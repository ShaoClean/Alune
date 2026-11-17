// Exact legacy sources execute with explicit Nest/dependency recording ports.
// Current successors use real temporary files, SQLite and SDK stdio, never daily data.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { fileAccessKernel } = require('../dist/modules/files/access');
const { openStateKernel } = require('../dist/bootstrap/state-kernel');
const { spawnAgent } = require('@alune/agent-client/node');
const { FILE_ACCESS_MAX_BYTES, validateFileAccess } = require('@alune/protocol');
const root = path.resolve(__dirname, '../../..');
const baseline = '3c05f640fcc1a04c864e47bfc2880483ad48c984';
const plain = (v) => JSON.parse(JSON.stringify(v));
const hash = (v) => createHash('sha256').update(v).digest('hex');
function proof(name, value) {
  if (process.env.P0_FILE_MODULE_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_FILE_MODULE_PROOF_DIR, name + '.json'),
      JSON.stringify(value, null, 2) + '\n',
      { flag: 'wx' },
    );
}
function frozen() {
  const decorators = [],
    metadata = [],
    runtimeImports = [],
    imports = [],
    sources = {},
    cache = new Map();
  const ConnectionModule = class ConnectionModule {},
    RepositoryModule = class RepositoryModule {},
    ConnectionService = class ConnectionService {},
    RepositoryService = class RepositoryService {};
  const configFile = 'apps/server/tsconfig.json';
  const config = fs.readFileSync(path.join(process.env.P0_FILE_MODULE_FROZEN, configFile), 'utf8');
  assert.equal(
    config,
    execFileSync('git', ['show', baseline + ':' + configFile], { cwd: root, encoding: 'utf8' }),
  );
  assert.equal(JSON.parse(config).compilerOptions.emitDecoratorMetadata, true);
  const decorate =
    (name) =>
    (...args) =>
    (target, key, index) => {
      decorators.push({ name, args, target: target.name ?? target.constructor.name, key, index });
    };
  const nest = Object.fromEntries(
    ['Injectable', 'Module', 'Controller', 'Get', 'Post', 'Param', 'Body', 'Query'].map((n) => [
      n,
      decorate(n),
    ]),
  );
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const file = 'apps/server/src/file/' + name + '.ts';
    const source = fs.readFileSync(path.join(process.env.P0_FILE_MODULE_FROZEN, file), 'utf8');
    assert.equal(
      source,
      execFileSync('git', ['show', baseline + ':' + file], { cwd: root, encoding: 'utf8' }),
    );
    sources[file] = source;
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    imports.push(
      ...ast.statements
        .filter(ts.isImportDeclaration)
        .map((s) => ({ file, module: s.moduleSpecifier.text })),
    );
    const module = { exports: {} };
    const deps = {
      '@nestjs/common': nest,
      '../connection/connection.service': { ConnectionService },
      '../repository/repository.service': { RepositoryService },
      '../connection/connection.module': { ConnectionModule },
      '../repository/repository.module': { RepositoryModule },
      './file.service': () => load('file.service'),
      './file.controller': () => load('file.controller'),
    };
    vm.runInNewContext(
      ts.transpileModule(source, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2023,
          module: ts.ModuleKind.CommonJS,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
        },
      }).outputText,
      {
        module,
        exports: module.exports,
        String,
        Object,
        Promise,
        Function,
        Reflect: {
          metadata(type, values) {
            return (target, key) => {
              metadata.push({ type, values, target, key });
            };
          },
        },
        require(id) {
          assert(Object.hasOwn(deps, id), 'Unreviewed import: ' + id);
          runtimeImports.push({ file, module: id });
          return typeof deps[id] === 'function' ? deps[id]() : deps[id];
        },
      },
      { filename: file },
    );
    cache.set(name, module.exports);
    return module.exports;
  }
  const { FileModule } = load('file.module'),
    { FileService } = load('file.service'),
    { FileController } = load('file.controller');
  return {
    FileModule,
    FileService,
    FileController,
    ConnectionModule,
    RepositoryModule,
    ConnectionService,
    RepositoryService,
    decorators,
    metadata,
    runtimeImports,
    imports,
    sources,
  };
}
function recording(options = {}) {
  const old = frozen(),
    calls = [];
  const conn = {
    async readDir(p) {
      calls.push(['readDir', p]);
      if (options.readError) throw options.readError;
      return options.entries ?? [];
    },
    async readFile(p) {
      calls.push(['readFile', p]);
      if (options.readError) throw options.readError;
      return options.content ?? '';
    },
    async writeFile(p, v) {
      calls.push(['writeFile', p, v]);
      if (options.writeError) throw options.writeError;
      await options.wait;
    },
  };
  const connection = {
    async ensureConnected(id) {
      calls.push(['ensureConnected', id]);
      if (options.connectError) throw options.connectError;
      return conn;
    },
  };
  const repo = new Proxy(
    {},
    {
      get() {
        throw Error('Unused legacy repository dependency was accessed');
      },
    },
  );
  const service = new old.FileService(connection, repo);
  return {
    ...old,
    conn,
    connection,
    repo,
    calls,
    service,
    controller: new old.FileController(service),
  };
}
function temporary(t, prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function access(kernel = fileAccessKernel('agent-a'), sessionId = 'session-a') {
  const request = new AbortController(),
    session = new AbortController();
  const c = {
    agentId: 'agent-a',
    sessionId,
    signal: request.signal,
    sessionSignal: session.signal,
  };
  return {
    kernel,
    c,
    request,
    session,
    async call(method, p = {}, context = c) {
      const h = kernel.handlers['files.' + method];
      h.validate(p);
      return await h.run(p, context);
    },
  };
}
const ref = (g) => ({ agentId: g.agentId, id: g.id });
const denied = (run) => assert.rejects(run, (e) => e.kind === 'permission-denied');

test('P0 file module exact frozen imports constructors decorators and complete registration execute', () => {
  const f = recording();
  assert.deepEqual(
    Object.keys(f.sources).sort(),
    ['file.controller', 'file.module', 'file.service'].map(
      (n) => 'apps/server/src/file/' + n + '.ts',
    ),
  );
  assert.equal(f.imports.length, 10);
  assert.deepEqual(
    [...f.runtimeImports].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    [...f.imports].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  );
  assert.deepEqual(
    Array.from(
      f.metadata.find((m) => m.target === f.FileService && m.type === 'design:paramtypes').values,
    ),
    [f.ConnectionService, f.RepositoryService],
  );
  assert.deepEqual(
    Array.from(
      f.metadata.find((m) => m.target === f.FileController && m.type === 'design:paramtypes')
        .values,
    ),
    [f.FileService],
  );
  for (const method of ['listDirectory', 'readFile', 'writeFile']) {
    const meta = f.metadata.filter(
      (m) => m.target === f.FileController.prototype && m.key === method,
    );
    assert.equal(meta.length, 3);
    assert.equal(meta.find((m) => m.type === 'design:type').values, Function);
    assert.equal(meta.find((m) => m.type === 'design:returntype').values, Promise);
    assert.deepEqual(
      Array.from(meta.find((m) => m.type === 'design:paramtypes').values),
      method === 'writeFile' ? [Object] : [String, String],
    );
  }
  assert.equal(f.service.connectionService, f.connection);
  assert.equal(f.service.repoService, f.repo);
  assert.equal(f.controller.fileService, f.service);
  assert.deepEqual(Object.getOwnPropertyNames(f.FileService.prototype).sort(), [
    'constructor',
    'listDirectory',
    'readFile',
    'writeFile',
  ]);
  assert.deepEqual(Object.getOwnPropertyNames(f.FileController.prototype).sort(), [
    'constructor',
    'listDirectory',
    'readFile',
    'writeFile',
  ]);
  assert.deepEqual(Object.getOwnPropertyNames(f.FileModule.prototype), ['constructor']);
  assert(new f.FileModule() instanceof f.FileModule);
  const meta = f.decorators.find((d) => d.name === 'Module').args[0];
  assert.deepEqual(Array.from(meta.imports), [f.ConnectionModule, f.RepositoryModule]);
  assert.deepEqual(Array.from(meta.controllers), [f.FileController]);
  assert.deepEqual(Array.from(meta.providers), [f.FileService]);
  assert.deepEqual(
    f.decorators
      .filter((d) => ['Controller', 'Injectable'].includes(d.name))
      .map((d) => [d.name, plain(d.args), d.target]),
    [
      ['Injectable', [], 'FileService'],
      ['Controller', ['files'], 'FileController'],
    ],
  );
  for (const d of f.decorators.filter((d) => ['Get', 'Post'].includes(d.name))) {
    assert.equal(d.index.value, f.FileController.prototype[d.key]);
    assert.deepEqual(plain({ ...d.index, value: undefined }), {
      writable: true,
      enumerable: false,
      configurable: true,
    });
  }
  assert.deepEqual(
    plain(
      f.decorators
        .filter((d) => d.key)
        .map(({ name, args, key, index }) => ({
          name,
          args,
          key,
          ...(typeof index === 'number' ? { index } : {}),
        })),
    ),
    [
      { name: 'Query', args: ['path'], key: 'listDirectory', index: 1 },
      { name: 'Query', args: ['connectionId'], key: 'listDirectory', index: 0 },
      { name: 'Get', args: ['list'], key: 'listDirectory' },
      { name: 'Query', args: ['path'], key: 'readFile', index: 1 },
      { name: 'Query', args: ['connectionId'], key: 'readFile', index: 0 },
      { name: 'Get', args: ['read'], key: 'readFile' },
      { name: 'Body', args: [], key: 'writeFile', index: 0 },
      { name: 'Post', args: ['write'], key: 'writeFile' },
    ],
  );
  proof('file-module-registration', {
    imports: f.imports,
    runtimeImports: f.runtimeImports,
    metadata: f.metadata.map((m) => ({
      type: m.type,
      target: m.target.name ?? m.target.constructor.name,
      key: m.key,
      values: Array.isArray(m.values) ? m.values.map((v) => v.name) : m.values.name,
    })),
    module: {
      imports: meta.imports.map((x) => x.name),
      controllers: meta.controllers.map((x) => x.name),
      providers: meta.providers.map((x) => x.name),
    },
    decorators: f.decorators.map((d) => ({
      ...d,
      args:
        d.name === 'Module'
          ? [
              {
                imports: ['ConnectionModule', 'RepositoryModule'],
                controllers: ['FileController'],
                providers: ['FileService'],
              },
            ]
          : d.args,
    })),
    limitation:
      'Recording Nest decorators and dependency tokens; no live Nest HTTP server or implicit HTTP validation claim.',
  });
});

test('P0 file service frozen list maps every entry kind empty directories and exact connection failures', async () => {
  const entries = [
    { name: 'folder', longname: 'drwx' },
    { name: 'link', longname: 'lrwx' },
    { name: 'file', longname: '-rw-' },
    { name: 'pipe', longname: 'prw-' },
    { name: 'unknown', longname: '' },
  ];
  const f = recording({ entries });
  const result = await f.service.listDirectory('host-a', '/fixture/中文 path');
  assert.deepEqual(
    plain(result),
    entries.map((e) => ({
      ...e,
      isDirectory: e.name === 'folder',
      isFile: !['folder', 'link'].includes(e.name),
    })),
  );
  assert.deepEqual(f.calls, [
    ['ensureConnected', 'host-a'],
    ['readDir', '/fixture/中文 path'],
  ]);
  assert.deepEqual(plain(await recording().service.listDirectory('empty', '/empty')), []);
  for (const stage of ['connectError', 'readError']) {
    const error = new Error('synthetic ' + stage),
      failed = recording({ [stage]: error });
    await assert.rejects(
      () => failed.service.listDirectory('host-b', '/missing'),
      (e) => e === error,
    );
    assert.equal(failed.calls.length, stage === 'connectError' ? 1 : 2);
  }
  proof('file-service-list', {
    entries: plain(result),
    calls: f.calls,
    errors: ['connect and read errors retain identity; no transport read after failed connection'],
    differences: [
      'Legacy classifies non-directory non-link special files as isFile; current Dirent.isFile is stricter.',
      'Current granted listing uses basename longname, not SFTP permission text.',
    ],
  });
});

test('P0 file service frozen read preserves exact bytes values host path identity and error propagation', async () => {
  const cases = ['', '\uFEFF中文\r\n🦊', Buffer.from([0, 255, 1])],
    rows = [];
  for (const content of cases) {
    const f = recording({ content });
    assert.equal(await f.service.readFile('host-owned', '/fixture/note'), content);
    assert.deepEqual(f.calls, [
      ['ensureConnected', 'host-owned'],
      ['readFile', '/fixture/note'],
    ]);
    rows.push({ type: typeof content, size: content.length, calls: f.calls });
  }
  for (const stage of ['connectError', 'readError']) {
    for (const error of [new Error('fixture ' + stage), 'fixture non-Error']) {
      const f = recording({ [stage]: error });
      await assert.rejects(
        () => f.service.readFile('host-denied', '/fixture/note'),
        (e) => e === error,
      );
      assert.equal(f.calls.length, stage === 'connectError' ? 1 : 2);
    }
  }
  proof('file-service-read', {
    cases: rows,
    errorsPreserveIdentity: true,
    repositoryDependencyUnused: true,
    limitation:
      'Legacy transport return is passed through without encoding/size validation. Current granted file surface intentionally accepts bounded UTF-8 text only.',
  });
});

test('P0 file service frozen write awaits transport completion returns success and never hides failures', async () => {
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const f = recording({ wait });
  let settled = false;
  const pending = f.service.writeFile('host-w', '/fixture/target', '中文\n').then((r) => {
    settled = true;
    return r;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.deepEqual(f.calls, [
    ['ensureConnected', 'host-w'],
    ['writeFile', '/fixture/target', '中文\n'],
  ]);
  release();
  assert.deepEqual(plain(await pending), { success: true });
  assert.deepEqual(plain(await recording().service.writeFile('host-w', '/fixture/empty', '')), {
    success: true,
  });
  for (const stage of ['connectError', 'writeError']) {
    const error = new Error('synthetic ' + stage),
      failed = recording({ [stage]: error });
    await assert.rejects(
      () => failed.service.writeFile('host-w', '/fixture/target', 'x'),
      (e) => e === error,
    );
    assert.equal(failed.calls.length, stage === 'connectError' ? 1 : 2);
  }
  proof('file-service-write', {
    calls: f.calls,
    waitedForCompletion: true,
    errorsPropagate: true,
    limitation: 'Legacy success return is not a durable receipt or rollback guarantee.',
  });
});

test('P0 file controller whole frozen class delegates list read wrapper write and all errors exactly', async () => {
  const old = frozen(),
    calls = [],
    listing = Object.freeze([{ name: 'fixture' }]),
    saved = Object.freeze({ success: true });
  const port = {
    listDirectory: async (...a) => {
      calls.push(['list', ...a]);
      return listing;
    },
    readFile: async (...a) => {
      calls.push(['read', ...a]);
      return '\uFEFF中文\r\n';
    },
    writeFile: async (...a) => {
      calls.push(['write', ...a]);
      return saved;
    },
  };
  const c = new old.FileController(port);
  assert.equal(await c.listDirectory('host-a', '/list'), listing);
  assert.deepEqual(plain(await c.readFile('host-b', '/read')), { content: '\uFEFF中文\r\n' });
  assert.equal(await c.writeFile({ connectionId: 'host-c', path: '/write', content: '' }), saved);
  assert.deepEqual(calls, [
    ['list', 'host-a', '/list'],
    ['read', 'host-b', '/read'],
    ['write', 'host-c', '/write', ''],
  ]);
  for (const method of ['listDirectory', 'readFile', 'writeFile']) {
    const error = new Error('synthetic ' + method),
      failing = new old.FileController({
        [method]: async () => {
          throw error;
        },
      });
    await assert.rejects(
      () =>
        method === 'writeFile'
          ? failing[method]({ connectionId: 'h', path: '/p', content: 'x' })
          : failing[method]('h', '/p'),
      (e) => e === error,
    );
  }
  proof('file-controller-delegations', {
    calls,
    errorMethods: ['listDirectory', 'readFile', 'writeFile'],
    wrapper: { content: '\uFEFF中文\r\n' },
    limitation:
      'Exact frozen source with recording FileService; HTTP routing metadata executes, no real HTTP transport claimed.',
  });
});

test('P0 file module real successor read list write preserve text with explicit grants CAS and index isolation', async (t) => {
  const directory = temporary(t, 'alune-p0-files-real-'),
    contentRoot = path.join(directory, 'notes');
  fs.mkdirSync(contentRoot);
  fs.mkdirSync(path.join(contentRoot, 'folder'));
  fs.writeFileSync(path.join(contentRoot, 'note.txt'), '\uFEFF中文\r\n🦊');
  execFileSync('git', ['init', '-q', contentRoot]);
  execFileSync('git', ['-C', contentRoot, 'add', 'note.txt']);
  const index = fs.readFileSync(path.join(contentRoot, '.git/index'));
  const agentId = randomUUID();
  const kernel = await openStateKernel(path.join(directory, 'state'), agentId, undefined, {
    backend: 'file',
  });
  t.after(() => kernel.close());
  const f = access({ handlers: kernel.handlers }, 'owner');
  f.c.agentId = agentId;
  const grant = await f.call('grant', { path: contentRoot, access: 'read-write', confirmed: true }),
    g = ref(grant);
  assert.equal(grant.agentId, agentId);
  const read = await f.call('read', { grant: g, path: 'note.txt' });
  assert.equal(read.content, '\uFEFF中文\r\n🦊');
  assert.equal(read.version, hash(fs.readFileSync(path.join(contentRoot, 'note.txt'))));
  const listing = await f.call('list', { grant: g, path: '' });
  assert.deepEqual(
    listing.find((e) => e.name === 'folder'),
    { name: 'folder', isFile: false, isDirectory: true, longname: 'folder' },
  );
  assert.deepEqual(
    listing.find((e) => e.name === 'note.txt'),
    { name: 'note.txt', isFile: true, isDirectory: false, longname: 'note.txt' },
  );
  const saved = await f.call('write', {
    grant: g,
    path: 'note.txt',
    content: 'saved\n',
    version: read.version,
  });
  assert.deepEqual(saved, { success: true, version: hash('saved\n') });
  assert.equal(fs.readFileSync(path.join(contentRoot, 'note.txt'), 'utf8'), 'saved\n');
  assert.deepEqual(fs.readFileSync(path.join(contentRoot, '.git/index')), index);
  await assert.rejects(
    () => f.call('write', { grant: g, path: 'note.txt', content: 'stale', version: read.version }),
    (e) => e.kind === 'conflict',
  );
  const outcomes = await Promise.allSettled(
    ['first', 'second'].map((content) =>
      f.call('write', { grant: g, path: 'note.txt', content, version: saved.version }),
    ),
  );
  assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find((r) => r.status === 'rejected').reason.kind, 'conflict');
  await f.call('write', { grant: g, path: 'created.txt', content: '', version: 'missing' });
  assert.equal(fs.readFileSync(path.join(contentRoot, 'created.txt'), 'utf8'), '');
  const version = (await f.call('read', { grant: g, path: 'note.txt' })).version;
  await f.call('write', { grant: g, path: 'note.txt', content: '', version });
  assert.equal(fs.statSync(path.join(contentRoot, 'note.txt')).size, 0);
  kernel.disconnect('owner');
  await denied(() => f.call('read', { grant: g, path: 'note.txt' }));
  proof('file-successor-real-kernel', {
    read,
    saved,
    listing,
    concurrent: outcomes.map((r) =>
      r.status === 'fulfilled'
        ? { status: r.status, value: r.value }
        : { status: r.status, kind: r.reason.kind },
    ),
    indexUnchanged: true,
    disconnectRevokes: true,
    evidence:
      'Actual openStateKernel SQLite, native files and isolated Git index; no direct handler durable receipt claim.',
  });
});

test('P0 file module successor owner session revocation traversal symlink hardlink and cancellation fail closed', async (t) => {
  const directory = temporary(t, 'alune-p0-files-policy-'),
    target = path.join(directory, 'target'),
    outside = path.join(directory, 'outside');
  fs.mkdirSync(target);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(target, 'note'), 'safe');
  fs.writeFileSync(path.join(outside, 'private'), 'private fixture');
  fs.symlinkSync(outside, path.join(target, 'escape'), 'dir');
  fs.linkSync(path.join(outside, 'private'), path.join(target, 'linked'));
  const f = access();
  t.after(() => f.kernel.close());
  const ro = ref(await f.call('grant', { path: target, access: 'read', confirmed: true }));
  const rw = ref(await f.call('grant', { path: target, access: 'read-write', confirmed: true }));
  const deniedPaths = [
    '../outside/private',
    path.join(outside, 'private'),
    'escape/private',
    '.git/config',
    'x/.GIT/index',
    'C:drive',
    'x\\y',
  ];
  for (const p of deniedPaths) await denied(() => f.call('read', { grant: rw, path: p }));
  await denied(() => f.call('list', { grant: rw, path: 'escape' }));
  await denied(() => f.call('read', { grant: { ...rw, agentId: 'agent-b' }, path: 'note' }));
  const other = access(f.kernel, 'session-b');
  assert.deepEqual(await other.call('grants'), []);
  await denied(() => other.call('read', { grant: rw, path: 'note' }));
  await denied(() =>
    f.call('write', { grant: ro, path: 'note', content: 'bad', version: hash('safe') }),
  );
  await denied(() =>
    f.call('write', {
      grant: rw,
      path: 'linked',
      content: 'bad',
      version: hash('private fixture'),
    }),
  );
  assert.equal(fs.readFileSync(path.join(outside, 'private'), 'utf8'), 'private fixture');
  await f.call('revoke', { grant: rw });
  await denied(() => f.call('read', { grant: rw, path: 'note' }));
  for (const which of ['request', 'session']) {
    const cancelled = access(f.kernel);
    cancelled[which].abort(new Error('synthetic ' + which + ' cancelled'));
    for (const method of ['read', 'list', 'write'])
      await assert.rejects(
        () =>
          cancelled.call(method, {
            grant: ro,
            path: 'note',
            content: 'never',
            version: hash('safe'),
          }),
        /synthetic/,
      );
  }
  assert.equal(fs.readFileSync(path.join(target, 'note'), 'utf8'), 'safe');
  f.kernel.disconnect('session-a');
  assert.deepEqual(await f.call('grants'), []);
  await denied(() => f.call('read', { grant: ro, path: 'note' }));
  proof('file-successor-policy', {
    deniedPaths,
    wrongAgentDenied: true,
    wrongSessionDenied: true,
    readOnlyWriteDenied: true,
    symlinkTraversalDenied: true,
    hardlinkWriteDenied: true,
    revokedAndDisconnectedDenied: true,
    preCancelledRequestAndSession: ['read', 'list', 'write'],
    limitation:
      'Local filesystem boundary matrix, no arbitrary OS race-proof or remote installation claim. Readable hardlinks are permitted; writes to multiply-linked inodes are rejected.',
  });
});

test('P0 file module successor exact byte limits UTF8 binary and invalid inputs are enforced', async (t) => {
  const directory = temporary(t, 'alune-p0-files-limits-'),
    f = access();
  t.after(() => f.kernel.close());
  const grant = ref(
    await f.call('grant', { path: directory, access: 'read-write', confirmed: true }),
  );
  fs.writeFileSync(path.join(directory, 'limit'), Buffer.alloc(FILE_ACCESS_MAX_BYTES, 0x61));
  fs.writeFileSync(path.join(directory, 'over'), Buffer.alloc(FILE_ACCESS_MAX_BYTES + 1, 0x61));
  fs.writeFileSync(path.join(directory, 'binary'), Buffer.from([0x61, 0, 0x62]));
  fs.writeFileSync(path.join(directory, 'invalid'), Buffer.from([0xc3, 0x28]));
  assert.equal(
    (await f.call('read', { grant, path: 'limit' })).content.length,
    FILE_ACCESS_MAX_BYTES,
  );
  for (const p of ['over', 'binary'])
    await assert.rejects(
      () => f.call('read', { grant, path: p }),
      (e) => e.kind === 'invalid-params',
    );
  await assert.rejects(
    () => f.call('read', { grant, path: 'invalid' }),
    (e) => e.kind === 'unavailable',
  );
  await assert.rejects(
    () => f.call('read', { grant, path: 'missing' }),
    (e) => e.kind === 'not-found',
  );
  const data = '界'.repeat(Math.floor(FILE_ACCESS_MAX_BYTES / 3)) + 'a';
  assert.equal(Buffer.byteLength(data), FILE_ACCESS_MAX_BYTES);
  const saved = await f.call('write', { grant, path: 'new', content: data, version: 'missing' });
  assert.equal(saved.version, hash(data));
  assert.equal(fs.statSync(path.join(directory, 'new')).size, FILE_ACCESS_MAX_BYTES);
  await assert.rejects(
    () => f.call('write', { grant, path: 'new', content: data + 'a', version: saved.version }),
    (e) => e.kind === 'invalid-params',
  );
  assert.equal(hash(fs.readFileSync(path.join(directory, 'new'))), saved.version);
  for (const accessValue of [['read'], ['read-write'], {}, null, 1, true, 'READ', 'read ', ''])
    assert.throws(
      () => validateFileAccess('grant', { path: directory, access: accessValue, confirmed: true }),
      (e) => e.kind === 'invalid-params',
    );
  assert.throws(
    () => validateFileAccess('grant', { path: directory, access: 'read', confirmed: false }),
    (e) => e.kind === 'invalid-params',
  );
  assert.throws(
    () => validateFileAccess('write', { grant, path: 'new', content: 'x', version: 'stale' }),
    (e) => e.kind === 'invalid-params',
  );
  proof('file-successor-limits', {
    maxBytes: FILE_ACCESS_MAX_BYTES,
    exactReadAndMultibyteWritePass: true,
    oversizedReadAndWriteDenied: true,
    binaryKind: 'invalid-params',
    malformedUtf8Kind: 'unavailable',
    missingKind: 'not-found',
    invalidAccessTypesRejected: true,
  });
});

test(
  'P0 file module actual SDK stdio grants reject coerced access persist receipts and revoke across restart',
  { timeout: 60000 },
  async (t) => {
    const directory = temporary(t, 'alune-p0-files-rpc-'),
      contentRoot = path.join(directory, 'files'),
      state = path.join(directory, 'state');
    fs.mkdirSync(contentRoot);
    fs.writeFileSync(path.join(contentRoot, 'note'), 'rpc original');
    const children = [];
    t.after(async () => {
      await Promise.all(children.map((c) => c.close()));
    });
    async function start() {
      const child = spawnAgent(process.execPath, [
        path.join(__dirname, 'settings-fixture.cjs'),
        state,
      ]);
      children.push(child);
      await child.client.initialize();
      return child;
    }
    const first = await start(),
      client = first.client;
    for (const accessValue of [['read'], ['read-write'], {}, null, 'invalid'])
      await assert.rejects(
        () =>
          client.request('files.grant', {
            path: contentRoot,
            access: accessValue,
            confirmed: true,
          }),
        (e) => e.kind === 'invalid-params',
      );
    assert.deepEqual(await client.request('files.grants', {}), []);
    const grant = await client.request('files.grant', {
      path: contentRoot,
      access: 'read-write',
      confirmed: true,
    });
    const g = ref(grant);
    assert.equal(typeof grant.access, 'string');
    assert.equal(grant.lifetime, 'session');
    const read = await client.request('files.read', { grant: g, path: 'note' });
    assert.deepEqual(read, { content: 'rpc original', version: hash('rpc original') });
    assert.equal((await client.request('files.list', { grant: g, path: '' }))[0].name, 'note');
    const write = client.startRequest('files.write', {
      grant: g,
      path: 'note',
      content: 'rpc saved',
      version: read.version,
    });
    assert.deepEqual(await write.result, { success: true, version: hash('rpc saved') });
    const receipt = await client.getTask({ requestId: write.requestId });
    assert.equal(receipt.task.state, 'succeeded');
    assert.equal(receipt.task.outcome, 'completed');
    assert.doesNotMatch(JSON.stringify(receipt), /rpc saved|rpc original/);
    const agentId = grant.agentId;
    await first.close();
    const next = await start();
    assert.deepEqual(await next.client.request('files.grants', {}), []);
    await denied(() => next.client.request('files.read', { grant: g, path: 'note' }));
    assert.deepEqual(await next.client.getTask({ taskId: receipt.task.taskId }), receipt);
    const renewed = await next.client.request('files.grant', {
      path: contentRoot,
      access: 'read',
      confirmed: true,
    });
    assert.equal(renewed.agentId, agentId);
    assert.notEqual(renewed.id, grant.id);
    assert.equal(
      (await next.client.request('files.read', { grant: ref(renewed), path: 'note' })).content,
      'rpc saved',
    );
    await next.client.request('files.revoke', { grant: ref(renewed) });
    await denied(() => next.client.request('files.read', { grant: ref(renewed), path: 'note' }));
    proof('file-successor-stdio', {
      actualTransport: 'SDK child process stdio and SQLite state kernel',
      malformedAccessDeniedBeforeGrant: true,
      receipt,
      sameAgentIdentity: true,
      restartRevokedOldGrant: true,
      explicitRenewalRequired: true,
      fileAfterRestart: fs.readFileSync(path.join(contentRoot, 'note'), 'utf8'),
      limitation:
        'Normal write completed. Unknown-write crash/no-replay evidence is companion task-journal/relay, not a crash injected into this normal write.',
    });
  },
);
