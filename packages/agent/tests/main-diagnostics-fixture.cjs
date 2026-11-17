// Entire desktop entry with explicit Electron/update doubles. No installed app or credentials.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const directory = path.resolve(__dirname, '../../../apps/desktop/src');
function main({
  dataDir,
  service,
  processObject,
  pending = [],
  stderr = [],
  waiting = false,
  brokenStderr = false,
  workspace,
  logs,
} = {}) {
  const app = new EventEmitter(),
    handlers = new Map(),
    calls = [];
  Object.assign(app, {
    setName() {},
    setPath() {},
    getPath: () => dataDir,
    getVersion: () => require('../../../package.json').version,
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
    isPackaged: false,
    dock: { setIcon() {} },
    quit: () => calls.push(['quit']),
    exit: (code) => calls.push(['exit', code]),
  });
  class BrowserWindow extends EventEmitter {
    constructor() {
      super();
      this.webContents = workspace ?? new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {};
    }
    loadURL() {
      calls.push(['window-ready']);
      return Promise.resolve();
    }
  }
  class UpdateService extends EventEmitter {
    getState() {
      return { status: 'idle' };
    }
  }
  const ipcMain = new EventEmitter();
  ipcMain.handle = (name, fn) => handlers.set(name, fn);
  const p =
    processObject ??
    Object.assign(new EventEmitter(), {
      env: {},
      argv: ['electron', 'main.cjs'],
      platform: 'linux',
      arch: 'arm64',
      versions: {},
    });
  const deps = {
    electron: {
      app,
      BrowserWindow,
      nativeTheme: { shouldUseDarkColors: false },
      ipcMain,
      Menu: { buildFromTemplate: (v) => v, setApplicationMenu() {} },
      session: {
        fromPartition: () => ({
          setPermissionRequestHandler() {},
          setPermissionCheckHandler() {},
          webRequest: { onBeforeSendHeaders() {}, onHeadersReceived() {} },
        }),
      },
      dialog: { showErrorBox: (...a) => calls.push(['dialog', ...a]) },
      shell: {},
    },
    'node:crypto': require('node:crypto'),
    'node:path': path,
    'node:fs': {
      ...fs,
      writeSync(fd, value) {
        if (brokenStderr) throw Error('synthetic stderr unavailable');
        stderr.push({ fd, value });
        if (processObject === process) return fs.writeSync(fd, value);
        return Buffer.byteLength(value);
      },
    },
    './workspace-preferences.cjs': require('../../../apps/desktop/src/workspace-preferences.cjs'),
    './external-links.cjs': { createExternalLinkHandler: () => () => ({ action: 'deny' }) },
    './log-window.cjs': { createLogWindow: () => ({ contents: () => logs }) },
    './desktop-agent.cjs': {
      startDesktopAgent: async () => {
        calls.push(['agent-start']);
        if (waiting) return new Promise(() => {});
        return {
          ...service,
          client: {
            state: 'ready',
            request: (...args) => {
              // Normalize VM objects; requests otherwise use the real native Agent client.
              const promise = service.client.request(...JSON.parse(JSON.stringify(args)));
              pending.push(promise);
              return promise;
            },
          },
        };
      },
    },
    './update-service.cjs': { UpdateService },
    './update-ipc.cjs': { registerUpdateIPC() {} },
    './mac-updater.cjs': { createMacUpdater: () => ({}) },
    './mac-installer.cjs': { takeInstallError: async () => null },
    './electron-updater-adapter.cjs': { createElectronUpdater: () => ({}) },
    'electron-updater': {},
    './clipboard-permissions.cjs': {},
  };
  const sourceFile = process.env.P0_DIAGNOSTICS_MAIN_FILE ?? path.join(directory, 'main.cjs');
  vm.runInNewContext(
    fs.readFileSync(sourceFile, 'utf8'),
    {
      __dirname: directory,
      process: p,
      setTimeout,
      clearTimeout,
      console: { error: (...a) => calls.push(['stderr', ...a]) },
      require(name) {
        if (!Object.hasOwn(deps, name)) throw Error('Unreviewed main dependency: ' + name);
        return deps[name];
      },
    },
    { filename: sourceFile },
  );
  return { app, process: p, calls, pending, stderr };
}
module.exports = { main };
if (require.main === module) {
  const [mode, dataDir] = process.argv.slice(2);
  const f = main({
    dataDir,
    processObject: process,
    waiting: mode !== 'ready-crash',
    brokenStderr: mode === 'broken-stderr',
    service: {
      origin: 'http://127.0.0.1:1',
      registry: {},
      networkProxy: {},
      client: { request: () => Promise.resolve() },
    },
  });
  setImmediate(() => {
    if (mode === 'ready-crash' && !f.calls.some((c) => c[0] === 'window-ready'))
      throw Error('Fixture did not reach full main startup');
    if (mode === 'early-rejection') {
      Promise.reject(new Error('diagnostic early rejection sentinel'));
      setTimeout(() => process.exit(0), 30);
    } else {
      throw new Error('diagnostic crash sentinel ' + mode);
    }
  });
}
