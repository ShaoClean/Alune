// Compare immutable P0 lifecycle behavior with Agent-owned sessions. The PTY
// port is controlled here; real packaged PTYs have their own integration suite.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const ts = require('typescript');
const { TerminalSessions, TerminalRegistry, terminalHandlers } = require('../dist/modules/terminals');
const { ProtocolError, TERMINAL_TOPICS } = require('@alune/protocol');
const { TERMINAL_LIMITS } = require('@alune/domain');
const baseline = '3c05f640fcc1a04c864e47bfc2880483ad48c984';
const root = path.resolve(__dirname, '../../..');
const frozenSource = file => execFileSync('git', ['show', baseline + ':' + file], { cwd: root, encoding: 'utf8' });
function loadFrozen(file, dependencies) {
  const mod = { exports: {} };
  const output = ts.transpileModule(frozenSource(file), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
  } }).outputText;
  vm.compileFunction(output, ['require', 'module', 'exports'], { filename: baseline + '/' + file })(name => {
    if (name in dependencies) return dependencies[name];
    if (name.startsWith('node:')) return require(name);
    throw Error('Unreviewed frozen dependency: ' + name);
  }, mod, mod.exports);
  return mod.exports;
}
const frozenTypes = loadFrozen('packages/shared/src/types/terminal.ts', {});
const noDecorator = () => () => {};
const tick = () => new Promise(resolve => setImmediate(resolve));
const normalized = value => JSON.parse(JSON.stringify(value, (key, v) => key === 'createdAt' ? '<time>' : v));

function fixture(t, legacy = false, options = {}) {
  const registry = new TerminalRegistry(message => new Error(message));
  registry.enabled = true;
  const repo = { id: randomUUID(), name: 'Fixture', path: '/fixture/repository', source: 'local' };
  const packets = [], calls = [];
  const owner = { id: randomUUID(), connected: true, emit: (type, payload) => packets.push({ type, payload: normalized(payload) }) };
  const stranger = { id: randomUUID(), connected: true, emit() { assert.fail('foreign owner emission'); } };
  let callbacks, signal;
  const transport = {
    write: data => calls.push(['write', data]), resize: (cols, rows) => calls.push(['resize', cols, rows]),
    pause: () => calls.push(['pause']), resume: () => calls.push(['resume']),
    dispose: () => { calls.push(['dispose']); return options.dispose?.(); },
  };
  const open = async (_cwd, cols, rows, abort, cb) => {
    calls.push(['open', cols, rows]); callbacks = cb; signal = abort;
    if (options.open) return options.open(transport, cb);
    return transport;
  };
  let sessions, validId;
  if (legacy) {
    const old = loadFrozen('apps/server/src/terminal/terminal.service.ts', {
      '@nestjs/common': { Injectable: noDecorator }, '@alune/shared': frozenTypes,
      './terminal-transport': { localTerminal: open, sshTerminal: () => assert.fail('unexpected SSH') },
    });
    sessions = new old.TerminalService({ get: async () => ({ ...repo }) }, {}, registry);
    validId = old.validTerminalId;
  } else {
    sessions = new TerminalSessions(async () => ({
      repositoryName: repo.name, initialPath: repo.path, source: repo.source,
      environment: `Alune 服务主机 · ${require('node:os').hostname()}`,
      open: (...args) => open(repo.path, ...args),
    }), registry);
    validId = require('../dist/modules/terminals').validTerminalId;
  }
  t.after(() => sessions.onModuleDestroy());
  const create = (overrides = {}) => sessions.create(owner, {
    requestId: randomUUID(), repositoryId: repo.id, cols: 80, rows: 24, ...overrides,
  });
  // P0 had no list RPC; inspect its state for the lifecycle comparison. The
  // Agent branch exercises the new public, owner-filtered list operation.
  const list = who => legacy ? [...sessions.sessions.values()]
    .filter(entry => entry.owner.id === who.id).map(entry => ({ ...entry.info })) : sessions.list(who);
  return { sessions, registry, repo, owner, stranger, packets, calls, create, validId, list,
    get callbacks() { return callbacks; }, get signal() { return signal; } };
}

