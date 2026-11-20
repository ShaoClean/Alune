const assert = require('node:assert/strict');
const { createHash, randomBytes } = require('node:crypto');
const { once, EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { Client } = require('ssh2');
const { startSSHServer } = require('./helpers/ssh-server.cjs');
const {
  SftpUnavailableError,
  uploadArchive,
  uploadArchiveViaSftp,
} = require('../dist/adapters/ssh/upload');

test(
  'uploadArchiveViaSftp streams an archive with real ACK progress and supports resume',
  { skip: process.platform === 'win32' },
  async () => {
    const server = await startSSHServer();
    const ssh = new Client();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-sftp-upload-'));
    try {
      const ready = once(ssh, 'ready');
      ssh.connect(server.options);
      await ready;
      const openSftp = () =>
        new Promise((resolve, reject) => {
          ssh.sftp((err, sftp) => (err ? reject(err) : resolve(sftp)));
        });
      const archive = randomBytes(3 * 1024 * 1024 + 137);
      const digest = createHash('sha256').update(archive).digest('hex');
      const remoteDir = path.join(dir, '.alune-ssh');
      const remotePart = path.join(remoteDir, `upload-${digest}.part`);

      // Fresh upload
      const progress = [];
      const fresh = await uploadArchiveViaSftp(
        openSftp,
        remoteDir,
        remotePart,
        archive,
        new AbortController().signal,
        (p) => progress.push(p),
      );
      assert.equal(fresh.resumed, false);
      assert.equal(fresh.resumedFrom, 0);
      assert.equal(progress[0].transferred, 0);
      assert.equal(progress.at(-1).transferred, archive.length);
      assert.equal(progress.at(-1).percent, 100);
      assert.equal(createHash('sha256').update(fs.readFileSync(remotePart)).digest('hex'), digest);

      // Partial resume upload
      const partialSize = 1024 * 1024 + 19;
      fs.writeFileSync(remotePart, archive.subarray(0, partialSize));
      const resumeProgress = [];
      const resumed = await uploadArchiveViaSftp(
        openSftp,
        remoteDir,
        remotePart,
        archive,
        new AbortController().signal,
        (p) => resumeProgress.push(p),
      );
      assert.equal(resumed.resumed, true);
      assert.equal(resumed.resumedFrom, partialSize);
      assert.equal(resumeProgress[0].transferred, partialSize);
      assert.equal(resumeProgress.at(-1).transferred, archive.length);
      assert.equal(resumeProgress.at(-1).percent, 100);
      assert.equal(createHash('sha256').update(fs.readFileSync(remotePart)).digest('hex'), digest);
    } finally {
      ssh.destroy();
      await server.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

test('uploadArchiveViaSftp throws SftpUnavailableError when SFTP subsystem cannot open', async () => {
  await assert.rejects(
    uploadArchiveViaSftp(
      () => Promise.reject(new Error('Unable to start SFTP subsystem')),
      '.alune-ssh',
      '.alune-ssh/upload.part',
      Buffer.from('archive'),
      new AbortController().signal,
    ),
    (err) => err instanceof SftpUnavailableError,
  );
});

test('uploadArchiveViaSftp times out when remote SFTP stops acknowledging writes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let onWriteStarted;
  const writeStarted = new Promise((resolve) => {
    onWriteStarted = resolve;
  });
  const fakeSftp = Object.assign(new EventEmitter(), {
    mkdir(_dir, _attrs, cb) {
      cb();
    },
    stat(_p, cb) {
      cb(Object.assign(new Error('ENOENT'), { code: 2 }));
    },
    open(_p, _flags, _attrs, cb) {
      cb(null, Buffer.from([0, 0, 0, 1]));
    },
    write(_handle, _buf, _offset, _len, _pos, _cb) {
      onWriteStarted();
      // Never ACK to simulate a stalled remote SFTP server.
    },
    close(_handle, cb) {
      cb();
    },
    end() {},
  });
  const pending = uploadArchiveViaSftp(
    () => Promise.resolve(fakeSftp),
    '.alune-ssh',
    '.alune-ssh/upload.part',
    Buffer.from('archive'),
    new AbortController().signal,
    undefined,
    { idleTimeoutMs: 5_000 },
  );
  await writeStarted;
  t.mock.timers.tick(5_000);
  await assert.rejects(pending, { kind: 'timeout' });
});

test(
  'uploadArchive supports binary and base64-lines fallback streams and reports remote stderr',
  { skip: process.platform === 'win32' },
  async () => {
    const server = await startSSHServer();
    const ssh = new Client();
    try {
      const ready = once(ssh, 'ready');
      ssh.connect(server.options);
      await ready;
      const archive = randomBytes(512 * 1024 + 55);
      const digest = createHash('sha256').update(archive).digest('hex');

      // Binary mode
      const openBinary = () =>
        new Promise((resolve, reject) => {
          const cmd = `node -e 'const h = require("node:crypto").createHash("sha256"); process.stdin.on("data", b => h.update(b)).on("end", () => process.exit(h.digest("hex") === "${digest}" ? 0 : 1))'`;
          ssh.exec(cmd, (err, ch) => (err ? reject(err) : resolve(ch)));
        });
      const progress = [];
      await uploadArchive(openBinary, archive, new AbortController().signal, (p) =>
        progress.push(p),
      );
      assert.equal(progress[0].transferred, 0);
      assert.equal(progress.at(-1).transferred, archive.length);
      assert.equal(progress.at(-1).percent, 100);

      // Base64-lines mode with explicit END sentinel (used for Windows non-SFTP fallback)
      const openBase64 = () =>
        new Promise((resolve, reject) => {
          const cmd = `node -e 'const rl=require("node:readline").createInterface({input:process.stdin});const h=require("node:crypto").createHash("sha256");rl.on("line",l=>{const t=l.trim();if(t==="END"){process.exit(h.digest("hex")==="${digest}"?0:1)}if(t)h.update(Buffer.from(t,"base64"))})'`;
          ssh.exec(cmd, (err, ch) => (err ? reject(err) : resolve(ch)));
        });
      const b64Progress = [];
      await uploadArchive(
        openBase64,
        archive,
        new AbortController().signal,
        (p) => b64Progress.push(p),
        { encoding: 'base64-lines' },
      );
      assert.equal(b64Progress.at(-1).transferred, archive.length);
      assert.equal(b64Progress.at(-1).percent, 100);

      // Remote stderr diagnostic propagation
      const openFail = () =>
        new Promise((resolve, reject) => {
          ssh.exec('node -e \'process.stderr.write("disk full on target"); process.exit(1)\'', (err, ch) =>
            err ? reject(err) : resolve(ch),
          );
        });
      await assert.rejects(
        uploadArchive(openFail, Buffer.from('abc'), new AbortController().signal),
        /disk full on target/,
      );
    } finally {
      ssh.destroy();
      await server.close();
    }
  },
);

for (const stage of ['open', 'write', 'confirmation']) {
  test('stalled exec upload times out and remains cancellable during ' + stage, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const makeChannel = () =>
      Object.assign(new EventEmitter(), {
        resume() {},
        stderr: Object.assign(new EventEmitter(), { resume() {} }),
        end() {},
        close() {},
        write(_data, cb) {
          if (stage === 'confirmation') cb();
        },
      });
    const open = () => (stage === 'open' ? new Promise(() => {}) : Promise.resolve(makeChannel()));

    // Cancellable before timeout
    const controller = new AbortController();
    const cancellable = uploadArchive(open, Buffer.from('archive'), controller.signal, undefined, {
      idleTimeoutMs: 5_000,
      confirmTimeoutMs: 10_000,
    });
    await Promise.resolve();
    controller.abort();
    await assert.rejects(cancellable, { name: 'AbortError' });

    // Times out if stalled
    const timedOut = uploadArchive(
      open,
      Buffer.from('archive'),
      new AbortController().signal,
      undefined,
      { idleTimeoutMs: 5_000, confirmTimeoutMs: 10_000 },
    );
    await Promise.resolve();
    t.mock.timers.tick(stage === 'confirmation' ? 10_000 : 5_000);
    await assert.rejects(timedOut, { kind: 'timeout' });
  });
}
