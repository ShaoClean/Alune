// Complete TSX modules with explicit React/JSX/clipboard/desktop/transport stand-ins.
// No DOM, browser permissions, system clipboard or OS shell actions are performed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const protocol = require('@alune/protocol');
const root = path.resolve(__dirname, '../../..');
const frozen = () => {
  assert(process.env.P0_LOG_VIEWER_ACTIONS_FROZEN);
  return process.env.P0_LOG_VIEWER_ACTIONS_FROZEN;
};
function execute(file, imports, globals = {}) {
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
      ...globals,
      require(id) {
        assert(Object.hasOwn(imports, id), 'Unexpected module import: ' + id);
        return imports[id];
      },
    },
    { filename: file },
  );
  return module.exports;
}
// Minimal state/effect host executes the complete component and its real callbacks.
// UI widgets, React scheduling, sockets and Agent API are test doubles. No DOM/layout assertion.
function viewer(legacy = false, agentId = 'fixture-agent-a') {
  const controls = {
    selection: '',
    writes: [],
    clipboardError: null,
    bridgeCalls: [],
    bridgeError: null,
    timers: [],
    recentCalls: [],
    forbiddenCalls: [],
    socketEmits: [],
    registered: [],
    agentOff: 0,
    closeOff: 0,
    disconnected: 0,
  };
  const browserWindow = {
    addEventListener() {},
    removeEventListener() {},
    getSelection: () => ({ toString: () => controls.selection }),
    setTimeout(fn, ms) {
      controls.timers.push({ fn, ms });
      return controls.timers.length;
    },
  };
  const browserNavigator = {
    clipboard: {
      async writeText(value) {
        controls.writes.push(value);
        if (controls.clipboardError) throw controls.clipboardError;
      },
    },
  };
  const globals = { window: browserWindow, navigator: browserNavigator };
  const apiModule = execute(
    path.join(legacy ? frozen() : root, 'apps/web/src/api/logging.ts'),
    {
      '@alune/protocol': protocol,
      axios: {
        __esModule: true,
        default: {
          create() {
            return Object.fromEntries(
              ['get', 'put', 'post'].map((method) => [
                method,
                (...args) => {
                  controls.forbiddenCalls.push([method, args]);
                  throw Error('Unexpected HTTP');
                },
              ]),
            );
          },
          isAxiosError: () => false,
        },
      },
    },
    globals,
  );
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
  const closeListeners = new Set();
  let nextRead;
  const agent = {
    initialized: { agentId },
    onEvent(fn) {
      listeners.set('agent', fn);
      return () => {
        controls.agentOff++;
        listeners.delete('agent');
      };
    },
    onClose(fn) {
      closeListeners.add(fn);
      return () => {
        controls.closeOff++;
        closeListeners.delete(fn);
      };
    },
  };
  const socket = {
    on(name, fn) {
      controls.registered.push(name);
      listeners.set(name, fn);
    },
    emit(...args) {
      controls.socketEmits.push(args);
    },
    disconnect() {
      controls.disconnected++;
      listeners.clear();
    },
  };
  const api = {
    recent: async (limit) => {
      controls.recentCalls.push(limit);
      if (nextRead) {
        const read = nextRead;
        nextRead = undefined;
        return read;
      }
      return history;
    },
  };
  Object.assign(apiModule.loggingApi, api);
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
    '../api/logging': apiModule,
    '../api/ui-agent': { currentUiAgent: () => agent, observeUiAgent: () => () => {} },
    './log-history': cursorModule,
    '../logs.css': {},
    'socket.io-client': { io: () => socket },
  };
  const module = execute(
    path.join(legacy ? frozen() : root, 'apps/web/src/pages/LogViewerPage.tsx'),
    imports,
    globals,
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
    controls,
    render,
    settle,
    startPending(initial) {
      history = initial;
      render();
    },
    deferRecent() {
      let resolve, reject;
      nextRead = new Promise((a, b) => {
        resolve = a;
        reject = b;
      });
      return { resolve, reject };
    },
    setHistory(value) {
      history = value;
    },
    event(name, payload) {
      assert(listeners.has(name), name);
      listeners.get(name)(payload);
    },
    agentEvent(type, payload = {}) {
      assert(listeners.has('agent'));
      listeners.get('agent')({ type, ...payload });
    },
    closeEvent() {
      closeListeners.forEach((fn) => fn());
      render();
    },
    listenerCount() {
      return listeners.size + closeListeners.size;
    },
    hasButton(label) {
      return nodes(tree, (n) => n.props['aria-label'] === label).length === 1;
    },
    setBridge(enabled) {
      browserWindow.aluneLogs = enabled
        ? {
            async openDirectory(...args) {
              controls.bridgeCalls.push(args);
              if (controls.bridgeError) throw controls.bridgeError;
              return '/fixture/private/logs';
            },
          }
        : undefined;
      render();
    },
    async click(label) {
      this.button(label).props.onClick();
      await settle();
    },
    change(label, value) {
      this.button(label).props.onChange(value);
      render();
    },
    toggleLevel(level) {
      const found = nodes(tree, (n) => n.type === 'button' && n.props.children?.[0] === level);
      assert.equal(found.length, 1);
      found[0].props.onClick();
      render();
    },
    notices() {
      return nodes(tree, (n) => n.props.role === 'status')
        .slice(1)
        .map((n) => n.props.children);
    },
    fireTimer(index) {
      controls.timers[index].fn();
      render();
    },
    removeClipboard() {
      delete browserNavigator.clipboard;
    },
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
      cleanup = [];
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

module.exports = { viewer };
