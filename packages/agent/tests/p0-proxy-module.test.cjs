const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { openStateKernel } = require('../dist/bootstrap/state-kernel');
const baseline = '3c05f640fcc1a04c864e47bfc2880483ad48c984';
const file = 'apps/server/src/proxy/proxy.module.ts';
const root = path.resolve(__dirname, '../../..');
function proof(name, value) {
  if (process.env.P0_PROXY_MODULE_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_PROXY_MODULE_PROOF_DIR, name + '.json'),
      JSON.stringify(value, null, 2) + '\n',
      { flag: 'wx' },
    );
}
function frozen(env, home, construct) {
  const source = fs.readFileSync(path.join(process.env.P0_PROXY_MODULE_FROZEN, file), 'utf8');
  assert.equal(
    source,
    execFileSync('git', ['show', baseline + ':' + file], { cwd: root, encoding: 'utf8' }),
  );
  const decorators = [];
  const token = Symbol('secret-storage');
  class ProxyService {}
  class ProxySettingsStore {
    constructor(...args) {
      construct(...args);
      this.args = args;
    }
  }
  const dependencies = {
    '@nestjs/common': {
      Global: () => (target) => {
        decorators.push({ name: 'Global', target: target.name });
      },
      Module: (value) => (target) => {
        decorators.push({ name: 'Module', target: target.name, value });
      },
    },
    'node:os': { homedir: () => home },
    'node:path': { join: path.join },
    '../secrets/secrets.module': { SECRET_STORAGE: token },
    './proxy-settings': { ProxySettingsStore },
    './proxy.service': { ProxyService },
  };
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        experimentalDecorators: true,
      },
    }).outputText,
    {
      module,
      exports: module.exports,
      process: { env },
      require(id) {
        assert(Object.hasOwn(dependencies, id), id);
        return dependencies[id];
      },
    },
    { filename: file },
  );
  return { ...module.exports, ProxyService, ProxySettingsStore, token, decorators, source };
}
async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-batch26-'));
  const kernels = [];
  t.after(async () => {
    for (const k of kernels) await k.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return {
    directory,
    async open(name, id, options = { backend: 'file' }) {
      const k = await openStateKernel(path.join(directory, name), id, undefined, options);
      kernels.push(k);
      return k;
    },
  };
}
function caller(k, id, notifications = []) {
  return async (method, params, signal = new AbortController().signal) => {
    const h = k.handlers[method];
    h.validate(params);
    return h.run(params, {
      signal,
      sessionSignal: signal,
      agentId: id,
      sessionId: randomUUID(),
      taskId: randomUUID(),
      events: {
        notifyState(...args) {
          notifications.push(args);
        },
      },
    });
  };
}
const config = (first, user = 'synthetic-user') => ({
  ...first,
  enabled: true,
  host: '127.0.0.1',
  port: 3128,
  authEnabled: true,
  credentials: { action: 'replace', username: user, password: 'synthetic-private-password' },
});

test('P0 proxy module full frozen registration binds secret token paths exports and constructor failures', () => {
  const rows = [];
  for (const environment of [{}, { ALUNE_DATA_DIR: '' }, { ALUNE_DATA_DIR: '/synthetic/custom' }]) {
    const calls = [],
      f = frozen(environment, '/synthetic/home', (...args) => calls.push(args));
    const ast = ts.createSourceFile(file, f.source, ts.ScriptTarget.Latest, true);
    assert.deepEqual(
      ast.statements.filter(ts.isImportDeclaration).map((s) => s.moduleSpecifier.text),
      [
        '@nestjs/common',
        'node:os',
        'node:path',
        '../secrets/secrets.module',
        '../secrets/secret-storage',
        './proxy-settings',
        './proxy.service',
      ],
    );
    const declarations = ast.statements.filter((s) => !ts.isImportDeclaration(s));
    assert.equal(declarations.length, 1);
    assert(ts.isClassDeclaration(declarations[0]));
    assert.deepEqual(
      declarations[0].members.map((m) => m.name.getText(ast)),
      ['register'],
    );
    assert.deepEqual(Object.keys(f), [
      'ProxyModule',
      'ProxyService',
      'ProxySettingsStore',
      'token',
      'decorators',
      'source',
    ]);
    assert.deepEqual(JSON.parse(JSON.stringify(f.decorators)), [
      { name: 'Module', target: 'ProxyModule', value: {} },
      { name: 'Global', target: 'ProxyModule' },
    ]);
    assert.deepEqual(Object.getOwnPropertyNames(f.ProxyModule).sort(), [
      'length',
      'name',
      'prototype',
      'register',
    ]);
    assert.deepEqual(Object.getOwnPropertyNames(f.ProxyModule.prototype), ['constructor']);
    const a = f.ProxyModule.register(),
      b = f.ProxyModule.register();
    assert.notEqual(a, b);
    assert.notEqual(a.providers, b.providers);
    assert.deepEqual(Object.keys(a).sort(), ['exports', 'module', 'providers']);
    assert.equal(a.module, f.ProxyModule);
    assert.equal(a.providers.length, 2);
    assert.equal(a.providers[0], f.ProxyService);
    assert.equal(a.exports.length, 1);
    assert.equal(a.exports[0], f.ProxyService);
    const provider = a.providers[1];
    assert.deepEqual(Object.keys(provider).sort(), ['inject', 'provide', 'useFactory']);
    assert.equal(provider.provide, f.ProxySettingsStore);
    assert.equal(provider.inject.length, 1);
    assert.equal(provider.inject[0], f.token);
    assert.equal(calls.length, 0, 'registration must not instantiate settings');
    const secrets = Object.freeze({ marker: 'exact injected cipher' });
    const first = provider.useFactory(secrets),
      second = provider.useFactory(secrets);
    assert.notEqual(first, second);
    assert.equal(calls.length, 2);
    const expected = path.join(
      environment.ALUNE_DATA_DIR || '/synthetic/home/.alune',
      'network-proxy.json',
    );
    for (const args of calls) {
      assert.equal(args.length, 2);
      assert.equal(args[0], expected);
      assert.equal(args[1], secrets);
    }
    rows.push({
      environment,
      path: expected,
      lazy: true,
      injectedToken: true,
      freshDescriptors: true,
    });
  }
  const marker = Error('synthetic constructor failure');
  const f = frozen({}, '/synthetic/home', () => {
    throw marker;
  });
  assert.throws(
    () => f.ProxyModule.register().providers[1].useFactory({}),
    (e) => e === marker,
  );
  proof('proxy-module-frozen-registration', {
    rows,
    constructorFailurePropagated: true,
    boundary:
      'Exact whole frozen module executed; decorators and settings/service constructor ports are explicit doubles, no Nest container or real home access.',
  });
});

test('P0 proxy module successor isolates explicit directories cipher ownership and concurrent revisions', async (t) => {
  const f = await fixture(t),
    ids = [randomUUID(), randomUUID()];
  const previousEnv = process.env.ALUNE_DATA_DIR;
  const decoy = path.join(f.directory, 'legacy-global');
  fs.mkdirSync(decoy);
  const sentinel = JSON.stringify({ marker: 'synthetic untouched legacy global data' });
  fs.writeFileSync(path.join(decoy, 'network-proxy.json'), sentinel);
  process.env.ALUNE_DATA_DIR = decoy;
  t.after(() => {
    if (previousEnv === undefined) delete process.env.ALUNE_DATA_DIR;
    else process.env.ALUNE_DATA_DIR = previousEnv;
  });
  const options = { backend: 'file', keychain: '/synthetic/unused.keychain-db' };
  const a = await f.open('a', ids[0], options),
    b = await f.open('b', ids[1]);
  options.backend = 'keychain';
  const events = [],
    callA = caller(a, ids[0], events),
    callB = caller(b, ids[1]);
  const firstA = await callA('settings.proxy.get'),
    firstB = await callB('settings.proxy.get');
  assert.equal(firstA.secretStorageAvailable, false);
  assert.equal(firstB.secretStorageAvailable, false);
  for (const name of ['a', 'b'])
    assert.equal(fs.existsSync(path.join(f.directory, name, 'keys')), false);
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    callA('settings.proxy.save', { config: config(firstA) }, cancelled.signal),
    (e) => e.name === 'AbortError',
  );
  assert.equal(events.length, 0);
  assert.equal(fs.existsSync(path.join(f.directory, 'a', 'keys')), false);
  const outcomes = await Promise.allSettled([
    callA('settings.proxy.save', { config: config(firstA) }),
    callA('settings.proxy.save', { config: config(firstA, 'second-user') }),
  ]);
  assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    outcomes.filter((r) => r.status === 'rejected' && r.reason.kind === 'conflict').length,
    1,
  );
  const saved = outcomes.find((r) => r.status === 'fulfilled').value;
  assert.equal(saved.hasCredentials, true);
  assert.equal(saved.secretStorageAvailable, true);
  assert.equal(events.length, 1);
  assert.equal(events[0][0], 'settings.changed');
  assert.equal((await callB('settings.proxy.get')).revision, firstB.revision);
  assert.equal(fs.existsSync(path.join(f.directory, 'b', 'keys')), false);
  assert.equal(a.state.document('credential-key').read().backend, 'file');
  assert(
    fs.readdirSync(path.join(f.directory, 'a', 'keys')).every((name) => name.endsWith('.key')),
  );
  const stored = a.state.document('network-proxy').read();
  assert.match(stored.encryptedCredentials, /^aes-gcm:/);
  assert.doesNotMatch(
    JSON.stringify([stored, saved, events]),
    /synthetic-private-password|synthetic-user|second-user/,
  );
  assert.equal(
    fs.existsSync(path.join(f.directory, 'a', 'network-proxy.json')),
    false,
    'successor stores document in SQLite, not legacy global JSON',
  );
  const revision = saved.revision;
  await a.close();
  await assert.rejects(callA('settings.proxy.get'), (e) => e.kind === 'unavailable');
  assert.equal((await callB('settings.proxy.get')).revision, firstB.revision);
  const restored = await f.open('a', ids[0]),
    restoredCall = caller(restored, ids[0]);
  assert.equal((await restoredCall('settings.proxy.get')).revision, revision);
  const kept = await restoredCall('settings.proxy.save', {
    config: { ...saved, credentials: { action: 'keep' } },
  });
  assert.equal(kept.hasCredentials, true);
  assert.notEqual(kept.revision, revision);
  assert.equal(fs.readFileSync(path.join(decoy, 'network-proxy.json'), 'utf8'), sentinel);
  assert.deepEqual(fs.readdirSync(decoy), ['network-proxy.json']);
  proof('proxy-module-owner-isolation', {
    owners: ids,
    revisionPreserved: revision,
    compareAndSwap: ['one fulfilled', 'one conflict'],
    cancellationBeforeInitialization: true,
    peerUnaffected: true,
    legacyGlobalDirectoryUntouched: true,
    fixedFileBackendDespiteCallerMutation: true,
    persistedBackend: 'file',
    encryptedDocument: true,
    closedOwnerRejects: true,
    restoredCredentialsUsable: true,
  });
});

