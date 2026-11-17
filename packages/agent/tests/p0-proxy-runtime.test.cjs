// Exact frozen service versus current production runtime; all endpoints are disposable loopback.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const net = require('node:net');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { ProxyRuntime } = require('../dist/adapters/network/runtime');
const transport = require('../dist/adapters/network/proxy-transport');
const { StateFault } = require('../dist/ports/state');
const { openStateKernel } = require('../dist/bootstrap/state-kernel');
const root = path.resolve(__dirname, '../../..');
const baseline = '3c05f640fcc1a04c864e47bfc2880483ad48c984';
const serviceFile = 'apps/server/src/proxy/proxy.service.ts';
const transportFile = 'packages/ssh-client/src/proxy-transport.ts';
const plain = (v) => JSON.parse(JSON.stringify(v));
function proof(name, value) {
  if (process.env.P0_PROXY_RUNTIME_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_PROXY_RUNTIME_PROOF_DIR, name + '.json'),
      JSON.stringify(value, null, 2) + '\n',
      { flag: 'wx' },
    );
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function source(file, frozen = true) {
  const text = fs.readFileSync(
    path.join(frozen ? process.env.P0_PROXY_RUNTIME_FROZEN : root, file),
    'utf8',
  );
  if (frozen)
    assert.equal(
      text,
      execFileSync('git', ['show', baseline + ':' + file], { cwd: root, encoding: 'utf8' }),
    );
  return text;
}
function evaluate(file, deps, frozen = true, globals = {}) {
  const module = { exports: {} };
  const text = ts.transpileModule(source(file, frozen), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      experimentalDecorators: true,
    },
  }).outputText;
  vm.runInNewContext(
    text,
    {
      module,
      exports: module.exports,
      Error,
      Buffer,
      URL,
      AbortController,
      AbortSignal,
      setTimeout,
      clearTimeout,
      require(id) {
        assert(Object.hasOwn(deps, id), 'Unreviewed dependency: ' + id);
        return deps[id];
      },
      ...globals,
    },
    { filename: file },
  );
  return module.exports;
}
function frozenTransport() {
  return evaluate(
    transportFile,
    Object.fromEntries(
      ['node:net', 'node:tls', 'node:http', 'node:https', 'undici', 'socks'].map((id) => [
        id,
        require(id),
      ]),
    ),
  );
}
function service(settings, networking, fetcher = global.fetch, decorators = []) {
  const { ProxyService } = evaluate(
    serviceFile,
    {
      '@nestjs/common': {
        Injectable: () => (target) => {
          decorators.push(target.name);
        },
      },
      '@alune/ssh-client': networking,
      './proxy-settings': {}, // Type-only constructor metadata is absent; actual settings port supplied below.
    },
    true,
    { fetch: fetcher },
  );
  return new ProxyService(settings);
}
function instrumented(current, settings, networking, fetcher) {
  return current
    ? new (evaluate(
        'packages/agent/src/adapters/network/runtime.ts',
        {
          './proxy-transport': networking,
          '../../ports/state': { StateFault },
        },
        false,
        { fetch: fetcher },
      ).ProxyRuntime)(settings)
    : service(settings, networking, fetcher);
}
function settingsPort(initial) {
  let snapshot = initial;
  return {
    set: (value) => {
      snapshot = value;
    },
    snapshot: () => snapshot,
    read: () => ({
      ...snapshot,
      authEnabled: Boolean(snapshot.credentials),
      hasCredentials: Boolean(snapshot.credentials),
      secretStorageAvailable: true,
    }),
  };
}
const initial = () => ({
  revision: 'r1',
  enabled: true,
  protocol: 'http',
  host: '127.0.0.1',
  port: 3128,
});
const stop = (v) => (v.close ? v.close() : v.onModuleDestroy());
async function listen(server) {
  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    port: server.address().port,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
function bridgeGet(port, target) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: target }, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    request.on('error', reject);
  });
}
async function refused(port) {
  await new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('error', (error) => {
      assert.equal(error.code, 'ECONNREFUSED');
      resolve();
    });
    socket.once('connect', () => {
      socket.destroy();
      reject(Error('Owned bridge remained open'));
    });
  });
}

