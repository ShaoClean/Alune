// Exact start-owned registrations; Electron dialog/IPC are doubles, files and killed child are real.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createHash } = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../..');
const origin = 'http://127.0.0.1:43111';
const plain = (v) => JSON.parse(JSON.stringify(v));
const valid = JSON.stringify({
  version: 1,
  state: { appearance: { theme: 'dark' }, repositories: ['synthetic-local-id'] },
});
function record(name, value) {
  if (process.env.P0_WORKSPACE_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_WORKSPACE_PROOF_DIR, name + '.json'),
      JSON.stringify(value, null, 2) + '\n',
      { flag: 'wx' },
    );
}
function source(frozen, file) {
  if (frozen) assert(process.env.P0_WORKSPACE_FROZEN, 'Use batch-12 replay driver');
  return path.join(frozen ? process.env.P0_WORKSPACE_FROZEN : root, 'apps/desktop/src', file);
}
function preferencesModule(frozen) {
  const m = { exports: {} },
    file = source(frozen, 'workspace-preferences.cjs');
  vm.runInNewContext(
    fs.readFileSync(file, 'utf8'),
    {
      module: m,
      exports: m.exports,
      URL,
      Error,
      SyntaxError,
      JSON,
      require: (id) => {
        assert.equal(id, 'node:fs');
        return fs;
      },
    },
    { filename: file },
  );
  return m.exports;
}
function fixture(t, frozen) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-batch12-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const module = preferencesModule(frozen),
    file = path.join(directory, 'workspace.json');
  const preferences = module.createWorkspacePreferences(file);
  const text = fs.readFileSync(source(frozen, 'main.cjs'), 'utf8');
  const ast = ts.createSourceFile('main.cjs', text, ts.ScriptTarget.Latest, true),
    nodes = [];
  function visit(n) {
    if (
      ts.isExpressionStatement(n) &&
      ts.isCallExpression(n.expression) &&
      ['ipcMain.handle', 'ipcMain.on'].includes(n.expression.expression.getText(ast)) &&
      ts.isStringLiteral(n.expression.arguments[0]) &&
      ['workspace:choose-directory', 'workspace:save-sync'].includes(n.expression.arguments[0].text)
    )
      nodes.push(n);
    if (
      ts.isForOfStatement(n) &&
      n.statement.getText(ast).includes('ipcMain.handle(`workspace:${operation}`')
    )
      nodes.push(n);
    ts.forEachChild(n, visit);
  }
  visit(ast);
  assert.equal(nodes.length, 3);
  assert(nodes.every((n) => n.parent === nodes[0].parent));
  assert.equal(nodes[0].parent.parent.name.text, 'start');
  const handlers = new Map(),
    listeners = new Map(),
    calls = [];
  const workspace = { mainFrame: { url: origin + '/repositories' } },
    window = { webContents: workspace };
  const state = { result: { canceled: false, filePaths: ['/synthetic/选择仓库'] } };
  const globals = {
    Error,
    origin,
    window,
    preferences,
    ...module,
    ipcMain: {
      handle: (n, f) => {
        assert(!handlers.has(n));
        handlers.set(n, f);
      },
      on: (n, f) => {
        assert(!listeners.has(n));
        listeners.set(n, f);
      },
    },
    dialog: {
      showOpenDialog: async (parent, options) => {
        assert.equal(parent, window);
        calls.push(plain(options));
        if (state.error) throw state.error;
        return state.result;
      },
    },
  };
  for (const n of nodes)
    vm.runInNewContext(n.getText(ast), globals, {
      filename: source(frozen, 'main.cjs'),
      lineOffset: ast.getLineAndCharacterOfPosition(n.getStart(ast)).line,
    });
  assert.deepEqual(
    [...handlers.keys()],
    ['workspace:choose-directory', 'workspace:load', 'workspace:save', 'workspace:clear'],
  );
  assert.deepEqual([...listeners.keys()], ['workspace:save-sync']);
  const f = {
    frozen,
    directory,
    file,
    preferences,
    globals,
    handlers,
    listeners,
    workspace,
    state,
    calls,
    event: { sender: workspace, senderFrame: workspace.mainFrame },
    inventory: nodes.map((n) => ({
      line: ast.getLineAndCharacterOfPosition(n.getStart(ast)).line + 1,
      sha256: createHash('sha256').update(n.getText(ast)).digest('hex'),
      text: n.getText(ast),
    })),
  };
  f.bridge = (event = f.event) => {
    const exposed = {},
      invoke = (name, ...args) => Promise.resolve().then(() => handlers.get(name)(event, ...args));
    vm.runInNewContext(fs.readFileSync(source(frozen, 'preload.cjs'), 'utf8'), {
      Error,
      process: { argv: [] },
      require: (id) => {
        assert.equal(id, 'electron');
        return {
          contextBridge: {
            exposeInMainWorld: (n, v) => {
              exposed[n] = v;
            },
          },
          ipcRenderer: {
            invoke,
            sendSync: (name, ...args) => {
              const e = { ...event };
              listeners.get(name)(e, ...args);
              return e.returnValue;
            },
          },
        };
      },
    });
    return exposed.aluneWorkspace;
  };
  return f;
}
function rejected(f) {
  const other = { mainFrame: { url: origin + '/repositories' } };
  return [
    {},
    { sender: other, senderFrame: other.mainFrame },
    { sender: f.workspace, senderFrame: { url: origin + '/child' } },
    { sender: f.workspace, senderFrame: null },
    { sender: f.workspace },
    { sender: {}, senderFrame: f.workspace.mainFrame },
  ];
}
async function denyAll(f, event) {
  const before = f.preferences.load(),
    count = f.calls.length;
  for (const op of ['chooseDirectory', 'load', 'clear'])
    await assert.rejects(f.bridge(event)[op](), /Workspace access denied/);
  await assert.rejects(f.bridge(event).save(valid), /Workspace access denied/);
  assert.throws(() => f.handlers.get('workspace:save')(event, valid), /Workspace access denied/);
  assert.equal(f.preferences.load(), before);
  assert.equal(f.calls.length, count);
}

