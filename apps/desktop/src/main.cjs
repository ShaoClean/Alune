const { app, BrowserWindow, Menu, dialog, session, ipcMain, shell, autoUpdater: nativeUpdater } = require('electron');
const { randomBytes } = require('node:crypto');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createWorkspacePreferences, isTrustedWorkspaceSender } = require('./workspace-preferences.cjs');

const smokeTest = process.argv.includes('--smoke-test');
app.setName('RemoteGit');
if (smokeTest) {
  if (!process.env.REMOTE_GIT_SMOKE_DIR) throw new Error('Smoke tests require an isolated data directory');
  app.setPath('userData', process.env.REMOTE_GIT_SMOKE_DIR);
} else {
  app.setPath('userData', path.join(app.getPath('appData'), 'RemoteGit'));
}

let backend;
let window;
let origin;
let quitting = false;
let updates;
let closingBackend;
const token = randomBytes(32).toString('hex');
const windowStatePath = path.join(app.getPath('userData'), 'window.json');

function createWindow() {
  let state = {};
  try { state = JSON.parse(readFileSync(windowStatePath, 'utf8')); } catch {}
  window = new BrowserWindow({
    title: 'RemoteGit',
    width: Number.isFinite(state.width) ? Math.max(1000, Math.min(state.width, 3840)) : 1440,
    height: Number.isFinite(state.height) ? Math.max(680, Math.min(state.height, 2160)) : 900,
    minWidth: 1000,
    minHeight: 680,
    backgroundColor: '#f4f6f9',
    show: false,
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      partition: 'remote-git-desktop',
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const guardNavigation = (event, url) => {
    if (new URL(url).origin !== origin) event.preventDefault();
  };
  window.webContents.on('will-navigate', guardNavigation);
  window.webContents.on('will-redirect', guardNavigation);
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.once('ready-to-show', () => {
    if (state.maximized) window.maximize();
    if (!smokeTest) window.show();
  });
  window.on('close', () => {
    const { width, height } = window.getNormalBounds();
    try { writeFileSync(windowStatePath, JSON.stringify({ width, height, maximized: window.isMaximized() })); } catch {}
  });
  window.on('closed', () => { window = null; });
  return window.loadURL(origin);
}

async function start() {
  const dataDir = app.getPath('userData');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  process.env.REMOTE_GIT_DATA_DIR = dataDir;
  const legacyDatabase = path.join(os.homedir(), '.remote-git', 'remote-git.db');
  const databasePath = path.join(dataDir, 'remote-git.db');
  if (!smokeTest && !existsSync(databasePath) && existsSync(legacyDatabase)) {
    const Database = require('better-sqlite3');
    const source = new Database(legacyDatabase, { readonly: true });
    try { await source.backup(databasePath); } finally { source.close(); }
  }
  const { startServer } = require('./server/bootstrap.js');
  backend = await startServer({ port: 0, host: '127.0.0.1', token, webRoot: path.join(__dirname, 'web') });
  origin = await backend.getUrl();
  const { UpdateService } = require('./update-service.cjs');
  const { registerUpdateIPC } = require('./update-ipc.cjs');
  const adapter = smokeTest
    ? require('./smoke.cjs').createUpdateAdapter(app.getVersion())
    : process.platform === 'darwin'
      ? require('./mac-updater.cjs').createMacUpdater({
        version: app.getVersion(), arch: process.arch, cacheDir: path.join(dataDir, 'updates'), shell, app,
      })
      : require('./electron-updater-adapter.cjs').createElectronUpdater({
        updater: require('electron-updater').autoUpdater, nativeUpdater,
      });
  if (adapter.install) {
    const install = adapter.install.bind(adapter);
    adapter.install = async (...args) => {
      quitting = true;
      try { await install(...args); } catch (error) { quitting = false; throw error; }
    };
  }
  const supported = smokeTest || (app.isPackaged && (
    (process.platform === 'darwin' && ['arm64', 'x64'].includes(process.arch))
    || (process.platform === 'win32' && process.arch === 'x64')
    || (process.platform === 'linux' && process.arch === 'x64' && Boolean(process.env.APPIMAGE))
  ));
  updates = new UpdateService({ version: app.getVersion(), platform: process.platform, supported, adapter, closeBackend });
  const installError = !smokeTest && process.platform === 'darwin'
    ? await require('./mac-installer.cjs').takeInstallError(path.join(dataDir, 'updates')).catch((error) => {
      console.error('读取上次更新结果失败', error);
      return '无法读取上次更新结果，请重新检查更新。';
    }) : null;
  if (installError) updates.setState({ status: 'error', error: { action: 'check', message: installError } });
  registerUpdateIPC({ ipcMain, service: updates, getWindow: () => window, getOrigin: () => origin });
  const preferences = createWorkspacePreferences(path.join(dataDir, 'workspace.json'));
  for (const operation of ['load', 'save', 'clear']) {
    ipcMain.handle(`workspace:${operation}`, (event, value) => {
      if (!isTrustedWorkspaceSender(event, window?.webContents, origin)) throw new Error('Workspace access denied');
      return preferences[operation](value);
    });
  }
  const desktopSession = session.fromPartition('remote-git-desktop');
  desktopSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  desktopSession.setPermissionCheckHandler(() => false);
  // Keep the per-launch credential in the main process, including WebSocket upgrades.
  desktopSession.webRequest.onBeforeSendHeaders(
    { urls: [`${origin}/*`, `${origin.replace('http:', 'ws:')}/*`] },
    (details, callback) => callback({ requestHeaders: { ...details.requestHeaders, Authorization: `Bearer ${token}` } }),
  );
  desktopSession.webRequest.onHeadersReceived({ urls: [`${origin}/*`] }, (details, callback) => {
    callback({ responseHeaders: {
      ...details.responseHeaders,
      'Content-Security-Policy': [
        `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' ${origin.replace('http:', 'ws:')}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
      ],
    } });
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: '文件', submenu: [{ label: '连接', accelerator: 'CmdOrCtrl+1', click: () => window?.loadURL(origin) },
      { label: '仓库', accelerator: 'CmdOrCtrl+2', click: () => window?.loadURL(`${origin}/repositories`) },
      { type: 'separator' }, { role: process.platform === 'darwin' ? 'close' : 'quit' }] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '视图', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ]));
  await createWindow();
  if (!smokeTest && supported && !installError) {
    const timer = setTimeout(() => { if (!quitting) void updates.check({ background: true }); }, 10000);
    timer.unref();
    app.once('before-quit', () => clearTimeout(timer));
  }
  if (smokeTest) {
    await require('./smoke.cjs')({ window, origin, token, updates, closeBackend, backend, version: app.getVersion() });
    app.quit();
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    } else if (origin) void createWindow().catch(fail);
  });
  app.whenReady().then(start).catch(fail);
  app.on('activate', () => {
    if (!window && origin && !quitting) void createWindow().catch(fail);
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('before-quit', (event) => {
    if (!quitting && updates?.getState().status === 'installing') { event.preventDefault(); return; }
    if (quitting || !backend) return;
    event.preventDefault();
    quitting = true;
    const timeout = setTimeout(() => { console.error('关闭本地服务超时'); app.exit(1); }, 5000);
    closeBackend().then(() => {
      clearTimeout(timeout);
      app.quit();
    }).catch(fail);
  });
}

function closeBackend() {
  if (!backend) return Promise.resolve();
  if (!closingBackend) {
    closingBackend = Promise.resolve().then(() => backend.close()).then(() => { backend = null; })
      .finally(() => { closingBackend = null; });
  }
  return closingBackend;
}

function fail(error) {
  console.error(error);
  if (!smokeTest) dialog.showErrorBox('RemoteGit 启动失败', error.message || String(error));
  app.exit(1);
}
