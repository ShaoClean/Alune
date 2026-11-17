const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const { main } = require('./main-diagnostics-fixture.cjs');
const { desktop, peer } = require('./startup-lifecycle-fixture.cjs');
const tick = () => new Promise(setImmediate);
const record = (name, value) => {
  if (process.env.P0_DIAGNOSTICS_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_DIAGNOSTICS_PROOF_DIR, name),
      JSON.stringify(value, null, 2) + '\n',
      { flag: 'wx' },
    );
};

test('P0 diagnostics early fatal exception retains the default nonzero process exit', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-diagnostics-crash-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const results = [];
  for (const mode of ['early-crash', 'ready-crash', 'broken-stderr']) {
    const r = spawnSync(
      process.execPath,
      [path.join(__dirname, 'main-diagnostics-fixture.cjs'), mode, dir],
      {
        encoding: 'utf8',
        timeout: 10000,
        env: { ...process.env, NODE_OPTIONS: '' },
      },
    );
    assert.equal(r.error, undefined);
    assert.equal(r.status, 1);
    assert.equal(r.signal, null);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /diagnostic crash sentinel/);
    assert.doesNotMatch(r.stderr, /Fixture did not reach|synthetic stderr unavailable/);
    if (mode !== 'broken-stderr') assert.match(r.stderr, /未捕获异常（uncaughtException）/);
    results.push({ mode, status: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr });
  }
  record('actual-crash-processes.json', results);
});

test('P0 diagnostics early rejection is visible before Agent readiness', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-diagnostics-rejection-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const r = spawnSync(
    process.execPath,
    [path.join(__dirname, 'main-diagnostics-fixture.cjs'), 'early-rejection', dir],
    {
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, NODE_OPTIONS: '' },
    },
  );
  assert.equal(r.error, undefined);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /未处理的 Promise 拒绝/);
  assert.match(r.stderr, /diagnostic early rejection sentinel/);
  record('actual-rejection-process.json', { status: r.status, stdout: r.stdout, stderr: r.stderr });
});

test('P0-BOOTSTRAP-0460 complete frozen entry has explicit diagnostics and lifecycle successors', async () => {
  assert(process.env.P0_DIAGNOSTICS_FROZEN, 'Use batch-09 driver');
  const source = fs.readFileSync(
    path.join(process.env.P0_DIAGNOSTICS_FROZEN, 'apps/server/src/main.ts'),
    'utf8',
  );
  const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  assert.equal(ast.statements.length, 5);
  const calls = [],
    p = new EventEmitter();
  const deps = {
    './bootstrap': {
      startServer: async () => {
        calls.push(['startServer']);
        return {
          enableShutdownHooks: () => calls.push(['shutdownHooks']),
          getUrl: async () => 'http://frozen.invalid',
        };
      },
    },
    './logging/logger': {
      logger: { error: (...a) => calls.push(['error', ...a]) },
      errorContext: (e) => ({ error: String(e) }),
    },
  };
  vm.runInNewContext(
    ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    {
      exports: {},
      process: p,
      console: { log: (value) => calls.push(['url', value]) },
      require(name) {
        assert(Object.hasOwn(deps, name));
        return deps[name];
      },
    },
  );
  const failure = new Error('frozen monitor cause');
  assert.equal(p.listenerCount('uncaughtException'), 0);
  assert.equal(p.listenerCount('uncaughtExceptionMonitor'), 1);
  p.emit('uncaughtExceptionMonitor', failure, 'unhandledRejection');
  await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['startServer'],
    ['error', 'process', '未捕获异常（unhandledRejection）', { error: String(failure) }],
    ['shutdownHooks'],
    ['url', 'Server running on http://frozen.invalid'],
  ]);
  record('main-responsibilities.json', {
    source: 'apps/server/src/main.ts',
    statements: ast.statements.map((s) => s.getText(ast)),
    calls,
    replacements: {
      monitor:
        'Synchronous stderr before async startup; default fatal exit kept, ready Agent log is best effort.',
      rejection:
        'Desktop intentionally keeps its established nonfatal unhandledRejection policy, now visible before ready. Old server default rejection crash is retired, not identical behavior.',
      startServer:
        'Independent private Agent plus loopback HTTP/IPC; full prior lifecycle and auth tests rebound this run.',
      shutdownHooks:
        'Real Agent EOF/SIGTERM/SIGINT cleanup and desktop close replace Nest shutdown hooks.',
      url: 'No URL console output on protocol stdout. Desktop origin used internally and startup logs go through native desktop.log.',
    },
    releaseEligible: false,
  });
});