test('P0 terminal identifiers, dimensions and creation refusal retain frozen boundaries', async t => {
  assert.deepEqual(TERMINAL_LIMITS, frozenTypes.TERMINAL_LIMITS);
  for (const legacy of [true, false]) {
    const f = fixture(t, legacy);
    for (const value of [undefined, null, '', 1, 'not-a-uuid', '0'.repeat(36)]) assert.equal(f.validId(value), false);
    assert.equal(f.validId(randomUUID()), true);
    f.registry.enabled = false;
    assert.throws(() => f.create(), /已认证/);
    f.registry.enabled = true; f.owner.connected = false;
    assert.throws(() => f.create(), /连接已断开/);
    f.owner.connected = true;
    assert.throws(() => f.create({ requestId: 'bad' }), /有效仓库/);
    assert.throws(() => f.create({ repositoryId: 'bad' }), /有效仓库/);
    for (const [cols, rows] of [[1, 24], [501, 24], [80, 0], [80, 201], [2.5, 24], ['80', 24]])
      assert.throws(() => f.create({ cols, rows }), /终端尺寸/);
    assert.equal(f.registry.entries.size, 0);
    assert.deepEqual(f.calls, []);
  }
});

test('P0 terminal state, output ACK, input, resize and confirmed removal survive migration', async t => {
  const snapshots = [];
  for (const legacy of [true, false]) {
    const f = fixture(t, legacy), created = f.create();
    assert.equal(created.state, 'connecting');
    await tick();
    const id = created.id;
    assert.deepEqual(f.calls[0], ['open', 80, 24]);
    assert.equal(f.list(f.owner)[0].state, 'running');
    assert.equal(f.list(f.stranger).length, 0);
    assert.throws(() => f.sessions.input(f.stranger, { sessionId: id, data: 'foreign' }), /不属于当前窗口/);
    f.callbacks.data('first\n'); f.callbacks.data('second\n');
    assert.equal(f.packets.filter(p => p.type === 'terminal:output').length, 1);
    assert.throws(() => f.sessions.ack(f.owner, { sessionId: id, sequence: 99 }), /无效的终端输出确认/);
    f.sessions.ack(f.owner, { sessionId: id, sequence: 1 });
    assert.deepEqual(f.packets.filter(p => p.type === 'terminal:output').map(p => p.payload.data), ['first\n', 'second\n']);
    f.sessions.ack(f.owner, { sessionId: id, sequence: 2 });
    assert.throws(() => f.sessions.ack(f.owner, { sessionId: id, sequence: 2 }), /无效的终端输出确认/);
    f.sessions.input(f.owner, { sessionId: id, data: 'printf fixture\r' });
    f.sessions.resize(f.owner, { sessionId: id, cols: 100, rows: 30 });
    assert(f.calls.some(c => c[0] === 'write' && c[1] === 'printf fixture\r'));
    assert(f.calls.some(c => JSON.stringify(c) === JSON.stringify(['resize', 100, 30])));
    assert.throws(() => f.sessions.close(f.owner, { sessionId: id }), /确认关闭/);
    snapshots.push(f.packets.map(({ type, payload }) => [type, { ...payload, id: payload.id ? '<id>' : undefined, requestId: payload.requestId ? '<id>' : undefined, repositoryId: payload.repositoryId ? '<repo>' : undefined, sessionId: payload.sessionId ? '<id>' : undefined }]));
    await f.sessions.close(f.owner, { sessionId: id, confirmed: true });
    assert.equal(f.signal.aborted, true);
    assert.equal(f.list(f.owner).length, 0);
    assert.equal(f.registry.entries.size, 0);
    assert.equal(f.calls.filter(c => c[0] === 'dispose').length, 1);
    assert.deepEqual(f.packets.at(-1), { type: 'terminal:removed', payload: { sessionId: id } });
  }
  assert.deepEqual(snapshots[1], snapshots[0]);
});

test('P0 terminal Unicode output, backpressure and bounded input retain exact data', async t => {
  for (const legacy of [true, false]) {
    const f = fixture(t, legacy), id = f.create().id;
    await tick();
    const data = 'a'.repeat(4095) + '🌙中文'.repeat(12000);
    f.callbacks.data(data);
    let received = '';
    while (true) {
      const packet = f.packets.filter(p => p.type === 'terminal:output').at(-1)?.payload;
      if (!packet || received.length >= data.length) break;
      assert(Buffer.byteLength(packet.data) <= TERMINAL_LIMITS.packetBytes);
      assert(!/[\uD800-\uDBFF]$/.test(packet.data));
      received += packet.data;
      f.sessions.ack(f.owner, { sessionId: id, sequence: packet.sequence });
    }
    assert.equal(received, data);
    assert(f.calls.some(c => c[0] === 'pause'));
    assert.equal(f.calls.at(-1)[0], 'resume');
    for (const input of [undefined, '', 1, 'x'.repeat(TERMINAL_LIMITS.inputBytes + 1)])
      assert.throws(() => f.sessions.input(f.owner, { sessionId: id, data: input }), /终端输入/);
    assert.throws(() => f.sessions.resize(f.owner, { sessionId: id, cols: 1, rows: 10 }), /终端尺寸/);
  }
});

