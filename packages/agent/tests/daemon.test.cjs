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
    fs.writeFileSync(runtime, JSON.stringify({ ...a, version: 'old' }));
    const next = await launch();
    assert.notEqual(next.pid, a.pid);
    process.kill(next.pid, 'SIGKILL');
    assert.notEqual((await launch()).pid, next.pid);
  },
);
