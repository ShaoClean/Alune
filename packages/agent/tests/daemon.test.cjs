const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { exec } = require('node:child_process');
const { promisify } = require('node:util');
const { randomUUID } = require('node:crypto');
const { runtimeCommands } = require('../dist/adapters/ssh/commands');
const version = require('../dist/version.json').version;

test(
  'Unix daemon serializes launches, authenticates clients and replaces stale versions and crashed processes',
  { skip: process.platform === 'win32', timeout: 60000 },
  async (t) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-daemon-'));
    const runtime = path.join(home, '.alune-ssh/daemon/server-runtime.json');
    const bundle = {
      version,
      target: process.platform + '-' + process.arch,
      url: 'https://example.invalid/agent',
      sha256: '0'.repeat(64),
    };
    const command = runtimeCommands(bundle, randomUUID()).serve(
      path.resolve(__dirname, '../bin/alune-agent.cjs'),
      true,
    );
    const launch = async () =>
      JSON.parse(
        (
          await promisify(exec)(command, {
            env: { ...process.env, HOME: home, ALUNE_AGENT_DATA_DIR: path.join(home, 'data') },
          })
        ).stdout,
      );
    t.after(() => {
      if (fs.existsSync(runtime)) {
        try {
          process.kill(JSON.parse(fs.readFileSync(runtime)).pid);
        } catch (e) {
          if (e.code !== 'ESRCH') throw e;
        }
      }
      fs.rmSync(home, { recursive: true, force: true });
    });
    const [a, b] = await Promise.all([launch(), launch()]);
    assert.equal(a.pid, b.pid);
    assert.equal(fs.statSync(runtime).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(runtime)).mode & 0o777, 0o700);
    for (const payload of ['x', 'z'.repeat(64) + '00000', null]) {
      const socket = net.connect(a.port, '127.0.0.1');
      const closed = once(socket, 'close');
      if (payload) socket.end(payload);
      await closed;
    }
    assert.equal((await launch()).pid, a.pid);
    const { AgentClient, SocketTransport } = require('@alune/agent-client/node');
    const client = new AgentClient(
      new SocketTransport(net.connect(a.port, '127.0.0.1'), { token: a.token }),
    );
    await client.initialize();
    const repo = path.join(home, 'repo');
    fs.mkdirSync(repo);
    require('node:child_process').execFileSync('git', ['init', '-q', repo]);
    const { resource } = await client.registerRepository(repo);
    await client.subscribe(require('./terminal-scenario.cjs').topics);
    const id = randomUUID();
    await client.request('terminals.create', { requestId: id, resource, cols: 80, rows: 24 });
    fs.writeFileSync(runtime, JSON.stringify({ ...a, version: 'old' }));
    const guarded = await launch();
    assert.equal(guarded.upgradeRequired, a.pid);
    assert.ok(guarded.activity.includes(id));
    assert.ok((await client.listTerminals()).some((shell) => shell.id === id));
    await client.request('terminals.close', { sessionId: id, confirmed: true });
    client.close();
    const next = await launch();
    assert.notEqual(next.pid, a.pid);
    const manage = async (action) =>
      JSON.parse(
        (
          await promisify(exec)(
            runtimeCommands(bundle, randomUUID()).serve(
              path.resolve(__dirname, '../bin/alune-agent.cjs'),
              true,
              undefined,
              action,
            ),
            { env: { ...process.env, HOME: home, ALUNE_AGENT_DATA_DIR: path.join(home, 'data') } },
          )
        ).stdout,
      );
    const versions = path.join(home, '.alune-ssh/runtime/versions');
    for (const v of [version, '0.0.0-old']) {
      const dir = path.join(versions, v, bundle.target);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, '.install-complete'), 'fixture');
    }
    assert.match(await manage('versions'), /0.0.0-old/);
    await manage('clean');
    assert(fs.existsSync(path.join(versions, version, bundle.target, '.install-complete')));
    assert(!fs.existsSync(path.join(versions, '0.0.0-old')));
    fs.appendFileSync(path.join(home, '.alune-ssh/daemon/server.log'), 'diagnostic marker');
    assert.match(await manage('logs'), /diagnostic marker/);
    await manage('restart');
    const restarted = await launch();
    assert.notEqual(restarted.pid, next.pid);
    await manage('stop');
    assert(!fs.existsSync(runtime));
    process.kill((await launch()).pid, 'SIGKILL');
    assert.notEqual((await launch()).pid, next.pid);
  },
);
