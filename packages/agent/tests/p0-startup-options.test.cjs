// Real HTTP/IPC/Agent boundaries, with explicit Electron bootstrap dependency doubles.
// No daily state, legacy migration, OS credentials, installers or hosted-only scripts.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const { randomBytes, createHash } = require('node:crypto');
const ts = require('typescript');
const sdk = require('@alune/agent-client/node');
const { PROTOCOL_VERSION } = require('@alune/protocol');
const repo = path.resolve(__dirname, '../../..');
const cli = path.join(repo, 'packages/agent/bin/alune-agent.cjs');
const desktopFile = path.join(repo, 'apps/desktop/src/desktop-agent.cjs');
const version = require('../../../package.json').version;
const digest = (v) => createHash('sha256').update(v).digest('hex');
const plain = (v) => JSON.parse(JSON.stringify(v));
function record(name, value) {
  if (process.env.P0_STARTUP_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_STARTUP_PROOF_DIR, name),
      JSON.stringify(value, null, 2) + '\n',
      { flag: 'wx' },
    );
}
function frozenBootstrap() {
  assert(process.env.P0_STARTUP_FROZEN, 'Use the batch-07 replay driver');
  const source = fs.readFileSync(
    path.join(process.env.P0_STARTUP_FROZEN, 'apps/server/src/bootstrap.ts'),
    'utf8',
  );
  const ast = ts.createSourceFile('bootstrap.ts', source, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(
    (s) => ts.isInterfaceDeclaration(s) && s.name.text === 'ServerOptions',
  );
  const fields = declaration.members.map((m) => ({
    name: m.name.getText(ast),
    type: m.type.getText(ast),
    optional: Boolean(m.questionToken),
  }));
  assert.deepEqual(
    fields,
    [
      ['port', 'number'],
      ['host', 'string'],
      ['webRoot', 'string'],
      ['token', 'string'],
      ['aiSecretStorage', 'AiSecretStorage'],
      ['desktop', 'boolean'],
    ].map(([name, type]) => ({ name, type, optional: true })),
  );
  const calls = [],
    apps = [];
  class IoAdapter {
    createIOServer(port, options) {
      calls.push(['super.createIOServer', port]);
      return { port, options };
    }
  }
  const deps = {
    '@nestjs/core': {
      NestFactory: {
        async create(mod, options) {
          const app = {
            mod,
            options,
            terminals: {},
            middleware: [],
            cors: [],
            prefix: [],
            get() {
              return this.terminals;
            },
            use(...args) {
              this.middleware.push(args);
            },
            useWebSocketAdapter(value) {
              this.adapter = value;
            },
            enableCors(value) {
              this.cors.push(value);
            },
            setGlobalPrefix(value) {
              this.prefix.push(value);
            },
            async listen(...args) {
              this.listenArgs = args;
            },
            async getUrl() {
              return 'http://synthetic.invalid';
            },
            async close() {
              this.closed = true;
            },
          };
          apps.push(app);
          return app;
        },
      },
    },
    '@nestjs/platform-socket.io': { IoAdapter },
    express: {
      json: (options) => ({ parser: options ?? 'default' }),
      static: (...args) => ({ static: args }),
    },
    'node:path': path,
    './app.module': { AppModule: { register: (storage) => ({ storage }) } },
    './terminal/terminal-registry': { TerminalRegistry: class {} },
    './logging/nest-logger': { AluneNestLogger: class {} },
    './logging/logger': {
      logger: { info() {}, error() {} },
      errorContext: (e) => e,
      logStore() {},
    },
    './logging/redact': { registerSecret: (token) => calls.push(['registerSecret', token]) },
  };
  const m = { exports: {} };
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext('(function(require,module,exports){' + code + '\n})', {})(
    (name) => {
      assert(Object.hasOwn(deps, name), 'Unreviewed frozen dependency: ' + name);
      return deps[name];
    },
    m,
    m.exports,
  );
  assert.deepEqual(Object.keys(m.exports), ['startServer']);
  return { source, fields, calls, apps, ...m.exports };
}
async function desktop(t, ...input) {
  const token = input.length ? input[0] : randomBytes(32).toString('hex');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-batch07-')),
    src = path.join(root, 'src'),
    runtime = path.join(root, 'agent-runtime');
  fs.mkdirSync(path.join(src, 'web/assets'), { recursive: true });
  fs.mkdirSync(runtime);
  fs.writeFileSync(
    path.join(runtime, 'manifest.json'),
    JSON.stringify({ version, target: process.platform + '-' + process.arch }),
  );
  fs.writeFileSync(path.join(src, 'web/index.html'), '<html>batch07 shell</html>');
  fs.writeFileSync(path.join(src, 'web/assets/app.js'), 'window.batch07 = true;');
  fs.writeFileSync(path.join(src, 'web/socket.iota'), 'not a reserved endpoint');
  fs.writeFileSync(path.join(root, 'outside.js'), 'OUTSIDE-PRIVATE-BYTES');
  fs.symlinkSync(path.join(root, 'outside.js'), path.join(src, 'web/assets/linked.js'));
  const handlers = new Map(),
    hosts = [],
    effects = [];
  const contents = () => {
    const c = new EventEmitter();
    c.mainFrame = { url: '', send: (...args) => c.emit('sent', ...args) };
    c.isDestroyed = () => false;
    return c;
  };
  const workspace = contents(),
    logs = contents();
  const allowed = {
    'node:http': http,
    'node:path': path,
    'node:fs': fs,
    'node:os': os,
    '@alune/agent-client/node': {
      superviseUiAgent: async (node, entry, dir, v) => {
        effects.push('supervise');
        assert.equal(node, path.join(runtime, 'runtime/bin/node'));
        assert.equal(entry, path.join(runtime, 'node_modules/@alune/agent/bin/alune-agent.cjs'));
        assert.equal(dir, path.join(root, 'data/agent'));
        assert.equal(v, version);
        const h = await sdk.superviseUiAgent(process.execPath, cli, dir, v);
        hosts.push(h);
        return h;
      },
    },
    './workspace-preferences.cjs': require('../../../apps/desktop/src/workspace-preferences.cjs'),
    './agent-window-channel.cjs': require('../../../apps/desktop/src/agent-window-channel.cjs'),
    './agent-import.cjs': {
      initializeDesktopState: async (...args) => {
        effects.push('migration-double');
        assert.equal(args[1], path.join(root, 'data'));
      },
    },
    './ai-secret-storage.cjs': {
      createAiSecretStorage: () => {
        effects.push('safeStorage-double');
        return {};
      },
    },
    electron: { safeStorage: {} },
    undici: require('undici'),
  };
  const m = new Module(path.join(src, 'desktop-agent.cjs'), module);
  m.filename = path.join(src, 'desktop-agent.cjs');
  m.require = (name) => {
    assert(Object.hasOwn(allowed, name), 'Unreviewed desktop dependency: ' + name);
    return allowed[name];
  };
  m._compile(
    fs.readFileSync(process.env.P0_STARTUP_DESKTOP_FILE ?? desktopFile, 'utf8'),
    m.filename,
  );
  let service;
  t.after(async () => {
    await service?.close();
    for (const h of hosts) await h.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const start = async () => {
    service = await m.exports.startDesktopAgent({
      app: { isPackaged: false, getVersion: () => version },
      ipcMain: {
        handle(name, fn) {
          assert(!handlers.has(name));
          handlers.set(name, fn);
        },
        removeHandler(name) {
          handlers.delete(name);
        },
      },
      token,
      dataDir: path.join(root, 'data'),
      windowContents: () => workspace,
      logContents: () => logs,
      smokeTest: true,
    });
    workspace.mainFrame.url = service.origin;
    logs.mainFrame.url = service.origin + '/logs';
    return service;
  };
  return {
    root,
    start,
    handlers,
    effects,
    workspace,
    logs,
    token,
    event: (c) => ({ sender: c, senderFrame: c.mainFrame }),
  };
}
function request(origin, token, route, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      origin + '/',
      {
        path: route,
        method: options.method ?? 'GET',
        headers: {
          ...(token === undefined ? {} : { authorization: 'Bearer ' + token }),
          ...options.headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(Error('HTTP timeout')));
    req.end();
  });
}
function peer(f, c, generation) {
  return new sdk.AgentClient(
    sdk.frameTransport({
      send: async (frame) => {
        assert.equal(await f.handlers.get('agent:frame')(f.event(c), generation, frame), true);
      },
      close: () => {
        f.handlers.get('agent:close')?.(f.event(c), generation);
      },
      onFrame(fn) {
        const read = (type, g, value) => {
          if (type === 'agent:frame' && g === generation) fn(value);
        };
        c.on('sent', read);
        return () => c.off('sent', read);
      },
      onEnd(fn) {
        const read = (type, g) => {
          if (type === 'agent:end' && g === generation) fn();
        };
        c.on('sent', read);
        return () => c.off('sent', read);
      },
    }),
  );
}
const sequences = new Map();
async function raw(f, c, generation, method, params) {
  return new Promise((resolve, reject) => {
    const sequence = (sequences.get(generation) ?? 0) + 1;
    sequences.set(generation, sequence);
    const id = 'batch07:' + sequence;
    const timer = setTimeout(() => {
      c.off('sent', read);
      reject(Error('No raw response: ' + method));
    }, 5000);
    const read = (kind, g, value) => {
      if (kind !== 'agent:frame' || g !== generation) return;
      const reply = JSON.parse(value);
      if (reply.id !== id) return;
      clearTimeout(timer);
      c.off('sent', read);
      resolve(reply);
    };
    c.on('sent', read);
    void Promise.resolve(
      f.handlers.get('agent:frame')(
        f.event(c),
        generation,
        JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }),
      ),
    ).catch(reject);
  });
}