test('P0 terminal duplicate requests, per-owner limit and foreign operations are refused', async t => {
  for (const legacy of [true, false]) {
    const f = fixture(t, legacy), first = f.create();
    assert.throws(() => f.create({ requestId: first.id }), /不能重复/);
    for (let i = 1; i < TERMINAL_LIMITS.sessions; i++) f.create();
    assert.throws(() => f.create(), /最多保留 8/);
    await tick();
    for (const command of ['input', 'resize', 'ack', 'close'])
      assert.throws(() => f.sessions[command](f.stranger, { sessionId: first.id }), /不属于当前窗口/);
    const listed = f.list(f.owner);
    listed[0].state = 'failed';
    assert.equal(f.list(f.owner)[0].state, 'running');
    f.owner.connected = false;
    assert.throws(() => f.sessions.input(f.owner, { sessionId: first.id, data: 'x' }), /不属于当前窗口/);
    f.sessions.disconnect(f.owner);
    assert.equal(f.list(f.owner).length, 0);
    assert.equal(f.registry.entries.size, 0);
    assert.equal(f.calls.filter(c => c[0] === 'dispose').length, TERMINAL_LIMITS.sessions);
  }
});

test('P0 terminal exit, disconnect, overflow and startup failures preserve explicit stopped states', async t => {
  for (const legacy of [true, false]) {
    for (const reason of ['exit', 'disconnect', 'overflow', 'startup']) {
      const f = fixture(t, legacy, reason === 'startup' ? { open: () => { throw Error('controlled startup failure'); } } : {});
      const id = f.create().id;
      await tick();
      if (reason === 'exit') f.callbacks.exit(7, 'SIGTERM');
      if (reason === 'disconnect') f.callbacks.disconnect('controlled disconnect');
      if (reason === 'overflow') f.callbacks.data('x'.repeat(TERMINAL_LIMITS.pendingBytes + 1));
      const state = f.list(f.owner)[0];
      assert.equal(state.state, reason === 'exit' ? 'exited' : reason === 'startup' ? 'failed' : 'disconnected');
      if (reason === 'exit') { assert.equal(state.exitCode, 7); assert.equal(state.signal, 'SIGTERM'); }
      if (reason === 'startup') assert.equal(state.error, 'controlled startup failure');
      if (reason === 'disconnect') assert.equal(state.error, 'controlled disconnect');
      if (reason === 'overflow') assert.match(state.error, /输出超过传输上限/);
      assert.throws(() => f.sessions.input(f.owner, { sessionId: id, data: 'x' }), /停止接收输入/);
      if (reason !== 'startup') {
        const before = f.packets.length;
        f.callbacks.data('late'); f.callbacks.exit(0);
        assert.equal(f.packets.length, before);
        assert.equal(f.calls.filter(c => c[0] === 'dispose').length, 1);
      }
      await f.sessions.close(f.owner, { sessionId: id });
      assert.equal(f.registry.entries.size, 0);
    }
  }
});

test('Agent terminal shutdown awaits a late startup and its asynchronous transport disposal', async t => {
  let resolveOpen, resolveDispose;
  const f = fixture(t, false, {
    open: transport => new Promise(resolve => { resolveOpen = () => resolve(transport); }),
    dispose: () => new Promise(resolve => { resolveDispose = resolve; }),
  });
  f.create(); await tick();
  let closed = false;
  const closing = f.sessions.onModuleDestroy().then(() => { closed = true; });
  await tick(); assert.equal(closed, false);
  resolveOpen(); await tick(); assert.equal(closed, false);
  assert.equal(f.signal.aborted, true);
  resolveDispose(); await closing;
  assert.equal(closed, true);
  assert.equal(f.registry.entries.size, 0);
  assert.equal(f.calls.filter(c => c[0] === 'dispose').length, 1);
});

