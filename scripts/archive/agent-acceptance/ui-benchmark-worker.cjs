// P8 transport-side counterpart to the production HTTP/Socket.IO worker.
// Includes the launcher IPC, routing lookup and decoding; excludes the Chromium render pass.
module.exports = async function uiBenchmarkWorker(repo, count, directory) {
  const path = require('node:path');
  const { randomUUID } = require('node:crypto');
  const { launchUiAgent, AgentClient, frameTransport } = require('@alune/agent-client/node');
  process.env.SHELL = '/bin/sh';
  process.env.PS1 = 'ALUNE_BASELINE> ';
  const bundle = process.env.ALUNE_BENCH_PACKAGE;
  const runtime = bundle
    ? path.resolve(bundle, process.platform === 'win32' ? 'runtime/node.exe' : 'runtime/bin/node')
    : process.execPath;
  const entry = bundle
    ? path.resolve(bundle, 'node_modules/@alune/agent/bin/alune-agent.cjs')
    : path.resolve(__dirname, '../../../packages/agent/bin/alune-agent.cjs');
  const host = await launchUiAgent(runtime, entry, directory);
  const c = new AgentClient(frameTransport(await host.open('workspace')));
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const stop = () => {
    void host.close();
  };
  process.once('SIGTERM', stop);
  try {
    await c.initialize();
    await c.subscribe(['terminal:output', 'terminal:state', 'terminal:removed']);
    let session,
      output = '',
      running = false;
    c.onEvent(({ type, payload }) => {
      if (type === 'terminal:output' && payload.sessionId === session) {
        output += payload.data;
        void c
          .request('terminals.ack', { sessionId: session, sequence: payload.sequence })
          .catch(() => {});
      } else if (type === 'terminal:state' && payload.id === session)
        running = payload.state === 'running';
    });
    const { resource } = await c.registerRepository(repo);
    const until = async (f) => {
      const end = performance.now() + 10000;
      while (!f()) {
        if (performance.now() > end) throw Error('PTY benchmark timed out');
        await delay(1);
      }
    };
    const rows = [];
    for (let i = 0; i < count; i++) {
      const row = {};
      for (const [name, kind, params] of [
        ['status', 'status', { foreground: true }],
        ['diff', 'diff', { file: 'tracked.txt' }],
        ['history', 'log', { count: 50 }],
      ]) {
        const start = performance.now();
        const owner = await c.getRepository(resource);
        const value = await c.readRepository(owner.resource, kind, params);
        row[name] = performance.now() - start;
        if (
          (name === 'status' && !value.files.some((f) => f.path === 'tracked.txt')) ||
          (name === 'history' && value.commits.length !== 50) ||
          (name === 'diff' && !value.includes('modified'))
        )
          throw Error('Invalid ' + name + ' result');
      }
      session = randomUUID();
      running = false;
      output = '';
      await c.request('terminals.create', { resource, requestId: session, cols: 80, rows: 24 });
      await until(() => running);
      const start = performance.now();
      await c.request('terminals.input', {
        sessionId: session,
        data:
          JSON.stringify(process.execPath) +
          " -e \"process.stdout.write('X'.repeat(65536)+'\\nALUNE_BENCH_DONE\\n')\"\r",
      });
      await until(() => output.includes('\r\nALUNE_BENCH_DONE\r\n'));
      row.terminalOutput = performance.now() - start;
      if ((output.match(/X/g) || []).length < 65536) throw Error('Truncated PTY output');
      await c.request('terminals.close', { sessionId: session, confirmed: true });
      rows.push(row);
    }
    process.send({ rows, nodeMaxRssKiB: process.resourceUsage().maxRSS });
  } finally {
    process.off('SIGTERM', stop);
    c.close();
    await host.close();
  }
};
