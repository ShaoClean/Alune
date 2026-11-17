// Retired framework adapter executes with an explicit ConsoleLogger spy.
// Current kernel receives already-normalized logs; no automatic Nest bridge is claimed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createHash, randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { openStateKernel } = require('../dist/bootstrap/state-kernel');
const root = path.resolve(__dirname, '../../..');
const baseline = '3c05f640fcc1a04c864e47bfc2880483ad48c984';
const file = 'apps/server/src/logging/nest-logger.ts';
const settings = { customDirectory: null, level: 'DEBUG', retentionDays: 14, maxTotalMB: 200 };
const plain = (v) => JSON.parse(JSON.stringify(v));
const identity = (row) => {
  const next = plain(row);
  delete next.time;
  return next;
};
function record(name, value) {
  if (process.env.P0_NEST_LOGGER_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_NEST_LOGGER_PROOF_DIR, name + '.json'),
      JSON.stringify(value, null, 2) + '\n',
      { flag: 'wx' },
    );
}
function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-batch24-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function legacy(t, directory) {
  assert(process.env.P0_NEST_LOGGER_FROZEN, 'Use batch-24 replay driver');
  const modules = new Map(),
    calls = [],
    order = [],
    exits = [];
  class ConsoleLogger {}
  for (const method of ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'])
    ConsoleLogger.prototype[method] = function (...args) {
      calls.push({ method, args });
      order.push('console:' + method);
    };
  function load(name) {
    if (modules.has(name)) return modules.get(name);
    const source = fs.readFileSync(path.join(process.env.P0_NEST_LOGGER_FROZEN, name), 'utf8');
    assert.equal(
      source,
      execFileSync('git', ['show', baseline + ':' + name], { cwd: root, encoding: 'utf8' }),
    );
    const result = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    });
    const module = { exports: {} };
    const deps = {
      'node:fs': fs,
      'node:path': path,
      'node:os': {
        homedir() {
          throw Error('No user home access');
        },
        tmpdir() {
          throw Error('Explicit data directory required');
        },
      },
      '@nestjs/common': { ConsoleLogger },
    };
    vm.runInNewContext(
      result.outputText,
      {
        module,
        exports: module.exports,
        Error,
        Date,
        Buffer,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        process: {
          pid: process.pid,
          env: { ALUNE_DATA_DIR: directory, NODE_ENV: 'test' },
          once(event, cb) {
            assert.equal(event, 'exit');
            exits.push(cb);
          },
        },
        require(id) {
          if (Object.hasOwn(deps, id)) return deps[id];
          if (id === '@alune/shared') return load('packages/shared/src/types/logging.ts');
          if (id.startsWith('./'))
            return load(path.posix.join(path.posix.dirname(name), id + '.ts'));
          throw Error('Unreviewed dependency: ' + id);
        },
      },
      { filename: name },
    );
    modules.set(name, module.exports);
    return module.exports;
  }
  const { AluneNestLogger } = load(file);
  const api = load('apps/server/src/logging/logger.ts');
  const store = api.logStore();
  store.update(settings);
  store.subscribe(() => order.push('record'));
  t.after(() => api.setLogStore(undefined));
  return {
    logger: new AluneNestLogger(),
    AluneNestLogger,
    ConsoleLogger,
    calls,
    order,
    exits,
    store,
    api,
  };
}
async function successor(t, directory, agentId = randomUUID(), configure = true) {
  const kernel = await openStateKernel(directory, agentId, undefined, { backend: 'file' });
  t.after(() => kernel.close());
  const notifications = [];
  const signal = new AbortController().signal;
  const context = {
    signal,
    sessionSignal: signal,
    taskId: randomUUID(),
    events: {
      notifyState(...args) {
        notifications.push(args);
      },
    },
  };
  function call(name, params, overrides = {}) {
    const handler = kernel.handlers['diagnostics.logs.' + name];
    handler.validate(params);
    return handler.run(params, { ...context, ...overrides });
  }
  function write(row) {
    const handler = kernel.desktopHandlers['desktop.log'];
    handler.validate(row);
    assert.equal(handler.run(row, context), null);
  }
  function recent() {
    const snapshot = call('snapshot', { limit: 1000 });
    const chunks = Array.from({ length: snapshot.chunks }, (_, index) =>
      Buffer.from(call('chunk', { snapshotId: snapshot.snapshotId, index }).base64, 'base64'),
    );
    call('release', { snapshotId: snapshot.snapshotId });
    return JSON.parse(Buffer.concat(chunks).toString('utf8')).map(identity);
  }
  const initial = call('settings');
  if (configure) call('saveSettings', { revision: initial.revision, settings });
  const initialRows = recent();
  if (configure) {
    assert.equal(initialRows.at(-1).source, 'logging');
    assert.equal(initialRows.at(-1).message, '日志设置已更新');
    assert.equal(initialRows.at(-1).context.directory, path.join(directory, 'logs'));
  }
  return { kernel, call, write, recent, notifications, initialRows };
}
function disk(directory) {
  return fs
    .readdirSync(path.join(directory, 'logs'))
    .filter((f) => f.endsWith('.log'))
    .flatMap((f) =>
      fs
        .readFileSync(path.join(directory, 'logs', f), 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(JSON.parse),
    )
    .map(identity);
}

test('P0 Nest logger entire frozen source and class include every private helper and public override', (t) => {
  const old = legacy(t, scratch(t));
  const source = fs.readFileSync(path.join(process.env.P0_NEST_LOGGER_FROZEN, file), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  assert.deepEqual(
    ast.statements.map((s) => ts.SyntaxKind[s.kind]),
    [
      'ImportDeclaration',
      'ImportDeclaration',
      'ImportDeclaration',
      'FunctionDeclaration',
      'ClassDeclaration',
    ],
  );
  assert.equal(ast.statements[3].name.text, 'text');
  const klass = ast.statements[4];
  assert.equal(klass.name.text, 'AluneNestLogger');
  assert.deepEqual(
    klass.members.map((m) => m.name.text),
    ['record', 'log', 'error', 'warn', 'debug', 'verbose', 'fatal'],
  );
  assert(old.logger instanceof old.ConsoleLogger);
  assert.deepEqual(Object.getOwnPropertyNames(old.AluneNestLogger.prototype), [
    'constructor',
    'record',
    'log',
    'error',
    'warn',
    'debug',
    'verbose',
    'fatal',
  ]);
  assert.equal(old.exits.length, 1);
  assert.equal(old.api.logStore(), old.store);
  record('nest-source-inventory', {
    baseline,
    file,
    sha256: createHash('sha256').update(source).digest('hex'),
    imports: ['@nestjs/common', '@alune/shared (type only)', './logger'],
    helper: 'text',
    members: klass.members.map((m) => m.name.text),
    console: 'Explicit spy; actual Nest rendering is not tested',
  });
});

test('P0 Nest record normalizes all message kinds and documents serialization and severity failures', (t) => {
  const old = legacy(t, scratch(t));
  const cases = [
    [new Error('error 中文'), 'error 中文'],
    ['raw\r\n\0', 'raw\r\n\0'],
    [{ ok: 1 }, '{"ok":1}'],
    [[1, true], '[1,true]'],
    [null, 'null'],
    [42, '42'],
    [false, 'false'],
  ];
  for (const [message, expected] of cases) {
    old.logger.record('INFO', message, 'Fixture', 'safe-stack');
    assert.deepEqual(identity(old.store.recent().at(-1)), {
      level: 'INFO',
      source: 'nest:Fixture',
      message: expected,
      context: { stack: 'safe-stack' },
    });
  }
  for (const context of [undefined, '']) {
    old.logger.record('WARN', 'plain', context, '');
    assert.deepEqual(identity(old.store.recent().at(-1)), {
      level: 'WARN',
      source: 'nest',
      message: 'plain',
    });
  }
  const circular = {};
  circular.self = circular;
  const count = old.store.recent().length;
  for (const value of [undefined, Symbol('x'), () => 1]) {
    assert.doesNotThrow(() => old.logger.record('INFO', value));
    assert.equal(old.store.recent().length, count);
  }
  for (const bad of [
    1n,
    circular,
    {
      toJSON() {
        throw Error('fixture serialization');
      },
    },
  ])
    assert.throws(() => old.logger.record('INFO', bad));
  assert.throws(() => old.logger.record('TRACE', 'invalid-level'));
  assert.equal(old.store.recent().length, count);
  assert.deepEqual(old.calls, []);
  record('nest-record-matrix', {
    recordedMessageCases: cases.length,
    emptyContextCases: 2,
    silentlyDropped: ['undefined', 'symbol', 'function'],
    rejectedWithoutRows: ['bigint', 'cycle', 'throwing toJSON', 'unsupported private severity'],
    limitation:
      'Undefined/symbol/function serialize to undefined; actual frozen logger catches LogStore string-redactor failure and records no row. Successor RPC requires a string. Old serialization failures are documented, not made a new RPC contract.',
  });
});

test('P0 Nest log demotes exactly the five framework contexts and retains explicit console argument order', (t) => {
  const old = legacy(t, scratch(t));
  const cases = [
    undefined,
    '',
    'Application',
    'routerexplorer',
    'RouterExplorer',
    'RoutesResolver',
    'InstanceLoader',
    'WebSocketsController',
    'NestFactory',
    'prefixRouterExplorerSuffix',
  ];
  const rows = [];
  for (const context of cases) {
    const start = old.order.length;
    old.logger.log('startup', context);
    assert.deepEqual(old.calls.at(-1), {
      method: 'log',
      args: context ? ['startup', context] : ['startup'],
    });
    assert.deepEqual(old.order.slice(start), ['console:log', 'record']);
    const level =
      context &&
      /RouterExplorer|RoutesResolver|InstanceLoader|WebSocketsController|NestFactory/.test(context)
        ? 'DEBUG'
        : 'INFO';
    const row = identity(old.store.recent().at(-1));
    assert.deepEqual(row, {
      level,
      source: context ? 'nest:' + context : 'nest',
      message: 'startup',
    });
    rows.push({ context: context ?? null, row });
  }
  old.store.update({ ...settings, level: 'INFO' });
  const before = old.store.recent().length;
  old.logger.log('filtered-startup', 'RouterExplorer');
  assert.equal(old.store.recent().length, before);
  assert.deepEqual(old.calls.at(-1), {
    method: 'log',
    args: ['filtered-startup', 'RouterExplorer'],
  });
  record('nest-log-routing', {
    rows,
    infoThresholdFiltersStartup: true,
    consoleRetainedBeforeFiltering: true,
    successor:
      'No Nest startup contexts emitted in Agent; explicit DEBUG filtering verified separately',
  });
});

test('P0 Nest error preserves independent stack and context optional arguments and records redacted stack', (t) => {
  const old = legacy(t, scratch(t));
  const cases = [
    [undefined, undefined],
    ['', ''],
    ['stack', undefined],
    [undefined, 'Scope'],
    ['stack', 'Scope'],
  ];
  for (const [stack, context] of cases) {
    old.logger.error(new Error('failed'), stack, context);
    const call = old.calls.at(-1);
    assert.equal(call.method, 'error');
    assert.equal(call.args[0].message, 'failed');
    assert.deepEqual(
      call.args.slice(1),
      [stack, context].filter((v) => v !== undefined),
    );
    assert.deepEqual(identity(old.store.recent().at(-1)), {
      level: 'ERROR',
      source: context ? 'nest:' + context : 'nest',
      message: 'failed',
      ...(stack ? { context: { stack } } : {}),
    });
    assert.deepEqual(old.order.slice(-2), ['console:error', 'record']);
  }
  old.logger.error('password=fixture-secret', 'Bearer fixture-stack-secret', 'ErrorContext');
  assert.doesNotMatch(JSON.stringify(old.store.recent()), /fixture-secret|fixture-stack-secret/);
  record('nest-error-routing', {
    optionalPairs: cases,
    messageErrorUsesMessage: true,
    consoleOriginalArguments: true,
    fileMessageAndStackRedacted: true,
    consoleRedaction: 'Not claimed; ConsoleLogger is an explicit spy',
  });
});

test('P0 Nest warn debug verbose and fatal retain exact levels context and failure ordering', (t) => {
  const old = legacy(t, scratch(t));
  const methods = { warn: 'WARN', debug: 'DEBUG', verbose: 'DEBUG', fatal: 'ERROR' };
  for (const [method, level] of Object.entries(methods))
    for (const context of [undefined, '', 'Scope']) {
      old.logger[method]('message', context);
      assert.deepEqual(old.calls.at(-1), {
        method,
        args: context ? ['message', context] : ['message'],
      });
      assert.deepEqual(old.order.slice(-2), ['console:' + method, 'record']);
      assert.deepEqual(identity(old.store.recent().at(-1)), {
        level,
        source: context ? 'nest:' + context : 'nest',
        message: 'message',
      });
    }
  const count = old.store.recent().length;
  const circular = {};
  circular.self = circular;
  assert.throws(() => old.logger.fatal(circular));
  assert.equal(old.calls.at(-1).args[0], circular);
  assert.equal(old.store.recent().length, count);
  const failure = Error('console refused');
  const original = old.ConsoleLogger.prototype.warn;
  old.ConsoleLogger.prototype.warn = () => {
    throw failure;
  };
  assert.throws(
    () => old.logger.warn('not-written'),
    (e) => e === failure,
  );
  assert.equal(old.store.recent().length, count);
  old.ConsoleLogger.prototype.warn = original;
  const write = old.store.write;
  old.store.write = () => {
    throw Error('disk spy failure');
  };
  assert.doesNotThrow(() => old.logger.warn('logger contains store failure'));
  old.store.write = write;
  record('nest-override-routing', {
    methods,
    contextCasesPerMethod: 3,
    consoleBeforeRecord: true,
    fatalDoesNotExitProcess: true,
    failures: [
      'text serialization throws after console',
      'console error aborts record',
      'actual frozen logger contains store-write failure',
    ],
    successor: 'verbose/fatal aliases retired; current callers use DEBUG/ERROR',
  });
});

test('P0 Nest migrated recording uses production kernel levels redaction disk filtering and restart without framework console', async (t) => {
  const directory = scratch(t),
    old = legacy(t, path.join(directory, 'old'));
  const nextDir = path.join(directory, 'next'),
    agentId = randomUUID();
  const next = await successor(t, nextDir, agentId);
  assert.equal(next.kernel.handlers['desktop.log'], undefined);
  assert.equal(next.kernel.desktopHandlers['desktop.log'].durable, false);
  const rows = [
    { level: 'INFO', source: 'nest', message: 'plain 中文\r\n\0' },
    { level: 'DEBUG', source: 'nest:RouterExplorer', message: 'startup' },
    { level: 'WARN', source: 'nest:Scope', message: '{"ok":1}' },
    {
      level: 'ERROR',
      source: 'nest:ErrorContext',
      message: 'password=fixture-kernel-secret',
      context: { stack: 'Bearer fixture-kernel-stack' },
    },
  ];
  for (const row of rows) {
    old.logger.record(
      row.level,
      row.message,
      row.source === 'nest' ? undefined : row.source.slice(5),
      row.context?.stack,
    );
    next.write(row);
  }
  assert.deepEqual(
    next.recent().slice(next.initialRows.length),
    plain(old.store.recent()).map(identity).slice(1),
  );
  const expected = next.recent();
  for (const bad of [
    { ...rows[0], level: 'TRACE' },
    { ...rows[0], message: {} },
    { ...rows[0], source: null },
    null,
  ])
    assert.throws(
      () => next.write(bad),
      (e) => e.code === 'invalid-params' || e.kind === 'invalid-params',
    );
  assert.deepEqual(next.recent(), expected);
  const initial = next.call('settings');
  next.call('saveSettings', {
    revision: initial.revision,
    settings: { ...settings, level: 'INFO' },
  });
  const beforeFilteredWrite = next.recent();
  assert.equal(beforeFilteredWrite.at(-1).source, 'logging');
  assert.equal(beforeFilteredWrite.at(-1).context.level, 'INFO');
  next.write({ level: 'DEBUG', source: 'agent', message: 'filtered-debug' });
  assert.deepEqual(next.recent(), beforeFilteredWrite);
  await next.kernel.close();
  assert.deepEqual(disk(nextDir), beforeFilteredWrite);
  assert.doesNotMatch(
    JSON.stringify(disk(nextDir)),
    /fixture-kernel-secret|fixture-kernel-stack|filtered-debug/,
  );
  const reopened = await successor(t, nextDir, agentId, false);
  assert.deepEqual(reopened.recent(), beforeFilteredWrite);
  assert.equal(reopened.call('settings').settings.level, 'INFO');
  assert.equal(next.notifications.length > 0, true);
  record('nest-successor-kernel', {
    retainedRows: expected,
    malformedRejected: 4,
    filteredDebug: true,
    actualDiskAndRestart: true,
    privateDesktopLogOnly: true,
    durable: false,
    mappingBoundary:
      'Test supplies normalized strings/DEBUG or ERROR explicitly to actual production desktop handler. No Nest class, ConsoleLogger, startup demotion, verbose/fatal or object serializer exists in successor; no compatibility shim added.',
    cancellationBoundary:
      'desktop.log is a trusted internal handler; its run alone is not a cancellation boundary. Public diagnostics pre-cancellation is tested separately.',
  });
});

test('P0 Nest successor diagnostics isolate owners snapshot handles and pre-cancelled writes without invented retry', async (t) => {
  const directory = scratch(t);
  const one = await successor(t, path.join(directory, 'one'));
  const two = await successor(t, path.join(directory, 'two'));
  one.write({ level: 'ERROR', source: 'owner-one', message: 'one' });
  two.write({ level: 'WARN', source: 'owner-two', message: 'two' });
  const snapshot = one.call('snapshot', { limit: 10 });
  assert.throws(
    () => two.call('chunk', { snapshotId: snapshot.snapshotId, index: 0 }),
    (e) => e.kind === 'not-found',
  );
  const stopped = new AbortController(),
    reason = Error('cancelled-before-diagnostic-write');
  stopped.abort(reason);
  assert.throws(
    () => one.call('client', { message: 'never-recorded' }, { signal: stopped.signal }),
    (e) => e === reason,
  );
  assert.deepEqual(one.recent(), [
    ...one.initialRows,
    { level: 'ERROR', source: 'owner-one', message: 'one' },
  ]);
  assert.deepEqual(two.recent(), [
    ...two.initialRows,
    { level: 'WARN', source: 'owner-two', message: 'two' },
  ]);
  await one.kernel.close();
  two.write({ level: 'INFO', source: 'owner-two', message: 'still-open' });
  assert.deepEqual(
    two.recent().map((r) => r.message),
    ['日志设置已更新', 'two', 'still-open'],
  );
  record('nest-successor-owners', {
    owners: 2,
    crossOwnerSnapshotRefused: true,
    preCancelledPublicWritePreservesRows: true,
    independentClose: true,
    limitation:
      'Direct production kernels, not network/SSH. Ambiguous durable business-write no-replay is a same-run companion test, not a guarantee that log writes are durable or deduplicated after restart.',
  });
});
