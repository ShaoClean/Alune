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
  channels[1].emit('data', Buffer.from('# branch.head main\n# branch.ab +2 -1\n? note.txt\n'));
  channels[1].emit('close', 0);
  const result = await fast;
  assert.equal(result.files.length, 1);
  assert.equal(result.ahead, 2);
  assert.equal(result.behind, 1);
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
