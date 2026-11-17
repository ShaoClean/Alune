// Whole frozen classes, explicit framework/logger doubles, real current sessions and stdio.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const ts = require('typescript');
const { AgentSession } = require('../dist');
const { spawnAgent } = require('@alune/agent-client/node');
const { CORE_CAPABILITIES, PROTOCOL_VERSION, ProtocolError } = require('@alune/protocol');
const plain = (v) => JSON.parse(JSON.stringify(v));
const topic = 'diagnostics.logs.changed';
function record(name, value) {
  if (process.env.P0_EVENT_LIFECYCLE_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_EVENT_LIFECYCLE_PROOF_DIR, name + '.json'),
      JSON.stringify(value, null, 2) + '\n',
      { flag: 'wx' },
    );
}
function legacy() {
  assert(process.env.P0_EVENT_LIFECYCLE_FROZEN, 'Use batch-20 replay driver');
  const cache = new Map(),
    metadata = [],
    calls = [],
    runtimeImports = [];
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const source = fs.readFileSync(path.join(process.env.P0_EVENT_LIFECYCLE_FROZEN, file), 'utf8');
    const module = { exports: {} };
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
        setTimeout() {
          assert.fail('Lifecycle hooks must not start a log timer');
        },
        clearTimeout() {
          assert.fail('Lifecycle hooks must not cancel a log timer');
        },
        require(id) {
          runtimeImports.push({ file, id });
          if (id === '@nestjs/websockets')
            return Object.fromEntries(
              ['WebSocketGateway', 'WebSocketServer', 'SubscribeMessage', 'ConnectedSocket'].map(
                (name) => [
                  name,
                  (...args) =>
                    (...target) => {
                      metadata.push({ name, args, member: target[1] });
                    },
                ],
              ),
            );
          if (id === '@nestjs/common')
            return {
              Module: (config) => (target) => {
                metadata.push({ name: 'Module', config, target });
              },
            };
          if (id === './events.gateway') return load('apps/server/src/events/events.gateway.ts');
          if (id === '../logging/logger')
            return {
              logger: {
                debug(...args) {
                  calls.push(args);
                },
              },
              logStore() {
                assert.fail('Connection callbacks must not subscribe to the log store');
              },
            };
          throw Error('Unreviewed frozen runtime import: ' + id);
        },
      },
      { filename: 'frozen/' + file },
    );
    cache.set(file, module.exports);
    return module.exports;
  }
  const { EventsModule } = load('apps/server/src/events/events.module.ts');
  const { EventsGateway } = load('apps/server/src/events/events.gateway.ts');
  return { EventsModule, EventsGateway, metadata, calls, runtimeImports };
}
async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    assert(Date.now() < deadline, label);
    await delay(5);
  }
}
class Wire {
  messages = new Set();
  closures = new Set();
  sent = [];
  next = 0;
  closeCount = 0;
  onMessage(fn) {
    this.messages.add(fn);
    return () => this.messages.delete(fn);
  }
  onClose(fn) {
    this.closures.add(fn);
    return () => this.closures.delete(fn);
  }
  send(message) {
    this.sent.push(structuredClone(message));
    return Promise.resolve();
  }
  close(error) {
    this.closeCount++;
    for (const fn of [...this.closures]) fn(error);
  }
  dispatch(method, params) {
    const id = 'lifecycle:' + ++this.next;
    for (const fn of this.messages)
      fn({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
    return id;
  }
  async request(method, params) {
    const id = this.dispatch(method, params);
    await until(() => this.sent.some((m) => m.id === id), 'reply for ' + method);
    return this.sent.find((m) => m.id === id);
  }
  notification(method, params) {
    for (const fn of this.messages) fn({ jsonrpc: '2.0', method, params });
  }
}
const initialize = (minor = PROTOCOL_VERSION.minor) => ({
  protocol: { major: PROTOCOL_VERSION.major, minor },
  client: { name: 'lifecycle-fixture', version: '1' },
});

test('P0 event lifecycle complete frozen handleConnection logs exactly one client ID without wire or store effects', () => {
  const f = legacy(),
    gateway = new f.EventsGateway();
  assert.equal(gateway.server, undefined);
  const ids = ['client-a', 'client-b', '', '中🦊\r\n', undefined];
  for (const id of ids) assert.equal(gateway.handleConnection({ id }), undefined);
  assert.deepEqual(
    plain(f.calls),
    plain(ids.map((clientId) => ['socket', '客户端已连接', { clientId }])),
  );
  assert.equal(gateway.logBatch.length, 0);
  assert.equal(gateway.logTimer, undefined);
  assert.equal(gateway.unsubscribeLogs, undefined);
  assert.throws(() => gateway.handleConnection(null));
  assert.equal(f.calls.length, ids.length);
  record('event-lifecycle-frozen-connect', {
    completeClassExecuted: true,
    calls: f.calls,
    sideEffects: 'Only logger.debug; no server, timer, event send, room join or log subscription',
    boundary:
      'Legacy socket client ID is unvalidated diagnostic context; current protocol identity is negotiated and not the same ID or log record.',
  });
});

test('P0 event lifecycle complete frozen handleDisconnect logs exactly one client ID and does not destroy the gateway', () => {
  const f = legacy(),
    gateway = new f.EventsGateway();
  const ids = ['client-a', '', '中🦊', undefined];
  // Disconnect is a diagnostic hook, not module destruction: an existing batch is retained.
  gateway.logBatch.push({ fixture: true });
  for (const id of ids) assert.equal(gateway.handleDisconnect({ id }), undefined);
  assert.deepEqual(
    plain(f.calls),
    plain(ids.map((clientId) => ['socket', '客户端已断开', { clientId }])),
  );
  assert.deepEqual(plain(gateway.logBatch), [{ fixture: true }]);
  assert.equal(gateway.server, undefined);
  assert.throws(() => gateway.handleDisconnect(null));
  assert.equal(f.calls.length, ids.length);
  record('event-lifecycle-frozen-disconnect', {
    completeClassExecuted: true,
    calls: f.calls,
    retainedBatch: gateway.logBatch,
    boundary:
      'Old disconnect only logs; actual release belongs to module destroy. Current session close releases its owned requests/events/resources explicitly, not a global gateway.',
  });
});

test('P0 event lifecycle complete frozen EventsModule registers and exports the identical gateway class with no hidden composition', () => {
  const f = legacy();
  const rows = f.metadata.filter((m) => m.name === 'Module');
  assert.equal(rows.length, 1);
  const m = rows[0];
  assert.equal(m.target, f.EventsModule);
  assert.deepEqual(Object.keys(m.config).sort(), ['exports', 'providers']);
  assert.equal(m.config.providers.length, 1);
  assert.equal(m.config.exports.length, 1);
  assert.equal(m.config.providers[0], f.EventsGateway);
  assert.equal(m.config.exports[0], f.EventsGateway);
  assert.deepEqual(Object.getOwnPropertyNames(f.EventsModule.prototype), ['constructor']);
  assert.deepEqual(Object.keys(new f.EventsModule()), []);
  assert.deepEqual(Object.keys(f.EventsModule), []);
  const provider = new m.config.providers[0]();
  assert(provider instanceof f.EventsGateway);
  const methods = Object.getOwnPropertyNames(f.EventsGateway.prototype);
  assert.deepEqual(methods, [
    'constructor',
    'afterInit',
    'onModuleDestroy',
    'handleConnection',
    'handleDisconnect',
    'subscribeLogs',
    'emitConnectionStatus',
    'emitRepoStatus',
    'emitCommandOutput',
    'emitCommandExit',
  ]);
  const source = fs.readFileSync(
    path.join(process.env.P0_EVENT_LIFECYCLE_FROZEN, 'apps/server/src/events/events.module.ts'),
    'utf8',
  );
  const ast = ts.createSourceFile('events.module.ts', source, ts.ScriptTarget.Latest, true);
  assert.equal(ast.statements.length, 3);
  assert.equal(ast.statements.filter(ts.isImportDeclaration).length, 2);
  assert.equal(ast.statements.filter(ts.isClassDeclaration)[0].members.length, 0);
  assert.deepEqual(f.runtimeImports, [
    { file: 'apps/server/src/events/events.module.ts', id: '@nestjs/common' },
    { file: 'apps/server/src/events/events.module.ts', id: './events.gateway' },
    { file: 'apps/server/src/events/events.gateway.ts', id: '@nestjs/websockets' },
    { file: 'apps/server/src/events/events.gateway.ts', id: '../logging/logger' },
  ]);
  assert.deepEqual(f.calls, []);
  record('event-lifecycle-frozen-module', {
    completeModuleExecuted: true,
    completeGatewayDependencyExecuted: true,
    moduleMembers: [],
    providers: ['EventsGateway'],
    exports: ['EventsGateway'],
    identicalClass: true,
    methods,
    runtimeImports: f.runtimeImports,
    boundary:
      'Decorator capture and explicit class instantiation; not a live Nest container or proof of singleton scope. Gateway source/export responsibilities remain uncredited.',
  });
});

test('P0 event lifecycle current session composes exact core capabilities gates initialization and isolates per-session event queues', async (t) => {
  const wire = new Wire(),
    second = new Wire();
  const handler = { minimumProtocolMinor: 1, effect: 'query', validate() {}, run: () => 'ok' };
  for (const name of ['initialize', ...CORE_CAPABILITIES, 'invalid name']) {
    assert.throws(
      () =>
        new AgentSession(new Wire(), {
          agentId: 'same-agent',
          version: 'fixture',
          handlers: { [name]: handler },
        }),
      /Reserved or invalid handler name/,
    );
  }
  const a = new AgentSession(wire, {
    agentId: 'same-agent',
    version: 'fixture',
    handlers: { 'fixture.feature': handler },
  });
  const b = new AgentSession(second, { agentId: 'same-agent', version: 'fixture' });
  t.after(async () => {
    await a.close();
    await b.close();
  });
  assert.notEqual(a.sessionId, b.sessionId);
  assert.notEqual(a.events, b.events);
  for (const method of ['agent.health', 'events.subscribe']) {
    const r = await wire.request(
      method,
      method === 'events.subscribe' ? { topics: ['fixture.changed'] } : undefined,
    );
    assert.equal(r.error.data.kind, 'not-initialized');
    assert.equal(r.error.data.outcome, 'not-started');
  }
  assert.equal(
    (await wire.request('initialize', { ...initialize(), protocol: { major: 99, minor: 0 } })).error
      .data.kind,
    'incompatible-version',
  );
  assert.equal((await wire.request('initialize', {})).error.data.kind, 'invalid-params');
  const ai = (await wire.request('initialize', initialize(0))).result;
  const bi = (await second.request('initialize', initialize(PROTOCOL_VERSION.minor + 10))).result;
  assert.deepEqual(ai.capabilities, [...CORE_CAPABILITIES]);
  assert.deepEqual(bi.capabilities, [...CORE_CAPABILITIES]);
  assert.equal(ai.protocol.minor, 0);
  assert.equal(bi.protocol.minor, PROTOCOL_VERSION.minor);
  assert.equal(ai.agentId, bi.agentId);
  assert.equal(ai.lifecycle, 'session');
  assert.equal((await wire.request('fixture.feature')).error.data.kind, 'unknown-method');
  assert.equal((await wire.request('initialize', initialize())).error.data.kind, 'invalid-request');
  await wire.request('events.subscribe', { topics: ['fixture.changed'] });
  a.events.notifyState('fixture.changed', { marker: 'a-only' });
  b.events.notifyState('fixture.changed', { marker: 'not-subscribed' });
  const ae = wire.sent.filter((m) => m.method === 'agent.event');
  assert.equal(ae.length, 1);
  assert.equal(second.sent.filter((m) => m.method === 'agent.event').length, 0);
  assert.deepEqual(ae[0].params, {
    agentId: ai.agentId,
    sessionId: ai.sessionId,
    sequence: 1,
    type: 'fixture.changed',
    payload: { marker: 'a-only' },
  });
  wire.notification('events.ack', { sessionId: ai.sessionId, sequence: 1 });
  await until(() => a.events.bufferedMessages === 0, 'ACK releases owned event');
  const health = (await wire.request('agent.health')).result;
  assert.deepEqual(health, {
    status: 'ok',
    agentId: ai.agentId,
    sessionId: ai.sessionId,
    lifecycle: 'session',
  });
  record('event-lifecycle-current-composition', {
    a: ai,
    b: bi,
    replies: wire.sent,
    secondReplies: second.sent,
    separateQueues: true,
    ackReleased: a.events.bufferedMessages === 0,
    boundary:
      'Actual AgentSession with captured transport; two sessions sharing an Agent ID are controlled composition, not the production shared UI kernel.',
  });
});

test('P0 event lifecycle current close is idempotent aborts owned work rejects pending delivery and disposes once without affecting another session', async (t) => {
  const wire = new Wire(),
    otherWire = new Wire();
  const active = [],
    effects = [];
  let disposed = 0,
    releaseDispose;
  const disposeGate = new Promise((resolve) => {
    releaseDispose = resolve;
  });
  const handlers = Object.fromEntries(
    ['query', 'mutation'].map((effect) => [
      'fixture.' + effect,
      {
        effect,
        durable: false,
        validate() {},
        run(_params, context) {
          active.push({ effect, signal: context.signal, sessionSignal: context.sessionSignal });
          return new Promise((_resolve, reject) => {
            context.signal.addEventListener(
              'abort',
              () => {
                effects.push(effect + '-aborted');
                reject(new DOMException('Stopped', 'AbortError'));
              },
              { once: true },
            );
          });
        },
      },
    ]),
  );
  const a = new AgentSession(wire, {
    agentId: 'owner-a',
    version: 'fixture',
    handlers,
    onDispose: async () => {
      disposed++;
      await disposeGate;
    },
  });
  const b = new AgentSession(otherWire, { agentId: 'owner-b', version: 'fixture' });
  t.after(async () => {
    releaseDispose();
    await a.close();
    await b.close();
  });
  const ai = (await wire.request('initialize', initialize())).result;
  await otherWire.request('initialize', initialize());
  await wire.request('events.subscribe', { topics: ['*'] });
  const queryId = wire.dispatch('fixture.query', {});
  const mutationId = wire.dispatch('fixture.mutation', {});
  await until(() => active.length === 2, 'both controlled handlers admitted');
  const delivery = a.events.write('fixture.reliable', { marker: 'pending' });
  const rejection = assert.rejects(
    delivery,
    (e) => e.kind === 'disconnected' && e.outcome === 'unknown',
  );
  assert(a.events.bufferedMessages > 0);
  const closing = a.close();
  assert.equal(a.close(new Error('ignored second close')), closing);
  await until(() => disposed === 1, 'disposal invoked');
  assert(active.every((x) => x.signal.aborted && x.sessionSignal.aborted));
  assert.deepEqual(effects.sort(), ['mutation-aborted', 'query-aborted']);
  assert.equal(wire.messages.size, 0);
  assert.equal(wire.closures.size, 0);
  releaseDispose();
  await closing;
  await a.closed;
  await rejection;
  assert.equal(disposed, 1);
  assert.equal(wire.closeCount, 1);
  assert.equal(a.shutdownTimedOut, false);
  assert.equal(a.shutdownFailed, false);
  assert.equal(a.events.bufferedMessages, 0);
  assert.equal(a.events.bufferedBytes, 0);
  const count = wire.sent.length;
  a.events.notifyState('fixture.changed', { marker: 'late' });
  await assert.rejects(a.events.write('fixture.reliable', 'late'), { kind: 'disconnected' });
  wire.dispatch('agent.health');
  await delay(0);
  assert.equal(wire.sent.length, count);
  assert(!wire.sent.some((m) => m.id === queryId || m.id === mutationId));
  assert.equal((await otherWire.request('agent.health')).result.status, 'ok');
  record('event-lifecycle-current-close', {
    identity: ai,
    effects,
    disposed,
    transportCloseCount: wire.closeCount,
    listenersAfterClose: { messages: wire.messages.size, closures: wire.closures.size },
    queueAfterClose: { bytes: a.events.bufferedBytes, messages: a.events.bufferedMessages },
    shutdownFailed: a.shutdownFailed,
    shutdownTimedOut: a.shutdownTimedOut,
    secondOwnerHealthy: true,
    boundary:
      'Controlled query and durable:false mutation block on AbortSignal without external side effects. Not a running-write rollback or durable unknown proof; those use unchanged companion tests.',
  });
});

test('P0 event lifecycle real stdio EOF signals and malformed input close safely while owners and fresh subscriptions remain isolated', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-batch20-'));
  const children = [],
    raw = [];
  t.after(async () => {
    for (const child of children) await child.close();
    for (const child of raw) if (child.exitCode === null) child.kill('SIGKILL');
    fs.rmSync(root, { recursive: true, force: true });
  });
  const fixture = path.join(__dirname, 'settings-fixture.cjs');
  async function owner(name) {
    const frames = [],
      errors = [];
    const child = spawnAgent(process.execPath, [fixture, path.join(root, name)], {
      onStderr(text) {
        errors.push(text);
      },
    });
    children.push(child);
    child.process.stdout.on('data', (chunk) => frames.push(chunk.toString('utf8')));
    const info = await child.client.initialize();
    return { ...child, info, frames, errors };
  }
  const a = await owner('a'),
    b = await owner('b');
  assert.notEqual(a.info.agentId, b.info.agentId);
  const events = [];
  a.client.onEvent((e) => events.push(plain(e)));
  await a.client.subscribe([topic]);
  await a.client.request('diagnostics.logs.client', {
    level: 'ERROR',
    message: 'owner-a-before-close',
  });
  await until(() => events.length === 1, 'event before close');
  const eof = a.close();
  assert.equal(a.close(), eof);
  await eof;
  assert.deepEqual(await a.exited, { code: 0, signal: null });
  assert.equal(a.client.state, 'closed');
  await assert.rejects(a.client.health(), { kind: 'disconnected' });
  assert.equal((await b.client.health()).status, 'ok');
  const again = await owner('a'),
    fresh = [];
  assert.equal(again.info.agentId, a.info.agentId);
  assert.notEqual(again.info.sessionId, a.info.sessionId);
  again.client.onEvent((e) => fresh.push(plain(e)));
  await again.client.request('diagnostics.logs.client', {
    level: 'ERROR',
    message: 'a-unsubscribed',
  });
  await again.client.health();
  assert.deepEqual(fresh, []);
  await again.client.subscribe([topic]);
  await again.client.request('diagnostics.logs.client', { level: 'ERROR', message: 'a-fresh' });
  await until(() => fresh.length === 1, 'fresh subscription');
  assert.equal(fresh[0].sequence, 1);
  assert.equal(fresh[0].sessionId, again.info.sessionId);
  assert.equal(events.length, 1);
  assert.deepEqual(
    (await again.client.recentLogs(100)).map((e) => e.message),
    ['owner-a-before-close', 'a-unsubscribed', 'a-fresh'],
  );
  assert.deepEqual(await b.client.recentLogs(100), []);
  const signals = [];
  for (const signal of ['SIGTERM', 'SIGINT']) {
    const c = await owner(signal);
    c.process.kill(signal);
    signals.push({ signal, exit: await c.exited, state: c.client.state });
    assert.deepEqual(signals.at(-1).exit, { code: 0, signal: null });
    assert.equal(c.client.state, 'closed');
  }
  const child = spawn(process.execPath, [fixture, path.join(root, 'malformed')], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  raw.push(child);
  let stdout = '',
    stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const exited = new Promise((resolve) =>
    child.once('close', (code, signal) => resolve({ code, signal })),
  );
  child.stdin.on('error', () => {});
  child.stdin.end('{malformed-json}\n');
  const malformedExit = await exited;
  assert.deepEqual(malformedExit, { code: 1, signal: null });
  assert.equal(stdout, '');
  assert.match(stderr, /Agent protocol session failed/);
  for (const c of [a, b, again]) {
    assert.deepEqual(c.errors, []);
    const frames = c.frames.join('').trim().split('\n').filter(Boolean).map(JSON.parse);
    assert(frames.length > 0 && frames.every((f) => f.jsonrpc === '2.0'));
  }
  record('event-lifecycle-stdio', {
    before: a.info,
    after: again.info,
    secondOwner: b.info,
    eofExit: await a.exited,
    oldClientState: a.client.state,
    oldEvents: events,
    freshEvents: fresh,
    signals,
    malformed: { exit: malformedExit, stdout, stderr },
    boundary:
      'Real local SDK/stdio/SQLite and production kernel/session via unchanged file-secret-backend fixture. No default keychain, remote host, live Nest/WebSocket, browser/Electron or production shared UI kernel.',
  });
});