test('P0 diagnostics whole main forwards ready errors to isolated Agent logs and survives logger refusal', async (t) => {
  const f = await desktop(t),
    service = await f.start();
  const log = peer(f, f.logs, await f.handlers.get('agent:open')(f.event(f.logs)));
  await log.initialize();
  const pending = [],
    fmain = main({ dataDir: f.root, service, pending, workspace: f.workspace, logs: f.logs });
  await tick();
  assert(fmain.calls.some((c) => c[0] === 'window-ready'));
  assert.equal(fmain.process.listenerCount('uncaughtException'), 0);
  assert.equal(fmain.process.listenerCount('uncaughtExceptionMonitor'), 1);
  fmain.process.emit(
    'uncaughtExceptionMonitor',
    new Error('ready fatal sentinel'),
    'uncaughtException',
  );
  fmain.process.emit('unhandledRejection', 'ready rejection sentinel');
  await Promise.all(pending);
  const entries = await log.recentLogs(50);
  for (const message of ['未捕获异常（uncaughtException）', '未处理的 Promise 拒绝'])
    assert(
      entries.some((e) => e.source === 'process' && e.level === 'ERROR' && e.message === message),
    );
  const rejection = entries.find((e) => e.message === '未处理的 Promise 拒绝');
  assert.equal(rejection.context.error, 'ready rejection sentinel');
  assert.match(
    entries.find((e) => e.message === '未捕获异常（uncaughtException）').context.error,
    /ready fatal sentinel$/,
  );
  assert.equal(fmain.stderr.length, 2);
  assert(fmain.stderr.every((e) => e.fd === 2));
  log.close();
  await service.close();
  await f.start();
  const persisted = peer(f, f.logs, await f.handlers.get('agent:open')(f.event(f.logs)));
  await persisted.initialize();
  assert(
    (await persisted.recentLogs(50)).some((e) => e.context?.error === 'ready rejection sentinel'),
  );
  persisted.close();
  let refusedProcessLogs = 0;
  const rejected = main({
    dataDir: f.root,
    service: {
      ...service,
      client: {
        request: (_method, params) => {
          if (params.source === 'process') refusedProcessLogs++;
          return Promise.reject(Error('synthetic logger refusal'));
        },
      },
    },
  });
  await tick();
  rejected.process.emit('unhandledRejection', 'logger refusal sentinel');
  rejected.process.emit('unhandledRejection', {
    toString() {
      throw Error('synthetic bad reason');
    },
  });
  await tick();
  assert.equal(refusedProcessLogs, 1);
  assert(rejected.stderr.some((e) => e.value.includes('logger refusal sentinel')));
  assert(rejected.stderr.some((e) => e.value.includes('[无法读取错误原因]')));
  assert(rejected.stderr.some((e) => e.value.includes('未处理的 Promise 拒绝')));
  assert(!rejected.calls.some((c) => c[0] === 'exit'));
  record('ready-diagnostics.json', {
    entries,
    stderr: fmain.stderr,
    persistedRejection: true,
    loggerRefusalContained: true,
    scope:
      'Full main executed with Electron/update doubles; real desktop HTTP/IPC/Agent/native and logs sessions, isolated SQLite and filesystem.',
  });
});
