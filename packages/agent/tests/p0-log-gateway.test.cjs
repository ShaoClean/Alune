// Frozen gateway uses real disposable LogStore; decorators/socket/timer are explicit doubles.
// Successor integration uses actual Agent child processes, SDK, stdio, SQLite and EventQueue.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { spawnAgent } = require('@alune/agent-client/node');
const { EventQueue } = require('../dist');
const plain = (v) => JSON.parse(JSON.stringify(v));
const topic = 'diagnostics.logs.changed';
function record(name, value) {
  if (process.env.P0_LOG_GATEWAY_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_LOG_GATEWAY_PROOF_DIR, name + '.json'),
      JSON.stringify(value, null, 2) + '\n',
      { flag: 'wx' },
    );
}
function scratch(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-batch17-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function legacy(t) {
  assert(process.env.P0_LOG_GATEWAY_FROZEN, 'Use batch-17 replay driver');
  const metadata = [],
    modules = new Map(),
    timers = new Map(),
    sent = [],
    rooms = new Map();
  let serial = 0,
    listeners = 0;
  const websockets = Object.fromEntries(
    ['WebSocketGateway', 'WebSocketServer', 'SubscribeMessage', 'ConnectedSocket'].map((name) => [
      name,
      (...args) =>
        (...target) => {
          metadata.push({ name, args, member: target[1] });
        },
    ]),
  );
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const source = fs.readFileSync(path.join(process.env.P0_LOG_GATEWAY_FROZEN, file), 'utf8');
    const module = { exports: {} };
    const gateway = file.endsWith('events.gateway.ts');
    const output = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        experimentalDecorators: true,
      },
    }).outputText;
    vm.runInNewContext(
      output,
      {
        module,
        exports: module.exports,
        Error,
        Buffer,
        Date,
        process: { pid: process.pid },
        setInterval,
        clearInterval,
        setTimeout: gateway
          ? (fn, ms) => {
              const id = ++serial;
              timers.set(id, { fn, ms });
              return id;
            }
          : setTimeout,
        clearTimeout: gateway ? (id) => timers.delete(id) : clearTimeout,
        require(id) {
          if (id === 'node:fs') return fs;
          if (id === 'node:path') return path;
          if (id === '@nestjs/websockets') return websockets;
          if (id === '@nestjs/common') return {};
          if (id === '@alune/shared') return load('packages/shared/src/types/logging.ts');
          if (id === './redact') return load('apps/server/src/logging/redact.ts');
          if (id === '../logging/logger')
            return { logStore: () => observedStore, logger: { debug() {} } };
          throw Error('Unexpected frozen import: ' + id);
        },
      },
      { filename: file },
    );
    modules.set(file, module.exports);
    return module.exports;
  }
  const { LogStore } = load('apps/server/src/logging/log-store.ts');
  const store = new LogStore(scratch(t));
  t.after(() => store.close());
  const observedStore = {
    subscribe(fn) {
      const off = store.subscribe(fn);
      listeners++;
      return () => {
        listeners--;
        off();
      };
    },
  };
  const { EventsGateway } = load('apps/server/src/events/events.gateway.ts');
  const gateway = new EventsGateway();
  gateway.server = {
    sockets: { adapter: { rooms } },
    to(room) {
      return {
        emit(name, rows) {
          sent.push({ room, name, rows: plain(rows) });
        },
      };
    },
    emit() {
      assert.fail('Log entries must not broadcast globally');
    },
  };
  t.after(() => {
    if (listeners) gateway.onModuleDestroy();
  });
  return {
    gateway,
    store,
    metadata,
    rooms,
    timers,
    sent,
    get listeners() {
      return listeners;
    },
    flush() {
      assert.equal(timers.size, 1);
      const [id, timer] = [...timers][0];
      timers.delete(id);
      assert.equal(timer.ms, 100);
      timer.fn();
    },
  };
}
async function processes(t) {
  const directory = scratch(t),
    children = [];
  t.after(async () => {
    for (const child of children) await child.close();
  });
  return async (owner) => {
    let stderr = '';
    const child = spawnAgent(
      process.execPath,
      [path.join(__dirname, 'settings-fixture.cjs'), path.join(directory, owner)],
      {
        onStderr(text) {
          stderr += text;
        },
      },
    );
    children.push(child);
    await child.client.initialize();
    const events = [];
    child.client.onEvent((event) => events.push(event));
    return {
      ...child,
      events,
      get stderr() {
        return stderr;
      },
    };
  };
}
async function write(client, message) {
  assert.deepEqual(
    await client.request('diagnostics.logs.client', {
      level: 'ERROR',
      message,
      context: { password: 'gateway-test-private', visible: '中🦊' },
    }),
    { accepted: true },
  );
}
async function barrier(client) {
  await client.health();
}