test('P0 startup rejects an absent or malformed desktop bearer before side effects', async (t) => {
  for (const token of [
    undefined,
    null,
    '',
    'undefined',
    'short',
    'A'.repeat(64),
    'a'.repeat(63) + '\n',
  ]) {
    const f = await desktop(t, token);
    let error;
    try {
      await f.start();
    } catch (e) {
      error = e;
    }
    assert(error, 'Missing or malformed desktop token started state initialization');
    assert.match(error.message, /Desktop authorization token is required/);
    assert.deepEqual(f.effects, [], 'Rejected options must not initialize state or OS credentials');
    assert.equal(fs.existsSync(path.join(f.root, 'data')), false);
    assert.equal(f.handlers.size, 0);
  }
});

test('P0 startup serves only confined assets and reserves exact retired API routes', async (t) => {
  const f = await desktop(t),
    s = await f.start();
  for (const route of ['/api', '/api/', '/api/repositories', '/socket.io', '/socket.io/?EIO=4'])
    assert.equal(
      (await request(s.origin, f.token, route)).status,
      404,
      'Retired endpoint returned SPA content: ' + route,
    );
  assert.equal((await request(s.origin, f.token, '/socket.iota')).body, 'not a reserved endpoint');
  for (const route of ['/%00.js', '/assets/%5coutside.js'])
    assert.equal((await request(s.origin, f.token, route)).status, 403);
  assert.equal((await request(s.origin, f.token, '/%zz')).status, 400);
  assert.equal((await request(s.origin, f.token, '/assets/absent.js')).status, 404);
});

