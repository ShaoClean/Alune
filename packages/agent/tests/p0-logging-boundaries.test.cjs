// Frozen sources execute in a restricted VM. All filesystem work uses disposable fixtures.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');
const current = require('../dist/adapters/logging');
const protocol = require('@alune/protocol');
const { openStateKernel } = require('../dist/bootstrap/state-kernel');
const { spawnAgent } = require('@alune/agent-client/node');
const plain = (v) => JSON.parse(JSON.stringify(v));
const fixed = () => new Date('2026-11-13T12:00:00.000Z');
const settings = { customDirectory: null, level: 'DEBUG', retentionDays: 14, maxTotalMB: 200 };
function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-p0-logging-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function evaluate(file, deps, globals = {}) {
  const source = fs.readFileSync(file, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      experimentalDecorators: true,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(
    output,
    {
      module,
      exports: module.exports,
      Buffer,
      Date,
      Error,
      URL,
      process: { pid: process.pid },
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      queueMicrotask,
      ...globals,
      require(name) {
        assert(Object.hasOwn(deps, name), 'Unreviewed dependency: ' + name);
        return deps[name];
      },
    },
    { filename: file },
  );
  return module.exports;
}
function frozen(name, deps = {}, globals = {}) {
  assert(process.env.P0_LOGGING_FROZEN, 'Use batch-10 replay driver');
  return evaluate(path.join(process.env.P0_LOGGING_FROZEN, name), deps, globals);
}
function oldModules(globals = {}, fsOverrides = {}) {
  const constants = frozen('packages/shared/src/types/logging.ts');
  assert.deepEqual(plain(constants), {
    LOG_LEVELS: protocol.LOG_LEVELS,
    LOGGING_LIMITS: protocol.LOGGING_LIMITS,
  });
  const redact = frozen('apps/server/src/logging/redact.ts');
  const store = frozen(
    'apps/server/src/logging/log-store.ts',
    {
      'node:fs': { ...fs, ...fsOverrides },
      'node:path': path,
      '@alune/shared': constants,
      './redact': redact,
    },
    globals,
  );
  return { ...store, ...redact };
}
function storeFixture(t, Module, dir = scratch(t), now = fixed) {
  fs.mkdirSync(dir, { recursive: true });
  const store = new Module.LogStore(dir, now);
  t.after(() => store.close());
  return { store, dir };
}
function disk(store) {
  return fs
    .readdirSync(store.settings().directory)
    .filter(
      (x) =>
        /^alune-\d{4}-\d{2}-\d{2}(?:\.\d+)?\.log$/.test(x) &&
        fs.statSync(path.join(store.settings().directory, x)).isFile(),
    )
    .sort()
    .flatMap((x) =>
      fs
        .readFileSync(path.join(store.settings().directory, x), 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(JSON.parse),
    );
}
function record(name, value) {
  if (process.env.P0_LOGGING_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_LOGGING_PROOF_DIR, name + '.json'),
      JSON.stringify(value, null, 2) + '\n',
      { flag: 'wx' },
    );
}

test('P0 logging zero and negative internal history limits return no entries', (t) => {
  const Module = process.env.P0_LOGGING_ORIGINAL
    ? evaluate(process.env.P0_LOGGING_ORIGINAL, {
        'node:fs': fs,
        'node:path': path,
        '@alune/protocol': protocol,
        './redact': current,
      })
    : current;
  const { store } = storeFixture(t, Module);
  store.write('ERROR', 'fixture', 'must not escape an empty request');
  for (const limit of [0, -1, -1000])
    assert.deepEqual(plain(store.recent(limit)), [], 'limit=' + limit);
  assert.equal(store.recent(1).length, 1);
});

test('P0-DIAGNOSTICS-0456 whole redactor preserves bounded values and explicitly strengthens secret masking', () => {
  const old = oldModules();
  const samples = [
    ['safe 中文🦊', 'safe 中文🦊'],
    [
      '-----BEGIN RSA PRIVATE KEY-----\nfixture\n-----END RSA PRIVATE KEY-----',
      '[REDACTED PRIVATE KEY]',
    ],
    ['ssh://user:password@host.invalid/path', 'ssh://***@host.invalid/path'],
    ['Authorization: fixture-private-header', 'Authorization: [REDACTED]'],
    ['Bearer fixture-private-bearer', 'Bearer [REDACTED]'],
    [
      'https://host.invalid/?access_token=fixture-value&safe=yes',
      'https://host.invalid/?access_token=[REDACTED]&safe=yes',
    ],
    ['password=fixture-value', 'password=[REDACTED]'],
    ['ghp_' + 'a'.repeat(30), '[REDACTED]'],
    ['x'.repeat(4001), 'x'.repeat(4000) + '…（已截断 1 字符）'],
  ];
  for (const api of [old, current]) {
    api.registerSecret('fixture-registered-literal');
    api.registerSecret('short');
    api.registerSecret('');
    assert.equal(
      api.redactText('fixture-registered-literal repeated fixture-registered-literal'),
      '[REDACTED] repeated [REDACTED]',
    );
    assert.equal(api.redactText('short'), 'short');
    for (const [input, expected] of samples) assert.equal(api.redactText(input), expected);
    assert.equal(api.redactContext(undefined), undefined);
    assert.equal(api.redactContext({}), undefined);
    const repeated = { safe: 1 },
      circular = {};
    circular.self = circular;
    const input = {
      empty: '',
      nil: null,
      missing: undefined,
      count: 2,
      flag: false,
      big: 99n,
      symbol: Symbol('ok'),
      array: [1, 'password=hidden', false],
      password: 'hidden',
      emptyToken: '',
      token: null,
      nested: { api_key: 'hidden' },
      circular,
      first: repeated,
      second: repeated,
      deep: { b: { c: { d: { value: 'too deep' } } } },
      many: Array.from({ length: 50 }, (_, i) => i),
    };
    const value = plain(api.redactContext(input));
    assert.equal(value.big, '99');
    assert.equal(value.symbol, 'Symbol(ok)');
    assert.equal(value.password, '[REDACTED]');
    assert.equal(value.token, null);
    assert.equal(value.emptyToken, '');
    assert.deepEqual(value.array, [1, 'password=[REDACTED]', false]);
    assert.equal(value.nested.api_key, '[REDACTED]');
    assert.equal(value.circular.self, '[Circular]');
    assert.equal(value.second, '[Circular]');
    assert.equal(value.deep.b.c.d, '[Object]');
    assert.equal(value.many.length, 40);
    assert.equal(
      Object.keys(
        api.redactContext(Object.fromEntries(Array.from({ length: 50 }, (_, i) => ['k' + i, i]))),
      ).length,
      40,
    );
    assert(!Object.hasOwn(value, 'missing'));
  }
  const cipher = 'aes-gcm:v1:' + Buffer.alloc(48, 7).toString('base64');
  const error = Object.assign(new Error(cipher), { name: cipher, code: cipher });
  const hardened = current.redactContext({
    error,
    ciphertext: cipher,
    masterKey: 'synthetic',
    duration: Infinity,
  });
  assert.doesNotMatch(JSON.stringify(hardened), /aes-gcm:|synthetic/);
  assert.equal(hardened.duration, null);
  assert.equal(
    Object.getPrototypeOf(current.redactContext(JSON.parse('{"__proto__":{"token":"hidden"}}'))),
    null,
  );
  assert.equal(
    current.redactContext({ e: Object.assign(new Error('safe'), { code: 'EIO' }) }).e.code,
    'EIO',
  );
  record('redaction-matrix', {
    commonSamples: samples.length,
    registeredLiterals: true,
    bounds: { string: 4000, depth: 4, keys: 40 },
    strengthened: ['ciphertext', 'Error name/code', 'nonfinite JSON', 'null prototype'],
    legacyDifferences:
      'Frozen redactor did not mask ciphertext/error name/code or normalize nonfinite numbers; intentional stronger successor.',
  });
});

test('P0-DIAGNOSTICS-0409 whole store preserves validation levels live delivery flush and settings persistence', async (t) => {
  const results = [];
  for (const Module of [oldModules(), current]) {
    const { store, dir } = storeFixture(t, Module);
    assert.equal(store.settings().level, 'INFO');
    const live = [];
    const off = store.subscribe((e) => live.push(plain(e)));
    store.subscribe(() => {
      throw Error('listener failure must be contained');
    });
    store.write('DEBUG', 'fixture', 'filtered');
    assert.equal(store.recent().length, 0);
    store.update(settings);
    assert.deepEqual(
      plain(Module.validateLoggingSettings({ ...settings, customDirectory: '  ' })),
      settings,
    );
    for (const bad of [
      null,
      {},
      { ...settings, level: 'TRACE' },
      { ...settings, customDirectory: 'relative' },
      { ...settings, customDirectory: 'bad\0path' },
      { ...settings, retentionDays: 0 },
      { ...settings, maxTotalMB: 1.5 },
    ])
      assert.throws(
        () => Module.validateLoggingSettings(bad),
        (e) => e.constructor.name === 'LogValidationError',
      );
    for (const level of protocol.LOG_LEVELS)
      store.write(level, 'source'.repeat(20), level + ' password=hidden', {
        token: 'hidden',
        safe: 1,
      });
    assert.equal(live.length, 5);
    const beforeOff = live.length;
    off();
    store.write('WARN', 'fixture', 'after unsubscribe');
    assert.equal(live.length, beforeOff);
    store.flush();
    assert.equal(store.timer, undefined);
    const rows = plain(store.recent(4));
    assert.equal(rows[0].source.length, 64);
    assert.equal(rows[0].context.token, '[REDACTED]');
    assert.equal(disk(store).length, 6);
    assert.equal(fs.statSync(path.join(dir, 'logging.json')).mode & 0o777, 0o600);
    store.write('INFO', 'fixture', 'timer flush');
    await new Promise((resolve) => setTimeout(resolve, 260));
    assert.equal(disk(store).at(-1).message, 'timer flush');
    store.close();
    store.write('ERROR', 'fixture', 'after close');
    const reopened = storeFixture(t, Module, dir).store;
    assert.equal(reopened.settings().level, 'DEBUG');
    assert.equal(reopened.recent(1)[0].message, 'timer flush');
    results.push(rows);
  }
  assert.deepEqual(results[1], results[0]);
  record('store-common-contract', {
    paired: true,
    levels: protocol.LOG_LEVELS,
    timerFlush: true,
    errorFlush: true,
    listenerRefusal: true,
    unsubscribe: true,
    reopen: true,
  });
});

test('P0 logging rotation retention size caps and bounded history use real isolated files', async (t) => {
  for (const Module of [oldModules(), current]) {
    const dir = scratch(t);
    const logs = path.join(dir, 'logs');
    fs.mkdirSync(logs);
    const now = () => new Date('2026-11-13T12:00:00.000Z');
    fs.writeFileSync(
      path.join(dir, 'logging.json'),
      JSON.stringify({ ...settings, retentionDays: 2, maxTotalMB: 20 }),
    );
    fs.writeFileSync(path.join(logs, 'alune-2026-11-10.log'), 'old');
    fs.writeFileSync(path.join(logs, 'unrelated.log'), 'keep');
    fs.mkdirSync(path.join(logs, 'alune-2026-11-11.log'));
    const row =
      JSON.stringify({
        time: now().toISOString(),
        level: 'INFO',
        source: 'fixture',
        message: 'history',
      }) + '\n';
    fs.writeFileSync(path.join(logs, 'alune-2026-11-12.log'), row.repeat(1100));
    const { store } = storeFixture(t, Module, dir, now);
    assert(!fs.existsSync(path.join(logs, 'alune-2026-11-10.log')));
    assert.equal(fs.readFileSync(path.join(logs, 'unrelated.log'), 'utf8'), 'keep');
    assert.equal(store.recent().length, protocol.LOGGING_LIMITS.history);
    for (let i = 0; i < 2100; i++) store.write('DEBUG', 'fixture', 'entry-' + i);
    assert.equal(store.recent(2000).length, protocol.LOGGING_LIMITS.history);
    store.flush();
    for (let i = 0; i < 70; i++) store.write('DEBUG', 'fixture', 'x'.repeat(4000));
    assert(
      disk(store).some((e) => e.message === 'x'.repeat(4000)),
      '256 KiB threshold flushed without explicit flush',
    );
    store.cleanupTimer._onTimeout();
    // Resume the latest numbered file at its actual size and roll when the file limit is crossed.
    store.close();
    const full = path.join(logs, 'alune-2026-11-13.2.log');
    fs.writeFileSync(full, 'x');
    fs.truncateSync(full, protocol.LOGGING_LIMITS.fileMB * 1024 * 1024);
    const rolling = storeFixture(t, Module, dir, now).store;
    rolling.write('ERROR', 'fixture', 'roll-on-size');
    assert.equal(rolling.file.index, 3);
    assert(fs.existsSync(path.join(logs, 'alune-2026-11-13.3.log')));
    // The current file stays protected; old files are removed to meet the configured total cap.
    const extra = path.join(logs, 'alune-2026-11-12.1.log');
    fs.writeFileSync(extra, 'x');
    fs.truncateSync(extra, 21 * 1024 * 1024);
    rolling.cleanup();
    assert(!fs.existsSync(extra));
    assert(fs.existsSync(rolling.file.path));
    rolling.now = () => new Date('2026-11-14T12:00:00.000Z');
    rolling.write('ERROR', 'fixture', 'roll-on-date');
    assert.equal(path.basename(rolling.file.path), 'alune-2026-11-14.log');
    await new Promise(setImmediate);
  }
});

test('P0 logging directory switches fallback append failures and malformed history remain contained', (t) => {
  for (const Module of [oldModules(), current]) {
    const { store, dir } = storeFixture(t, Module);
    const custom = path.join(dir, 'custom');
    store.write('INFO', 'fixture', 'pending before switch');
    store.update({ ...settings, customDirectory: custom });
    store.flush();
    assert.equal(store.settings().directory, custom);
    assert(
      fs
        .readFileSync(path.join(dir, 'logs', fs.readdirSync(path.join(dir, 'logs'))[0]), 'utf8')
        .includes('pending before switch'),
    );
    fs.rmSync(custom, { recursive: true });
    store.write('ERROR', 'fixture', 'recreated');
    assert(fs.existsSync(custom));
    fs.rmSync(custom, { recursive: true });
    fs.writeFileSync(custom, 'blocks directory');
    store.write('ERROR', 'fixture', 'fallback');
    assert.equal(store.settings().directory, path.join(dir, 'logs'));
    assert.match(store.settings().fallbackReason, /回退/);
    const blocker = path.join(dir, 'file');
    fs.writeFileSync(blocker, 'preserve');
    assert.throws(() => Module.assertWritableDirectory(blocker), /路径不是目录/);
    const before = fs.readFileSync(path.join(dir, 'logging.json'));
    assert.throws(() => store.update({ ...settings, customDirectory: blocker }));
    assert.deepEqual(fs.readFileSync(path.join(dir, 'logging.json')), before);
    store.close();
    const reopened = storeFixture(t, Module, dir).store;
    assert.match(reopened.settings().fallbackReason, /回退/);
    assert(reopened.recent().some((e) => e.message === 'fallback'));
    fs.rmSync(reopened.settings().directory, { recursive: true });
    fs.writeFileSync(reopened.settings().directory, 'blocked default');
    assert.doesNotThrow(() => reopened.write('ERROR', 'fixture', 'cannot persist'));
  }
  const dir = scratch(t);
  fs.mkdirSync(path.join(dir, 'logs'));
  fs.writeFileSync(path.join(dir, 'logging.json'), '{damaged');
  const cipher = 'safe-storage:' + Buffer.alloc(48, 8).toString('base64');
  const valid = {
    time: fixed().toISOString(),
    level: 'ERROR',
    source: cipher,
    message: cipher,
    context: { password: 'hidden' },
    unwanted: 'not returned',
  };
  fs.writeFileSync(
    path.join(dir, 'logs/alune-2026-11-13.log'),
    'not-json\n' +
      [
        valid,
        { ...valid, time: 'invalid' },
        { ...valid, source: null },
        { ...valid, level: 'TRACE' },
      ]
        .map(JSON.stringify)
        .join('\n'),
  );
  const { store } = storeFixture(t, current, dir);
  assert.match(store.settings().fallbackReason, /无法读取/);
  const history = store.recent().filter((e) => e.level === 'ERROR');
  assert.equal(history.length, 1);
  assert.equal(history[0].source, '[REDACTED]');
  assert.doesNotMatch(JSON.stringify(history), /safe-storage:|hidden|unwanted/);
});

test('P0 logging partial history tails and cleanup IO failures do not discard usable entries', (t) => {
  const dir = scratch(t);
  fs.mkdirSync(path.join(dir, 'logs'));
  const line =
    JSON.stringify({
      time: fixed().toISOString(),
      level: 'INFO',
      source: 'fixture',
      message: 'tail-kept',
    }) + '\n';
  fs.writeFileSync(
    path.join(dir, 'logs/alune-2026-11-13.log'),
    'x'.repeat(2 * 1024 * 1024 + 20) + '\n' + line,
  );
  for (const Module of [oldModules(), current]) {
    const { store } = storeFixture(t, Module, dir);
    assert.equal(store.recent(1)[0].message, 'tail-kept');
    store.close();
  }
  const denied = oldModules(
    {},
    {
      rmSync() {
        throw Object.assign(Error('synthetic denied'), { code: 'EACCES' });
      },
    },
  );
  const f = storeFixture(t, denied);
  fs.writeFileSync(path.join(f.dir, 'logs/alune-2000-01-01.log'), 'preserved after refusal');
  assert.doesNotThrow(() => f.store.cleanup());
  assert(fs.existsSync(path.join(f.dir, 'logs/alune-2000-01-01.log')));
});

test('P0-DIAGNOSTICS-0444 logging module registration has private Agent handler successors', async (t) => {
  const old = oldModules();
  let metadata;
  const Controller = class {};
  const original = frozen('apps/server/src/logging/logging.module.ts', {
    '@nestjs/common': {
      Module(value) {
        metadata = value;
        return () => {};
      },
    },
    './logging.controller': { LoggingController: Controller },
    './logger': { logger: { info() {} }, logStore: () => ({ flush() {} }) },
  });
  assert.equal(metadata.controllers.length, 1);
  assert.equal(metadata.controllers[0], Controller);
  assert.deepEqual(Object.keys(original), ['LoggingModule']);
  const root = scratch(t);
  const kernel = await openStateKernel(root, randomUUID(), undefined, { backend: 'file' });
  t.after(() => kernel.close());
  const names = Object.keys(kernel.handlers)
    .filter((x) => x.startsWith('diagnostics.'))
    .sort();
  assert.deepEqual(names, [
    'diagnostics.logs.chunk',
    'diagnostics.logs.client',
    'diagnostics.logs.release',
    'diagnostics.logs.saveSettings',
    'diagnostics.logs.settings',
    'diagnostics.logs.snapshot',
  ]);
  for (const name of names) assert.equal(kernel.handlers[name].minimumProtocolMinor, 1);
  assert.equal(kernel.handlers['diagnostics.logs.client'].durable, false);
  assert.equal(kernel.desktopHandlers['desktop.log'].durable, false);
  assert.equal(kernel.handlers['desktop.log'], undefined);
  assert.equal(old.LogStore.name, 'LogStore');
  record('module-registration', {
    frozenControllers: ['LoggingController (explicit double)'],
    successor: names,
    privateDesktopLog: true,
    oldHttpAndNestRetired: true,
  });
});

test('P0-DIAGNOSTICS-0445 module ownership isolates settings history and cancelled mutations', async (t) => {
  const roots = [scratch(t), scratch(t)],
    kernels = [];
  const context = (signal = new AbortController().signal) => ({
    signal,
    events: { notifyState() {} },
  });
  for (const dir of roots) {
    const k = await openStateKernel(dir, randomUUID(), undefined, { backend: 'file' });
    kernels.push(k);
    t.after(() => k.close());
  }
  const [a, b] = kernels;
  const get = (k) => k.handlers['diagnostics.logs.settings'].run({}, context());
  const first = get(a),
    other = get(b);
  assert.notEqual(first.revision, other.revision);
  const save = a.handlers['diagnostics.logs.saveSettings'];
  const input = { revision: first.revision, settings };
  save.validate(input);
  const cancelled = new AbortController();
  cancelled.abort();
  assert.throws(
    () => save.run(input, context(cancelled.signal)),
    (e) => e.name === 'AbortError',
  );
  assert.equal(get(a).revision, first.revision);
  const saved = save.run(input, context());
  assert.notEqual(saved.revision, first.revision);
  assert.throws(
    () =>
      b.handlers['diagnostics.logs.saveSettings'].run(
        { revision: saved.revision, settings },
        context(),
      ),
    (e) => e.kind === 'conflict',
  );
  assert.equal(get(b).revision, other.revision);
  const bad = a.state.document('logging-settings');
  const original = bad.read();
  assert.equal(original.revision, saved.revision);
  record('module-isolation', {
    independentAgentIds: kernels.map((k) => k.state.status().agentId),
    distinctRevisions: true,
    crossAgentRevisionRefused: true,
    preAbortedSaveUnchanged: true,
  });
});

test('P0-DIAGNOSTICS-0446 shutdown flushes pending diagnostics before the Agent releases state', async (t) => {
  const old = oldModules(),
    oldDir = scratch(t),
    originalStore = storeFixture(t, old, oldDir).store;
  const calls = [];
  const Module = frozen('apps/server/src/logging/logging.module.ts', {
    '@nestjs/common': { Module: () => () => {} },
    './logging.controller': { LoggingController: class {} },
    './logger': {
      logger: {
        info: (...a) => {
          calls.push(a);
          originalStore.write('INFO', ...a);
        },
      },
      logStore: () => originalStore,
    },
  }).LoggingModule;
  for (const signal of [undefined, 'SIGTERM']) new Module().onApplicationShutdown(signal);
  assert.deepEqual(plain(calls), [
    ['server', '本地服务已关闭', null],
    ['server', '本地服务已关闭', { signal: 'SIGTERM' }],
  ]);
  assert.equal(disk(originalStore).length, 2);
  const dir = scratch(t),
    id = randomUUID();
  let kernel = await openStateKernel(dir, id, undefined, { backend: 'file' });
  t.after(() => kernel.close());
  kernel.desktopHandlers['desktop.log'].run({
    level: 'INFO',
    source: 'fixture',
    message: 'pending shutdown sentinel',
    context: { token: 'hidden' },
  });
  const close = kernel.close();
  assert.equal(kernel.close(), close);
  await close;
  assert.equal(kernel.state.status().writer, false);
  assert.equal(kernel.state.database.open, false);
  const text = fs
    .readdirSync(path.join(dir, 'logs'))
    .filter((f) => f.endsWith('.log'))
    .map((f) => fs.readFileSync(path.join(dir, 'logs', f), 'utf8'))
    .join('');
  assert.match(text, /pending shutdown sentinel/);
  assert.doesNotMatch(text, /hidden/);
  kernel = await openStateKernel(dir, id, undefined, { backend: 'file' });
  const ctx = { signal: new AbortController().signal, events: { notifyState() {} } };
  const snapshot = kernel.handlers['diagnostics.logs.snapshot'].run({ limit: 1 }, ctx);
  const chunk = kernel.handlers['diagnostics.logs.chunk'].run(
    { snapshotId: snapshot.snapshotId, index: 0 },
    ctx,
  );
  assert.equal(
    JSON.parse(Buffer.from(chunk.base64, 'base64'))[0].message,
    'pending shutdown sentinel',
  );
  record('shutdown-responsibility', {
    frozenSignals: [null, 'SIGTERM'],
    frozenInfoMessage: true,
    successorPendingFlushAndReopen: true,
    successorIdempotentClose: true,
    successorDifference:
      'Nest-specific server shutdown line and signal context are retired; Agent owns flush/release, stdout remains protocol-only. No new Agent shutdown info line is claimed.',
  });
});

test('P0 logging real stdio Agent flushes INFO on EOF and isolates snapshots across sessions', async (t) => {
  const root = scratch(t),
    secondRoot = scratch(t),
    children = [];
  t.after(async () => {
    await Promise.all(children.map((c) => c.close()));
  });
  const start = async (dir) => {
    const c = spawnAgent(process.execPath, [path.join(__dirname, 'settings-fixture.cjs'), dir]);
    children.push(c);
    await c.client.initialize();
    return c;
  };
  const a = await start(root),
    b = await start(secondRoot);
  const settings = await a.client.getLoggingSettings();
  const request = a.client.startRequest('diagnostics.logs.saveSettings', {
    revision: settings.revision,
    settings: { customDirectory: null, level: 'INFO', retentionDays: 14, maxTotalMB: 200 },
  });
  await request.result;
  assert.equal((await a.client.getTask({ requestId: request.requestId })).task.state, 'succeeded');
  assert.equal((await a.client.getTask({ requestId: request.requestId })).scope, 'agent');
  assert.equal(
    (
      await a.client.request('diagnostics.logs.client', {
        level: 'INFO',
        message: 'stdio flush sentinel',
        context: { password: 'hidden' },
      })
    ).accepted,
    true,
  );
  const snapshot = await a.client.request('diagnostics.logs.snapshot', { limit: 1 });
  await assert.rejects(
    b.client.request('diagnostics.logs.chunk', { snapshotId: snapshot.snapshotId, index: 0 }),
    (e) => e.kind === 'not-found',
  );
  await a.close();
  assert.equal((await a.exited).code, 0);
  const reopened = await start(root);
  assert.equal(
    (await reopened.client.getTask({ requestId: request.requestId })).task.state,
    'succeeded',
  );
  const rows = await reopened.client.recentLogs(1);
  assert.equal(rows[0].message, 'stdio flush sentinel');
  assert.equal(rows[0].context.password, '[REDACTED]');
  await assert.rejects(
    reopened.client.request('diagnostics.logs.chunk', {
      snapshotId: snapshot.snapshotId,
      index: 0,
    }),
    (e) => e.kind === 'not-found',
  );
  assert.equal((await b.client.recentLogs(10)).length, 0);
  record('actual-stdio-lifecycle', {
    eofExitCode: 0,
    infoFlushedAndRestarted: true,
    crossSessionAndAgentSnapshotRefused: true,
    durableSettingsReceiptRetained: true,
    noAutomaticMutationReplay: true,
  });
});