test('P0 log gateway frozen subscription metadata joins only logs and batches ordered redacted rows at 100ms', (t) => {
  const f = legacy(t);
  assert(
    f.metadata.some(
      (x) =>
        x.name === 'SubscribeMessage' &&
        x.args[0] === 'logs:subscribe' &&
        x.member === 'subscribeLogs',
    ),
  );
  assert(f.metadata.some((x) => x.name === 'ConnectedSocket' && x.member === 'subscribeLogs'));
  const joins = [];
  assert.deepEqual(
    plain(
      f.gateway.subscribeLogs({
        join(room) {
          joins.push(room);
          return Promise.resolve();
        },
      }),
    ),
    { ok: true },
  );
  assert.deepEqual(joins, ['logs']);
  f.gateway.afterInit();
  assert.equal(f.listeners, 1);
  f.store.write('ERROR', 'gateway', 'no-audience');
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.sent, []);
  f.rooms.set('logs', new Set(['viewer']));
  f.store.write('ERROR', 'gateway', 'first', { password: 'gateway-test-private', visible: '中🦊' });
  f.store.write('WARN', 'gateway', 'second');
  assert.equal(f.timers.size, 1);
  assert.deepEqual(f.sent, []);
  f.flush();
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].room, 'logs');
  assert.equal(f.sent[0].name, 'log:entries');
  assert.deepEqual(
    f.sent[0].rows.map((e) => e.message),
    ['first', 'second'],
  );
  assert.equal(f.sent[0].rows[0].context.password, '[REDACTED]');
  assert.equal(f.sent[0].rows[0].context.visible, '中🦊');
  f.store.write('ERROR', 'gateway', 'next-batch');
  f.flush();
  assert.deepEqual(
    f.sent[1].rows.map((e) => e.message),
    ['next-batch'],
  );
  f.rooms.delete('logs');
  f.store.write('ERROR', 'gateway', 'no-longer-viewing');
  assert.equal(f.timers.size, 0);
  assert.equal(f.sent.length, 2);
  record('gateway-frozen-subscription', {
    metadata: f.metadata,
    joins,
    batchMs: 100,
    orderedBatchSizes: f.sent.map((e) => e.rows.length),
    redacted: true,
    noAudienceNoSend: true,
    boundaries:
      'actual frozen LogStore/gateway, socket/decorator/timer doubles; no WebSocket or Nest server',
  });
});

test('P0 log gateway frozen destroy detaches listener and cancels pending batch without late sends', (t) => {
  const f = legacy(t);
  f.gateway.afterInit();
  f.rooms.set('logs', new Set(['viewer']));
  f.store.write('ERROR', 'gateway', 'pending');
  assert.equal(f.timers.size, 1);
  assert.equal(f.listeners, 1);
  f.gateway.onModuleDestroy();
  assert.equal(f.listeners, 0);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.sent, []);
  f.store.write('ERROR', 'gateway', 'after-destroy');
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.sent, []);
  assert.deepEqual(
    plain(f.store.recent()).map((e) => e.message),
    ['pending', 'after-destroy'],
  );
  record('gateway-frozen-cleanup', {
    listenerRemoved: true,
    pendingTimerCancelled: true,
    lateSendCount: f.sent.length,
    underlyingStoreRemainsWritable: true,
  });
});