test('P0 proxy service entire frozen source class and fetch preserve revision dispatch and retired cleanup', async () => {
  const inventory = ts.createSourceFile(
    serviceFile,
    source(serviceFile),
    ts.ScriptTarget.Latest,
    true,
  );
  const klass = inventory.statements.find(ts.isClassDeclaration);
  assert.deepEqual(
    inventory.statements.filter(ts.isImportDeclaration).map((v) => v.moduleSpecifier.text),
    ['@nestjs/common', '@alune/ssh-client', './proxy-settings'],
  );
  assert.deepEqual(
    klass.members.map((m) => m.name?.getText(inventory) ?? 'constructor'),
    [
      'dispatcher',
      'revision',
      'bridge',
      'retired',
      'constructor',
      'fetch',
      'updaterBridge',
      'onModuleDestroy',
    ],
  );
  const results = [];
  for (const current of [false, true]) {
    const settings = settingsPort(initial()),
      calls = [],
      dispatchers = [];
    const make = (snapshot) => {
      const closed = deferred();
      const dispatcher = {
        revision: snapshot.revision,
        closeCalls: 0,
        destroyCalls: 0,
        close() {
          this.closeCalls++;
          return closed.promise;
        },
        async destroy() {
          this.destroyCalls++;
        },
        closed,
      };
      dispatchers.push(dispatcher);
      return dispatcher;
    };
    const runtime = instrumented(current, settings, { createProxyDispatcher: make }, (...args) => {
      calls.push(args);
      return Promise.resolve('ok');
    });
    assert.strictEqual(runtime.settings, settings);
    const headers = { 'x-fixture': 'retained' },
      signal = new AbortController().signal;
    const input = new URL('http://fixture.invalid/path'),
      init = { method: 'POST', headers, body: 'payload', redirect: 'error', signal };
    assert.equal(await runtime.fetch(input, init), 'ok');
    assert.strictEqual(calls[0][0], input);
    assert.strictEqual(calls[0][1].headers, headers);
    assert.strictEqual(calls[0][1].signal, signal);
    assert.deepEqual(Object.keys(calls[0][1]).sort(), [...Object.keys(init), 'dispatcher'].sort());
    for (const key of Object.keys(init)) assert.strictEqual(calls[0][1][key], init[key]);
    assert.equal(init.dispatcher, undefined);
    await runtime.fetch(input);
    assert.equal(dispatchers.length, 1);
    settings.set({ ...initial(), revision: 'r2' });
    await runtime.fetch(input);
    assert.equal(dispatchers.length, 2);
    assert.equal(dispatchers[0].closeCalls, 1);
    assert.equal(runtime.retired.size, 1);
    dispatchers[0].closed.reject(Error('synthetic graceful-close failure'));
    await new Promise(setImmediate);
    assert.equal(runtime.retired.size, 0, 'graceful close failure is contained');
    settings.set({ ...initial(), revision: 'r3' });
    await runtime.fetch(input);
    assert.equal(runtime.retired.size, 1);
    await stop(runtime);
    assert.equal(dispatchers[1].destroyCalls, 1, 'pending retired dispatcher forcibly destroyed');
    assert.equal(dispatchers[2].destroyCalls, 1);
    dispatchers[1].closed.resolve();
    await new Promise(setImmediate);
    assert.equal(runtime.retired.size, 0);
    results.push({
      current,
      calls: calls.length,
      dispatchers: dispatchers.map((d) => ({
        revision: d.revision,
        closeCalls: d.closeCalls,
        destroyCalls: d.destroyCalls,
      })),
    });
  }
  const decorators = [];
  const frozen = service(settingsPort(initial()), {}, global.fetch, decorators);
  assert.deepEqual(decorators, ['ProxyService']);
  assert.deepEqual(Object.getOwnPropertyNames(Object.getPrototypeOf(frozen)), [
    'constructor',
    'updaterBridge',
    'onModuleDestroy',
  ]);
  assert.equal(typeof frozen.fetch, 'function');
  await stop(frozen);
  proof('proxy-service-inventory-dispatch', { imports: 3, fullClass: true, results });
});

