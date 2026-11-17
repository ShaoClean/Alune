import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { AgentClient } from '@alune/agent-client';
import { AgentSession } from '@alune/agent';
import { subscribeWorkspaceEvents } from '../src/api/workspace-events.ts';
import { workspaceTopics } from '../src/api/ui-agent.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const file = 'apps/web/src/hooks/useSocket.ts';
const baseline = '3c05f640fcc1a04c864e47bfc2880483ad48c984';
const record = (name, value) => {
  if (process.env.P0_USE_SOCKET_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_USE_SOCKET_PROOF_DIR, name + '.json'),
      JSON.stringify(value, null, 2) + '\n',
      { flag: 'wx' },
    );
};
const source = (frozen) =>
  frozen
    ? process.env.P0_USE_SOCKET_FROZEN
      ? fs.readFileSync(path.join(process.env.P0_USE_SOCKET_FROZEN, file), 'utf8')
      : execFileSync('git', ['show', baseline + ':' + file], { cwd: root, encoding: 'utf8' })
    : fs.readFileSync(path.join(root, file), 'utf8');

// Explicit effect/ref/external-store scheduler, not React or a DOM renderer.
// Execute each entire, unmodified module with only its imports substituted.
function scheduler() {
  const slots = [];
  let cursor = 0,
    pending = [],
    updates = 0;
  return {
    react: {
      useRef(value) {
        const i = cursor++;
        return (slots[i] ??= { current: value });
      },
      useSyncExternalStore(observe, snapshot) {
        const i = cursor++;
        if (!slots[i])
          slots[i] = {
            stop: observe(() => {
              updates++;
            }),
          };
        return snapshot();
      },
      useEffect(effect, deps) {
        const i = cursor++,
          previous = slots[i];
        if (!previous || deps.some((v, n) => !Object.is(v, previous.deps[n])))
          pending.push(() => {
            previous?.cleanup?.();
            slots[i] = { deps, cleanup: effect() };
          });
      },
    },
    render(fn, events) {
      cursor = 0;
      const result = fn(events);
      for (const commit of pending.splice(0)) commit();
      return result;
    },
    unmount() {
      for (const slot of slots) {
        slot.cleanup?.();
        slot.stop?.();
      }
      slots.length = 0;
    },
    get updates() {
      return updates;
    },
  };
}
function externalStore() {
  let value;
  const listeners = new Set();
  return {
    currentUiAgent: () => value,
    observeUiAgent(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    set(client) {
      value = client;
      for (const fn of listeners) fn();
    },
    get size() {
      return listeners.size;
    },
  };
}
function load(text, imports) {
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const declarations = ast.statements.filter(ts.isFunctionDeclaration);
  assert.equal(declarations.length, 1);
  assert.equal(declarations[0].name.text, 'useSocket');
  assert.equal(declarations[0].parameters.length, 1);
  assert(declarations[0].modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
  assert.equal(ast.statements.length, ast.statements.filter(ts.isImportDeclaration).length + 1);
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(text, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      require(name) {
        assert(Object.hasOwn(imports, name), 'Unreviewed import: ' + name);
        return imports[name];
      },
      console: { log() {} },
    },
    { filename: file, timeout: 2000 },
  );
  assert.deepEqual(Object.keys(exports), ['useSocket']);
  return {
    useSocket: exports.useSocket,
    imports: ast.statements.filter(ts.isImportDeclaration).map((s) => s.moduleSpecifier.text),
  };
}
function current(store, hooks) {
  return load(source(false), {
    react: hooks.react,
    '../api/ui-agent': store,
    '../api/workspace-events': { subscribeWorkspaceEvents },
  });
}
function fakeClient(label) {
  const events = new Set(),
    closes = new Set();
  return {
    label,
    closeCalls: 0,
    onEvent(fn) {
      events.add(fn);
      return () => events.delete(fn);
    },
    onClose(fn) {
      closes.add(fn);
      return () => closes.delete(fn);
    },
    emit(event) {
      for (const fn of events) fn(event);
    },
    close() {
      this.closeCalls++;
      for (const fn of [...closes]) fn();
    },
    counts: () => [events.size, closes.size],
  };
}

test('P0 useSocket complete frozen source export registers exact callbacks returns its socket ref and cleans only its owned socket', () => {
  const text = source(true);
  assert.equal(
    text,
    execFileSync('git', ['show', baseline + ':' + file], { cwd: root, encoding: 'utf8' }),
  );
  const sockets = [],
    trace = [];
  const io = (options) => {
    assert.equal(JSON.stringify(options), JSON.stringify({ transports: ['websocket'] }));
    const listeners = new Map();
    const socket = {
      on(name, fn) {
        (listeners.get(name) ?? listeners.set(name, new Set()).get(name)).add(fn);
        trace.push(['on', sockets.length, name]);
      },
      off(name, fn) {
        assert(listeners.get(name)?.delete(fn));
        trace.push(['off', sockets.indexOf(socket), name]);
      },
      disconnect() {
        socket.disconnected++;
        trace.push(['disconnect', sockets.indexOf(socket)]);
      },
      disconnected: 0,
      emit(name, ...args) {
        for (const fn of listeners.get(name) ?? []) fn(...args);
      },
      count(name) {
        return listeners.get(name)?.size ?? 0;
      },
    };
    sockets.push(socket);
    return socket;
  };
  const a = scheduler(),
    b = scheduler();
  const moduleA = load(text, { react: a.react, 'socket.io-client': { io } });
  assert.deepEqual(moduleA.imports, ['react', 'socket.io-client']);
  const got = [];
  const callback = (...args) => got.push(args);
  const ref = a.render(moduleA.useSocket, {
    connect: callback,
    disconnect: callback,
    custom: callback,
  });
  assert.equal(ref.current, sockets[0]);
  assert.equal(sockets[0].count('connect'), 2); // diagnostic and supplied handler
  sockets[0].emit('custom', '中文', 7, { value: true });
  assert.deepEqual(got, [['中文', 7, { value: true }]]);
  const rerender = a.render(moduleA.useSocket, {
    custom() {
      throw Error('Unexpected refreshed closure');
    },
  });
  assert.equal(rerender, ref);
  assert.equal(sockets.length, 1);
  sockets[0].emit('custom', 'original');
  assert.equal(got.at(-1)[0], 'original');
  const moduleB = load(text, { react: b.react, 'socket.io-client': { io } });
  const other = [];
  b.render(moduleB.useSocket, { custom: (...args) => other.push(args) });
  assert.equal(sockets.length, 2);
  a.unmount();
  assert.equal(sockets[0].disconnected, 1);
  assert.equal(sockets[0].count('custom'), 0);
  assert.equal(sockets[1].disconnected, 0);
  sockets[1].emit('custom', 'peer');
  assert.deepEqual(other, [['peer']]);
  sockets[0].emit('custom', 'late');
  assert.equal(got.length, 2);
  b.unmount();
  assert.equal(sockets[1].disconnected, 1);
  const remount = scheduler(),
    remodule = load(text, { react: remount.react, 'socket.io-client': { io } });
  assert.equal(remount.render(remodule.useSocket, {}).current, sockets[2]);
  remount.unmount();
  record('use-socket-frozen', {
    imports: moduleA.imports,
    soleExport: 'useSocket',
    trace,
    got,
    socketsCreated: sockets.length,
    limitations:
      'Complete frozen module; explicit hook scheduler and Socket.IO double. No React renderer, live Socket.IO connection or browser.',
  });
});

test('P0 useSocket current entire module switches shared clients removes owned listeners and preserves peer subscriptions', () => {
  const store = externalStore(),
    hooks = scheduler(),
    { useSocket, imports } = current(store, hooks);
  assert.deepEqual(imports, ['react', '../api/ui-agent', '../api/workspace-events']);
  const trace = [],
    events = {
      connect: () => trace.push('connect'),
      disconnect: () => trace.push('disconnect'),
      'access-tokens:changed': () => trace.push('tokens'),
    };
  assert.equal(hooks.render(useSocket, events), undefined); // retired ref deliberately removed
  assert.deepEqual(trace, ['disconnect']);
  assert.equal(store.size, 1);
  hooks.render(useSocket, events);
  assert.deepEqual(trace, ['disconnect']);
  const a = fakeClient('a'),
    b = fakeClient('b');
  store.set(a);
  assert.equal(hooks.updates, 1);
  hooks.render(useSocket, events);
  assert.deepEqual(a.counts(), [1, 1]);
  assert.equal(trace.at(-1), 'connect');
  const peer = scheduler(),
    peerHook = current(store, peer).useSocket,
    peerTrace = [];
  peer.render(peerHook, { 'access-tokens:changed': () => peerTrace.push('tokens') });
  assert.deepEqual(a.counts(), [2, 2]);
  a.emit({ type: 'accounts.tokens.changed' });
  assert.equal(trace.at(-1), 'tokens');
  assert.deepEqual(peerTrace, ['tokens']);
  hooks.render(useSocket, { 'access-tokens:changed': () => trace.push('unexpected-new-closure') });
  a.emit({ type: 'accounts.tokens.changed' });
  assert.equal(trace.at(-1), 'tokens');
  store.set(b);
  hooks.render(useSocket, events);
  assert.deepEqual(a.counts(), [1, 1]);
  assert.deepEqual(b.counts(), [1, 1]);
  const before = trace.length;
  a.emit({ type: 'accounts.tokens.changed' });
  assert.equal(trace.length, before);
  assert.equal(peerTrace.length, 3);
  b.emit({ type: 'accounts.tokens.changed' });
  assert.equal(trace.at(-1), 'tokens');
  b.close();
  assert.equal(trace.at(-1), 'disconnect');
  store.set(undefined);
  hooks.render(useSocket, events);
  assert.deepEqual(b.counts(), [0, 0]);
  hooks.unmount();
  assert.equal(store.size, 1);
  assert.equal(a.closeCalls, 0);
  assert.equal(b.closeCalls, 1);
  const last = trace.length;
  b.emit({ type: 'accounts.tokens.changed' });
  assert.equal(trace.length, last);
  peer.unmount();
  assert.equal(store.size, 0);
  assert.deepEqual(a.counts(), [0, 0]);
  record('use-socket-current-lifecycle', {
    trace,
    peerTrace,
    storeListenersAfterUnmount: store.size,
    oldClientClosedByHook: a.closeCalls,
    limitations:
      'Current complete module and real subscribeWorkspaceEvents. Shared store, hook scheduler and clients are explicit doubles; initial callback closure persists for an unchanged client, matching the former empty-dependency hook.',
  });
});

async function sessionFixture(t, agentId) {
  const listeners = [new Set(), new Set()],
    closed = [new Set(), new Set()];
  const endpoint = (i) => ({
    async send(message) {
      queueMicrotask(() => {
        for (const fn of listeners[1 - i]) fn(structuredClone(message));
      });
    },
    onMessage(fn) {
      listeners[i].add(fn);
      return () => listeners[i].delete(fn);
    },
    onClose(fn) {
      closed[i].add(fn);
      return () => closed[i].delete(fn);
    },
    close(error) {
      for (const fn of [...closed[1 - i]]) fn(error);
    },
  });
  const session = new AgentSession(endpoint(0), {
    agentId,
    version: 'fixture',
    handlers: {
      'fixture.event': {
        effect: 'query',
        validate() {},
        async run(p, c) {
          if (p.reliable) await c.events.write(p.type, p.payload, p.resource);
          else c.events.notifyState(p.type, p.payload, p.resource);
          return null;
        },
      },
    },
  });
  const client = new AgentClient(endpoint(1));
  await client.initialize();
  await client.subscribe(workspaceTopics);
  const wire = [];
  client.onEvent((event) => {
    wire.push(structuredClone(event));
  });
  t.after(async () => {
    client.close();
    await session.close();
  });
  return {
    session,
    client,
    wire,
    emit: (type, payload, resource, reliable = false) =>
      client.request('fixture.event', {
        type,
        payload,
        ...(resource ? { resource } : {}),
        reliable,
      }),
  };
}

test('P0 useSocket actual Agent sessions project subscribed events with owner isolation resync and decoder disposal across client replacement', async (t) => {
  const a = await sessionFixture(t, 'hook-owner-a'),
    b = await sessionFixture(t, 'hook-owner-b');
  const store = externalStore(),
    hooks = scheduler(),
    hook = current(store, hooks).useSocket;
  t.after(() => hooks.unmount());
  const trace = [],
    outputs = [],
    exits = [],
    hosts = [],
    repos = [];
  const callbacks = {
    connect: () => trace.push('connect'),
    disconnect: () => trace.push('disconnect'),
    'connection:status': (p) => hosts.push(p),
    'repository:changed': (id) => repos.push(id),
    'access-tokens:changed': () => trace.push('tokens'),
    'command:output': (p) => outputs.push(p),
    'command:exit': (p) => exits.push(p),
  };
  hooks.render(hook, callbacks);
  store.set(a.client);
  hooks.render(hook, callbacks);
  const resourceA = { agentId: 'hook-owner-a', resourceId: 'repo-a' };
  const resourceB = { agentId: 'hook-owner-b', resourceId: 'repo-b' };
  for (const status of ['connecting', 'connected', 'error', 'disconnected'])
    await a.emit('hosts.changed', { hostId: 'host-a', status, updatedAt: hosts.length + 1 });
  assert.deepEqual(
    hosts.map((p) => p.status),
    ['connecting', 'connected', 'error', 'disconnected'],
  );
  assert(hosts.every((p) => p.connectionId === 'host-a'));
  await a.emit('hosts.changed', { hostId: 'host-a', status: 'unsupported', updatedAt: 100 });
  assert.equal(hosts.length, 4);
  await a.emit('repositories.changed', { generation: 1 }, resourceA);
  assert.deepEqual(repos, ['repo-a']);
  await a.emit('accounts.tokens.changed', {});
  assert.equal(trace.at(-1), 'tokens');
  await a.emit('accounts.hosts.changed', {});
  assert.equal(trace.at(-1), 'connect');
  const beforeResync = trace.length;
  await a.client.subscribe([...workspaceTopics, 'events.resync-required']);
  await a.emit('events.resync-required', {});
  assert.equal(trace.length, beforeResync + 1);
  assert.equal(trace.at(-1), 'connect');
  const base = {
    commandId: 'same-command',
    operationId: 'operation',
    command: 'git status',
    executable: 'git',
    args: ['status'],
    cwd: '/fixture',
  };
  const output = (bytes) => ({
    ...base,
    stream: 'stdout',
    base64: Buffer.from(bytes).toString('base64'),
  });
  await a.emit('commands.output', output([0xe4]), resourceA, true);
  assert.equal(outputs.length, 0);
  store.set(b.client);
  hooks.render(hook, callbacks);
  await a.emit('commands.output', output([0xb8, 0xad]), resourceA, true);
  await a.emit('accounts.tokens.changed', {});
  assert.equal(outputs.length, 0);
  assert.equal(trace.at(-1), 'connect');
  await b.emit('commands.output', output([0xb8, 0xad]), resourceB, true);
  assert.equal(outputs.at(-1).data, '\ufffd\ufffd'); // old client's UTF-8 prefix was cleared
  await b.emit('commands.output', output(Buffer.from('中文')), resourceB, true);
  assert.equal(outputs.at(-1).data, '中文');
  assert(
    outputs.every(
      (p) =>
        p.agentId === 'hook-owner-b' &&
        p.repositoryId === 'repo-b' &&
        p.sessionId === b.session.sessionId,
    ),
  );
  await b.emit('commands.exit', { ...base, exitCode: null, signal: 'SIGTERM' }, resourceB, true);
  assert.equal(exits.length, 0);
  await b.emit('commands.exit', { ...base, exitCode: 7, signal: null }, resourceB, true);
  assert.equal(exits.length, 1);
  assert.equal(exits[0].exitCode, 7);
  await assert.rejects(b.emit('repositories.changed', {}, resourceA));
  assert.deepEqual(repos, ['repo-a']);
  hooks.unmount();
  assert.equal(store.size, 0);
  const after = JSON.stringify({ trace, outputs, exits, hosts, repos });
  await b.emit('accounts.tokens.changed', {});
  await b.emit('repositories.changed', {}, resourceB);
  assert.equal(JSON.stringify({ trace, outputs, exits, hosts, repos }), after);
  assert.equal((await a.client.request('agent.health')).status, 'ok');
  assert.equal((await b.client.request('agent.health')).status, 'ok');
  const remount = scheduler(),
    remountHook = current(store, remount).useSocket;
  remount.render(remountHook, callbacks);
  assert.equal(store.size, 1);
  b.client.close();
  assert.equal(trace.at(-1), 'disconnect');
  remount.unmount();
  assert.equal(store.size, 0);
  record('use-socket-agent-integration', {
    trace,
    outputs,
    exits,
    hosts,
    repos,
    wireA: a.wire,
    wireB: b.wire,
    limitations:
      'Actual AgentSession/EventQueue/AgentClient and production event projection over controlled in-memory transport; hook scheduler/store are doubles. Unknown exits are not fabricated. No network/browser/React scheduler or production shared UI kernel coverage.',
  });
});
