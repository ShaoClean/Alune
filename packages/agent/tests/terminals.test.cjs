const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { spawnAgent } = require('@alune/agent-client/node');
const { terminalScenario, until, topics } = require('./terminal-scenario.cjs');
async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-p5-')),
    repo = path.join(directory, 'registered repo');
  const children = [];
  t.after(async () => {
    await Promise.all(children.map((c) => c.close()));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  fs.mkdirSync(repo);
  execFileSync('git', ['init', '-q', repo]);
  const start = async () => {
    const child = spawnAgent(
      process.execPath,
      [
        path.join(__dirname, '../bin/alune-agent.cjs'),
        'serve',
        '--data-dir',
        path.join(directory, 'state'),
      ],
      { env: { ...process.env, ...(process.platform === 'win32' ? {} : { SHELL: '/bin/sh' }) } },
    );
    children.push(child);
    await child.client.initialize();
    return child;
  };
  const child = await start(),
    { resource, path: registered } = await child.client.registerRepository(repo);
  return { child, resource, repo: registered, start };
}
test('real stdio PTYs: cwd, independent parser ACKs, input, resize, confirmation and exit', async (t) => {
  const { child, resource, repo } = await fixture(t);
  await terminalScenario(child.client, resource, repo);
});
for (const crash of [false, true])
  test(
    'foreground process is reaped after ' +
      (crash ? 'abrupt Agent death' : 'stdio EOF') +
      '; restart cannot recover its session',
    async (t) => {
      const { child, resource, repo, start } = await fixture(t),
        c = child.client;
      await c.subscribe(topics);
      const id = randomUUID();
      let running = false;
      c.onEvent(({ type, payload: p }) => {
        if (type === 'terminal:state' && p.state === 'running') running = true;
        if (type === 'terminal:output')
          void c.request('terminals.ack', { sessionId: id, sequence: p.sequence }).catch(() => {});
      });
      await c.request('terminals.create', { resource, requestId: id, cols: 80, rows: 24 });
      await until(() => running, 'shell starts');
      const file = path.join(repo, 'child.pid');
      fs.writeFileSync(
        path.join(repo, 'job.cjs'),
        "require('fs').writeFileSync('child.pid',String(process.pid));setInterval(()=>{},1000)",
      );
      await c.request('terminals.input', {
        sessionId: id,
        data: '"' + process.execPath + '" job.cjs\r',
      });
      await until(
        () => fs.existsSync(file) && Number(fs.readFileSync(file, 'utf8')) > 0,
        'foreground job starts',
      );
      const pid = Number(fs.readFileSync(file, 'utf8'));
      await assert.rejects(
        c.request('repositories.unregister', { resource }),
        (e) => e.kind === 'conflict',
      );
      if (crash) child.process.kill('SIGKILL');
      else child.process.stdin.end();
      const exit = await child.exited;
      if (!crash) assert.equal(exit.code, 0, 'EOF must finish within the Agent shutdown deadline');
      await until(() => {
        try {
          process.kill(pid, 0);
          return false;
        } catch (e) {
          return e.code === 'ESRCH';
        }
      }, 'foreground job reaped');
      const fresh = (await start()).client;
      assert.deepEqual(await fresh.request('terminals.list', {}), []);
      await assert.rejects(
        fresh.request('terminals.input', { sessionId: id, data: 'x' }),
        (e) => e.kind === 'conflict',
      );
    },
  );