test('P0 proxy fetch snapshot factory and request failures never retry or select implicit direct fallback', async () => {
  const rows = [];
  for (const current of [false, true]) {
    const settings = settingsPort(initial()),
      marker = Error('synthetic snapshot/factory/fetch failure');
    let requests = 0,
      factories = 0,
      failFactory = true;
    const snapshot = settings.snapshot;
    settings.snapshot = () => {
      throw marker;
    };
    const runtime = instrumented(
      current,
      settings,
      {
        createProxyDispatcher() {
          factories++;
          if (failFactory) throw marker;
          return { async close() {}, async destroy() {} };
        },
      },
      async () => {
        requests++;
        throw marker;
      },
    );
    assert.throws(
      () => runtime.fetch('http://fixture.invalid'),
      (e) => e === marker,
    );
    assert.equal(factories, 0);
    assert.equal(requests, 0);
    settings.snapshot = snapshot;
    assert.throws(
      () => runtime.fetch('http://fixture.invalid'),
      (e) => e === marker,
    );
    assert.equal(requests, 0);
    assert.equal(runtime.revision, undefined);
    failFactory = false;
    await assert.rejects(runtime.fetch('http://fixture.invalid'), (e) => e === marker);
    assert.equal(factories, 2);
    assert.equal(requests, 1);
    await assert.rejects(runtime.fetch('http://fixture.invalid'), (e) => e === marker);
    assert.equal(factories, 2);
    assert.equal(requests, 2, 'no automatic resend');
    settings.set({ ...initial(), revision: 'disabled', enabled: false });
    const custom = {};
    let forwarded;
    const direct = instrumented(current, settings, {}, (_input, init) => {
      forwarded = init;
      return Promise.resolve('direct');
    });
    await direct.fetch('http://fixture.invalid', { dispatcher: custom });
    assert.strictEqual(
      forwarded.dispatcher,
      custom,
      'disabled mode retains explicit caller options',
    );
    await stop(direct);
    await stop(runtime);
    rows.push({ current, requests, factories, implicitFallback: false });
  }
  proof('proxy-fetch-failures', rows);
});

test('P0 updater bridge coalesces creation retries failures and returns only live public revision metadata', async () => {
  const rows = [];
  for (const current of [false, true]) {
    const settings = settingsPort(initial()),
      attempts = [],
      closed = [];
    const runtime = instrumented(current, settings, {
      createProxyBridge(getSnapshot) {
        const d = deferred();
        attempts.push({ ...d, getSnapshot });
        return d.promise;
      },
    });
    const first = runtime.updaterBridge(),
      second = runtime.updaterBridge();
    assert.equal(attempts.length, 1);
    const failure = Error('synthetic bind failure');
    attempts[0].reject(failure);
    for (const p of [first, second]) await assert.rejects(p, (e) => e === failure);
    assert.equal(runtime.bridge, undefined);
    const third = runtime.updaterBridge();
    assert.equal(attempts.length, 2);
    const next = {
      ...initial(),
      revision: 'r2',
      enabled: false,
      credentials: { username: 'synthetic', password: 'synthetic-secret' },
    };
    settings.set(next);
    attempts[1].resolve({
      port: 45678,
      close() {
        closed.push(true);
      },
    });
    assert.deepEqual(plain(await third), { port: 45678, revision: 'r2', enabled: false });
    assert.strictEqual(attempts[1].getSnapshot(), next, 'bridge reads a new per-request snapshot');
    settings.set({ ...next, revision: 'r3', enabled: true });
    assert.deepEqual(plain(await runtime.updaterBridge()), {
      port: 45678,
      revision: 'r3',
      enabled: true,
    });
    const read = settings.read;
    settings.read = () => {
      throw failure;
    };
    await assert.rejects(runtime.updaterBridge(), (e) => e === failure);
    settings.read = read;
    assert.equal((await runtime.updaterBridge()).port, 45678);
    assert.equal(attempts.length, 2);
    await stop(runtime);
    assert.equal(closed.length, 1);
    rows.push({
      current,
      attempts: attempts.length,
      metadataKeys: ['port', 'revision', 'enabled'],
      closed: closed.length,
    });
  }
  proof('proxy-bridge-coalescing', rows);
});

