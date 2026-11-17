// Frozen logger executes in a restricted VM; all state/files belong to disposable fixtures.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');
const { LogStore } = require('../dist/adapters/logging');
const { createHttpTracer, errorContext } = require('../dist/adapters/logging/http-trace');
const { openStateKernel } = require('../dist/bootstrap/state-kernel');
const plain = (v) => JSON.parse(JSON.stringify(v));
const settings = { customDirectory: null, level: 'DEBUG', retentionDays: 14, maxTotalMB: 200 };
function record(name, value) {
  if (process.env.P0_HTTP_LOGGING_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_HTTP_LOGGING_PROOF_DIR, name + '.json'),
      JSON.stringify(value, null, 2) + '\n',
      { flag: 'wx' },
    );
}
function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-batch13-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function frozen(env = { NODE_ENV: 'test' }) {
  assert(process.env.P0_HTTP_LOGGING_FROZEN, 'Use batch-13 replay driver');
  const calls = [],
    stores = [],
    exits = [];
  class Store {
    constructor(directory) {
      this.directory = directory;
      this.closed = 0;
      this.flushed = 0;
      this.rows = [];
      stores.push(this);
    }
    write(...args) {
      if (this.fail) throw this.fail;
      this.rows.push(args);
      calls.push(args);
    }
    enabled(level) {
      if (this.fail) throw this.fail;
      return level === 'ERROR';
    }
    close() {
      this.closed++;
    }
    flush() {
      this.flushed++;
    }
  }
  const file = path.join(process.env.P0_HTTP_LOGGING_FROZEN, 'apps/server/src/logging/logger.ts');
  const source = fs.readFileSync(file, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(
    output,
    {
      module,
      exports: module.exports,
      Error,
      URL,
      String,
      performance,
      process: {
        env,
        pid: 31313,
        once(name, listener) {
          assert.equal(name, 'exit');
          exits.push(listener);
        },
      },
      require(id) {
        if (id === 'node:os')
          return { homedir: () => '/synthetic-home', tmpdir: () => '/synthetic-tmp' };
        if (id === 'node:path') return path;
        assert.equal(id, './log-store');
        return { LogStore: Store };
      },
    },
    { filename: file },
  );
  return { ...module.exports, calls, stores, exits, Store };
}
function realStore(t, directory = scratch(t)) {
  const store = new LogStore(directory);
  t.after(() => store.close());
  store.update(settings);
  return store;
}
function normalize(entry) {
  const v = plain(entry);
  delete v.time;
  if (v.context && Object.hasOwn(v.context, 'durationMs')) {
    assert(Number.isInteger(v.context.durationMs));
    assert(v.context.durationMs >= 0);
    v.context.durationMs = '[nonnegative integer]';
  }
  return v;
}
function legacyRows(f) {
  return f.calls.map(([level, source, message, context]) =>
    normalize({ level, source, message, ...(context ? { context } : {}) }),
  );
}

test('P0 logger ownership replaces the frozen singleton and reset hook with isolated kernel lifetimes', async (t) => {
  const roots = [];
  for (const [env, directory] of [
    [{ ALUNE_DATA_DIR: '/synthetic-explicit', NODE_ENV: 'test' }, '/synthetic-explicit'],
    [{ NODE_ENV: 'test' }, '/synthetic-tmp/alune-test-logs-31313'],
    [{}, '/synthetic-home/.alune'],
  ]) {
    const f = frozen(env);
    assert.equal(f.stores.length, 0);
    const one = f.logStore();
    assert.equal(one.directory, directory);
    assert.equal(f.logStore(), one);
    assert.equal(f.exits.length, 1);
    const replacement = new f.Store('/synthetic-replacement');
    f.setLogStore(replacement);
    assert.equal(one.closed, 1);
    assert.equal(f.logStore(), replacement);
    f.exits[0]();
    assert.equal(replacement.flushed, 1);
    assert.equal(one.flushed, 0);
    f.setLogStore(undefined);
    assert.equal(replacement.closed, 1);
    const next = f.logStore();
    assert.notEqual(next, one);
    assert.equal(next.directory, directory);
    assert.equal(f.exits.length, 2);
    f.exits[1]();
    assert.equal(next.flushed, 1);
    roots.push({ env, directory, constructors: f.stores.length, exitListeners: f.exits.length });
  }
  const dir = scratch(t),
    a = path.join(dir, 'a'),
    b = path.join(dir, 'b');
  const kernels = [];
  t.after(async () => {
    for (const k of kernels) await k.close();
  });
  const firstId = randomUUID();
  const first = await openStateKernel(a, firstId, undefined, { backend: 'file' });
  kernels.push(first);
  const second = await openStateKernel(b, randomUUID(), undefined, { backend: 'file' });
  kernels.push(second);
  const write = (kernel, marker) => {
    const h = kernel.desktopHandlers['desktop.log'];
    const params = { level: 'INFO', source: 'batch13-owner', message: marker };
    h.validate(params);
    assert.equal(h.run(params), null);
  };
  write(first, 'only-a');
  write(second, 'only-b');
  const ctx = { signal: new AbortController().signal, events: { notifyState() {} } };
  const snapshot = first.handlers['diagnostics.logs.snapshot'].run({ limit: 10 }, ctx);
  assert.throws(
    () =>
      second.handlers['diagnostics.logs.chunk'].run(
        { snapshotId: snapshot.snapshotId, index: 0 },
        ctx,
      ),
    (error) => error.kind === 'not-found',
  );
  const ownChunk = first.handlers['diagnostics.logs.chunk'].run(
    { snapshotId: snapshot.snapshotId, index: 0 },
    ctx,
  );
  assert.match(Buffer.from(ownChunk.base64, 'base64').toString('utf8'), /only-a/);
  first.handlers['diagnostics.logs.release'].run({ snapshotId: snapshot.snapshotId }, ctx);
  const read = (directory) =>
    fs
      .readdirSync(path.join(directory, 'logs'))
      .filter((x) => x.endsWith('.log'))
      .map((x) => fs.readFileSync(path.join(directory, 'logs', x), 'utf8'))
      .join('');
  await first.close();
  await first.close();
  write(second, 'b-still-open');
  await second.close();
  assert.match(read(a), /only-a/);
  assert.doesNotMatch(read(a), /only-b|b-still-open/);
  assert.match(read(b), /only-b/);
  assert.match(read(b), /b-still-open/);
  assert.doesNotMatch(read(b), /only-a/);
  const again = await openStateKernel(a, firstId, undefined, { backend: 'file' });
  kernels.push(again);
  write(again, 'a-reopened');
  await again.close();
  assert.match(read(a), /a-reopened/);
  record('logger-ownership-contract', {
    frozen: roots,
    current: {
      isolatedKernels: 2,
      closeFlushes: true,
      idempotentClose: true,
      reopen: true,
      snapshotCannotCrossKernels: true,
    },
    difference:
      'No current global singleton or reset API; dependency ownership replaces process-global mutation.',
  });
});

test('P0 logger four levels filtering and write failures retain redacted disk and live semantics', (t) => {
  const f = frozen();
  const legacy = f.logStore();
  const store = realStore(t),
    live = [];
  store.subscribe((row) => live.push(row));
  for (const [method, level] of [
    ['debug', 'DEBUG'],
    ['info', 'INFO'],
    ['warn', 'WARN'],
    ['error', 'ERROR'],
  ]) {
    f.logger[method]('batch13-level', 'literal 中文', { number: 1 });
    store.write(level, 'batch13-level', 'literal 中文', { number: 1 });
    assert.equal(f.logger.enabled(level), level === 'ERROR');
  }
  assert.deepEqual(
    store
      .recent()
      .filter((x) => x.source === 'batch13-level')
      .map(normalize),
    legacyRows(f),
  );
  assert.equal(live.filter((x) => x.source === 'batch13-level').length, 4);
  store.update({ ...settings, level: 'WARN' });
  assert.equal(store.enabled('INFO'), false);
  assert.equal(store.enabled('WARN'), true);
  const count = store.recent().length;
  store.write('INFO', 'batch13-filtered', 'not-recorded');
  assert.equal(store.recent().length, count);
  legacy.fail = new Error('synthetic write failure');
  for (const method of ['debug', 'info', 'warn', 'error'])
    assert.doesNotThrow(() => f.logger[method]('s', 'm'));
  assert.equal(f.logger.enabled('ERROR'), false);
  const cipher = 'aes-gcm:v1:' + Buffer.alloc(48, 7).toString('base64');
  store.write('ERROR', cipher, 'token=' + 'synthetic-secret', {
    password: 'synthetic-password',
    cipher,
  });
  store.flush();
  const rows = store.recent();
  const disk = fs
    .readdirSync(store.settings().directory)
    .filter((x) => x.endsWith('.log'))
    .map((x) => fs.readFileSync(path.join(store.settings().directory, x), 'utf8'))
    .join('');
  for (const v of [JSON.stringify(rows), JSON.stringify(live), disk])
    assert.doesNotMatch(v, /aes-gcm:v1:|synthetic-password|synthetic-secret/);
  record('logger-level-contract', {
    frozen: legacyRows(f),
    current: rows.map(normalize),
    exactLevelParity: true,
    filtered: true,
    loggerFailureContained: true,
    redactedDiskAndLive: true,
  });
});

test('P0 errorContext retains error identity fields and non-error coercion before current redaction', (t) => {
  const f = frozen(),
    store = realStore(t);
  const withCode = Object.assign(new TypeError('failure'), {
    code: 'ECONNRESET',
    stack: 'fixed-stack',
  });
  const noStack = new Error('no-stack');
  noStack.stack = undefined;
  const cases = [
    withCode,
    noStack,
    'literal',
    undefined,
    null,
    0,
    false,
    { toString: () => 'custom' },
    Symbol('probe'),
  ];
  const observed = [];
  for (const error of cases) {
    assert.deepEqual(plain(errorContext(error)), plain(f.errorContext(error)));
    observed.push(plain(errorContext(error)));
  }
  assert.deepEqual(observed[0], {
    error: { name: 'TypeError', message: 'failure', code: 'ECONNRESET', stack: 'fixed-stack' },
  });
  assert.deepEqual(observed[1], { error: { name: 'Error', message: 'no-stack' } });
  const cipher = 'safe-storage:' + Buffer.alloc(48, 2).toString('base64');
  store.write(
    'ERROR',
    'batch13-error',
    'failed',
    errorContext(Object.assign(new Error(cipher), { code: cipher, stack: cipher })),
  );
  assert.doesNotMatch(JSON.stringify(store.recent()), /safe-storage:/);
  record('logger-error-context-contract', {
    cases: observed,
    parityBeforeRedaction: true,
    currentCiphertextMasked: true,
  });
});

test('P0 traceHttp preserves response identity HTTP errors URL metadata context and a single send', async (t) => {
  const f = frozen(),
    store = realStore(t),
    current = createHttpTracer((...args) => store.write(...args));
  const expected = [];
  for (const trace of [f.traceHttp, current]) {
    let sends = 0;
    for (const [url, status] of [
      [
        'https://synthetic-user:synthetic-password@example.invalid:8443/v1/models?api_key=synthetic-query#synthetic-fragment',
        200,
      ],
      [new URL('https://example.invalid/fail?q=synthetic-query'), 503],
      ['invalid-url?synthetic-query', 204],
    ]) {
      const response = new Response(null, { status });
      const context = { request: 'literal', status: -1, durationMs: -1 };
      assert.equal(
        await trace('batch13-http', 'GET', url, context, async () => {
          sends++;
          return response;
        }),
        response,
      );
      assert.deepEqual(context, { request: 'literal', status: -1, durationMs: -1 });
    }
    assert.equal(sends, 3);
    expected.push(sends);
  }
  const oldRows = legacyRows(f),
    rows = store
      .recent()
      .filter((x) => x.source === 'batch13-http')
      .map(normalize);
  assert.deepEqual(rows, oldRows);
  assert.deepEqual(
    rows.map((x) => [x.level, x.message, x.context.status]),
    [
      ['INFO', 'GET example.invalid:8443/v1/models', 200],
      ['WARN', 'GET example.invalid/fail 返回 HTTP 503', 503],
      ['INFO', 'GET [invalid url]', 204],
    ],
  );
  assert.doesNotMatch(
    JSON.stringify(rows),
    /synthetic-user|synthetic-password|synthetic-query|synthetic-fragment/,
  );
  store.flush();
  record('http-response-contract', {
    frozen: oldRows,
    current: rows,
    singleSendCounts: expected,
    exactResponseIdentity: true,
    inputContextUnchanged: true,
  });
});

test('P0 traceHttp rethrows failures and cancellations unchanged even when logging fails', async (t) => {
  const f = frozen(),
    store = realStore(t),
    current = createHttpTracer((...args) => store.write(...args));
  const connection = Object.assign(new Error('connection failed'), {
    code: 'ECONNRESET',
    stack: 'fixed-transport-stack',
  });
  const controller = new AbortController();
  controller.abort(new Error('cancelled fixture'));
  let sends = 0;
  for (const trace of [f.traceHttp, current]) {
    for (const reason of [
      connection,
      controller.signal.reason,
      'rejected-string',
      null,
      undefined,
    ]) {
      let caught = false;
      try {
        await trace(
          'batch13-failure',
          'POST',
          'https://example.invalid/write?hidden=query',
          { operationId: 'synthetic-operation' },
          async () => {
            sends++;
            throw reason;
          },
        );
      } catch (error) {
        caught = true;
        assert.equal(error, reason);
      }
      assert(caught);
    }
  }
  assert.equal(sends, 10);
  const oldRows = legacyRows(f),
    rows = store
      .recent()
      .filter((x) => x.source === 'batch13-failure')
      .map(normalize);
  assert.deepEqual(rows, oldRows);
  assert.equal(rows.length, 5);
  assert(
    rows.every((x) => x.level === 'WARN' && x.message === 'POST example.invalid/write 请求失败'),
  );
  assert.equal(rows[0].context.error.code, 'ECONNRESET');
  assert.equal(rows[0].context.operationId, 'synthetic-operation');
  const failedLogger = createHttpTracer(() => {
    throw new Error('disk unavailable');
  });
  const response = new Response(null, { status: 200 });
  assert.equal(
    await failedLogger('s', 'GET', 'https://example.invalid', {}, async () => response),
    response,
  );
  await assert.rejects(
    failedLogger('s', 'POST', 'https://example.invalid', {}, async () => {
      throw connection;
    }),
    (error) => error === connection,
  );
  record('http-failure-contract', {
    frozen: oldRows,
    current: rows,
    exactThrownIdentity: true,
    cancelledSendCount: 1,
    totalSends: sends,
    failingWriterCannotAlterResult: true,
    noRetry: true,
  });
});

test('P0 state kernel actually routes AI HTTP tracing through its owned diagnostics store', async (t) => {
  const http = require('node:http');
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'fixture-model' }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const dir = scratch(t),
    kernel = await openStateKernel(dir, randomUUID(), undefined, { backend: 'file' });
  t.after(() => kernel.close());
  const ctx = {
    signal: new AbortController().signal,
    sessionSignal: new AbortController().signal,
    events: { notifyState() {} },
  };
  const call = async (method, params) => {
    const h = kernel.handlers[method];
    h.validate(params);
    return h.run(params, ctx);
  };
  const initial = await call('settings.ai.get', {}),
    provider = initial.providers.find((p) => p.id === 'openai');
  const saved = await call('settings.ai.saveProvider', {
    id: provider.id,
    revision: initial.revision,
    provider: {
      ...provider,
      enabled: true,
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      apiKey: 'synthetic-provider-secret',
    },
  });
  await call('ai.models', { input: { id: provider.id, revision: saved.revision } });
  assert.deepEqual(requests, ['/v1/models']);
  await kernel.close();
  const disk = fs
    .readdirSync(path.join(dir, 'logs'))
    .filter((x) => x.endsWith('.log'))
    .flatMap((x) =>
      fs
        .readFileSync(path.join(dir, 'logs', x), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
    );
  const row = disk.find((x) => x.message === `GET 127.0.0.1:${server.address().port}/v1/models`);
  assert(row, 'Real AI request must execute the installed tracer');
  assert.equal(row.level, 'INFO');
  assert.equal(row.context.status, 200);
  assert(Number.isInteger(row.context.durationMs));
  assert.doesNotMatch(JSON.stringify(disk), /synthetic-provider-secret/);
  record('http-kernel-integration', {
    requests,
    trace: normalize(row),
    realLoopbackServer: true,
    externalTraffic: false,
    realPrivateFileCredentials: true,
    systemCredentialsAccessed: false,
  });
});
