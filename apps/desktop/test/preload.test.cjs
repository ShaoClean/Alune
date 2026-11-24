const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { registerUpdateIPC } = require('../src/update-ipc.cjs');

function fixture(argv = []) {
  const exposed = {}, calls = [], ipc = new EventEmitter();
  let reply, failure, syncError;
  ipc.invoke = async (...args) => { calls.push(args); if (failure) throw failure; return reply; };
  ipc.send = (...args) => calls.push(args);
  ipc.sendSync = (...args) => { calls.push(args); return syncError; };
  const electron = { ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/preload.cjs'), 'utf8'), {
    require: (name) => { assert.equal(name, 'electron'); return electron; }, process: { argv },
  }, { filename: 'preload.cjs' });
  return { exposed, calls, ipc, setReply: (value) => { reply = value; },
    setFailure: (value) => { failure = value; }, setSyncError: (value) => { syncError = value; } };
}

const invokes = [
  ['aluneTray', 'getPreferences', 'tray:preferences'],
  ['desktopUpdates', 'getState', 'updates:state'],
  ['desktopUpdates', 'check', 'updates:check'],
  ['desktopUpdates', 'download', 'updates:download'],
  ['desktopUpdates', 'cancel', 'updates:cancel'],
  ['desktopUpdates', 'install', 'updates:install'],
  ['desktopUpdates', 'openFile', 'updates:open-file'],
  ['desktopUpdates', 'revealFile', 'updates:reveal-file'],
  ['aluneWorkspace', 'chooseDirectory', 'workspace:choose-directory'],
  ['aluneWorkspace', 'load', 'workspace:load'],
  ['aluneWorkspace', 'clear', 'workspace:clear'],
  ['aluneLogs', 'openWindow', 'logs:open-window'],
  ['aluneLogs', 'openDirectory', 'logs:open-directory'],
  ['aluneLogs', 'chooseDirectory', 'logs:choose-directory'],
];
for (const [bridge, method, channel] of invokes) {
  test(`preload ${channel} forwards no renderer arguments and preserves replies and rejection`, async () => {
    const f = fixture(), value = { fixture: channel };
    f.setReply(value);
    assert.equal(await f.exposed[bridge][method]('ignored-renderer-input'), value);
    assert.deepEqual(f.calls, [[channel]]);
    const error = new Error('isolated IPC failure');
    f.setFailure(error);
    await assert.rejects(f.exposed[bridge][method](), (actual) => actual === error);
    assert.deepEqual(f.calls, [[channel], [channel]]);
  });
}

for (const [bridge, method, channel] of [
  ['aluneTray', 'onSelect', 'tray:select'],
  ['aluneTray', 'onReadHead', 'tray:read-head'],
  ['aluneTerminal', 'onShutdownRequested', 'terminal:shutdown-request'],
  ['desktopUpdates', 'subscribe', 'updates:changed'],
]) {
  test(`preload ${channel} strips Electron event and independently removes listeners`, () => {
    const f = fixture(), first = [], second = [], payload = { requestId: 'isolated', status: 'available' };
    const offFirst = f.exposed[bridge][method]((...args) => first.push(args));
    const offSecond = f.exposed[bridge][method]((...args) => second.push(args));
    const event = { privileged: true };
    f.ipc.emit(channel, event, payload);
    assert.deepEqual(first, [[payload]]);
    assert.deepEqual(second, [[payload]]);
    offFirst(); offFirst();
    assert.equal(f.ipc.listenerCount(channel), 1);
    f.ipc.emit(channel, event, payload);
    assert.equal(first.length, 1);
    assert.equal(second.length, 2);
    offSecond();
    assert.equal(f.ipc.listenerCount(channel), 0);
  });
}

test('preload terminal:shutdown-response only accepts literal true confirmation', () => {
  const f = fixture();
  for (const confirmed of [true, false, 'true', 1, undefined])
    f.exposed.aluneTerminal.respondToShutdown('request-123', confirmed);
  assert.deepEqual(f.calls, [
    ['terminal:shutdown-response', 'request-123', true],
    ['terminal:shutdown-response', 'request-123', false],
    ['terminal:shutdown-response', 'request-123', false],
    ['terminal:shutdown-response', 'request-123', false],
    ['terminal:shutdown-response', 'request-123', false],
  ]);
});

test('window unload releases its Agent generation once without requesting an IPC reply', async () => {
  const f = fixture(['--alune-agent-ui']);
  const notifications = [];
  f.ipc.send = (...args) => notifications.push(args);
  f.setReply('generation-1');
  await f.exposed.aluneAgent.open();
  f.exposed.aluneAgent.close();
  f.exposed.aluneAgent.close();
  assert.deepEqual(notifications, [['agent:close', 'generation-1']]);
  assert.deepEqual(f.calls, [['agent:open']]);
});

test('preload workspace:save-sync preserves data and rejects a synchronous main-process error', async () => {
  const f = fixture(), value = { version: 1, path: '/isolated/中文' };
  await f.exposed.aluneWorkspace.save(value);
  assert.deepEqual(f.calls, [['workspace:save-sync', value]]);
  f.setSyncError('isolated disk write failed');
  await assert.rejects(f.exposed.aluneWorkspace.save(value), /isolated disk write failed/);
  assert.deepEqual(f.calls, [['workspace:save-sync', value], ['workspace:save-sync', value]]);
});

test('update IPC broadcasts exact state only to a live current-origin window and stops after disposal', () => {
  const service = new EventEmitter(), handlers = new Map(), calls = [];
  let origin = 'http://localhost:5173', url = origin + '/settings', destroyed = false;
  let window = { isDestroyed: () => destroyed, webContents: {
    getURL: () => url, send: (...args) => calls.push(args),
  } };
  const dispose = registerUpdateIPC({ service, getWindow: () => window, getOrigin: () => origin,
    ipcMain: { handle: (channel, fn) => handlers.set(channel, fn), removeHandler: (channel) => handlers.delete(channel) } });
  const state = { status: 'available', version: '1.2.3' };
  service.emit('state', state);
  assert.deepEqual(calls, [['updates:changed', state]]);
  for (const invalid of ['https://other.invalid/', 'about:blank', 'not a URL']) {
    url = invalid; service.emit('state', state);
  }
  url = origin; destroyed = true; service.emit('state', state);
  destroyed = false; window = null; service.emit('state', state);
  assert.equal(calls.length, 1);
  dispose();
  assert.equal(service.listenerCount('state'), 0);
  assert.equal(handlers.size, 0);
  service.emit('state', state);
  assert.equal(calls.length, 1);
});
