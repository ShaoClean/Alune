const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { SSHConnection } = require('../dist/connection-manager');
const { GitCommands } = require('../dist/git-commands');
const stream = () =>
  Object.assign(new EventEmitter(), {
    stderr: new EventEmitter(),
    closed: false,
    close() {
      this.closed = true;
    },
  });
const connection = (exec) =>
  Object.assign(new SSHConnection({ host: 'fixture.invalid', username: 'fixture' }), {
    _connected: true,
    client: { exec },
  });

test('UTF-8 paths remain exact when SSH splits a character across chunks', async () => {
  const channel = stream();
  const conn = connection((_command, done) => done(null, channel));
  const pending = new GitCommands(conn).status('/repo');
  const output = Buffer.from('# branch.head main\0? 目录/中文.txt\0');
  for (const byte of output) channel.emit('data', Buffer.from([byte]));
  channel.emit('close', 0);
  assert.equal((await pending).files[0].path, '目录/中文.txt');
});

test('a cancelled status closes only its channel; other repository commands still complete', async () => {
  const channels = [];
  const conn = connection((command, callback) => {
    const channel = stream();
    channels.push(channel);
    callback(null, channel);
  });
  const controller = new AbortController();
  const git = new GitCommands(conn);
  const slow = git.status('/slow', controller.signal);
  const fast = git.status('/fast');
  controller.abort(new Error('status deadline'));
  await assert.rejects(slow, /status deadline/);
  assert.equal(channels[0].closed, true);
  assert.equal(channels[1].closed, false);
  assert.equal(conn.connected, true);
  channels[1].emit('data', Buffer.from('# branch.head main\0# branch.ab +2 -1\0? note.txt\0'));
  channels[1].emit('close', 0);
  const result = await fast;
  assert.equal(result.files.length, 1);
  assert.equal(result.branch, 'main');
  assert.equal(result.ahead, 2);
  assert.equal(result.behind, 1);
});

test('bounded commands close only their own channel and count stderr against the limit', async () => {
  const channel = stream();
  const conn = connection((_command, done) => done(null, channel));
  const pending = conn.execCommand('diff', undefined, undefined, { maxOutputBytes: 5 });
  channel.emit('data', Buffer.from('1234'));
  channel.stderr.emit('data', Buffer.from('56'));
  await assert.rejects(pending, /preview limit/);
  assert.equal(channel.closed, true);
  assert.equal(conn.connected, true);
});

test('UTF-8 survives split SSH packets and invalid text can be rejected for previews', async () => {
  const channel = stream();
  const conn = connection((_command, done) => done(null, channel));
  const pending = conn.execCommand('diff', undefined, undefined, { strictUtf8: true });
  const bytes = Buffer.from('中文');
  channel.emit('data', bytes.subarray(0, 2));
  channel.emit('data', bytes.subarray(2));
  channel.emit('close', 0);
  assert.equal((await pending).stdout, '中文');
  const bad = stream();
  conn.client.exec = (_command, done) => done(null, bad);
  const invalid = conn.execCommand('diff', undefined, undefined, { strictUtf8: true });
  bad.emit('data', Buffer.from([0xff]));
  bad.emit('close', 0);
  await assert.rejects(invalid, /encoded data/);
});

test('a channel opened after cancellation is immediately closed', async () => {
  let callback;
  const conn = connection((command, done) => {
    callback = done;
  });
  const controller = new AbortController();
  const pending = conn.execCommand('git status', undefined, controller.signal);
  controller.abort(new Error('timeout'));
  await assert.rejects(pending, /timeout/);
  const late = stream();
  callback(null, late);
  assert.equal(late.closed, true);
});

test('stream errors fail the request and an already aborted signal never starts a command', async () => {
  let calls = 0;
  const channel = stream();
  const conn = connection((command, done) => {
    calls++;
    done(null, channel);
  });
  const pending = conn.execCommand('git status');
  channel.emit('error', new Error('channel failed'));
  await assert.rejects(pending, /channel failed/);
  await assert.rejects(
    conn.execCommand('git status', undefined, AbortSignal.abort(new Error('cancelled'))),
    /cancelled/,
  );
  assert.equal(calls, 1);
});
