const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { ProxySettingsStore } = require('../dist/modules/settings/proxy');
const { StateFault } = require('../dist/ports/state');
const { openStateKernel } = require('../dist/bootstrap/state-kernel');
const baseline = '3c05f640fcc1a04c864e47bfc2880483ad48c984';
const file = 'apps/server/src/proxy/proxy-settings.ts';
const root = path.resolve(__dirname, '../../..');
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
function proof(name, value) {
  if (process.env.P0_PROXY_SETTINGS_SOURCE_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_PROXY_SETTINGS_SOURCE_PROOF_DIR, name + '.json'),
      JSON.stringify(value, null, 2) + '\n',
      { flag: 'wx' },
    );
}
function source() {
  const text = fs.readFileSync(
    path.join(process.env.P0_PROXY_SETTINGS_SOURCE_FROZEN, file),
    'utf8',
  );
  assert.equal(
    text,
    execFileSync('git', ['show', baseline + ':' + file], { cwd: root, encoding: 'utf8' }),
  );
  return text;
}
const base = () => ({
  revision: 'synthetic-revision',
  enabled: false,
  protocol: 'http',
  host: '',
  port: 8080,
  authEnabled: false,
});
function harness(kind, saved, options = {}) {
  const state = {
    stored: clone(saved),
    calls: [],
    fault: undefined,
    encrypted: undefined,
    available: true,
    decryptValue: undefined,
  };
  const secrets = {
    get available() {
      return state.available;
    },
    description: 'explicit synthetic cipher port, not cryptography evidence',
    encrypt(value) {
      state.calls.push('encrypt');
      if (state.fault === 'encrypt') throw Error('synthetic encrypt fault');
      state.encrypted = JSON.parse(value);
      return 'synthetic-cipher:' + Buffer.from(value).toString('base64');
    },
    decrypt(value) {
      state.calls.push('decrypt');
      if (state.fault === 'decrypt') throw Error('synthetic decrypt fault');
      if (state.decryptValue !== undefined) return state.decryptValue;
      assert.equal(typeof value, 'string');
      assert(value.startsWith('synthetic-cipher:'));
      return Buffer.from(value.slice('synthetic-cipher:'.length), 'base64').toString();
    },
  };
  let Store = ProxySettingsStore;
  if (kind === 'frozen') {
    const module = { exports: {} };
    class BadRequestException extends Error {
      kind = 'invalid-input';
    }
    class ConflictException extends Error {
      kind = 'conflict';
    }
    class ServiceUnavailableException extends Error {
      kind = 'unavailable';
    }
    const dependencies = {
      '@nestjs/common': { BadRequestException, ConflictException, ServiceUnavailableException },
      'node:crypto': { randomUUID },
      'node:net': { isIP: require('node:net').isIP },
      'node:path': { dirname: path.dirname },
      'node:fs': {
        readFileSync(name, encoding) {
          assert.equal(name, '/synthetic/network-proxy.json');
          assert.equal(encoding, 'utf8');
          if (options.readError)
            throw Object.assign(Error('synthetic read'), { code: options.readError });
          if (saved === undefined) throw Object.assign(Error('absent'), { code: 'ENOENT' });
          return options.raw ?? JSON.stringify(state.stored);
        },
        mkdirSync(name, opts) {
          assert.equal(name, '/synthetic');
          assert.deepEqual(clone(opts), { recursive: true, mode: 0o700 });
          state.calls.push('mkdir');
          if (state.fault === 'mkdir') throw Error('synthetic mkdir fault');
        },
        writeFileSync(name, bytes, opts) {
          assert.match(name, /^\/synthetic\/network-proxy\.json\.[a-f0-9-]+\.tmp$/);
          assert.deepEqual(clone(opts), { flag: 'wx', mode: 0o600, flush: true });
          state.calls.push('write');
          if (state.fault === 'write') throw Error('synthetic write fault');
          state.temporary = { name, value: JSON.parse(bytes) };
        },
        renameSync(from, to) {
          assert.equal(from, state.temporary.name);
          assert.equal(to, '/synthetic/network-proxy.json');
          state.calls.push('rename');
          if (state.fault === 'rename') throw Error('synthetic rename fault');
          state.stored = clone(state.temporary.value);
        },
        rmSync(name, opts) {
          assert.match(name, /^\/synthetic\/network-proxy\.json\.[a-f0-9-]+\.tmp$/);
          assert.deepEqual(clone(opts), { force: true });
          state.calls.push('cleanup');
          delete state.temporary;
        },
      },
    };
    vm.runInNewContext(
      ts.transpileModule(source(), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText,
      {
        module,
        exports: module.exports,
        Buffer,
        require(id) {
          assert(Object.hasOwn(dependencies, id), id);
          return dependencies[id];
        },
      },
      { filename: file },
    );
    Store = module.exports.ProxySettingsStore;
  }
  const document = {
    read() {
      if (options.readError)
        throw Object.assign(Error('synthetic read'), { code: options.readError });
      return options.raw ? JSON.parse(options.raw) : clone(state.stored);
    },
    write(value) {
      state.calls.push('document.write');
      if (state.fault === 'conflict') throw new StateFault('conflict', 'synthetic conflict');
      if (state.fault === 'write') throw Error('synthetic write fault');
      state.stored = clone(value);
      if (state.fault === 'after-write') throw Error('synthetic indeterminate result');
    },
  };
  const reopen = () =>
    kind === 'frozen'
      ? new Store('/synthetic/network-proxy.json', secrets)
      : new Store(document, secrets);
  return { state, secrets, store: reopen(), reopen };
}
const input = (store, changes = {}) => ({
  ...store.read(),
  credentials: { action: 'keep' },
  ...changes,
});
function rejectedWithoutWrite(h, value, kind = 'invalid-input') {
  const before = clone(h.state.stored),
    revision = h.store.read().revision;
  h.state.calls.length = 0;
  assert.throws(
    () => h.store.save(value),
    (e) => e.kind === kind,
  );
  assert.deepEqual(h.state.stored, before);
  assert.equal(h.store.read().revision, revision);
  assert(
    !h.state.calls.some((v) =>
      ['mkdir', 'write', 'rename', 'cleanup', 'document.write'].includes(v),
    ),
  );
}

test('P0 complete proxy settings source inventory defaults and damaged configuration fail closed in frozen and successor', () => {
  const ast = ts.createSourceFile(file, source(), ts.ScriptTarget.Latest, true);
  const imports = ast.statements.filter(ts.isImportDeclaration).map((n) => n.moduleSpecifier.text);
  assert.deepEqual(imports, [
    '@nestjs/common',
    'node:crypto',
    'node:fs',
    'node:path',
    'node:net',
    '@alune/shared',
    '@alune/ssh-client',
    '../secrets/secret-storage',
  ]);
  const declarations = ast.statements.filter((n) => !ts.isImportDeclaration(n));
  assert.deepEqual(
    declarations.map((n) => ts.SyntaxKind[n.kind]),
    ['TypeAliasDeclaration', 'FirstStatement', 'FunctionDeclaration', 'ClassDeclaration'],
  );
  const cls = declarations.at(-1);
  assert.equal(cls.name.text, 'ProxySettingsStore');
  assert.deepEqual(
    cls.members.map((m) => m.name?.getText(ast) ?? 'constructor'),
    ['data', 'loadError', 'constructor', 'read', 'assertRevision', 'snapshot', 'save'],
  );
  const damaged = [
    null,
    {},
    { ...base(), enabled: 1 },
    { ...base(), authEnabled: 1 },
    { ...base(), protocol: 'ftp' },
    { ...base(), host: 1 },
    { ...base(), host: 'x'.repeat(254) },
    { ...base(), port: 0 },
    { ...base(), port: 65536 },
    { ...base(), port: 1.1 },
    { ...base(), port: '80' },
    { ...base(), enabled: true },
    { ...base(), host: 'http://bad' },
    { ...base(), revision: '' },
    { ...base(), revision: 1 },
    { ...base(), encryptedCredentials: {} },
  ];
  for (const kind of ['frozen', 'successor']) {
    const missing = harness(kind);
    const first = clone(missing.store.read());
    assert.match(first.revision, /^[a-f0-9-]{36}$/);
    assert.deepEqual(
      { ...first, revision: 'synthetic-revision' },
      { ...base(), hasCredentials: false, secretStorageAvailable: true },
    );
    assert.equal(missing.state.stored, undefined);
    assert.deepEqual(missing.state.calls, []);
    for (const saved of damaged) {
      const h = harness(kind, saved);
      for (const run of [
        () => h.store.read(),
        () => h.store.snapshot(),
        () => h.store.assertRevision('any'),
        () => h.store.save({ revision: 'any' }),
      ])
        assert.throws(run, (e) => e.kind === 'unavailable' && e.message.includes('不会回退直连'));
      assert.deepEqual(h.state.stored, saved);
      assert.deepEqual(h.state.calls, []);
    }
    for (const options of [{ readError: 'EACCES' }, { raw: '{broken JSON' }]) {
      const h = harness(kind, base(), options);
      assert.throws(
        () => h.store.read(),
        (e) => e.kind === 'unavailable',
      );
      assert.deepEqual(h.state.calls, []);
    }
    const absentByError = harness(kind, base(), { readError: 'ENOENT' });
    assert.equal(absentByError.store.read().enabled, false);
  }
  proof('proxy-settings-source-inventory', {
    imports,
    declarations: declarations.map((n) => ({ kind: ts.SyntaxKind[n.kind], name: n.name?.text })),
    classMembers: cls.members.map((m) => m.name?.getText(ast) ?? 'constructor'),
    damagedFixturesPerImplementation: damaged.length + 2,
    fullSourceExecuted: true,
    boundary:
      'Legacy fs, Nest exceptions and cipher ports are explicit recording doubles; successor class is production dist. No real legacy home or JSON files.',
  });
});

test('P0 complete proxy settings source validates every input family and credential action without mutation on rejection', () => {
  const rows = [];
  for (const kind of ['frozen', 'successor']) {
    const h = harness(kind, base());
    rejectedWithoutWrite(h, undefined, 'conflict');
    rejectedWithoutWrite(h, input(h.store, { revision: 'stale' }), 'conflict');
    const badConfig = [
      { enabled: 1 },
      { authEnabled: 1 },
      { protocol: 'ftp' },
      { host: 1 },
      { host: 'x'.repeat(254) },
      { host: '', enabled: true },
      { host: 'a/path' },
      { host: '-bad' },
      { host: 'bad-' },
      { port: 0 },
      { port: 65536 },
      { port: 1.1 },
      { port: '80' },
    ];
    for (const changes of badConfig) rejectedWithoutWrite(h, input(h.store, changes));
    const badCredentials = [
      undefined,
      { action: 'unknown' },
      { action: 'replace', username: '', password: 'p' },
      { action: 'replace', username: 'a:b', password: 'p' },
      { action: 'replace', username: 1, password: 'p' },
      { action: 'replace', username: 'u', password: '' },
      { action: 'replace', username: 'u', password: 1 },
      ...['u'.repeat(256), '界'.repeat(86), 'u\n', 'u\x7f'].flatMap((v) => [
        { action: 'replace', username: v, password: 'p' },
        { action: 'replace', username: 'u', password: v },
      ]),
    ];
    for (const credentials of badCredentials)
      rejectedWithoutWrite(h, input(h.store, { credentials }));
    rejectedWithoutWrite(
      h,
      input(h.store, { authEnabled: true, credentials: { action: 'clear' } }),
    );
    const auth = { action: 'replace', username: 'synthetic-user', password: 'synthetic-private' };
    h.state.available = false;
    rejectedWithoutWrite(h, input(h.store, { credentials: auth }), 'unavailable');
    h.state.available = true;
    h.state.fault = 'encrypt';
    rejectedWithoutWrite(h, input(h.store, { credentials: auth }), 'unavailable');
    h.state.fault = undefined;
    for (const [protocol, host, port] of [
      ['http', ' 127.0.0.1 ', 1],
      ['https', '::1', 65535],
      ['socks5', 'proxy.example', 8080],
    ]) {
      const oldRevision = h.store.read().revision;
      const saved = h.store.save(
        input(h.store, {
          protocol,
          host,
          port,
          enabled: true,
          authEnabled: true,
          credentials: auth,
        }),
      );
      assert.equal(saved.host, host.trim());
      assert.notEqual(saved.revision, oldRevision);
      assert.equal(saved.hasCredentials, true);
      assert.deepEqual(h.state.encrypted, {
        username: auth.username,
        password: auth.password,
        host: host.trim(),
        port,
        protocol,
      });
      assert.doesNotMatch(
        JSON.stringify(saved),
        /synthetic-user|synthetic-private|encryptedCredentials|synthetic-cipher/,
      );
      assert.equal(h.reopen().read().revision, saved.revision);
      const kept = h.store.save(input(h.store));
      assert.equal(kept.hasCredentials, true);
      for (const changes of [
        { host: 'other.example' },
        { port: port === 1 ? 2 : 1 },
        { protocol: protocol === 'http' ? 'https' : 'http' },
      ])
        rejectedWithoutWrite(h, input(h.store, changes));
      const clear = h.store.save(
        input(h.store, { authEnabled: false, credentials: { action: 'clear' } }),
      );
      assert.equal(clear.hasCredentials, false);
      assert.equal(h.store.snapshot().credentials, undefined);
      assert.equal(Object.hasOwn(h.state.stored, 'encryptedCredentials'), false);
    }
    const boundary = { action: 'replace', username: '界'.repeat(85), password: 'p'.repeat(255) };
    assert.equal(h.store.save(input(h.store, { credentials: boundary })).hasCredentials, true);
    rows.push({
      kind,
      invalidConfig: badConfig.length,
      invalidCredentials: badCredentials.length,
      validEndpointFamilies: 3,
      byteBoundary: 255,
      exactPublicShape: true,
    });
  }
  proof('proxy-settings-source-inputs', {
    rows,
    persistenceBoundary:
      'Recorded legacy atomic fs contract versus document port; actual SQLite and cipher evidence is supplied by same-run companions.',
  });
});

test('P0 complete proxy settings source snapshots bind credentials and contain all malformed decrypted payloads', () => {
  const rows = [];
  for (const kind of ['frozen', 'successor']) {
    const h = harness(kind, base());
    h.store.save(
      input(h.store, {
        enabled: true,
        host: 'proxy.example',
        authEnabled: true,
        credentials: {
          action: 'replace',
          username: 'synthetic-user',
          password: 'synthetic-private',
        },
      }),
    );
    const good = clone(h.store.snapshot());
    assert.deepEqual(good.credentials, {
      username: 'synthetic-user',
      password: 'synthetic-private',
    });
    assert.deepEqual(Object.keys(good).sort(), [
      'credentials',
      'enabled',
      'host',
      'port',
      'protocol',
      'revision',
    ]);
    const payload = h.state.encrypted;
    const malformed = [
      '{bad JSON',
      'null',
      ...[
        { ...payload, username: '' },
        { ...payload, password: '' },
        { ...payload, host: 'other.example' },
        { ...payload, port: 3128 },
        { ...payload, protocol: 'https' },
      ].map(JSON.stringify),
    ];
    for (const [index, text] of malformed.entries()) {
      h.state.decryptValue = text;
      assert.throws(
        () => h.store.snapshot(),
        (e) => e.kind === 'unavailable' && e.message.includes('不会回退直连'),
      );
      // Legacy and successor keep check binding only; snapshot separately checks
      // the credential contents before any network consumer may use them.
      if (index === 2 || index === 3) {
        assert.equal(h.store.save(input(h.store)).hasCredentials, true);
        assert.throws(
          () => h.store.snapshot(),
          (e) => e.kind === 'unavailable',
        );
      } else rejectedWithoutWrite(h, input(h.store));
    }
    h.state.decryptValue = undefined;
    h.state.fault = 'decrypt';
    assert.throws(
      () => h.store.snapshot(),
      (e) => e.kind === 'unavailable',
    );
    rejectedWithoutWrite(h, input(h.store));
    h.store.save(input(h.store, { enabled: false }));
    h.state.calls.length = 0;
    assert.equal(h.store.snapshot().credentials, undefined);
    assert.deepEqual(h.state.calls, []);
    h.store.save(input(h.store, { enabled: true, authEnabled: false }));
    h.state.calls.length = 0;
    assert.equal(h.store.snapshot().credentials, undefined);
    assert.deepEqual(h.state.calls, []);
    rows.push({
      kind,
      malformedPayloads: malformed.length,
      decryptFailureContained: true,
      keepChecksEndpointBindingOnly: true,
      snapshotStillRejectsEmptyCredentialsAfterKeep: true,
      disabledAndNoAuthSkipDecrypt: true,
    });
  }
  proof('proxy-settings-source-snapshots', {
    rows,
    note: 'Snapshots are internal only. Same-run SDK rejects settings.proxy.snapshot as unknown method; unavailable snapshots do not imply direct networking permission.',
  });
});

test('P0 complete proxy settings source records atomic cleanup document CAS and ambiguous write outcomes', () => {
  const frozenRows = [];
  for (const fault of ['mkdir', 'write', 'rename']) {
    const h = harness('frozen', base());
    h.state.fault = fault;
    assert.throws(
      () => h.store.save(input(h.store, { host: 'next.example' })),
      (e) => e.kind === 'unavailable',
    );
    assert.deepEqual(h.state.stored, base());
    assert.equal(h.store.read().revision, base().revision);
    assert.equal(h.state.temporary, undefined);
    assert.equal(h.state.calls.at(-1), 'cleanup');
    assert.deepEqual(
      h.state.calls,
      ['mkdir', 'write', 'rename']
        .slice(0, ['mkdir', 'write', 'rename'].indexOf(fault) + 1)
        .concat('cleanup'),
    );
    frozenRows.push({ fault, originalRetained: true, temporaryCleaned: true });
  }
  const success = harness('frozen', base());
  success.store.save(input(success.store, { host: 'next.example' }));
  assert.deepEqual(success.state.calls, ['mkdir', 'write', 'rename', 'cleanup']);
  assert.equal(success.state.temporary, undefined);
  const currentRows = [];
  for (const fault of ['write', 'after-write']) {
    const h = harness('successor', base());
    h.state.fault = fault;
    assert.throws(
      () => h.store.save(input(h.store, { host: 'next.example' })),
      (e) => e.kind === 'unavailable' && e.outcome === 'unknown',
    );
    assert.equal(h.store.read().host, '');
    assert.equal(h.reopen().read().host, fault === 'write' ? '' : 'next.example');
    currentRows.push({
      fault,
      outcome: 'unknown',
      storedChanged: fault === 'after-write',
      reconciliationRequired: true,
    });
  }
  const conflict = harness('successor', base());
  conflict.state.stored = { ...base(), revision: 'peer-revision', host: 'peer.example' };
  conflict.state.fault = 'conflict';
  assert.throws(
    () => conflict.store.save(input(conflict.store, { host: 'stale.example' })),
    (e) => e.kind === 'conflict',
  );
  assert.equal(conflict.store.read().revision, 'peer-revision');
  assert.equal(conflict.store.read().host, 'peer.example');
  const damaged = harness('successor', base());
  damaged.state.stored = null;
  damaged.state.fault = 'conflict';
  assert.throws(
    () => damaged.store.save(input(damaged.store)),
    (e) => e.kind === 'conflict',
  );
  assert.throws(
    () => damaged.store.read(),
    (e) => e.kind === 'unavailable',
  );
  assert.equal(damaged.state.stored, null);
  proof('proxy-settings-source-persistence', {
    frozenRows,
    currentRows,
    CASRefreshesPeer: true,
    CASReloadDamageFailsClosed: true,
    migrationDifference:
      'Legacy successful rename precedes in-memory commit; successor opaque document failure is unknown, including persisted-then-thrown. No automatic replay or rollback claimed; separate durable journal companion covers process crash receipts.',
  });
});

test('P0 complete proxy settings successor real owners isolate cancellation CAS encryption and restart', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-batch27-'));
  const kernels = [],
    ids = [randomUUID(), randomUUID()];
  t.after(async () => {
    for (const k of kernels) await k.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const open = async (name, id) => {
    const k = await openStateKernel(path.join(directory, name), id, undefined, { backend: 'file' });
    kernels.push(k);
    return k;
  };
  const a = await open('a', ids[0]),
    b = await open('b', ids[1]),
    events = [];
  const caller =
    (k, id) =>
    async (method, params, signal = new AbortController().signal) => {
      const handler = k.handlers[method];
      handler.validate(params);
      return handler.run(params, {
        signal,
        sessionSignal: signal,
        agentId: id,
        sessionId: randomUUID(),
        taskId: randomUUID(),
        events: {
          notifyState(...args) {
            events.push({ id, args });
          },
        },
      });
    };
  const callA = caller(a, ids[0]),
    callB = caller(b, ids[1]);
  const first = await callA('settings.proxy.get'),
    peer = await callB('settings.proxy.get');
  const save = {
    config: {
      ...first,
      enabled: true,
      host: '127.0.0.1',
      authEnabled: true,
      credentials: { action: 'replace', username: 'synthetic-user', password: 'synthetic-private' },
    },
  };
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    callA('settings.proxy.save', save, abort.signal),
    (e) => e.name === 'AbortError',
  );
  assert.equal(events.length, 0);
  assert.equal(fs.existsSync(path.join(directory, 'a/keys')), false);
  const outcomes = await Promise.allSettled([
    callA('settings.proxy.save', save),
    callA('settings.proxy.save', save),
  ]);
  assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    outcomes.filter((r) => r.status === 'rejected' && r.reason.kind === 'conflict').length,
    1,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].id, ids[0]);
  assert.equal(events[0].args[0], 'settings.changed');
  const saved = outcomes.find((r) => r.status === 'fulfilled').value;
  assert.equal(saved.hasCredentials, true);
  assert.notEqual(saved.revision, first.revision);
  assert.equal((await callB('settings.proxy.get')).revision, peer.revision);
  assert.equal(fs.existsSync(path.join(directory, 'b/keys')), false);
  const stored = a.state.document('network-proxy').read();
  assert.match(stored.encryptedCredentials, /^aes-gcm:/);
  assert.doesNotMatch(JSON.stringify([saved, events, stored]), /synthetic-user|synthetic-private/);
  await a.close();
  await assert.rejects(callA('settings.proxy.get'), (e) => e.kind === 'unavailable');
  const again = caller(await open('a', ids[0]), ids[0]);
  assert.equal((await again('settings.proxy.get')).revision, saved.revision);
  const kept = await again('settings.proxy.save', {
    config: { ...saved, credentials: { action: 'keep' } },
  });
  assert.equal(kept.hasCredentials, true);
  assert.equal((await callB('settings.proxy.get')).revision, peer.revision);
  proof('proxy-settings-source-real-owners', {
    encrypted: true,
    owners: ids,
    peerUnchanged: true,
    successfulWritesBeforeRestart: 1,
    conflictCount: 1,
    preExecutionCancellation: true,
    noPeerKeyInitialization: true,
    revisionPreservedOnRestart: saved.revision,
    keepDecryptsOriginalCredentials: true,
    closedOwnerRejects: true,
    boundary:
      'Actual SQLite production kernel and file cipher, temporary synthetic owners; direct handler contexts are explicit fixtures. SDK stdio and crash receipt companions separately run in this replay.',
  });
});