test('P0 log gateway real stdio subscription replaces topics rejects malformed requests and emits invalidations not log payloads', async (t) => {
  const start = await processes(t),
    child = await start('owner'),
    { client, events } = child;
  await write(client, 'before-subscribe');
  await barrier(client);
  assert.deepEqual(events, []);
  const reply = await client.subscribe([topic]);
  assert.deepEqual(reply, { subscribed: [topic], sessionId: client.initialized.sessionId });
  await write(client, 'subscribed');
  await barrier(client);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, topic);
  assert.deepEqual(events[0].payload, { changed: true });
  assert.equal(events[0].agentId, client.initialized.agentId);
  assert.equal(events[0].sessionId, client.initialized.sessionId);
  assert.doesNotMatch(JSON.stringify(events), /subscribed|gateway-test-private|visible/);
  const malformed = [
    undefined,
    null,
    {},
    { topics: 'logs' },
    { topics: [null] },
    { topics: [''] },
    { topics: ['x'.repeat(129)] },
    { topics: Array(129).fill(topic) },
  ];
  for (const params of malformed)
    await assert.rejects(
      client.request('events.subscribe', params),
      (e) => e.kind === 'invalid-params',
    );
  await write(client, 'still-subscribed');
  await barrier(client);
  assert.equal(events.length, 2);
  await client.subscribe([]);
  await write(client, 'unsubscribed');
  await barrier(client);
  assert.equal(events.length, 2);
  await client.subscribe(['settings.changed']);
  await write(client, 'filtered');
  await barrier(client);
  assert.equal(events.length, 2);
  await client.subscribe([topic]);
  await write(client, 'resubscribed');
  await barrier(client);
  assert.equal(events.length, 3);
  const rows = await client.recentLogs(1000);
  assert.deepEqual(
    rows.map((e) => e.message),
    [
      'before-subscribe',
      'subscribed',
      'still-subscribed',
      'unsubscribed',
      'filtered',
      'resubscribed',
    ],
  );
  assert(rows.every((e) => e.context.password === '[REDACTED]' && e.context.visible === '中🦊'));
  assert(events.every((e) => Buffer.byteLength(JSON.stringify(e)) < 1024));
  assert.deepEqual(
    events.map((e) => e.sequence),
    [1, 2, 3],
  );
  await child.close();
  assert.deepEqual(await child.exited, { code: 0, signal: null });
  assert.equal(child.stderr, '');
  record('gateway-stdio-subscription', {
    malformedRejected: malformed.length,
    exactEvents: events,
    persistedRows: rows.length,
    subscriptionIsReplacement: true,
    unchangedOnInvalidRequest: true,
    unsubscribedLogsRetainedForSnapshot: true,
    redacted: true,
    normalExit: true,
    migration:
      'Legacy join/log batch is replaced by explicit per-session topics, bounded invalidation and snapshot pull; no legacy payload wire parity claim',
  });
});

