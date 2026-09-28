const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { SSHConnection } = require('../dist/connection-manager');

function connectionFixture() {
  const opened = [];
  const connection = new SSHConnection({ host: 'fixture', username: 'fixture' });
  connection._connected = true;
  connection.client = {
    exec(command, callback) {
      opened.push({ command, callback });
    },
    sftp(callback) {
      opened.push({ command: 'sftp', callback });
    },
    destroy() {},
  };
  const accept = (index) => {
    const stream = new EventEmitter();
    stream.stderr = new EventEmitter();
    stream.close = () => {
      stream.closeRequested = true;
    };
    stream.end = stream.close;
    stream.complete = (exitCode = 0) => stream.emit('close', exitCode);
    opened[index].callback(undefined, stream);
    return stream;
  };
  return { connection, opened, accept };
}

test('streaming, buffered commands and SFTP share slots until their channels close', async () => {
  const { connection, opened, accept } = connectionFixture();
  const stdout = [];
  const streaming = connection.execCommandStream('stream', {
    onStdout: (value) => stdout.push(value),
  });
  const commands = [connection.execCommand('one'), connection.execCommand('two')];
  const sftp = connection.withSftp(async () => 'file');
  const pending = connection.execCommand('later');
  assert.equal(opened.length, 4);
  assert.equal(connection.activeTasks, 5);
  const channels = Array.from({ length: 4 }, (_, index) => accept(index));
  await streaming;
  channels[0].emit('data', Buffer.from('progress'));
  assert.deepEqual(stdout, ['progress']);
  assert.equal(await sftp, 'file');
  assert.equal(channels[3].closeRequested, true);
  assert.equal(connection.activeTasks, 5);
  assert.equal(opened.length, 4);
  channels[3].complete();
  assert.equal(opened.length, 5);
  accept(4).complete();
  channels.slice(0, 3).forEach((channel) => channel.complete());
  assert.ok((await Promise.all([...commands, pending])).every((result) => result.exitCode === 0));
  assert.equal(connection.activeTasks, 0);
});

test('cancelled queued commands never execute; cancelled opens retain their slot until close', async () => {
  const { connection, opened, accept } = connectionFixture();
  const openingAbort = new AbortController();
  const queuedAbort = new AbortController();
  const cancelledOpen = connection.execCommand('cancel opening', undefined, openingAbort.signal);
  const running = Array.from({ length: 3 }, (_, index) =>
    connection.execCommand(`running ${index}`),
  );
  const cancelledQueue = connection.execCommand('cancel queued', undefined, queuedAbort.signal);
  const next = connection.execCommand('next');
  assert.equal(connection.activeTasks, 6);
  const rejected = [
    assert.rejects(cancelledOpen, /cancel opening/),
    assert.rejects(cancelledQueue, /cancel queued/),
  ];
  openingAbort.abort(new Error('cancel opening'));
  queuedAbort.abort(new Error('cancel queued'));
  await Promise.all(rejected);
  assert.equal(connection.activeTasks, 5);
  assert.equal(opened.length, 4);
  const cancelledChannel = accept(0);
  assert.equal(cancelledChannel.closeRequested, true);
  assert.equal(cancelledChannel.listenerCount('data'), 1);
  assert.equal(cancelledChannel.stderr.listenerCount('data'), 1);
  assert.equal(opened.length, 4);
  cancelledChannel.complete();
  assert.deepEqual(
    opened.map((item) => item.command),
    ['cancel opening', 'running 0', 'running 1', 'running 2', 'next'],
  );
  for (let i = 1; i < 5; i++) accept(i).complete();
  await Promise.all([...running, next]);
  assert.equal(connection.activeTasks, 0);
});

test('output limits close only the failing channel and unblock queued commands after close', async () => {
  const { connection, opened, accept } = connectionFixture();
  const limited = connection.execCommand('limited', undefined, undefined, { maxOutputBytes: 2 });
  const running = Array.from({ length: 4 }, () => connection.execCommand('normal'));
  const rejected = assert.rejects(limited, /preview limit/);
  const channel = accept(0);
  channel.emit('data', Buffer.from('too long'));
  await rejected;
  assert.equal(channel.closeRequested, true);
  assert.equal(opened.length, 4);
  channel.complete();
  assert.equal(opened.length, 5);
  for (let i = 1; i < 5; i++) accept(i).complete();
  await Promise.all(running);
  assert.equal(connection.connected, true);
});

test('disconnect rejects queued and opening work and disposes late channels', async () => {
  const { connection, opened, accept } = connectionFixture();
  const work = Array.from({ length: 6 }, () => connection.execCommand('pending'));
  const rejected = work.map((promise) => assert.rejects(promise, /SSH connection closed/));
  connection.disconnect();
  await Promise.all(rejected);
  assert.equal(opened.length, 4);
  for (let i = 0; i < 4; i++) {
    const channel = accept(i);
    assert.equal(channel.closeRequested, true);
    channel.complete();
  }
  assert.equal(opened.length, 4);
  await assert.rejects(connection.execCommand('disconnected'), /not established/);
  await assert.rejects(
    connection.withSftp(async () => {}),
    /not established/,
  );
});

test('only refused channel opens retry, once; command failures and policy denial are preserved', async () => {
  for (const reason of [2, 4, 1]) {
    const { connection, opened } = connectionFixture();
    const failure = Object.assign(new Error('Channel open failure'), { reason });
    const result = assert.rejects(connection.execCommand('refused'), (error) => error === failure);
    opened[0].callback(failure);
    if (reason !== 1) opened[1].callback(failure);
    await result;
    assert.equal(opened.length, reason === 1 ? 1 : 2);
  }
  const { connection, opened, accept } = connectionFixture();
  const result = connection.execCommand('write fails');
  const stream = accept(0);
  stream.stderr.emit('data', Buffer.from('permission denied'));
  stream.complete(1);
  assert.deepEqual(await result, { exitCode: 1, stdout: '', stderr: 'permission denied' });
  assert.equal(opened.length, 1);
});

test('SFTP timeout cancels queued opens and closes a late acknowledgement without running the operation', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { connection, opened, accept } = connectionFixture();
  let operations = 0;
  const operation = async () => {
    operations++;
  };
  const opening = connection.withSftp(operation);
  const commands = Array.from({ length: 3 }, () => connection.execCommand('running'));
  const queued = connection.withSftp(operation);
  const rejected = [opening, queued].map((promise) => assert.rejects(promise, /远端文件操作超时/));
  t.mock.timers.tick(15000);
  await Promise.all(rejected);
  const late = accept(0);
  assert.equal(late.closeRequested, true);
  late.complete();
  for (let i = 1; i < 4; i++) accept(i).complete();
  await Promise.all(commands);
  assert.equal(opened.length, 4);
  assert.equal(operations, 0);
});