test('P0 startup confines asset symlinks to the packaged web root', async (t) => {
  const f = await desktop(t),
    s = await f.start();
  const linked = await request(s.origin, f.token, '/assets/linked.js');
  assert.equal(linked.status, 403, 'Asset symlink escaped the packaged web root');
  assert(!linked.body.includes('OUTSIDE-PRIVATE-BYTES'));
});

test('P0-BOOTSTRAP-0142 all six startup options have explicit local successors or retirement boundaries', async (t) => {
  const old = frozenBootstrap(),
    injected = { syntheticStorage: true };
  const defaults = await old.startServer();
  assert.deepEqual(plain(defaults.listenArgs), [3000, '127.0.0.1']);
  assert.deepEqual(plain(defaults.cors), [
    { origin: ['http://localhost:5173', 'http://localhost:3000'], credentials: true },
  ]);
  assert.deepEqual(plain(defaults.terminals), { enabled: false, desktop: false });
  const configured = await old.startServer({
    port: 0,
    host: 'localhost',
    webRoot: '/synthetic-web',
    token: 'synthetic-old-bearer',
    aiSecretStorage: injected,
    desktop: true,
  });
  assert.deepEqual(plain(configured.listenArgs), [0, 'localhost']);
  assert.strictEqual(configured.mod.storage, injected);
  assert.equal(configured.options.forceCloseConnections, true);
  assert.deepEqual(plain(configured.terminals), { enabled: true, desktop: true });
  assert.deepEqual(plain(configured.prefix), ['api']);
  assert.deepEqual(configured.cors, []);
  assert(configured.middleware.some((args) => args[0].static?.[0] === '/synthetic-web'));
  const f = await desktop(t),
    s = await f.start(),
    origin = new URL(s.origin);
  assert.equal(origin.hostname, '127.0.0.1');
  assert(Number(origin.port) > 0);
  for (const route of ['/', '/workspace/repo']) {
    const res = await request(s.origin, f.token, route);
    assert.equal(res.status, 200);
    assert.equal(res.body, '<html>batch07 shell</html>');
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['access-control-allow-origin'], undefined);
    assert(!res.body.includes(f.token));
  }
  const asset = await request(s.origin, f.token, '/assets/app.js');
  assert.equal(asset.body, 'window.batch07 = true;');
  assert.equal(asset.headers['content-type'], 'application/javascript');
  assert.equal((await request(s.origin, f.token, '/', { method: 'HEAD' })).body, '');
  assert.equal((await request(s.origin, f.token, '/', { method: 'POST' })).status, 405);
  assert.equal((await request(s.origin, undefined, '/')).status, 401);
  assert.equal((await request(s.origin, 'wrong', '/')).status, 401);
  assert.equal(
    (await request(s.origin, f.token, '/', { headers: { host: 'foreign.invalid' } })).status,
    401,
  );
  const generation = await f.handlers.get('agent:open')(f.event(f.workspace));
  const client = peer(f, f.workspace, generation);
  t.after(() => client.close());
  const init = await client.initialize();
  assert.equal(init.implementation.version, version);
  assert(init.capabilities.includes('terminals.create'));
  assert(!init.capabilities.includes('desktop.terminals.impact'));
  for (const name of [
    '--port',
    '--host',
    '--web-root',
    '--token',
    '--ai-secret-storage',
    '--desktop',
  ]) {
    const data = path.join(f.root, 'rejected-' + name.slice(2));
    const result = spawnSync(
      process.execPath,
      [cli, 'serve', '--data-dir', data, name, 'synthetic'],
      { encoding: 'utf8', timeout: 15000 },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Invalid state command options/);
    assert.equal(fs.existsSync(data), false);
  }
  const missingHost = path.join(f.root, 'missing-private-host');
  const refused = spawnSync(process.execPath, [cli, 'serve-ui', '--data-dir', missingHost], {
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Private host channel is required/);
  assert(!fs.existsSync(missingHost));
  record('startup-options-inventory.json', {
    frozenSha256: digest(old.source),
    fields: old.fields,
    successors: {
      port: 'Desktop static server selects ephemeral port; Agent uses inherited IPC/stdio, not HTTP listen options.',
      host: 'Desktop is fixed to IPv4 loopback; dev gateway separately enforces loopback. Arbitrary network bind option retired.',
      webRoot:
        'Desktop assets are fixed to its packaged web directory; confined static reads and SPA behavior tested. Dev Vite root is separately owned.',
      token:
        'Mandatory fresh-shape desktop bearer plus exact Host, private trusted renderer IPC; dev invitation and Origin enforced separately.',
      aiSecretStorage:
        'Arbitrary Nest storage injection retired; internal protected file/backend options and encrypted restart checked in the same run by the bound 0137 test. No RPC backend choice.',
      desktop:
        'No caller boolean grants authority; parent chooses workspace/log/native roles. Terminal capability and raw role denial tested.',
    },
    limitations:
      'Frozen entire startServer executes against allowlisted dependency doubles only. Desktop module is actual bytes with synthetic manifest/assets, migration/safeStorage/Electron doubles; actual HTTP and real supervised Agent. Not an installed Electron app or complete startServer/main pass.',
    releaseEligible: false,
  });
});