test('P0 log gateway real stdio owners stay isolated across unsubscribe close and restart without inherited subscription', async (t) => {
  const start = await processes(t),
    a = await start('a'),
    b = await start('b');
  const identityA = a.client.initialized,
    identityB = b.client.initialized;
  assert.notEqual(identityA.agentId, identityB.agentId);
  await a.client.subscribe([topic]);
  await b.client.subscribe([topic]);
  await write(a.client, 'owner-a');
  await write(b.client, 'owner-b');
  await Promise.all([barrier(a.client), barrier(b.client)]);
  assert.equal(a.events.length, 1);
  assert.equal(b.events.length, 1);
  assert(
    a.events.every((e) => e.agentId === identityA.agentId && e.sessionId === identityA.sessionId),
  );
  assert(
    b.events.every((e) => e.agentId === identityB.agentId && e.sessionId === identityB.sessionId),
  );
  const snapshot = await a.client.request('diagnostics.logs.snapshot', { limit: 1 });
  await assert.rejects(
    b.client.request('diagnostics.logs.chunk', { snapshotId: snapshot.snapshotId, index: 0 }),
    (e) => e.kind === 'not-found',
  );
  await assert.rejects(
    b.client.request('diagnostics.logs.chunk', {
      snapshotId: snapshot.snapshotId,
      index: 0,
      agentId: identityA.agentId,
    }),
    (e) => e.kind === 'invalid-params',
  );
  await a.close();
  assert.deepEqual(await a.exited, { code: 0, signal: null });
  await assert.rejects(
    a.client.request('diagnostics.logs.client', { message: 'must-not-write' }),
    (e) => e.kind === 'disconnected',
  );
  await write(b.client, 'b-after-a-close');
  await barrier(b.client);
  assert.equal(b.events.length, 2);
  const again = await start('a');
  assert.equal(again.client.initialized.agentId, identityA.agentId);
  assert.notEqual(again.client.initialized.sessionId, identityA.sessionId);
  await write(again.client, 'a-after-restart');
  await barrier(again.client);
  assert.deepEqual(again.events, []);
  await assert.rejects(
    again.client.request('diagnostics.logs.chunk', { snapshotId: snapshot.snapshotId, index: 0 }),
    (e) => e.kind === 'not-found',
  );
  await again.client.subscribe([topic]);
  await write(again.client, 'a-fresh-subscription');
  await barrier(again.client);
  assert.equal(again.events.length, 1);
  assert.equal(again.events[0].sequence, 1);
  assert.deepEqual(
    (await again.client.recentLogs(1000)).map((e) => e.message),
    ['owner-a', 'a-after-restart', 'a-fresh-subscription'],
  );
  assert.deepEqual(
    (await b.client.recentLogs(1000)).map((e) => e.message),
    ['owner-b', 'b-after-a-close'],
  );
  assert.equal(a.events.length, 1);
  assert.equal(b.events.length, 2);
  record('gateway-owner-lifecycle', {
    owners: 2,
    transport: 'actual independent local child-process stdio',
    noCrossOwnerRecordsOrEvents: true,
    crossOwnerHandleRejected: true,
    spoofedOwnerRejected: true,
    oldClientCannotWrite: true,
    restartPreservesAgentChangesSession: true,
    restartRequiresSubscription: true,
    oldSnapshotInvalid: true,
    limitation:
      'Two local Agent owners; not two UI sessions sharing one kernel, WebSocket or remote SSH',
  });
});

test('P0 log gateway current queue bounds invalidation flood emits resync and releases pending events on close', async (t) => {
  const sent = [],
    failures = [];
  const q = new EventQueue(
    'owner',
    'session',
    async (m) => {
      sent.push(m.params);
    },
    (e) => failures.push(e),
    { bytes: 4096, messages: 4, ackMs: 30000 },
  );
  t.after(() => q.close());
  q.notifyState(topic, { changed: true });
  assert.deepEqual(sent, []);
  q.subscribe([topic]);
  for (let i = 0; i < 10000; i++) {
    q.notifyState(topic, { changed: true });
    assert(q.bufferedMessages <= 4);
    assert(q.bufferedBytes <= 4096);
  }
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].payload, { changed: true });
  q.ack(1);
  assert.equal(sent[1].type, 'events.resync-required');
  assert.deepEqual(sent[1].payload, { reason: 'state-coalesced-or-overflowed' });
  q.ack(2);
  assert.equal(sent[2].type, topic);
  q.ack(3);
  assert.equal(q.bufferedBytes, 0);
  assert.equal(q.bufferedMessages, 0);
  assert.deepEqual(
    sent.map((e) => e.sequence),
    [1, 2, 3],
  );
  q.subscribe([]);
  q.notifyState(topic, { changed: true });
  assert.equal(sent.length, 3);
  q.subscribe([topic]);
  q.notifyState(topic, { changed: true });
  q.notifyState(topic, { changed: true });
  assert.equal(q.bufferedMessages, 2);
  q.close();
  assert.equal(q.bufferedBytes, 0);
  assert.equal(q.bufferedMessages, 0);
  const count = sent.length;
  q.notifyState(topic, { changed: true });
  assert.equal(sent.length, count);
  await assert.rejects(q.write(topic, { changed: true }), (e) => e.kind === 'disconnected');
  assert.deepEqual(failures, []);
  record('gateway-current-backpressure', {
    flood: 10000,
    bytesBound: 4096,
    messagesBound: 4,
    eventsBeforeAck: 1,
    exactDrainSequence: sent.slice(0, 3),
    noUnsubscribedDelivery: true,
    closeReleasesInFlightAndQueued: true,
    noDeliveryAfterClose: true,
    boundary:
      'Actual EventQueue; send callback captured with controlled ACK, no transport throughput claim',
  });
});