test('P0-BOOTSTRAP-0009 frozen and current workspace chooser preserves exact query results and trust', async (t) => {
  const results = [];
  for (const frozen of [true, false]) {
    const f = fixture(t, frozen),
      bridge = f.bridge();
    f.preferences.save(valid);
    const cases = [
      { canceled: true, filePaths: ['/synthetic/ignored'] },
      { canceled: false, filePaths: [] },
      { canceled: false, filePaths: [''] },
      { canceled: false, filePaths: ['/synthetic/选择仓库', '/synthetic/ignored'] },
    ];
    const replies = [];
    for (const c of cases) {
      f.state.result = c;
      replies.push(await bridge.chooseDirectory('/renderer/cannot-override'));
    }
    assert.deepEqual(replies, [null, null, null, '/synthetic/选择仓库']);
    for (const call of f.calls)
      assert.deepEqual(call, {
        title: '打开本地 Git 仓库',
        buttonLabel: '选择仓库目录',
        properties: ['openDirectory'],
      });
    f.state.error = Error('synthetic dialog failure');
    await assert.rejects(bridge.chooseDirectory(), /synthetic dialog failure/);
    delete f.state.error;
    let release;
    f.state.result = new Promise((r) => {
      release = r;
    });
    const pending = bridge.chooseDirectory();
    await Promise.resolve();
    assert.equal(f.preferences.load(), valid);
    release({ canceled: true, filePaths: [] });
    assert.equal(await pending, null);
    assert.equal(f.preferences.load(), valid);
    assert.deepEqual(fs.readdirSync(f.directory), ['workspace.json']);
    for (const e of rejected(f)) await denyAll(f, e);
    results.push({
      frozen,
      replies,
      dialogFailure: 'propagated',
      delayedCancel: null,
      fileUnchanged: true,
      registration: f.inventory[0],
    });
  }
  record('workspace-chooser-contract', results);
});

test('P0-BOOTSTRAP-0010 exact workspace operations preserve bytes validation and read failure semantics', async (t) => {
  const results = [];
  for (const frozen of [true, false]) {
    const f = fixture(t, frozen),
      b = f.bridge();
    assert.equal(await b.load(), null);
    assert.equal(await f.handlers.get('workspace:save')(f.event, valid), undefined);
    assert.equal(await b.load(), valid);
    assert.equal(fs.statSync(f.file).mode & 0o777, 0o600);
    assert.equal(fs.existsSync(f.file + '.tmp'), false);
    for (const invalid of [
      null,
      7,
      '{}',
      '{broken',
      '{"version":2,"state":{}}',
      '{"version":1,"state":[]}',
    ]) {
      assert.throws(
        () => f.handlers.get('workspace:save')(f.event, invalid),
        frozen && invalid === '{broken' ? SyntaxError : /Invalid workspace preferences/,
      );
      assert.equal(await b.load(), valid);
    }
    for (const e of rejected(f)) await denyAll(f, e);
    fs.writeFileSync(f.file, '{broken');
    assert.equal(await b.load(), null);
    assert.equal(fs.readFileSync(f.file, 'utf8'), '{broken');
    fs.writeFileSync(f.file, '{"version":2,"state":{}}');
    assert.equal(await b.load(), null);
    assert.equal(await b.clear('ignored'), undefined);
    assert.equal(await b.clear(), undefined);
    assert.equal(await b.load(), null);
    fs.mkdirSync(f.file);
    await assert.rejects(b.load(), /EISDIR/);
    fs.rmdirSync(f.file);
    fs.mkdirSync(f.file + '.tmp');
    assert.throws(() => f.handlers.get('workspace:save')(f.event, valid));
    assert.equal(fs.existsSync(f.file), false);
    fs.rmdirSync(f.file + '.tmp');
    results.push({
      frozen,
      atomicPermissions: '0600',
      invalidWrites: 'preserve previous bytes',
      malformedRead: null,
      unknownVersion: null,
      nonENOENT: 'propagated',
      failedWrite: 'no published file',
      registration: f.inventory[1],
    });
  }
  record('workspace-operations-contract', results);
});