test('P0-BOOTSTRAP-0144 complete socket bearer adapter is replaced by guarded IPC and origin-bound dev sessions', async (t) => {
  const old = frozenBootstrap(),
    app = await old.startServer({ token: 'synthetic-old-bearer' });
  const marker = {},
    inherited = () => true;
  const socket = app.adapter.createIOServer(1234, {
    marker,
    allowRequest: inherited,
    transports: ['websocket'],
  });
  assert.equal(socket.port, 1234);
  assert.strictEqual(socket.options.marker, marker);
  assert.deepEqual(socket.options.transports, ['websocket']);
  assert.notStrictEqual(socket.options.allowRequest, inherited);
  for (const value of [
    undefined,
    '',
    'Bearer wrong',
    'bearer synthetic-old-bearer',
    'Bearer synthetic-old-bearer',
  ]) {
    let reply;
    socket.options.allowRequest({ headers: { authorization: value } }, (...args) => {
      assert.equal(reply, undefined);
      reply = args;
    });
    assert.deepEqual(reply, [null, value === 'Bearer synthetic-old-bearer']);
    let next = false,
      status,
      body;
    app.middleware[0][0](
      { headers: { authorization: value } },
      {
        status(v) {
          status = v;
          return this;
        },
        json(v) {
          body = plain(v);
        },
      },
      () => {
        next = true;
      },
    );
    assert.equal(next, value === 'Bearer synthetic-old-bearer');
    if (!next) {
      assert.equal(status, 401);
      assert.deepEqual(body, { message: 'Unauthorized' });
    }
  }
  const f = await desktop(t),
    s = await f.start(),
    open = f.handlers.get('agent:open');
  const foreign = new EventEmitter();
  foreign.mainFrame = { url: s.origin };
  for (const event of [
    { sender: foreign, senderFrame: foreign.mainFrame },
    { sender: f.workspace, senderFrame: { url: s.origin } },
  ])
    await assert.rejects(open(event), /Agent channel unavailable/);
  f.workspace.mainFrame.url = 'https://foreign.invalid';
  await assert.rejects(open(f.event(f.workspace)), /Agent channel unavailable/);
  f.workspace.mainFrame.url = s.origin;
  const generation = await open(f.event(f.workspace));
  await assert.rejects(open(f.event(f.workspace)), /Agent channel unavailable/);
  const before = await raw(f, f.workspace, generation, 'agent.health');
  assert.equal(before.error.data.kind, 'not-initialized');
  const initialized = await raw(f, f.workspace, generation, 'initialize', {
    protocol: PROTOCOL_VERSION,
    client: { name: 'raw-startup-peer', version: '1' },
  });
  assert(initialized.result.capabilities.includes('repositories.register'));
  for (const method of ['desktop.terminals.impact', 'network.updaterBridge', 'storage.backup']) {
    const reply = await raw(f, f.workspace, generation, method, {});
    assert.equal(reply.error.data.kind, 'unknown-method');
    assert.equal(reply.error.data.outcome, 'not-started');
  }
  assert.equal(
    await f.handlers.get('agent:frame')(f.event(f.workspace), 'forged-generation', '{}'),
    false,
  );
  f.workspace.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  assert.equal(await f.handlers.get('agent:frame')(f.event(f.workspace), generation, '{}'), false);
  const renewed = await open(f.event(f.workspace));
  assert.notEqual(renewed, generation);
  const next = peer(f, f.workspace, renewed);
  t.after(() => next.close());
  await next.initialize();
  assert.equal((await next.request('agent.health')).status, 'ok');
  const logsGeneration = await open(f.event(f.logs));
  const logsInit = await raw(f, f.logs, logsGeneration, 'initialize', {
    protocol: PROTOCOL_VERSION,
    client: { name: 'raw-logs-peer', version: '1' },
  });
  assert(logsInit.result.capabilities.includes('diagnostics.logs.snapshot'));
  assert((await raw(f, f.logs, logsGeneration, 'diagnostics.logs.snapshot', { limit: 5 })).result);
  const denied = await raw(f, f.logs, logsGeneration, 'repositories.register', { path: f.root });
  assert.equal(denied.error.data.kind, 'unknown-method');
  for (const route of ['/api', '/socket.io/?EIO=4', '/__alune_agent/workspace']) {
    const res = await request(s.origin, undefined, route);
    assert.equal(res.status, 401);
  }
  record('authentication-boundaries.json', {
    frozenSha256: digest(old.source),
    legacy:
      'Complete DesktopSocketAdapter.createIOServer executed via frozen startServer; exact bearer table, callback count, port and inherited socket options checked. Nest/IoAdapter are explicit doubles.',
    desktop:
      'Actual HTTP server and IPC handlers; real Agent process. Main-frame identity, owner contents, origin, generation, duplicate open, navigation revocation, pre-initialize, raw workspace/native and logs/workspace denials checked.',
    development:
      'Actual Vite/WebSocket gateway is executed in the companion bound integration test; no token or Origin bypass.',
    releaseEligible: false,
  });
});
