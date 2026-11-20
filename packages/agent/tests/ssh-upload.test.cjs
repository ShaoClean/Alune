const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { once, EventEmitter } = require('node:events');
const { test } = require('node:test');
const { Client } = require('ssh2');
const { startSSHServer } = require('./helpers/ssh-server.cjs');
const { uploadArchive } = require('../dist/adapters/ssh/upload');

test(
  'upload streams an archive larger than the SSH window and waits for remote verification',
  { skip: process.platform === 'win32' },
  async () => {
    const server = await startSSHServer();
    const ssh = new Client();
    try {
      const ready = once(ssh, 'ready');
      ssh.connect(server.options);
      await ready;
      const archive = randomBytes(5 * 1024 * 1024);
      const digest = require('node:crypto').createHash('sha256').update(archive).digest('hex');
      const open = () =>
        new Promise((resolve, reject) => {
          const cmd = `node -e 'const h = require("node:crypto").createHash("sha256"); process.stdin.on("data", b => h.update(b)).on("end", () => process.exit(h.digest("hex") === "${digest}" ? 0 : 1))'`;
          ssh.exec(cmd, (err, ch) => (err ? reject(err) : resolve(ch)));
        });
      const progress = [];
      await uploadArchive(open, archive, new AbortController().signal, (p) => progress.push(p));
      assert.equal(progress[0].transferred, 0);
      assert.equal(progress.at(-1).transferred, archive.length);
      assert.equal(progress.at(-1).percent, 100);
    } finally {
      ssh.destroy();
      await server.close();
    }
  },
);

for (const stage of ['open', 'write', 'confirmation']) {
  test('stalled upload remains cancellable during ' + stage, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const ch = Object.assign(new EventEmitter(), {
      resume() {},
      stderr: { resume() {} },
      end() {},
      write(_data, cb) {
        if (stage === 'confirmation') cb();
      },
    });
    const open = () => (stage === 'open' ? new Promise(() => {}) : Promise.resolve(ch));
    const controller = new AbortController();
    const waiting = uploadArchive(open, Buffer.from('archive'), controller.signal);
    await Promise.resolve();
    t.mock.timers.tick(120_000);
    controller.abort();
    await assert.rejects(waiting, { name: 'AbortError' });
  });
}