test('P0 proxy module missing bound secret fails closed without regeneration and permits explicit clear', async (t) => {
  const f = await fixture(t),
    id = randomUUID(),
    k = await f.open('owner', id),
    call = caller(k, id);
  const saved = await call('settings.proxy.save', {
    config: config(await call('settings.proxy.get')),
  });
  const before = JSON.stringify(k.state.document('network-proxy').read());
  const descriptor = JSON.stringify(k.state.document('credential-key').read());
  await k.close();
  const keys = path.join(f.directory, 'owner', 'keys');
  const keyFiles = fs.readdirSync(keys);
  assert(keyFiles.length > 0);
  const retained = path.join(f.directory, 'retained-keys');
  fs.renameSync(keys, retained);
  const restored = await f.open('owner', id),
    events = [],
    again = caller(restored, id, events);
  const publicConfig = await again('settings.proxy.get');
  assert.equal(publicConfig.hasCredentials, true);
  assert.equal(publicConfig.secretStorageAvailable, false);
  await assert.rejects(
    again('settings.proxy.save', { config: { ...saved, credentials: { action: 'keep' } } }),
    (e) => e.kind === 'invalid-input',
  );
  await assert.rejects(
    again('settings.proxy.save', { config: config(saved) }),
    (e) => e.kind === 'unavailable',
  );
  // Metadata creation can succeed without decrypting credentials. Actual bridge
  // traffic must consult the unavailable snapshot and fail before any target hit.
  let targetHits = 0;
  const target = http.createServer((_req, res) => {
    targetHits++;
    res.end('must not reach');
  });
  t.after(async () => {
    target.closeAllConnections();
    await new Promise((resolve) => target.close(resolve));
  });
  await new Promise((resolve, reject) => {
    target.once('error', reject);
    target.listen(0, '127.0.0.1', resolve);
  });
  const bridge = await again('network.updaterBridge', {});
  assert.equal(bridge.agentId, id);
  assert.equal(bridge.enabled, true);
  assert.equal(bridge.revision, saved.revision);
  assert.equal(bridge.scope, 'agent-loopback');
  assert.deepEqual(Object.keys(bridge).sort(), ['agentId', 'enabled', 'port', 'revision', 'scope']);
  const status = await new Promise((resolve, reject) => {
    const req = http.get(
      {
        host: '127.0.0.1',
        port: bridge.port,
        path: `http://127.0.0.1:${target.address().port}/forbidden`,
      },
      (res) => {
        res.resume();
        res.once('end', () => resolve(res.statusCode));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
  });
  assert.equal(status, 502);
  assert.equal(targetHits, 0);
  assert.equal(JSON.stringify(restored.state.document('network-proxy').read()), before);
  assert.equal(events.length, 0);
  assert.deepEqual(fs.readdirSync(keys), []);
  assert.equal(JSON.stringify(restored.state.document('credential-key').read()), descriptor);
  const cleared = await again('settings.proxy.save', {
    config: { ...saved, enabled: false, authEnabled: false, credentials: { action: 'clear' } },
  });
  assert.equal(cleared.hasCredentials, false);
  assert.equal(events.length, 1);
  assert.deepEqual(fs.readdirSync(keys), []);
  assert.deepEqual(fs.readdirSync(retained), keyFiles);
  proof('proxy-module-missing-secret', {
    readPresenceOnly: true,
    rejected: ['keep', 'replace'],
    bridgeMetadataAvailable: true,
    bridgeRequestStatus: status,
    targetHits,
    unchangedOnFailure: true,
    recreatedEmptyDirectory: true,
    regeneratedKey: false,
    descriptorUnchanged: true,
    emittedFailureEvent: false,
    explicitClearSucceeded: true,
    retainedOriginalKeys: true,
  });
});
