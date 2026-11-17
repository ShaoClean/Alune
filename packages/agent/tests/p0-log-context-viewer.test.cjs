// Complete frozen/current modules in a VM; explicit hook/JSX/transport stand-ins, no browser claim.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const ts = require('typescript');
const { LogStore } = require('../dist/adapters/logging/log-store');
const { diagnosticLogs } = require('../dist/modules/diagnostics/logs');
const { AgentState } = require('../dist/adapters/sqlite/state');
const { randomUUID } = require('node:crypto');
const protocol = require('@alune/protocol');
const root = path.resolve(__dirname, '../../..');
const plain = (x) => JSON.parse(JSON.stringify(x));
const frozen = () => {
  assert(process.env.P0_LOG_CONTEXT_VIEWER_FROZEN, 'Use batch-15 replay driver');
  return process.env.P0_LOG_CONTEXT_VIEWER_FROZEN;
};
function record(name, value) {
  if (process.env.P0_LOG_CONTEXT_VIEWER_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_LOG_CONTEXT_VIEWER_PROOF_DIR, name + '.json'),
      JSON.stringify(value, null, 2) + '\n',
      { flag: 'wx' },
    );
}
function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-batch15-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function execute(file, imports) {
  const source = fs.readFileSync(file, 'utf8');
  const module = { exports: {} };
  const output = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  vm.runInNewContext(
    output,
    {
      module,
      exports: module.exports,
      Error,
      Buffer,
      Date,
      URL,
      performance,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      process: { pid: process.pid, env: { NODE_ENV: 'test', ALUNE_DATA_DIR: 'UNUSED' }, once() {} },
      window: { addEventListener() {}, removeEventListener() {}, setTimeout },
      require(id) {
        assert(Object.hasOwn(imports, id), 'Unexpected module import: ' + id);
        return imports[id];
      },
    },
    { filename: file },
  );
  return module.exports;
}
function oldStore(t, dir) {
  const base = frozen();
  const shared = execute(path.join(base, 'packages/shared/src/types/logging.ts'), {});
  const redact = execute(path.join(base, 'apps/server/src/logging/redact.ts'), {});
  const { LogStore: Old } = execute(path.join(base, 'apps/server/src/logging/log-store.ts'), {
    'node:fs': fs,
    'node:path': path,
    '@alune/shared': shared,
    './redact': redact,
  });
  const store = new Old(dir);
  t.after(() => store.close());
  return store;
}
function row(index, context) {
  return {
    time: new Date(Date.UTC(2026, 10, 16) + index).toISOString(),
    level: 'INFO',
    source: 'fixture',
    message: 'record-' + index,
    ...(context ? { context } : {}),
  };
}
function disk(dir) {
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith('.log'))
    .flatMap((n) =>
      fs.readFileSync(path.join(dir, n), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse),
    );
}
// Minimal state/effect host executes the complete component and its real callbacks.
// UI widgets, React scheduling, sockets and Agent API are test doubles. No DOM/layout assertion.
function viewer(legacy = false) {
  const slots = [];
  let cursor = 0,
    pending = [],
    tree,
    history = [],
    cleanup = [];
  const listeners = new Map();
  let activeEffects = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const memo = (fn, deps) => {
    const i = cursor++;
    if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: fn(), deps };
    return slots[i].value;
  };
  const effect = (fn, deps) => {
    const i = cursor++;
    if (!slots[i] || !same(slots[i].deps, deps)) {
      slots[i] = { deps };
      pending.push(() => {
        activeEffects++;
        const off = fn();
        if (off) cleanup.push(off);
      });
    }
  };
  const react = {
    memo: (fn) => fn,
    useCallback: (fn, deps) => memo(() => fn, deps),
    useMemo: memo,
    useState(value) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { value: typeof value === 'function' ? value() : value };
      return [
        slots[i].value,
        (v) => {
          slots[i].value = typeof v === 'function' ? v(slots[i].value) : v;
        },
      ];
    },
    useRef(value) {
      const i = cursor++;
      return (slots[i] ??= { current: value });
    },
    useEffect: effect,
    useLayoutEffect: effect,
    useSyncExternalStore(_observe, get) {
      return get();
    },
  };
  const jsx = (type, props) => ({ type, props: props || {} });
  const agent = {
    initialized: { agentId: 'fixture-agent-a' },
    onEvent(fn) {
      listeners.set('agent', fn);
      return () => listeners.delete('agent');
    },
    onClose() {
      return () => {};
    },
  };
  const socket = {
    on(name, fn) {
      listeners.set(name, fn);
    },
    emit() {},
    disconnect() {
      listeners.clear();
    },
  };
  const api = { recent: async () => history };
  const cursorModule = execute(path.join(root, 'apps/web/src/pages/log-history.ts'), {});
  const imports = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@alune/ui': Object.fromEntries(
      ['AluneUIProvider', 'Button', 'Input', 'Select', 'Tooltip'].map((x) => [x, x]),
    ),
    '@ant-design/icons': Object.fromEntries(
      [
        'ArrowDownOutlined',
        'ClearOutlined',
        'CopyOutlined',
        'FolderOpenOutlined',
        'PauseOutlined',
        'CaretRightOutlined',
        'SearchOutlined',
      ].map((x) => [x, x]),
    ),
    '@alune/shared': protocol,
    '@alune/protocol': protocol,
    '../api/logging': {
      logBridge: () => undefined,
      loggingApi: api,
      loggingError: (_e, fallback) => fallback,
    },
    '../api/ui-agent': { currentUiAgent: () => agent, observeUiAgent: () => () => {} },
    './log-history': cursorModule,
    '../logs.css': {},
    'socket.io-client': { io: () => socket },
  };
  const module = execute(
    path.join(legacy ? frozen() : root, 'apps/web/src/pages/LogViewerPage.tsx'),
    imports,
  );
  function render() {
    cursor = 0;
    tree = module.LogViewerPage();
    const next = pending;
    pending = [];
    next.forEach((fn) => fn());
    return tree;
  }
  function nodes(node, predicate) {
    if (Array.isArray(node)) return node.flatMap((x) => nodes(x, predicate));
    if (!node || typeof node !== 'object') return [];
    return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
  }
  async function settle() {
    await new Promise(setImmediate);
    render();
  }
  return {
    ...module,
    async start(initial) {
      history = initial;
      render();
      await settle();
    },
    async append(incoming) {
      if (legacy) listeners.get('log:entries')(incoming);
      else {
        history = incoming;
        listeners.get('agent')({ type: 'diagnostics.logs.changed' });
      }
      await settle();
    },
    entries() {
      return nodes(tree, (n) => typeof n.type === 'function' && n.type.name === 'LogLine').map(
        (n) => n.props.entry,
      );
    },
    button(label) {
      const found = nodes(tree, (n) => n.props['aria-label'] === label);
      assert.equal(found.length, 1);
      return found[0];
    },
    pause() {
      this.button('暂停').props.onClick();
      render();
    },
    resume() {
      this.button('继续').props.onClick();
      render();
    },
    close() {
      cleanup.reverse().forEach((fn) => fn());
    },
    effectCount: () => activeEffects,
    status() {
      const found = nodes(tree, (n) => n.props.role === 'status');
      assert.equal(found.length, 1);
      return found[0].props.children;
    },
    footer() {
      const footer = nodes(tree, (n) => n.type === 'footer')[0];
      function text(n) {
        return Array.isArray(n)
          ? n.map(text).join('')
          : n && typeof n === 'object'
            ? text(n.props?.children)
            : (n ?? '');
      }
      return text(footer);
    },
  };
}

