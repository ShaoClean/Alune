// Actual Agent composition with disposable SQLite/file-backed credentials only.
// Frozen Nest registration executes in a restricted VM with explicit dependency doubles.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { PassThrough } = require('node:stream');
const ts = require('typescript');
const { AgentClient, StdioTransport } = require('@alune/agent-client/node');
const { CORE_CAPABILITIES, PROTOCOL_VERSION } = require('@alune/protocol');
const { loadIdentity } = require('../dist/adapters/identity');
const { AgentSession } = require('../dist/server/session');
if (process.env.P0_MODULE_SETTINGS_FILE) {
  const actual = require.resolve('../dist/bootstrap/settings-kernel');
  const m = new Module(actual, module);
  m.filename = actual;
  m.paths = Module._nodeModulePaths(path.dirname(actual));
  require.cache[actual] = m;
  m._compile(fs.readFileSync(process.env.P0_MODULE_SETTINGS_FILE, 'utf8'), actual);
}
const { openStateKernel } = require('../dist/bootstrap/state-kernel');
const audit = [];
function frozenRegistration() {
  const root = process.env.P0_MODULE_FROZEN;
  assert(root, 'Use the batch-06 replay driver');
  const metadata = new Map();
  const common = {
    Module: (value) => (cls) => {
      metadata.set(cls, value);
    },
    Global: () => () => {},
  };
  const load = (file, deps) => {
    const source = fs.readFileSync(path.join(root, 'apps/server/src', file + '.ts'), 'utf8');
    const ast = ts.createSourceFile(file + '.ts', source, ts.ScriptTarget.Latest, true);
    const exports = ast.statements.filter((s) =>
      s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword),
    );
    const cls = ast.statements.filter(ts.isClassDeclaration);
    assert.equal(cls.length, 1);
    assert.deepEqual(
      cls[0].members.map((m) => m.name.getText(ast)),
      ['register'],
    );
    audit.push({
      file: 'apps/server/src/' + file + '.ts',
      sha256: createHash('sha256').update(source).digest('hex'),
      exports: exports.map((s) => s.getText(ast)),
      statements: ast.statements.map((s) => s.getText(ast)),
      note: 'Complete registration executes with allowlisted dependency doubles; no legacy server starts.',
    });
    const code = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        experimentalDecorators: true,
      },
    }).outputText;
    const m = { exports: {} };
    vm.runInNewContext('(function(require,module,exports){' + code + '\n})', {
      process: { env: { ALUNE_DATA_DIR: '/synthetic-data' } },
    })(
      (name) => {
        assert(Object.hasOwn(deps, name), 'Unreviewed dependency: ' + name);
        return deps[name];
      },
      m,
      m.exports,
    );
    return m.exports;
  };
  const names = [
    'Database',
    'Connection',
    'Repository',
    'Git',
    'File',
    'Events',
    'Terminal',
    'Logging',
  ];
  const deps = Object.fromEntries(
    names.map((n) => [
      './' + n.toLowerCase() + '/' + n.toLowerCase() + '.module',
      { [n + 'Module']: n + 'Module' },
    ]),
  );
  const defaults = [];
  const secrets = load('secrets/secrets.module', {
    '@nestjs/common': common,
    'node:os': { homedir: () => '/synthetic-home' },
    'node:path': { join: path.join },
    './secret-storage': {
      localSecretStorage: (dir) => {
        defaults.push(dir);
        return { syntheticDefault: dir };
      },
    },
  });
  const store = class {
    constructor(file, cipher) {
      this.file = file;
      this.cipher = cipher;
    }
  };
  const ai = load('ai/ai.module', {
    '@nestjs/common': common,
    'node:os': { homedir: () => '/synthetic-home' },
    'node:path': { join: path.join },
    '../connection/connection.module': { ConnectionModule: 'ConnectionModule' },
    '../repository/repository.module': { RepositoryModule: 'RepositoryModule' },
    './ai-settings': { AiSettingsStore: store },
    './ai.service': { AiService: 'AiService' },
    './ai.controller': { AiController: 'AiController' },
    '../secrets/secrets.module': secrets,
  });
  const proxy = load('proxy/proxy.module', {
    '@nestjs/common': common,
    'node:os': { homedir: () => '/synthetic-home' },
    'node:path': { join: path.join },
    '../secrets/secrets.module': secrets,
    './proxy-settings': { ProxySettingsStore: store },
    './proxy.service': { ProxyService: 'ProxyService' },
  });
  const app = load('app.module', {
    '@nestjs/common': common,
    ...deps,
    './ai/ai.module': ai,
    './secrets/secrets.module': secrets,
    './proxy/proxy.module': proxy,
    './app.controller': { AppController: 'AppController' },
    './app.service': { AppService: 'AppService' },
    './proxy/proxy.controller': { ProxyController: 'ProxyController' },
  });
  assert.deepEqual(Object.keys(app), ['AppModule']);
  assert.deepEqual(Object.getOwnPropertyNames(app.AppModule), [
    'length',
    'name',
    'prototype',
    'register',
  ]);
  assert.deepEqual(Object.getOwnPropertyNames(app.AppModule.prototype), ['constructor']);
  const plain = (v) => JSON.parse(JSON.stringify(v));
  assert.deepEqual(plain(metadata.get(app.AppModule)), {
    imports: names.map((n) => n + 'Module'),
    controllers: ['AppController', 'ProxyController'],
    providers: ['AppService'],
  });
  for (const injected of [
    undefined,
    { syntheticInjected: true },
    { syntheticInjected: 'second' },
  ]) {
    const dynamic = app.AppModule.register(injected);
    assert.deepEqual(Object.keys(dynamic).sort(), ['imports', 'module']);
    assert.strictEqual(dynamic.module, app.AppModule);
    assert.equal(dynamic.imports.length, 3);
    assert.strictEqual(dynamic.imports[0].module, secrets.SecretsModule);
    assert.strictEqual(dynamic.imports[1].module, proxy.ProxyModule);
    assert.strictEqual(dynamic.imports[2].module, ai.AiModule);
    const registration = dynamic.imports[0];
    assert.strictEqual(registration.exports[0], secrets.SECRET_STORAGE);
    assert.strictEqual(registration.providers[0].provide, secrets.SECRET_STORAGE);
    const cipher = registration.providers[0].useFactory();
    if (injected) assert.strictEqual(cipher, injected);
    else assert.deepEqual(defaults, ['/synthetic-data']);
    for (const [index, filename] of [
      [1, 'network-proxy.json'],
      [2, 'ai-settings.json'],
    ]) {
      const provider = dynamic.imports[index].providers.find((p) => p.inject);
      assert.strictEqual(provider.inject[0], secrets.SECRET_STORAGE);
      const created = provider.useFactory(cipher);
      assert.strictEqual(created.cipher, cipher);
      assert.equal(created.file, path.join('/synthetic-data', filename));
    }
  }
  return names;
}
const owned = new WeakMap();
function resources(t) {
  if (!owned.has(t)) {
    const r = { roots: [], kernels: [], connections: [] };
    owned.set(t, r);
    t.after(async () => {
      for (const c of r.connections) await c.close();
      for (const k of r.kernels) await k.close();
      for (const root of r.roots) fs.rmSync(root, { recursive: true, force: true });
    });
  }
  return owned.get(t);
}
function directory(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-p0-modules-'));
  resources(t).roots.push(root);
  return root;
}
async function kernel(t, root = directory(t), options = { backend: 'file' }, remote) {
  const id = await loadIdentity(root);
  const k = await openStateKernel(root, id, undefined, options, remote);
  resources(t).kernels.push(k);
  return { k, id, root };
}
async function connection(t, f, minor = PROTOCOL_VERSION.minor) {
  const input = new PassThrough(),
    output = new PassThrough();
  const transport = new StdioTransport(output, input);
  const send = transport.send.bind(transport);
  // Explicit test peer negotiates an older minor over actual framed streams.
  transport.send = (message) =>
    send(
      message.method === 'initialize'
        ? {
            ...message,
            params: { ...message.params, protocol: { major: PROTOCOL_VERSION.major, minor } },
          }
        : message,
    );
  const client = new AgentClient(transport);
  const session = new AgentSession(new StdioTransport(input, output), {
    agentId: f.id,
    version: 'composition-test',
    handlers: f.k.handlers,
    taskJournal: f.k.taskJournal,
    onDispose: async () => f.k.disconnect(session.sessionId),
  });
  const c = {
    client,
    session,
    close: async () => {
      await session.close();
      client.close();
    },
  };
  resources(t).connections.push(c);
  c.init = await client.initialize();
  assert.equal(c.init.protocol.minor, minor);
  return c;
}
// Deliberately bypass the SDK's capability guard using an independent framed peer.
// This proves the Agent itself rejects unavailable methods on the wire.
async function rawPeer(t, f, minor = PROTOCOL_VERSION.minor) {
  const input = new PassThrough(),
    output = new PassThrough();
  const peer = new StdioTransport(output, input);
  const session = new AgentSession(new StdioTransport(input, output), {
    agentId: f.id,
    version: 'raw-composition-test',
    handlers: f.k.handlers,
    taskJournal: f.k.taskJournal,
    onDispose: async () => f.k.disconnect(session.sessionId),
  });
  resources(t).connections.push({
    close: async () => {
      await session.close();
      peer.close();
    },
  });
  let sequence = 0;
  const pending = new Map();
  peer.onMessage((message) => {
    const resolve = pending.get(message.id);
    if (resolve) {
      pending.delete(message.id);
      resolve(message);
    }
  });
  const request = async (method, params) => {
    const id = 'raw:' + ++sequence;
    let resolve;
    const reply = new Promise((r) => {
      resolve = r;
    });
    pending.set(id, resolve);
    await peer.send({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
    let timer;
    try {
      return await Promise.race([
        reply,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error('Missing raw Agent response')), 3000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      pending.delete(id);
    }
  };
  const init = await request('initialize', {
    protocol: { major: PROTOCOL_VERSION.major, minor },
    client: { name: 'raw-test', version: '1' },
  });
  assert.equal(init.result.agentId, f.id);
  return request;
}
function record(file, value) {
  if (process.env.P0_MODULE_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_MODULE_PROOF_DIR, file),
      JSON.stringify(value, null, 2) + '\n',
      { flag: 'wx' },
    );
}

test('P0-BOOTSTRAP-0135 full module registration maps every static and dynamic dependency to scoped Agent composition', async (t) => {
  const names = frozenRegistration();
  const f = await kernel(t),
    a = await connection(t, f);
  const caps = a.init.capabilities;
  assert.deepEqual([...caps].sort(), [...CORE_CAPABILITIES, ...Object.keys(f.k.handlers)].sort());
  assert.equal(new Set(caps).size, caps.length);
  const mapping = {
    Database: ['storage.status', 'storage.backupDatabase'],
    Connection: ['hosts.catalog', 'hosts.open'],
    Repository: ['repositories.list', 'repositories.register'],
    Git: ['repositories.read', 'repositories.write'],
    File: ['files.grant', 'files.read', 'files.write'],
    Events: ['events.subscribe', 'events.ack'],
    Terminal: ['terminals.list', 'terminals.create', 'terminals.input'],
    Logging: ['diagnostics.logs.settings', 'diagnostics.logs.snapshot'],
    Secrets: ['settings.credentials.prepare'],
    Proxy: ['settings.proxy.get', 'settings.proxy.save', 'network.testProxy'],
    Ai: ['settings.ai.get', 'settings.ai.saveProvider', 'ai.test', 'ai.generate'],
    AppController: ['agent.health'],
    AppService: ['agent.version'],
    ProxyController: ['settings.proxy.get', 'network.testProxy'],
  };
  assert.deepEqual(names, Object.keys(mapping).slice(0, 8));
  for (const [dependency, methods] of Object.entries(mapping))
    for (const method of methods) assert(caps.includes(method), dependency + ' missing ' + method);
  assert.equal((await a.client.request('agent.health')).agentId, f.id);
  assert.equal((await a.client.request('storage.status')).agentId, f.id);
  assert.deepEqual(await a.client.request('repositories.list'), []);
  assert.deepEqual(await a.client.request('hosts.catalog'), { local: [], hosts: [] });
  assert.deepEqual(await a.client.request('files.grants', {}), []);
  assert.deepEqual(await a.client.request('terminals.list', {}), []);
  assert.equal((await a.client.request('diagnostics.logs.settings')).settings.level, 'INFO');
  assert.equal((await a.client.getProxySettings()).enabled, false);
  assert.equal((await a.client.getAiSettings()).secretStorage.available, false);
  await a.client.subscribe(['repositories.changed']);
  const events = [];
  a.client.onEvent((event) => events.push(event));
  const repo = path.join(f.root, 'repo');
  fs.mkdirSync(repo);
  execFileSync('git', ['init', '-q', repo]);
  fs.writeFileSync(path.join(repo, 'untracked.txt'), 'composition fixture\n');
  const registered = await a.client.registerRepository(repo);
  assert.equal(registered.resource.agentId, f.id);
  const grant = await a.client.request('files.grant', {
    path: repo,
    access: 'read',
    confirmed: true,
  });
  const file = await a.client.request('files.read', {
    grant: { agentId: grant.agentId, id: grant.id },
    path: 'untracked.txt',
  });
  assert.equal(file.content, 'composition fixture\n');
  const status = await a.client.request('repositories.read', {
    resource: registered.resource,
    kind: 'status',
    params: {},
  });
  assert.equal(status.resource.agentId, f.id);
  assert(status.value, 'real Git read must return an inline result');
  for (let n = 0; !events.length && n < 100; n++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(events[0].type, 'repositories.changed');
  assert.equal(events[0].agentId, f.id);
  assert.equal(fs.existsSync(path.join(f.root, 'keys')), false);
  record('module-inventory.json', {
    mapping,
    frozen: audit,
    capabilities: caps,
    boundary:
      'Module composition only: live smoke plus named dependency presence; individual domain behavior and HTTP/Nest/socket compatibility remain outside this receipt.',
  });
});

test('P0-BOOTSTRAP-0136 module instances isolate Agent authority and negotiate their actual handler sets', async (t) => {
  const f = await kernel(t),
    g = await kernel(t),
    remote = await kernel(t, undefined, undefined, { gitProxyPort: 'blocked' });
  const a = await connection(t, f),
    b = await connection(t, g),
    leaf = await connection(t, remote),
    old = await connection(t, f, 0);
  assert.notEqual(f.id, g.id);
  for (const name of ['hosts.open', 'hosts.catalog', 'workspace.remove', 'network.testProxy']) {
    assert(a.init.capabilities.includes(name));
    assert(!leaf.init.capabilities.includes(name));
    await assert.rejects(leaf.client.request(name), {
      kind: 'unknown-method',
      outcome: 'not-started',
    });
  }
  assert(leaf.init.capabilities.includes('repositories.hostRead'));
  assert(!a.init.capabilities.includes('repositories.hostRead'));
  const expected = [
    ...CORE_CAPABILITIES,
    ...Object.entries(f.k.handlers)
      .filter(([, h]) => (h.minimumProtocolMinor ?? 0) <= 0)
      .map(([name]) => name),
  ];
  assert.deepEqual([...old.init.capabilities].sort(), expected.sort());
  await assert.rejects(old.client.request('settings.ai.get'), {
    kind: 'unknown-method',
    outcome: 'not-started',
  });
  for (const method of [
    'desktop.log',
    'desktop.tasks.impact',
    'settings.ai.key',
    'settings.proxy.snapshot',
  ]) {
    assert(!a.init.capabilities.includes(method));
    await assert.rejects(a.client.request(method), {
      kind: 'unknown-method',
      outcome: 'not-started',
    });
  }
  const repo = path.join(f.root, 'repo');
  fs.mkdirSync(repo);
  execFileSync('git', ['init', '-q', repo]);
  const registered = await a.client.registerRepository(repo);
  await assert.rejects(b.client.request('repositories.get', { resource: registered.resource }), {
    kind: 'not-found',
    outcome: 'not-started',
  });
  assert.deepEqual(await b.client.request('repositories.list'), []);
  const rawLocal = await rawPeer(t, f),
    rawLeaf = await rawPeer(t, remote),
    rawOld = await rawPeer(t, f, 0);
  for (const method of [
    'desktop.log',
    'desktop.tasks.impact',
    'settings.ai.key',
    'settings.proxy.snapshot',
    'repositories.hostRead',
  ]) {
    const reply = await rawLocal(method);
    assert.equal(reply.error.data.kind, 'unknown-method');
    assert.equal(reply.error.data.outcome, 'not-started');
  }
  for (const method of ['hosts.open', 'hosts.catalog', 'workspace.remove', 'network.testProxy']) {
    const reply = await rawLeaf(method);
    assert.equal(reply.error.data.kind, 'unknown-method');
    assert.equal(reply.error.data.outcome, 'not-started');
  }
  assert.equal((await rawOld('settings.ai.get')).error.data.kind, 'unknown-method');
  record('capability-matrix.json', {
    local: a.init.capabilities,
    remote: leaf.init.capabilities,
    protocolMinorZero: old.init.capabilities,
    note: 'Real local kernel in remote mode; no physical SSH connection or remote network request.',
  });
});

test('P0-BOOTSTRAP-0137 registration shares one protected cipher for AI and proxy and retains it across restart', async (t) => {
  const f = await kernel(t),
    a = await connection(t, f);
  const responses = [],
    events = [];
  a.client.onEvent((e) => events.push(e));
  await a.client.subscribe(['settings.changed']);
  const first = await a.client.getAiSettings(),
    p = first.providers[0];
  assert.equal(f.k.state.document('credential-key').read(), undefined);
  await assert.rejects(
    a.client.request('settings.credentials.prepare', { backend: 'file', keychain: '/synthetic' }),
    { kind: 'invalid-params', outcome: 'not-started' },
  );
  assert.equal(f.k.state.document('credential-key').read(), undefined);
  const aiSecret = 'synthetic-batch06-ai-secret',
    proxySecret = 'synthetic-batch06-proxy-secret';
  const saved = await a.client.saveAiProvider(p.id, { ...p, apiKey: aiSecret }, first.revision);
  const descriptor = f.k.state.document('credential-key').read();
  assert.equal(descriptor.backend, 'file');
  assert.equal(descriptor.status, 'ready');
  const proxy = await a.client.getProxySettings();
  responses.push(
    saved,
    await a.client.saveProxySettings({
      ...proxy,
      enabled: true,
      host: '127.0.0.1',
      authEnabled: true,
      credentials: { action: 'replace', username: 'synthetic-user', password: proxySecret },
    }),
  );
  assert.deepEqual(f.k.state.document('credential-key').read(), descriptor);
  const aiStored = f.k.state.document('ai-settings').read(),
    proxyStored = f.k.state.document('network-proxy').read();
  assert.match(aiStored.providers[0].encryptedKey, /^aes-gcm:v1:/);
  assert.match(proxyStored.encryptedCredentials, /^aes-gcm:v1:/);
  assert.doesNotMatch(
    JSON.stringify([aiStored, proxyStored]),
    /synthetic-batch06-(ai|proxy)-secret/,
  );
  assert.equal(fs.readdirSync(path.join(f.root, 'keys')).length, 1);
  await a.close();
  await f.k.close();
  const next = await kernel(t, f.root),
    again = await connection(t, next);
  responses.push(await again.client.getAiSettings(), await again.client.getProxySettings());
  assert.equal(responses[2].providers[0].hasApiKey, true);
  assert.equal(responses[2].secretStorage.available, true);
  assert.equal(responses[3].hasCredentials, true);
  assert.equal(responses[3].secretStorageAvailable, true);
  // Internal consumer factories use the exact live settingsKernel and protected file key.
  const { settingsKernel } = require('../dist/bootstrap/settings-kernel');
  const internal = settingsKernel(next.k.state, f.root, f.id, { backend: 'file' });
  try {
    await internal.readyCredentials(new AbortController().signal);
    assert.strictEqual(internal.ai.secrets, internal.proxy.secrets);
    assert.equal(internal.ai.key(p.id), aiSecret);
    assert.equal(internal.proxy.snapshot().credentials.password, proxySecret);
  } finally {
    await internal.close();
  }
  for (let n = 0; events.length < 2 && n < 100; n++) await new Promise((r) => setTimeout(r, 5));
  assert(events.length >= 2, 'AI and proxy writes must emit subscribed settings events');
  assert(events.every((e) => e.type === 'settings.changed' && e.agentId === f.id));
  assert.doesNotMatch(
    JSON.stringify([responses, events]),
    /synthetic-batch06-(ai|proxy)-secret|aes-gcm:|encryptedKey|encryptedCredentials/,
  );
});

test('P0 module secret registration captures backend options before lazy initialization', async (t) => {
  const injected = { backend: 'file', keychain: '/synthetic-never-used' };
  const f = await kernel(t, undefined, injected),
    a = await connection(t, f);
  injected.backend = 'dpapi';
  injected.keychain = '/synthetic-mutated';
  // darwin must reject DPAPI before any OS credential API; old code borrows this mutable object.
  let result;
  try {
    result = await a.client.prepareCredentials();
  } catch (error) {
    assert.fail('Late option mutation changed registered credential backend: ' + error.kind);
  }
  assert.equal(result.available, true);
  assert.equal(f.k.state.document('credential-key').read().backend, 'file');
  assert.equal(fs.readdirSync(path.join(f.root, 'keys')).length, 1);
});

test('P0 module unavailable registered backend refuses fallback without replacing existing credentials', async (t) => {
  const f = await kernel(t),
    a = await connection(t, f);
  const first = await a.client.getAiSettings(),
    provider = first.providers[0];
  const saved = await a.client.saveAiProvider(
    provider.id,
    { ...provider, apiKey: 'synthetic-retained-secret' },
    first.revision,
  );
  const descriptor = f.k.state.document('credential-key').read();
  const keyFile = path.join(f.root, 'keys', fs.readdirSync(path.join(f.root, 'keys'))[0]);
  const keyHash = createHash('sha256').update(fs.readFileSync(keyFile)).digest('hex');
  await a.close();
  await f.k.close();
  const wrong = await kernel(t, f.root, { backend: 'dpapi' }),
    c = await connection(t, wrong);
  assert.equal((await c.client.getAiSettings()).secretStorage.available, false);
  await assert.rejects(c.client.prepareCredentials(), { kind: 'conflict', outcome: 'not-started' });
  await assert.rejects(
    c.client.saveAiProvider(
      provider.id,
      { ...provider, apiKey: 'synthetic-must-not-save' },
      saved.revision,
    ),
    { kind: 'conflict', outcome: 'not-started' },
  );
  assert.equal((await c.client.getAiSettings()).revision, saved.revision);
  assert.deepEqual(wrong.k.state.document('credential-key').read(), descriptor);
  assert.equal(createHash('sha256').update(fs.readFileSync(keyFile)).digest('hex'), keyHash);
  assert.deepEqual(await c.client.request('repositories.list'), []);
  await c.close();
  await wrong.k.close();
  const restored = await kernel(t, f.root),
    r = await connection(t, restored);
  assert.equal((await r.client.getAiSettings()).secretStorage.available, true);
  assert.equal((await r.client.getAiSettings()).revision, saved.revision);
});
