const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  { EventEmitter } = require('node:events');
const { openWindowAgentChannel } = require('../src/agent-window-channel.cjs');
function fixture() {
  const contents = new EventEmitter(),
    sent = [],
    waiting = [],
    channels = new Map();
  const frame = { send: (...a) => sent.push(a) };
  contents.mainFrame = frame;
  contents.isDestroyed = () => false;
  const host = { open: () => new Promise((resolve) => waiting.push(resolve)) };
  const open = () =>
    openWindowAgentChannel({
      host,
      contents,
      frame,
      name: 'workspace',
      channels,
      isCurrent: () => true,
    });
  const channel = () => ({
    closed: 0,
    close() {
      this.closed++;
      this.ended?.();
    },
    onFrame(fn) {
      this.emit = fn;
    },
    onEnd(fn) {
      this.ended = fn;
    },
  });
  return { contents, frame, sent, waiting, channels, open, channel };
}
test('same-frame navigation invalidates a pending open before the replacement document opens', async () => {
  const f = fixture(),
    first = f.open();
  f.contents.emit('did-start-navigation', {}, { isMainFrame: true, isSameDocument: false });
  const second = f.open(),
    old = f.channel(),
    current = f.channel();
  void second.catch(() => {});
  const rejected = assert.rejects(first, /window changed/);
  f.waiting[0](old);
  f.waiting[1](current);
  await rejected;
  const generation = await second;
  assert.equal(old.closed, 1);
  assert.equal(current.closed, 0);
  assert.equal(f.channels.get(f.contents).generation, generation);
  current.emit('fresh');
  assert.deepEqual(f.sent, [['agent:frame', generation, 'fresh']]);
  f.channels.get(f.contents).cleanup();
});

test('pending opens reject duplicates without allocating another channel; SPA and subframe navigation preserve ownership', async () => {
  const f = fixture(),
    opening = f.open();
  await assert.rejects(f.open(), /unavailable/);
  assert.equal(f.waiting.length, 1);
  f.contents.emit('did-start-navigation', {}, { isMainFrame: true, isSameDocument: true });
  f.contents.emit('did-start-navigation', {}, { isMainFrame: false, isSameDocument: false });
  const c = f.channel();
  f.waiting[0](c);
  await opening;
  assert.equal(c.closed, 0);
  assert.equal(f.contents.listenerCount('did-start-navigation'), 1);
  f.contents.emit('did-start-navigation', {}, 'http://fixture/new', false, true);
  assert.equal(c.closed, 1);
  assert.equal(f.channels.size, 0);
  assert.equal(f.contents.listenerCount('did-start-navigation'), 0);
});

test('late frames/end from a retired channel never reach or close the replacement document', async () => {
  const f = fixture(),
    a = f.open(),
    old = f.channel();
  f.waiting[0](old);
  await a;
  f.contents.emit('did-start-navigation', {}, { isMainFrame: true, isSameDocument: false });
  const b = f.open(),
    next = f.channel();
  f.waiting[1](next);
  const generation = await b;
  old.emit('stale');
  old.ended();
  assert.deepEqual(f.sent, []);
  assert.equal(next.closed, 0);
  assert.equal(f.channels.get(f.contents).generation, generation);
  next.emit('fresh');
  assert.deepEqual(f.sent, [['agent:frame', generation, 'fresh']]);
  f.channels.get(f.contents).cleanup();
});

test('renderer loss during acquisition retires the pending channel and releases listeners', async () => {
  for (const event of ['destroyed', 'render-process-gone']) {
    const f = fixture(),
      p = f.open();
    const rejected = assert.rejects(p, /window changed/);
    f.contents.emit(event);
    const c = f.channel();
    f.waiting[0](c);
    await rejected;
    assert.equal(c.closed, 1);
    assert.equal(f.channels.size, 0);
    for (const name of ['did-start-navigation', 'destroyed', 'render-process-gone'])
      assert.equal(f.contents.listenerCount(name), 0);
  }
});

test('frame replacement during acquisition rejects the stale owner even without a navigation callback', async () => {
  const f = fixture(),
    p = f.open(),
    rejected = assert.rejects(p, /window changed/);
  f.contents.mainFrame = {
    send() {
      assert.fail('must not address replacement frame');
    },
  };
  const c = f.channel();
  f.waiting[0](c);
  await rejected;
  assert.equal(c.closed, 1);
  assert.equal(f.channels.size, 0);
  assert.equal(f.contents.listenerCount('did-start-navigation'), 0);
});

test('failed acquisition clears its lease so the same document can try again', async () => {
  const contents = new EventEmitter(),
    frame = { send() {} },
    channels = new Map();
  contents.mainFrame = frame;
  contents.isDestroyed = () => false;
  const error = new Error('host acquisition failed');
  await assert.rejects(
    openWindowAgentChannel({
      host: {
        open: async () => {
          throw error;
        },
      },
      contents,
      frame,
      name: 'workspace',
      channels,
      isCurrent: () => true,
    }),
    (e) => e === error,
  );
  assert.equal(channels.size, 0);
  for (const name of ['did-start-navigation', 'destroyed', 'render-process-gone'])
    assert.equal(contents.listenerCount(name), 0);
});

test('current Electron first-argument navigation details fence document changes', async () => {
  const f = fixture(),
    pending = f.open(),
    old = f.channel();
  f.contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
  f.contents.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false });
  assert.equal(f.channels.size, 1);
  f.waiting[0](old);
  await pending;
  f.contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  assert.equal(old.closed, 1);
  assert.equal(f.channels.size, 0);
  const next = f.open(),
    c = f.channel();
  f.waiting[1](c);
  await next;
  assert.equal(c.closed, 0);
  f.channels.get(f.contents).cleanup();
});
test('current Electron navigation also retires an uncompleted acquisition', async () => {
  const f = fixture(),
    pending = f.open(),
    rejected = assert.rejects(pending, /window changed/);
  f.contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  const c = f.channel();
  f.waiting[0](c);
  await rejected;
  assert.equal(c.closed, 1);
  assert.equal(f.channels.size, 0);
});