test('Agent terminal handlers replace gateway commands with session-owned validated RPCs', async () => {
  const calls = [], controller = new AbortController(), sessionId = randomUUID(), resource = { agentId: 'agent', resourceId: randomUUID() };
  const sessions = Object.fromEntries(['create', 'list', 'input', 'resize', 'ack', 'close'].map(command => [command, (owner, body) => {
    calls.push({ command, owner, body });
    if (command === 'create') owner.emit('terminal:state', { id: body.requestId, error: undefined });
    return command === 'list' ? [] : command === 'create' ? { id: body.requestId } : command === 'close' ? Promise.resolve() : undefined;
  }]));
  const packets = [], checked = [];
  const context = { agentId: 'agent', sessionId, sessionSignal: controller.signal,
    events: { subscribed: topic => TERMINAL_TOPICS.includes(topic), write: async (...args) => packets.push(args), failStream: assert.fail } };
  const handlers = terminalHandlers(sessions, r => checked.push(r));
  const id = randomUUID();
  const bodies = { create: { resource, requestId: id, cols: 80, rows: 24 }, list: {}, input: { sessionId: id, data: 'x' }, resize: { sessionId: id, cols: 90, rows: 30 }, ack: { sessionId: id, sequence: 1 }, close: { sessionId: id, confirmed: true } };
  for (const [command, body] of Object.entries(bodies)) {
    const h = handlers['terminals.' + command];
    assert.equal(h.minimumProtocolMinor, 4); assert.equal(h.durable, false);
    assert.equal(h.effect, command === 'list' ? 'query' : 'mutation');
    h.validate(body); await h.run(body, context);
    assert.throws(() => h.validate({ ...body, ownerId: 'spoof' }), ProtocolError);
    assert.equal(calls.at(-1).owner.id, sessionId);
    assert.equal(calls.at(-1).owner.connected, true);
  }
  assert.deepEqual(calls.map(c => c.command), Object.keys(bodies));
  assert.equal(calls[0].body.repositoryId, resource.resourceId);
  assert.deepEqual(checked, [resource]);
  assert.deepEqual(packets, [['terminal:state', { id }, resource]]);
  controller.abort(); assert.equal(calls[0].owner.connected, false);
  const create = handlers['terminals.create'];
  assert.throws(() => create.run({ ...bodies.create, resource: { ...resource, agentId: 'foreign' } }, context), e => e.kind === 'not-found');
  assert.throws(() => create.run(bodies.create, { ...context, events: { subscribed: () => false } }), /Subscribe/);
  sessions.input = () => { throw Error('controlled refusal'); };
  assert.throws(() => handlers['terminals.input'].run(bodies.input, context), e => e.kind === 'conflict' && e.message === 'controlled refusal');
  const decorators = Object.fromEntries(['ConnectedSocket', 'MessageBody', 'SubscribeMessage', 'WebSocketGateway'].map(name => [name, noDecorator]));
  const { TerminalGateway } = loadFrozen('apps/server/src/terminal/terminal.gateway.ts', { '@nestjs/websockets': decorators });
  const legacyCalls = [];
  const legacySessions = Object.fromEntries(['create', 'input', 'resize', 'ack', 'close', 'disconnect'].map(command => [command, (owner, body) => {
    legacyCalls.push({ command, owner, body }); return command === 'create' ? { id } : undefined;
  }]));
  const registry = { enabled: false }, gateway = new TerminalGateway(legacySessions, registry);
  let authenticate;
  gateway.afterInit({ use: fn => { authenticate = fn; } });
  authenticate({}, error => assert.match(error.message, /已认证/));
  registry.enabled = true; authenticate({}, error => assert.equal(error, undefined));
  for (const command of ['create', 'input', 'resize', 'ack', 'close']) {
    const body = command === 'create' ? { requestId: id, repositoryId: resource.resourceId, cols: 80, rows: 24 } : bodies[command];
    assert.deepEqual(gateway[command]({ id: sessionId }, body), { ok: true, value: command === 'create' ? { id } : undefined });
    assert.equal(legacyCalls.at(-1).owner.id, sessionId);
    assert.deepEqual(legacyCalls.at(-1).body, body);
  }
  legacySessions.input = () => { throw Error('controlled refusal'); };
  assert.deepEqual(gateway.input({ id: sessionId }, bodies.input), { ok: false, error: 'controlled refusal' });
  gateway.handleDisconnect({ id: sessionId }); assert.equal(legacyCalls.at(-1).command, 'disconnect');
});

test('P0 terminal startup and parser ACK timeouts stop only their own sessions', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const legacy of [true, false]) {
    const f = fixture(t, legacy), id = f.create().id;
    await tick(); f.callbacks.data('held output');
    t.mock.timers.tick(30000);
    assert.equal(f.list(f.owner)[0].state, 'disconnected');
    assert.match(f.list(f.owner)[0].error, /输出确认超时/);
    assert.equal(f.calls.filter(c => c[0] === 'dispose').length, 1);
    await f.sessions.close(f.owner, { sessionId: id });
    let complete;
    const starting = fixture(t, legacy, { open: transport => new Promise(resolve => { complete = () => resolve(transport); }) });
    starting.create(); await tick(); t.mock.timers.tick(35000);
    assert.equal(starting.list(starting.owner)[0].state, 'failed');
    assert.equal(starting.list(starting.owner)[0].error, '终端启动超时。');
    assert.equal(starting.signal.aborted, true);
    complete(); await tick();
    assert.equal(starting.calls.filter(c => c[0] === 'dispose').length, 1);
    assert(!starting.packets.some(p => p.payload.state === 'running'));
  }
});
