// Electron is an explicit double; Agent, SQLite, HTTP/IPC and filesystem are real isolated fixtures.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createHash } = require('node:crypto');
const ts = require('typescript');
const { desktop, peer } = require('./startup-lifecycle-fixture.cjs');
const root = path.resolve(__dirname, '../../..');
const mainFile = 'apps/desktop/src/main.cjs';
const windowFile = 'apps/desktop/src/log-window.cjs';
const plain = (v) => JSON.parse(JSON.stringify(v));
const hash = (v) => createHash('sha256').update(v).digest('hex');
const origin = 'http://127.0.0.1:43111';
const event = (c) => ({ sender: c, senderFrame: c.mainFrame });
function record(name, value) {
  if (process.env.P0_NATIVE_LOG_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_NATIVE_LOG_PROOF_DIR, name + '.json'),
      JSON.stringify(value, null, 2) + '\n',
      { flag: 'wx' },
    );
}
function file(frozen, file) {
  if (frozen) assert(process.env.P0_NATIVE_LOG_FROZEN, 'Use batch-11 replay driver');
  return path.join(frozen ? process.env.P0_NATIVE_LOG_FROZEN : root, file);
}
function dependency(frozen, name) {
  if (!frozen) return require(path.join(root, 'apps/desktop/src', name));
  const sourceFile = file(true, 'apps/desktop/src/' + name),
    m = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(sourceFile, 'utf8'),
    {
      module: m,
      exports: m.exports,
      URL,
      console,
      require: (id) => {
        assert.equal(id, 'node:fs');
        return fs;
      },
    },
    { filename: sourceFile },
  );
  return m.exports;
}
function loadWindow(frozen = false, original = false) {
  const sourceFile = (original && process.env.P0_NATIVE_LOG_ORIGINAL) || file(frozen, windowFile);
  const m = { exports: {} };
  const deps = {
    'node:path': path,
    './external-links.cjs': dependency(frozen, 'external-links.cjs'),
  };
  vm.runInNewContext(
    fs.readFileSync(sourceFile, 'utf8'),
    {
      module: m,
      exports: m.exports,
      __dirname: path.join(root, 'apps/desktop/src'),
      process: { platform: 'darwin' },
      URL,
      require: (name) => {
        assert(Object.hasOwn(deps, name), name);
        return deps[name];
      },
    },
    { filename: sourceFile },
  );
  assert.deepEqual(Object.keys(m.exports), ['createLogWindow']);
  return m.exports.createLogWindow;
}
function windows(create, options = {}) {
  const created = [],
    effects = [],
    external = [];
  let currentOrigin = origin;
  class BrowserWindow extends EventEmitter {
    constructor(config) {
      super();
      this.config = config;
      this.destroyed = false;
      this.minimized = false;
      this.webContents = new EventEmitter();
      this.webContents.mainFrame = { url: origin + '/logs' };
      this.webContents.setWindowOpenHandler = (fn) => {
        this.link = fn;
      };
      created.push(this);
    }
    isDestroyed() {
      return this.destroyed;
    }
    isMinimized() {
      return this.minimized;
    }
    restore() {
      effects.push('restore');
      this.minimized = false;
    }
    show() {
      effects.push('show');
    }
    focus() {
      effects.push('focus');
    }
    close() {
      effects.push('close');
      this.destroyed = true;
      this.emit('closed');
    }
    loadURL(url) {
      effects.push(['loadURL', url]);
      return options.loadFailure
        ? Promise.reject(Error('synthetic load refusal'))
        : Promise.resolve();
    }
  }
  const log = create({
    BrowserWindow,
    getOrigin: () => currentOrigin,
    iconPath: '/synthetic/icon.png',
    openExternal: async (url) => external.push(url),
    ...options,
  });
  return {
    log,
    created,
    effects,
    external,
    setOrigin: (v) => {
      currentOrigin = v;
    },
  };
}
function handlers(frozen, globals = {}) {
  const source = fs.readFileSync(file(frozen, mainFile), 'utf8');
  const ast = ts.createSourceFile(mainFile, source, ts.ScriptTarget.Latest, true);
  const selected = [],
    registrations = [];
  let owner;
  function visit(node) {
    if (
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some((d) => d.name.getText(ast) === 'trustedLogSender')
    ) {
      selected.push(node);
      owner = node.parent;
    }
    if (
      ts.isExpressionStatement(node) &&
      ts.isCallExpression(node.expression) &&
      node.expression.expression.getText(ast) === 'ipcMain.handle' &&
      ts.isStringLiteral(node.expression.arguments[0]) &&
      node.expression.arguments[0].text.startsWith('logs:')
    ) {
      registrations.push(node);
      selected.push(node);
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'openLogDirectory')
      selected.push(node);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.deepEqual(
    registrations.map((n) => n.expression.arguments[0].text),
    ['logs:open-window', 'logs:open-directory', 'logs:choose-directory'],
  );
  assert.equal(owner.parent.name.text, 'start');
  assert(registrations.every((n) => n.parent === owner));
  assert.equal(selected.length, 5);
  const registered = new Map(),
    calls = [];
  const workspace = { mainFrame: { url: origin + '/settings' } },
    logs = { mainFrame: { url: origin + '/logs' } };
  const state = {
    result: { canceled: false, filePaths: ['/synthetic/选择目录'] },
    directory: '/synthetic/local-logs',
    shellError: '',
  };
  const warning = [];
  const context = {
    URL,
    Error,
    origin,
    window: { webContents: workspace },
    logWindow: { contents: () => logs, open: () => calls.push(['open-window']) },
    isTrustedWorkspaceSender: dependency(frozen, 'workspace-preferences.cjs')
      .isTrustedWorkspaceSender,
    ipcMain: {
      handle: (name, fn) => {
        assert(!registered.has(name));
        registered.set(name, fn);
      },
    },
    appLog: () => ({
      logStore: () => ({ settings: () => ({ directory: state.directory }) }),
      logger: { warn: (...args) => warning.push(plain(args)) },
    }),
    backend: {
      client: {
        getLoggingSettings: async () => {
          calls.push(['get-settings']);
          return { settings: { directory: state.directory } };
        },
      },
    },
    smokeTest: false,
    shell: {
      openPath: async (dir) => {
        calls.push(['openPath', dir]);
        return state.shellError;
      },
    },
    dialog: {
      showOpenDialog: async (parent, options) => {
        calls.push(['dialog', parent === context.window, plain(options)]);
        if (state.result instanceof Error) throw state.result;
        return state.result;
      },
    },
    ...globals,
  };
  const inventory = selected.map((n) => ({
    line: ast.getLineAndCharacterOfPosition(n.getStart(ast)).line + 1,
    sha256: hash(n.getText(ast)),
    text: n.getText(ast),
  }));
  vm.runInNewContext(selected.map((n) => n.getText(ast)).join('\n'), context, {
    filename: file(frozen, mainFile),
  });
  return { registered, workspace, logs, calls, warning, state, context, inventory };
}
function preload(invoke, frozen = false) {
  const exposed = {};
  vm.runInNewContext(fs.readFileSync(file(frozen, 'apps/desktop/src/preload.cjs'), 'utf8'), {
    process: { argv: [] },
    require: (name) => {
      assert.equal(name, 'electron');
      return {
        contextBridge: {
          exposeInMainWorld: (name, value) => {
            exposed[name] = value;
          },
        },
        ipcRenderer: { invoke },
      };
    },
  });
  return exposed.aluneLogs;
}
function invalidEvents(f) {
  return [
    {},
    { sender: {}, senderFrame: f.workspace.mainFrame },
    { sender: f.workspace, senderFrame: { url: origin + '/child' } },
    { sender: f.logs, senderFrame: { url: origin + '/logs' } },
    { sender: f.workspace, senderFrame: { url: 'https://foreign.invalid/' } },
    { sender: f.workspace, senderFrame: null },
  ];
}

test('P0 native log window rejects malformed navigation without throwing', () => {
  const f = windows(loadWindow(false, true)),
    w = f.log.open(),
    results = [];
  for (const kind of ['will-navigate', 'will-redirect']) {
    for (const url of [
      'not a URL',
      'http://[',
      '',
      'javascript:alert(1)',
      'file:///tmp/secret',
      'https://other.invalid/',
      origin + '.evil.invalid/',
    ]) {
      let prevented = 0;
      assert.doesNotThrow(
        () =>
          w.webContents.emit(
            kind,
            {
              preventDefault: () => {
                prevented++;
              },
            },
            url,
          ),
        'url=' + url,
      );
      assert.equal(prevented, 1);
      results.push({ kind, url, prevented });
    }
  }
  record('navigation-refusal', results);
});

test('P0-DIAGNOSTICS-0005 frozen and current whole log window preserve isolated lifecycle and security options', async () => {
  const evidence = [];
  for (const frozen of [true, false]) {
    const f = windows(loadWindow(frozen));
    assert.equal(f.log.contents(), null);
    f.log.close();
    f.setOrigin(undefined);
    assert.equal(f.log.open(), null);
    assert.equal(f.created.length, 0);
    f.setOrigin(origin);
    const a = f.log.open();
    assert.equal(f.log.contents(), a.webContents);
    const prefs = plain(a.config.webPreferences);
    assert.deepEqual(prefs, {
      preload: path.join(root, 'apps/desktop/src/preload.cjs'),
      partition: 'alune-desktop',
      ...(frozen ? {} : { additionalArguments: ['--alune-agent-ui'] }),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    });
    assert.deepEqual(plain(a.config), {
      title: 'Alune 日志',
      icon: '/synthetic/icon.png',
      width: 1040,
      height: 680,
      minWidth: 560,
      minHeight: 360,
      backgroundColor: '#171c27',
      show: false,
      autoHideMenuBar: false,
      webPreferences: prefs,
    });
    a.emit('ready-to-show');
    a.minimized = true;
    assert.equal(f.log.open(), a);
    assert.equal(f.created.length, 1);
    assert.deepEqual(f.effects.slice(-3), ['restore', 'show', 'focus']);
    for (const kind of ['will-navigate', 'will-redirect']) {
      let prevented = 0;
      a.webContents.emit(
        kind,
        {
          preventDefault: () => {
            prevented++;
          },
        },
        origin + '/logs?view=1',
      );
      assert.equal(prevented, 0);
      a.webContents.emit(
        kind,
        {
          preventDefault: () => {
            prevented++;
          },
        },
        'https://foreign.invalid/',
      );
      assert.equal(prevented, 1);
    }
    let prevented = 0;
    a.webContents.emit('will-attach-webview', {
      preventDefault: () => {
        prevented++;
      },
    });
    assert.equal(prevented, 1);
    for (const url of ['javascript:alert(1)', 'file:///tmp/private', 'not a URL'])
      assert.equal(a.link({ url }).action, 'deny');
    assert.equal(a.link({ url: 'https://example.invalid/help' }).action, 'deny');
    assert.deepEqual(f.external, ['https://example.invalid/help']);
    f.log.close();
    assert.equal(f.log.contents(), null);
    const b = f.log.open();
    assert.notEqual(a, b);
    a.emit('closed');
    assert.equal(f.log.contents(), b.webContents);
    b.destroyed = true;
    assert.equal(f.log.contents(), null);
    const c = f.log.open();
    assert.notEqual(b, c);
    const hidden = windows(loadWindow(frozen), { show: false, loadFailure: true });
    const h = hidden.log.open();
    h.emit('ready-to-show');
    h.minimized = true;
    hidden.log.open();
    assert.equal(hidden.created.length, 1);
    assert.deepEqual(hidden.effects, [['loadURL', origin + '/logs']]);
    await new Promise(setImmediate);
    evidence.push({
      frozen,
      options: plain(a.config),
      effects: f.effects,
      hiddenEffects: hidden.effects,
      staleClosePreservedReplacement: true,
    });
  }
  record('window-lifecycle', evidence);
});

test('P0-BOOTSTRAP-0012 exact native open-window handlers reject foreign frames and preserve preload results', async () => {
  const evidence = [];
  for (const frozen of [true, false]) {
    const w = windows(loadWindow(frozen)),
      f = handlers(frozen, { logWindow: w.log });
    const fn = f.registered.get('logs:open-window');
    for (const ev of invalidEvents(f)) assert.throws(() => fn(ev), /Log access denied/);
    assert.equal(w.created.length, 0);
    const bridge = preload((channel, ...args) => {
      assert.equal(args.length, 0);
      return Promise.resolve().then(() => f.registered.get(channel)(event(f.workspace)));
    }, frozen);
    assert.equal(await bridge.openWindow('/untrusted/path'), undefined);
    const first = w.created[0];
    assert.equal(fn(event(first.webContents)), undefined);
    assert.equal(w.created.length, 1);
    first.webContents.mainFrame.url = 'https://foreign.invalid/';
    assert.throws(() => fn(event(first.webContents)), /Log access denied/);
    first.webContents.mainFrame.url = origin + '/logs';
    w.log.close();
    assert.throws(() => fn(event(first.webContents)), /Log access denied/);
    f.workspace.mainFrame.url = 'bad url';
    assert.throws(() => fn(event(f.workspace)), /Log access denied/);
    f.workspace.mainFrame.url = origin;
    fn(event(f.workspace));
    assert.equal(w.created.length, 2);
    assert.throws(() => fn(event(first.webContents)), /Log access denied/);
    evidence.push({
      frozen,
      windowsCreated: w.created.length,
      inventory: f.inventory,
      staleAndForeignDenied: true,
    });
  }
  record('open-window-contract', evidence);
});

test('P0-BOOTSTRAP-0013 exact open-directory handlers retain results errors and local directory authority', async () => {
  const evidence = [];
  for (const frozen of [true, false]) {
    const f = handlers(frozen),
      fn = f.registered.get('logs:open-directory');
    for (const ev of invalidEvents(f)) await assert.rejects(fn(ev), /Log access denied/);
    assert.deepEqual(f.calls, []);
    assert.equal(await fn(event(f.workspace), '/renderer/injection'), f.state.directory);
    assert.equal(await fn(event(f.logs)), f.state.directory);
    assert.equal(f.calls.filter((c) => c[0] === 'openPath').length, 2);
    assert(f.calls.filter((c) => c[0] === 'openPath').every((c) => c[1] === f.state.directory));
    f.state.shellError = 'synthetic OS refusal';
    await assert.rejects(fn(event(f.workspace)), /无法打开日志目录：synthetic OS refusal/);
    assert.deepEqual(f.warning, [
      ['app', '无法打开日志目录', { directory: f.state.directory, error: f.state.shellError }],
    ]);
    const rejected = handlers(frozen, {
      shell: {
        openPath: async () => {
          throw Error('synthetic shell rejection');
        },
      },
    });
    await assert.rejects(
      rejected.registered.get('logs:open-directory')(event(rejected.workspace)),
      /synthetic shell rejection/,
    );
    const smoke = handlers(frozen, { smokeTest: true });
    assert.equal(
      await smoke.registered.get('logs:open-directory')(event(smoke.workspace)),
      smoke.state.directory,
    );
    assert.equal(
      smoke.calls.some((c) => c[0] === 'openPath'),
      false,
    );
    evidence.push({
      frozen,
      calls: f.calls,
      warning: f.warning,
      smokeShellCalls: 0,
      rendererPathIgnored: true,
    });
  }
  const failure = handlers(false, {
    backend: {
      client: {
        getLoggingSettings: async () => {
          throw Error('synthetic Agent read refusal');
        },
      },
    },
  });
  await assert.rejects(
    failure.registered.get('logs:open-directory')(event(failure.workspace)),
    /Agent read refusal/,
  );
  assert.deepEqual(failure.calls, []);
  record('open-directory-contract', evidence);
});

test('P0-BOOTSTRAP-0014 exact directory chooser accepts only workspace and never saves selected paths', async () => {
  const evidence = [];
  for (const frozen of [true, false]) {
    const f = handlers(frozen),
      fn = f.registered.get('logs:choose-directory');
    for (const ev of [...invalidEvents(f), event(f.logs)])
      await assert.rejects(fn(ev), /Log access denied/);
    assert.deepEqual(f.calls, []);
    for (const [result, expected] of [
      [{ canceled: true, filePaths: ['/ignored'] }, null],
      [{ canceled: false, filePaths: [] }, null],
      [{ canceled: false, filePaths: [''] }, null],
      [{ canceled: false, filePaths: ['/synthetic/选择目录', '/second'] }, '/synthetic/选择目录'],
    ]) {
      f.state.result = result;
      assert.equal(await fn(event(f.workspace), '/renderer/path'), expected);
    }
    f.state.result = Error('synthetic dialog refusal');
    await assert.rejects(fn(event(f.workspace)), /synthetic dialog refusal/);
    assert(f.calls.every((c) => c[0] === 'dialog' && c[1] === true));
    assert.deepEqual(f.calls[0][2], {
      title: '选择日志目录',
      buttonLabel: '使用此目录',
      properties: ['openDirectory', 'createDirectory'],
    });
    assert.equal(f.state.directory, '/synthetic/local-logs');
    let finish;
    const pending = handlers(frozen, {
      dialog: {
        showOpenDialog: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      },
    });
    const p = pending.registered.get('logs:choose-directory')(event(pending.workspace));
    assert.deepEqual(pending.calls, []);
    finish({ canceled: true, filePaths: ['/ignored'] });
    assert.equal(await p, null);
    evidence.push({
      frozen,
      calls: f.calls,
      persistedDirectoryUnchanged: true,
      delayedCancelResult: null,
    });
  }
  record('choose-directory-contract', evidence);
});

test(
  'P0 native log channels use real local Agent settings and isolate cross-host senders',
  { timeout: 60000 },
  async (t) => {
    const a = await desktop(t),
      b = await desktop(t),
      service = await a.start(),
      other = await b.start();
    const logPeer = peer(a, a.logs, await a.handlers.get('agent:open')(a.event(a.logs)));
    await logPeer.initialize();
    const owner = peer(a, a.workspace, await a.handlers.get('agent:open')(a.event(a.workspace)));
    const otherOwner = peer(
      b,
      b.workspace,
      await b.handlers.get('agent:open')(b.event(b.workspace)),
    );
    await owner.initialize();
    await otherOwner.initialize();
    const first = await service.client.getLoggingSettings();
    const custom = path.join(a.root, 'selected-日志');
    const saved = await owner.saveLoggingSettings(
      { customDirectory: custom, level: 'DEBUG', retentionDays: 14, maxTotalMB: 200 },
      first.revision,
    );
    const effects = [];
    const f = handlers(false, {
      origin: service.origin,
      window: { webContents: a.workspace },
      logWindow: { contents: () => a.logs, open: () => effects.push(['window']) },
      backend: service,
      shell: {
        openPath: async (dir) => {
          effects.push(['openPath', dir]);
          return '';
        },
      },
      dialog: {
        showOpenDialog: async () => ({
          canceled: false,
          filePaths: [path.join(a.root, 'candidate-only')],
        }),
      },
    });
    let currentEvent = a.event(a.workspace);
    const bridge = preload((channel, ...args) => {
      assert.deepEqual(args, []);
      return Promise.resolve().then(() => f.registered.get(channel)(currentEvent));
    });
    assert.equal(await bridge.openDirectory('/foreign/renderer'), custom);
    currentEvent = a.event(a.logs);
    assert.equal(await bridge.openDirectory(), custom);
    assert.equal(await bridge.openWindow(), undefined);
    await assert.rejects(bridge.chooseDirectory(), /Log access denied/);
    currentEvent = a.event(a.workspace);
    assert.equal(await bridge.chooseDirectory(), path.join(a.root, 'candidate-only'));
    assert.deepEqual(await service.client.getLoggingSettings(), saved);
    assert.equal(fs.existsSync(path.join(a.root, 'candidate-only')), false);
    await assert.rejects(logPeer.getLoggingSettings(), (e) => e.kind === 'unknown-method');
    const before = effects.length;
    for (const c of [b.workspace, b.logs, { mainFrame: { url: service.origin + '/logs' } }]) {
      currentEvent = { sender: c, senderFrame: c.mainFrame };
      for (const method of ['openWindow', 'openDirectory', 'chooseDirectory'])
        await assert.rejects(bridge[method](), /Log access denied/);
    }
    assert.equal(effects.length, before);
    assert.notEqual((await other.client.getLoggingSettings()).revision, saved.revision);
    await assert.rejects(
      otherOwner.saveLoggingSettings(
        { customDirectory: null, level: 'INFO', retentionDays: 14, maxTotalMB: 200 },
        saved.revision,
      ),
      (e) => e.kind === 'conflict',
    );
    await service.client.request('desktop.log', {
      level: 'ERROR',
      source: 'native',
      message: 'batch11-local-directory-proof',
    });
    assert(
      (await logPeer.recentLogs(10)).some((e) => e.message === 'batch11-local-directory-proof'),
    );
    assert(fs.readdirSync(custom).some((name) => name.endsWith('.log')));
    const localEffects = plain(effects);
    logPeer.close();
    owner.close();
    otherOwner.close();
    await service.close();
    currentEvent = a.event(a.workspace);
    const closedEffects = effects.length;
    await assert.rejects(bridge.openDirectory());
    assert.equal(effects.length, closedEffects);
    a.handlers.clear();
    const restarted = await a.start();
    assert.equal((await restarted.client.getLoggingSettings()).settings.directory, custom);
    record('actual-agent-native-channels', {
      localEffects,
      selectedDirectory: custom,
      sourceSettings: saved,
      crossAgentDenied: true,
      closedBackendNoShellEffect: true,
      reopenedDirectory: custom,
      scope:
        'Exact AST-selected main registrations/helper and whole preload; Electron dialog/shell/window doubles. Real desktop-agent, UI host, IPC/HTTP, SDK, SQLite and isolated logs. No actual OS dialog or installed Electron UI.',
    });
  },
);