test('P0-BOOTSTRAP-0011 exact synchronous saves always acknowledge errors and preload throws safely', async (t) => {
  const results = [];
  for (const frozen of [true, false]) {
    const f = fixture(t, frozen),
      b = f.bridge();
    assert.equal(await b.save(valid), undefined);
    assert.equal(f.preferences.load(), valid);
    await assert.rejects(
      b.save('{broken'),
      frozen ? /Expected property name/ : /Invalid workspace preferences/,
    );
    assert.equal(f.preferences.load(), valid);
    for (const e of rejected(f)) await denyAll(f, e);
    const save = f.preferences.save;
    for (const [error, expected] of [
      [Error('synthetic IO error'), 'synthetic IO error'],
      ['non-error throwable', 'Workspace save failed'],
    ]) {
      f.preferences.save = () => {
        throw error;
      };
      const e = { ...f.event };
      f.listeners.get('workspace:save-sync')(e, valid);
      assert.equal(e.returnValue, expected);
      await assert.rejects(b.save(valid), new RegExp(expected));
    }
    f.preferences.save = save;
    const e = { ...f.event };
    f.listeners.get('workspace:save-sync')(e, valid);
    assert.equal(e.returnValue, null);
    assert.equal(f.preferences.load(), valid);
    results.push({
      frozen,
      acknowledgement: null,
      errorReplies: [
        frozen ? 'JSON SyntaxError message' : 'Invalid workspace preferences',
        'Workspace access denied',
        'synthetic IO error',
        'Workspace save failed',
      ],
      registration: f.inventory[2],
    });
  }
  record('workspace-sync-contract', results);
});

test('P0 workspace native identity denies cross-window stale frame foreign and malformed origins', async (t) => {
  const results = [];
  for (const frozen of [true, false]) {
    const f = fixture(t, frozen),
      other = fixture(t, frozen);
    await f.bridge().save(valid);
    await denyAll(f, other.event);
    assert.equal(other.preferences.load(), null);
    const stale = { ...f.event };
    f.workspace.mainFrame = { url: origin + '/repositories' };
    await denyAll(f, stale);
    const current = { sender: f.workspace, senderFrame: f.workspace.mainFrame };
    for (const url of [
      'https://foreign.invalid/',
      'not a url',
      'file:///synthetic/local',
      origin + '.evil.invalid/',
    ]) {
      f.workspace.mainFrame.url = url;
      await denyAll(f, current);
    }
    f.workspace.mainFrame.url = origin + '/settings';
    assert.equal(await f.bridge(current).load(), valid);
    f.globals.window = null;
    await denyAll(f, current);
    results.push({
      frozen,
      crossWindow: 'denied',
      staleFrame: 'denied',
      foreignMalformedOrigins: 'denied',
      absentWindow: 'denied',
      otherPreferences: null,
    });
  }
  record('workspace-native-isolation', results);
});

test('P0 workspace completed synchronous reply survives immediate process kill without replay', async (t) => {
  const results = [];
  for (const frozen of [true, false]) {
    const f = fixture(t, frozen);
    // Execute the complete frozen/current module and the exact start-owned sync registration in a child.
    const code = `const fs=require('node:fs'),vm=require('node:vm');const m={exports:{}};vm.runInNewContext(fs.readFileSync(process.argv[1],'utf8'),{module:m,exports:m.exports,URL,Error,require});const preferences=m.exports.createWorkspacePreferences(process.argv[2]);const origin=${JSON.stringify(origin)},window={webContents:{mainFrame:{url:origin+'/repositories'}}};let handler;const ipcMain={on:(name,fn)=>{if(name!=='workspace:save-sync')throw Error(name);handler=fn}};const context={...m.exports,preferences,origin,window,ipcMain};vm.runInNewContext(process.argv[3],context);const e={sender:window.webContents,senderFrame:window.webContents.mainFrame};handler(e,process.argv[4]);if(e.returnValue!==null)throw Error(e.returnValue);process.send({reply:e.returnValue});setInterval(()=>{},1000);`;
    const child = spawn(
      process.execPath,
      ['-e', code, source(frozen, 'workspace-preferences.cjs'), f.file, f.inventory[2].text, valid],
      { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
    );
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    t.after(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    });
    const received = await Promise.race([
      once(child, 'message').then(([message]) => message),
      once(child, 'exit').then(([code]) => {
        throw Error('Child exited ' + code + ': ' + stderr);
      }),
    ]);
    assert.deepEqual(received, { reply: null });
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    const [codeValue, signal] = await exited;
    assert.equal(signal, 'SIGKILL');
    assert.equal(codeValue, null);
    assert.equal(stderr, '');
    assert.equal(f.preferences.load(), valid);
    assert.equal(fs.readFileSync(f.file, 'utf8'), valid);
    assert.deepEqual(fs.readdirSync(f.directory), ['workspace.json']);
    results.push({
      frozen,
      replyBeforeKill: null,
      signal,
      bytesAfterRestart: valid,
      writeReplay: false,
      files: ['workspace.json'],
    });
  }
  record('workspace-killed-writer', results);
});