test('P0 proxy destruction contains failed bridge creation and closes pending creation with explicit successor lifecycle policy', async () => {
  const rows = [];
  for (const current of [false, true]) {
    const pending = deferred(),
      settings = settingsPort(initial());
    let closes = 0,
      destroys = 0;
    const runtime = instrumented(
      current,
      settings,
      {
        createProxyDispatcher: () => ({
          async destroy() {
            destroys++;
          },
          async close() {},
        }),
        createProxyBridge: () => pending.promise,
      },
      async () => 'ok',
    );
    await runtime.fetch('http://fixture.invalid');
    const bridge = runtime.updaterBridge();
    const closing = stop(runtime);
    if (current) {
      assert.strictEqual(stop(runtime), closing);
      assert.throws(
        () => runtime.fetch('http://fixture.invalid'),
        (e) => e.kind === 'unavailable',
      );
      await assert.rejects(runtime.updaterBridge(), (e) => e.kind === 'unavailable');
    }
    const outcome = bridge.then(
      (value) => ({ value: plain(value) }),
      (error) => ({ kind: error.kind }),
    );
    pending.resolve({
      port: 45678,
      close() {
        closes++;
      },
    });
    await closing;
    const observed = await outcome;
    assert.equal(destroys, 1);
    if (current) {
      assert.deepEqual(observed, { kind: 'unavailable' });
      assert.equal(closes, 2);
    } else {
      assert.equal(observed.value.port, 45678);
      assert.equal(closes, 1);
    }
    rows.push({ current, observed, closes, destroys });
  }
  for (const current of [false, true]) {
    const pending = deferred(),
      failure = Error('synthetic bind rejection');
    let destroys = 0;
    const runtime = instrumented(
      current,
      settingsPort(initial()),
      {
        createProxyDispatcher: () => ({
          async destroy() {
            destroys++;
          },
          async close() {},
        }),
        createProxyBridge: () => pending.promise,
      },
      async () => 'ok',
    );
    await runtime.fetch('http://fixture.invalid');
    const creating = runtime.updaterBridge();
    const closing = stop(runtime);
    const result = closing.then(
      () => 'closed',
      (e) => {
        assert.strictEqual(e, failure);
        return 'rejected';
      },
    );
    pending.reject(failure);
    await assert.rejects(creating, (e) => e === failure);
    assert.equal(await result, current ? 'closed' : 'rejected');
    assert.equal(destroys, current ? 1 : 0);
    rows.push({ current, rejectedBridgeCreation: true, destroys });
  }
  proof('proxy-lifecycle-races', {
    rows,
    policy:
      'Current close is idempotent, refuses new work and drains dispatchers after rejected bridge creation. Frozen destroy propagates pending bind rejection before dispatcher destruction. Close may call idempotent bridge.close twice during creation race.',
  });
});

test(
  'P0 proxy real frozen and current transports retain inflight requests switch revisions and fail closed through stable bridge',
  { timeout: 30000 },
  async (t) => {
    const rows = [];
    for (const current of [false, true]) {
      let destinationHits = 0;
      const entered = deferred(),
        release = deferred();
      const destination = http.createServer(async (req, res) => {
        destinationHits++;
        if (req.url === '/slow') {
          entered.resolve();
          await release.promise;
        }
        res.end(req.headers['x-fixture'] ?? 'destination');
      });
      const dest = await listen(destination);
      t.after(() => dest.close());
      const proxyRecords = [],
        upstreams = new Set();
      async function proxy(label, rejectAuth = false) {
        const server = http.createServer();
        server.on('connect', (request, socket, head) => {
          proxyRecords.push({
            label,
            authority: request.url,
            auth: Boolean(request.headers['proxy-authorization']),
          });
          if (rejectAuth)
            return socket.end(
              'HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n',
            );
          const upstream = net.connect({ host: '127.0.0.1', port: dest.port }, () => {
            socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            if (head.length) upstream.write(head);
            socket.pipe(upstream).pipe(socket);
          });
          upstreams.add(upstream);
          upstream.once('close', () => upstreams.delete(upstream));
          upstream.on('error', () => socket.destroy());
          socket.once('close', () => upstream.destroy());
        });
        const result = await listen(server);
        t.after(() => result.close());
        return result;
      }
      const a = await proxy('a'),
        b = await proxy('b'),
        bad = await proxy('bad', true);
      const settings = settingsPort({ ...initial(), port: a.port });
      const runtime = current ? new ProxyRuntime(settings) : service(settings, frozenTransport());
      t.after(async () => {
        release.resolve();
        await stop(runtime);
        for (const s of upstreams) s.destroy();
      });
      const target = `http://127.0.0.1:${dest.port}`;
      const slow = runtime
        .fetch(target + '/slow', { headers: { 'x-fixture': 'old-inflight' } })
        .then((res) => res.text());
      await entered.promise;
      const bridge = await runtime.updaterBridge();
      settings.set({ ...initial(), revision: 'r2', port: b.port });
      assert.equal(
        await (
          await runtime.fetch(target + '/next', { headers: { 'x-fixture': 'new-revision' } })
        ).text(),
        'new-revision',
      );
      release.resolve();
      assert.equal(await slow, 'old-inflight');
      assert.deepEqual(
        proxyRecords.slice(0, 2).map((r) => r.label),
        ['a', 'b'],
      );
      assert.deepEqual(await bridgeGet(bridge.port, target + '/bridge'), {
        status: 200,
        body: 'destination',
      });
      assert.equal(proxyRecords.at(-1).label, 'b');
      const before = destinationHits;
      settings.set({
        ...initial(),
        revision: 'r3',
        port: bad.port,
        credentials: { username: 'synthetic', password: 'synthetic-secret' },
      });
      await assert.rejects(runtime.fetch(target + '/blocked'));
      assert.equal((await bridgeGet(bridge.port, target + '/blocked')).status, 502);
      assert.equal(destinationHits, before, 'proxy auth failures cannot fall back to direct');
      assert.equal(proxyRecords.at(-1).auth, true);
      const metadata = await runtime.updaterBridge();
      assert.deepEqual(plain(metadata), { port: bridge.port, revision: 'r3', enabled: true });
      assert.doesNotMatch(JSON.stringify(metadata), /synthetic|credentials/);
      settings.set({ ...initial(), revision: 'r4', enabled: false, port: bad.port });
      assert.equal(await (await runtime.fetch(target + '/direct')).text(), 'destination');
      assert.equal((await bridgeGet(bridge.port, target + '/direct-bridge')).status, 200);
      assert.equal((await runtime.updaterBridge()).port, bridge.port);
      const snapshot = settings.snapshot;
      settings.snapshot = () => {
        throw Error('synthetic corrupt settings');
      };
      assert.throws(() => runtime.fetch(target + '/corrupt'), /synthetic corrupt settings/);
      assert.equal((await bridgeGet(bridge.port, target + '/corrupt')).status, 502);
      assert.equal(destinationHits, before + 2);
      settings.snapshot = snapshot;
      await stop(runtime);
      await refused(bridge.port);
      rows.push({
        current,
        proxyRecords,
        destinationHits,
        oldInflightCompleted: true,
        stableBridge: true,
        closedPort: true,
      });
    }
    proof('proxy-real-transport-routing', rows);
  },
);

