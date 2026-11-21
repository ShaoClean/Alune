const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { AgentHost } = require('../dist/server/host');
const { AgentClient, SocketTransport } = require('@alune/agent-client/node');
const { topics, until } = require('./terminal-scenario.cjs');

test(
  'resident host replays a detached PTY and reconciles a detached Git commit',
  {
    skip: process.platform === 'win32',
    timeout: 30000,
  },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-reconnect-'));
    const gate = path.join(root, 'release');
    t.after(async () => {
      fs.writeFileSync(gate, '');
      await host.close();
      fs.rmSync(root, { recursive: true, force: true });
    });
    const connect = async () => {
      const [server, socket] = require('node:stream').duplexPair();
      await host.connect(
        () => new SocketTransport(server),
        undefined,
        () => true,
      );
      const client = new AgentClient(new SocketTransport(socket));
      await client.initialize();
      await client.subscribe([...topics, 'commands.output', 'commands.exit']);
      return client;
    };
    const repo = path.join(root, 'repo');
    fs.mkdirSync(repo);
    const git = (...args) =>
      execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
    git('init', '-q');
    git('config', 'user.name', 'Fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    git('config', 'commit.gpgsign', 'false');
    let idle = false;
    const host = new AgentHost(
      path.join(root, 'state'),
      randomUUID(),
      'test',
      () => {
        idle = true;
      },
      150,
    );
    let client = await connect();
    const { resource } = await client.registerRepository(repo);
    const id = randomUUID();
    let running = false;
    client.onEvent(({ type, payload }) => {
      if (type === 'terminal:state' && payload.state === 'running') running = true;
    });
    // A deterministic shell entry point lets the test observe the foreground
    // job before dropping the connection, independently of runner login files.
    const shellPath = path.join(repo, 'output.sh');
    fs.writeFileSync(path.join(repo, 'output-data'), 'x'.repeat(180000));
    fs.writeFileSync(
      shellPath,
      [
        '#!/bin/sh',
        'touch output-started',
        'while [ ! -f allow-output ]; do sleep 0.05; done',
        'echo evicted-marker',
        'cat output-data',
        'echo "offline-marker-$$"',
        'touch output-finished',
        'exec /bin/sh -i',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
    const originalShell = process.env.SHELL;
    process.env.SHELL = shellPath;
    try {
      await client.request('terminals.create', { requestId: id, resource, cols: 90, rows: 32 });
      await until(
        () => running && fs.existsSync(path.join(repo, 'output-started')),
        'PTY job ready',
      );
    } finally {
      if (originalShell === undefined) delete process.env.SHELL;
      else process.env.SHELL = originalShell;
    }
    const viewer = await connect();
    let mirrored = '';
    viewer.onEvent(({ type, payload }) => {
      if (type === 'terminal:output') {
        mirrored += payload.data;
        void viewer
          .request('terminals.ack', { sessionId: id, sequence: payload.sequence })
          .catch(() => {});
      }
    });
    assert.equal((await viewer.attachTerminal(id)).readOnly, true);
    await assert.rejects(
      viewer.request('terminals.resize', { sessionId: id, cols: 70, rows: 20 }),
      (e) => e.kind === 'conflict',
    );
    await assert.rejects(
      viewer.request('terminals.input', { sessionId: id, data: 'x' }),
      (e) => e.kind === 'conflict',
    );
    assert.equal((await client.listTerminals())[0].cols, 90);
    client.close();
    fs.writeFileSync(path.join(repo, 'allow-output'), '');
    await until(() => fs.existsSync(path.join(repo, 'output-finished')), 'offline job finished');
    await until(() => mirrored.includes('offline-marker-'), 'viewer receives independent output');
    viewer.close();
    await delay(200);
    assert.equal(idle, false);
    client = await connect();
    const [shell] = await client.listTerminals();
    assert.equal(shell.id, id);
    assert.equal(shell.cols, 90);
    let output = '';
    client.onEvent(({ type, payload }) => {
      if (type === 'terminal:output') {
        output += payload.data;
        void client
          .request('terminals.ack', { sessionId: id, sequence: payload.sequence })
          .catch(() => {});
      }
    });
    await client.attachTerminal(id);
    await until(() => /offline-marker-\d+/.test(output), 'offline replay');
    assert.doesNotMatch(output, /evicted-marker/);
    assert.ok(Buffer.byteLength(output) <= 128 * 1024);
    await client.request('terminals.input', { sessionId: id, data: 'echo "live-marker-$$"\r' });
    await until(() => /live-marker-\d+/.test(output), 'live output');
    assert.equal(output.match(/offline-marker-(\d+)/)[1], output.match(/live-marker-(\d+)/)[1]);
    await client.request('terminals.close', { sessionId: id, confirmed: true });
    git('add', 'output.sh');
    const hook = path.join(repo, '.git/hooks/pre-commit');
    fs.writeFileSync(
      hook,
      '#!/bin/sh\ntouch ../entered\nwhile [ ! -f ../release ]; do sleep 0.05; done\n',
      { mode: 0o755 },
    );
    git('config', 'core.hooksPath', path.dirname(hook));
    const intent = { resource, kind: 'commit', args: ['detached commit'] };
    const request = {
      ...intent,
      revision: await client.prepareRepositoryWrite(intent),
      operationId: randomUUID(),
    };
    const result = client.writeRepository(request).catch((e) => e);
    await until(() => fs.existsSync(path.join(root, 'entered')), 'Git entered hook');
    client.close();
    await result;
    await delay(300);
    assert.equal(idle, false);
    client = await connect();
    assert.equal(
      (await client.interruptedTasks()).find((t) => t.taskId === request.operationId)?.state,
      'running',
    );
    fs.writeFileSync(gate, '');
    let receipt;
    for (let i = 0; i < 100; i++) {
      receipt = await client.getTask({ taskId: request.operationId });
      if (receipt.task.state !== 'running') break;
      await delay(25);
    }
    assert.equal(receipt.task.state, 'succeeded');
    await assert.rejects(client.writeRepository(request), (e) => e.kind === 'duplicate-request');
    assert.equal(git('rev-list', '--count', 'HEAD'), '1');
    client.close();
    await until(() => idle, 'idle host expires');
  },
);