test('P0 LogContext frozen alias and current store tracer and protocol accept the same unknown record boundary', (t) => {
  const source = fs.readFileSync(path.join(frozen(), 'apps/server/src/logging/logger.ts'), 'utf8');
  const ast = ts.createSourceFile('logger.ts', source, ts.ScriptTarget.Latest, true);
  const aliases = ast.statements.filter(
    (s) => ts.isTypeAliasDeclaration(s) && s.name.text === 'LogContext',
  );
  assert.equal(aliases.length, 1);
  const declaration = aliases[0].getText(ast);
  const dir = scratch(t),
    file = path.join(dir, 'context-contract.ts');
  const body = `${declaration}
import type { LogStore } from ${JSON.stringify(path.join(root, 'packages/agent/dist/adapters/logging/log-store'))};
import type { createHttpTracer } from ${JSON.stringify(path.join(root, 'packages/agent/dist/adapters/logging/http-trace'))};
import type { LogEntry } from ${JSON.stringify(path.join(root, 'packages/protocol/dist/index'))};
type StoreContext = NonNullable<Parameters<LogStore['write']>[3]>;
type TraceContext = NonNullable<Parameters<Parameters<typeof createHttpTracer>[0]>[3]>;
type EntryContext = NonNullable<LogEntry['context']>;
type Equal<A,B> = (<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2) ? true : false;
type Assert<T extends true> = T;
type Store = Assert<Equal<LogContext,StoreContext>>;
type Trace = Assert<Equal<LogContext,TraceContext>>;
type Entry = Assert<Equal<LogContext,EntryContext>>;
const samples: LogContext[] = [{}, {nested:{x:1}, array:[1,null], error:new Error('fixture'), integer:1n, fn:()=>1, absent:undefined}];
for (const value of samples) { const a:StoreContext=value; const b:TraceContext=a; const c:EntryContext=b; const d:LogContext=c; }
// @ts-expect-error scalars are not contexts
const badText:LogContext='text';
// @ts-expect-error arrays lack the string index signature
const badArray:StoreContext=[];
// @ts-expect-error null is not an entry context
const badNull:EntryContext=null;
// @ts-expect-error unknown values must be narrowed before use
const badRead:string=({} as StoreContext).value;
`;
  fs.writeFileSync(file, body);
  const program = ts.createProgram([file], {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    ignoreDeprecations: '6.0',
    typeRoots: [path.join(root, 'node_modules/@types')],
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.deepEqual(
    diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')),
    [],
  );
  record('context-type-contract', {
    compiler: ts.version,
    frozenAlias: declaration,
    currentBoundaries: [
      'LogStore.write fourth argument',
      'createHttpTracer writer fourth argument',
      'LogEntry.context',
    ],
    equalityAssertions: 3,
    requiredRejections: 4,
    fixture: body,
    diagnostics: [],
  });
});

test('P0 LogContext unknown values normalize redact and persist without mutating callers', async (t) => {
  const dir = scratch(t),
    old = oldStore(t, path.join(dir, 'old'));
  const state = await AgentState.open(path.join(dir, 'next'), randomUUID());
  const next = diagnosticLogs(path.join(dir, 'next'), state.document('logging-settings'));
  t.after(async () => {
    next.close();
    await state.close();
  });
  const error = Object.assign(new Error('request failed password=fixture-error-secret'), {
    code: 'E_FIXTURE',
  });
  const cycle = {};
  cycle.self = cycle;
  const context = {
    text: '中文',
    nested: { ok: 42, token: 'fixture-nested-private' },
    token: 'fixture-private',
    array: [null, true, 1n, Infinity, NaN, undefined],
    absent: undefined,
    error,
    cycle,
    fn: () => 'x',
  };
  old.write('ERROR', 'context', 'probe', context);
  next.logs.write('ERROR', 'context', 'probe', context);
  const oldRow = plain(old.recent(1)[0]),
    newRow = plain(next.logs.recent(1)[0]);
  delete oldRow.time;
  delete newRow.time;
  assert.deepEqual(newRow, oldRow);
  assert.equal(newRow.context.token, '[REDACTED]');
  assert.equal(newRow.context.nested.token, '[REDACTED]');
  assert.equal(newRow.context.error.code, 'E_FIXTURE');
  assert.doesNotMatch(newRow.context.error.message, /fixture-error-secret/);
  assert.deepEqual(newRow.context.array, [null, true, '1', null, null, null]);
  assert.equal(newRow.context.cycle.self, '[Circular]');
  assert.equal(context.token, 'fixture-private');
  assert.equal(context.nested.token, 'fixture-nested-private');
  assert.equal(cycle.self, cycle);
  old.flush();
  next.logs.flush();
  const persisted = disk(path.join(dir, 'next', 'logs'));
  assert.deepEqual(persisted[0].context, newRow.context);
  assert.doesNotMatch(
    JSON.stringify(persisted),
    /fixture-private|fixture-nested-private|fixture-error-secret/,
  );
  record('context-runtime-contract', {
    normalized: newRow,
    inputUnmutated: true,
    realSQLite: true,
    liveDiskParity: true,
    scope:
      'local internal unknown-record normalization; transport remains JSON only, not bigint/function RPC inputs',
  });
});

test('P0 log formatLine matches frozen bytes for levels contexts error summaries Unicode and multiline records', (t) => {
  const old = viewer(true),
    next = viewer();
  t.after(() => {
    old.close();
    next.close();
  });
  const base = { time: '2026-11-16T00:00:00.123Z', source: '模块', message: '消息\nnext' };
  const contexts = [
    undefined,
    {},
    { request: 'a', count: 0, ok: false, nil: null, array: [1, '中'], nested: { n: 2 } },
    { error: 'failure', stack: 'private stack' },
    { error: { name: 'Error', message: 'failed', stack: 'hidden' }, stack: 'hidden', attempt: 2 },
    { error: { code: 'E_ONLY' } },
    { error: '', stack: 'hidden' },
  ];
  const results = [];
  for (const level of ['DEBUG', 'INFO', 'WARN', 'ERROR'])
    for (const context of contexts) {
      const entry = { ...base, level, ...(context ? { context } : {}) };
      const expectedDetails =
        context === contexts[2]
          ? 'request=a count=0 ok=false nil=null array=[1,"中"] nested={"n":2}'
          : context === contexts[3]
            ? 'failure'
            : context === contexts[4]
              ? 'attempt=2 failed'
              : '';
      const expected = `${base.time} ${level.padEnd(5)} [模块] 消息\nnext${expectedDetails ? '  ' + expectedDetails : ''}`;
      assert.equal(old.formatLine(entry), expected);
      assert.equal(next.formatLine(entry), expected);
      assert.doesNotMatch(next.formatLine(entry), /private stack|hidden|E_ONLY/);
      results.push({ entry, expected });
    }
  record('viewer-format-contract', {
    cases: results.length,
    results,
    scope:
      'complete module exports executed, exact line serialization; no clipboard or browser interaction claimed',
  });
});

test('P0 log viewer display cap retains latest five thousand live and paused rows at exact boundaries', async (t) => {
  const old = viewer(true),
    next = viewer();
  t.after(() => {
    old.close();
    next.close();
  });
  assert.equal(old.MAX_VISIBLE_ENTRIES, 5000);
  assert.equal(next.MAX_VISIBLE_ENTRIES, 5000);
  let index = 0,
    expected = [],
    paused = [];
  const steps = [];
  const make = (n) => Array.from({ length: n }, () => row(index++));
  const check = (label) => {
    for (const app of [old, next]) {
      assert.deepEqual(
        plain(app.entries()).map(({ id, ...entry }) => entry),
        expected,
      );
      assert.equal(new Set(app.entries().map((e) => e.id)).size, expected.length);
      assert.match(app.footer(), new RegExp(`显示 ${expected.length} / ${expected.length} 条`));
      assert.equal(app.footer().includes('最多保留最近 5000 条'), expected.length >= 5000);
    }
    steps.push({
      label,
      count: expected.length,
      first: expected[0]?.message,
      last: expected.at(-1)?.message,
    });
  };
  const initial = make(999);
  expected = initial;
  await old.start(initial);
  await next.start(initial);
  check('history 999');
  for (const count of [1000, 1000, 1000, 1000, 1, 1, 1000]) {
    const rows = make(count);
    expected = [...expected, ...rows].slice(-5000);
    await old.append(rows);
    await next.append(rows);
    check('append ' + count);
  }
  old.pause();
  next.pause();
  for (const count of [1000, 1000, 1000, 1000, 999, 1, 1, 1000]) {
    const rows = make(count);
    paused = [...paused, ...rows].slice(-5000);
    await old.append(rows);
    await next.append(rows);
    check('paused append ' + count);
    for (const app of [old, next]) assert.equal(app.status(), `已暂停 · ${paused.length} 条待显示`);
  }
  expected = [...expected, ...paused].slice(-5000);
  old.resume();
  next.resume();
  check('resume latest bounded queue');
  assert.equal(expected.length, 5000);
  assert.equal(expected[0].message, 'record-' + (index - 5000));
  record('viewer-cap-contract', {
    maximum: 5000,
    steps,
    finalReceived: index,
    oldestRetained: index - 5000,
    uniqueRowIds: true,
    currentSnapshotFixtureMaximum: 1000,
    harness:
      'complete TSX modules with state/effect/JSX and transport stand-ins; real callbacks, no DOM or browser scheduler claim',
  });
});

test('P0 log viewer cap is display-only and cannot truncate persisted diagnostic records', (t) => {
  const dir = scratch(t),
    store = new LogStore(dir);
  t.after(() => store.close());
  const next = viewer();
  t.after(() => next.close());
  assert.equal(next.MAX_VISIBLE_ENTRIES, 5000);
  for (let i = 0; i < 6005; i++) store.write('INFO', 'cap-proof', 'disk-' + i, { index: i });
  store.flush();
  const persisted = disk(path.join(dir, 'logs'));
  assert.equal(persisted.length, 6005);
  assert.deepEqual(
    persisted.map((e) => e.message),
    Array.from({ length: 6005 }, (_, i) => 'disk-' + i),
  );
  assert(store.recent().length <= protocol.LOGGING_LIMITS.history);
  record('viewer-disk-contract', {
    displayCap: next.MAX_VISIBLE_ENTRIES,
    written: 6005,
    persisted: 6005,
    ordered: true,
    scope:
      'actual store disk retention independent from executed component cap; not end-to-end UI transport throughput/performance',
  });
});

test('P0 LogContext diagnostic snapshots remain owner scoped and cancellation has no side effects', async (t) => {
  const dir = scratch(t);
  async function owner(name) {
    const agentId = randomUUID(),
      directory = path.join(dir, name);
    const state = await AgentState.open(directory, agentId);
    const mod = diagnosticLogs(directory, state.document('logging-settings'));
    t.after(async () => {
      mod.close();
      await state.close();
    });
    const events = [],
      signal = new AbortController().signal;
    const context = {
      agentId,
      sessionId: randomUUID(),
      taskId: randomUUID(),
      signal,
      sessionSignal: signal,
      events: {
        notifyState(...args) {
          events.push(args);
        },
      },
    };
    function call(name, params, override = {}) {
      const h = mod.handlers['diagnostics.logs.' + name];
      h.validate(params);
      return h.run(params, { ...context, ...override });
    }
    return { ...mod, call, events };
  }
  const one = await owner('one'),
    two = await owner('two');
  const initial = one.call('settings');
  one.call('client', {
    message: 'owner-one',
    context: { token: 'fixture-owner-private', marker: 'one' },
  });
  two.call('client', { message: 'owner-two', context: { marker: 'two' } });
  const snapshot = one.call('snapshot', { limit: 1 }),
    args = { snapshotId: snapshot.snapshotId, index: 0 };
  const chunk = one.call('chunk', args);
  assert.throws(
    () => two.call('chunk', args),
    (e) => e.kind === 'not-found',
  );
  assert.throws(
    () => two.call('chunk', { ...args, agentId: 'spoof' }),
    (e) => e.kind === 'invalid-params',
  );
  const content = JSON.parse(Buffer.from(chunk.base64, 'base64').toString('utf8'));
  assert.equal(content[0].context.marker, 'one');
  assert.equal(content[0].context.token, '[REDACTED]');
  const stopped = new AbortController(),
    reason = new Error('fixture-cancel');
  stopped.abort(reason);
  const methods = [
    ['settings', undefined],
    ['saveSettings', { revision: initial.revision, settings: initial.settings }],
    ['snapshot', { limit: 1 }],
    ['chunk', args],
    ['release', { snapshotId: snapshot.snapshotId }],
    ['client', { message: 'cancelled', context: { marker: 'never' } }],
  ];
  const eventsBefore = plain(one.events),
    rowsBefore = plain(one.logs.recent());
  for (const [name, params] of methods)
    assert.throws(
      () => one.call(name, params, { signal: stopped.signal }),
      (e) => e === reason,
    );
  assert.deepEqual(one.call('settings'), initial);
  assert.deepEqual(plain(one.logs.recent()), rowsBefore);
  assert.deepEqual(plain(one.events), eventsBefore);
  assert.deepEqual(one.call('chunk', args), chunk, 'cancelled release keeps handle alive');
  one.close();
  two.call('client', { message: 'two-still-open' });
  assert.deepEqual(
    two.logs.recent().map((e) => e.message),
    ['owner-two', 'two-still-open'],
  );
  record('context-isolation-contract', {
    localOwners: 2,
    crossOwnerHandleRejected: true,
    identitySpoofRejected: true,
    cancelledMethods: methods.map(([n]) => n),
    originalReasonIdentity: true,
    noWriteOrNotification: true,
    cancelledReleasePreservesHandle: true,
    closingOneDoesNotCloseOther: true,
    scope: 'two real local SQLite owners; no SSH or runtime disconnect replay claim',
  });
});