test(
  'P0 proxy current kernel bridge ownership cancellation and durable settings remain isolated across restart',
  { timeout: 30000 },
  async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-batch25-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const ids = [randomUUID(), randomUUID()],
      kernels = [];
    for (let i = 0; i < 2; i++)
      kernels.push(
        await openStateKernel(path.join(directory, String(i)), ids[i], undefined, {
          backend: 'file',
        }),
      );
    t.after(async () => {
      for (const k of kernels) await k.close();
    });
    const notifications = [];
    async function call(index, name, params, signal = new AbortController().signal) {
      const handler = kernels[index].handlers[name];
      handler.validate(params);
      return handler.run(params, {
        signal,
        sessionSignal: signal,
        agentId: ids[index],
        sessionId: randomUUID(),
        taskId: randomUUID(),
        events: {
          notifyState(...args) {
            notifications.push({ index, args });
          },
        },
      });
    }
    const a = await call(0, 'network.updaterBridge', {}),
      b = await call(1, 'network.updaterBridge', {});
    assert.equal(a.agentId, ids[0]);
    assert.equal(b.agentId, ids[1]);
    assert.equal(a.scope, 'agent-loopback');
    assert.notEqual(a.port, b.port);
    const first = await call(0, 'settings.proxy.get');
    const config = { ...first, host: '127.0.0.1', port: 31337, credentials: { action: 'keep' } };
    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(
      call(0, 'settings.proxy.save', { config }, cancelled.signal),
      (e) => e.name === 'AbortError',
    );
    assert.equal((await call(0, 'settings.proxy.get')).revision, first.revision);
    assert.equal(notifications.length, 0);
    const saved = await call(0, 'settings.proxy.save', { config });
    assert.notEqual(saved.revision, first.revision);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].args[0], 'settings.changed');
    assert.equal((await call(0, 'network.updaterBridge', {})).revision, saved.revision);
    assert.equal((await call(1, 'network.updaterBridge', {})).revision, b.revision);
    const stopA = kernels[0].close();
    await stopA;
    await refused(a.port);
    const destination = http.createServer((_req, res) => res.end('owner-b-alive'));
    const dest = await listen(destination);
    t.after(() => dest.close());
    assert.equal(
      (await bridgeGet(b.port, `http://127.0.0.1:${dest.port}/owner`)).body,
      'owner-b-alive',
    );
    kernels[0] = await openStateKernel(path.join(directory, '0'), ids[0], undefined, {
      backend: 'file',
    });
    assert.equal((await call(0, 'settings.proxy.get')).revision, saved.revision);
    const restarted = await call(0, 'network.updaterBridge', {});
    assert.equal(restarted.agentId, a.agentId);
    assert.equal(restarted.revision, saved.revision);
    await kernels[0].close();
    await kernels[1].close();
    await refused(restarted.port);
    await refused(b.port);
    proof('proxy-kernel-ownership', {
      owners: ids,
      distinctPorts: true,
      cancellationBeforeSave: true,
      settingsRevisionPersisted: true,
      survivingOwnerUsable: true,
      allOwnedPortsClosed: true,
      notifications: notifications.length,
      limitation:
        'Local direct handler scope; transport/durable mutation receipts are separate same-run companion tests. No claim that bridge ports survive restart or settings cancellation rolls back a started write.',
    });
  },
);
