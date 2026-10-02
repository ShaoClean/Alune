const {
  app,
  BrowserWindow,
  nativeTheme,
  Menu,
  dialog,
  session,
  ipcMain,
  shell,
  autoUpdater: nativeUpdater,
} = require('electron');
const { randomBytes } = require('node:crypto');
const { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  createWorkspacePreferences,
  isTrustedWorkspaceSender,
  workspaceBackground,
  saveWorkspacePreferences,
} = require('./workspace-preferences.cjs');
const { createExternalLinkHandler } = require('./external-links.cjs');

const smokeTest = process.argv.includes('--smoke-test');
app.setName('Alune');
if (smokeTest) {
  if (!process.env.ALUNE_SMOKE_DIR)
    throw new Error('Smoke tests require an isolated data directory');
  if (process.env.CI === 'true') app.disableHardwareAcceleration();
  app.setPath('userData', process.env.ALUNE_SMOKE_DIR);
} else {
  app.setPath('userData', path.join(app.getPath('appData'), 'Alune'));
}

let backend;
let window;
let origin;
let quitting = false;
let updates;
let closingBackend;
let terminalClosePending = false;
const token = randomBytes(32).toString('hex');
const windowStatePath = path.join(app.getPath('userData'), 'window.json');
const iconPath = path.join(__dirname, 'assets', 'icon.png');

function createWindow() {
  let state = {};
  try {
    state = JSON.parse(readFileSync(windowStatePath, 'utf8'));
  } catch {}
  let savedPreferences = null;
  try {
    savedPreferences = createWorkspacePreferences(
      path.join(app.getPath('userData'), 'workspace.json'),
    ).load();
  } catch {}
  window = new BrowserWindow({
    title: 'Alune',
    icon: iconPath,
    width: Number.isFinite(state.width) ? Math.max(320, Math.min(state.width, 3840)) : 1440,
    height: Number.isFinite(state.height) ? Math.max(680, Math.min(state.height, 2160)) : 900,
    minWidth: 320,
    minHeight: 680,
    backgroundColor: workspaceBackground(savedPreferences, nativeTheme.shouldUseDarkColors),
    show: false,
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      partition: 'alune-desktop',
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(
    createExternalLinkHandler(
      smokeTest ? require('./smoke.cjs').openExternal : (url) => shell.openExternal(url),
    ),
  );
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
  window.on('close', (event) => {
    if (!quitting && terminalRegistry()?.impact({}).length) {
      event.preventDefault();
      if (!terminalClosePending) {
        terminalClosePending = true;
        void confirmTerminalShutdown()
          .then((confirmed) => {
            if (confirmed) window?.close();
          })
          .finally(() => {
            terminalClosePending = false;
          });
      }
      return;
    }
    const { width, height } = window.getNormalBounds();
    try {
      writeFileSync(
        windowStatePath,
        JSON.stringify({ width, height, maximized: window.isMaximized() }),
      );
    } catch {}
  });
  window.on('closed', () => {
    window = null;
  });
  return window.loadURL(origin);
}

async function start() {
  if (process.platform === 'darwin') app.dock.setIcon(iconPath);
  const dataDir = app.getPath('userData');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  process.env.ALUNE_DATA_DIR = dataDir;
  const standaloneDatabase = path.join(os.homedir(), '.alune', 'alune.db');
  const databasePath = path.join(dataDir, 'alune.db');
  const tokenImportMarker = path.join(dataDir, 'access-token-import-pending');
  if (!smokeTest && !existsSync(databasePath) && existsSync(standaloneDatabase)) {
    const Database = require('better-sqlite3');
    const source = new Database(standaloneDatabase, { readonly: true });
    try {
      await source.backup(databasePath);
    } finally {
      source.close();
    }
    writeFileSync(tokenImportMarker, '', { mode: 0o600 });
  }
  const { startServer } = require('./server/bootstrap.js');
  const aiSecretStorage = require('./ai-secret-storage.cjs').createAiSecretStorage(
    require('electron').safeStorage,
  );
  if (!smokeTest && existsSync(tokenImportMarker)) {
    const Database = require('better-sqlite3');
    const imported = new Database(databasePath);
    try {
      const { localSecretStorage } = require('./server/secrets/secret-storage');
      const {
        migrateImportedAccessTokens,
      } = require('./server/access-tokens/access-token-migration');
      if (
        migrateImportedAccessTokens(
          imported,
          localSecretStorage(path.dirname(standaloneDatabase)),
          aiSecretStorage,
        )
      )
        rmSync(tokenImportMarker);
    } finally {
      imported.close();
    }
  }
  backend = await startServer({
    port: 0,
    host: '127.0.0.1',
    token,
    desktop: true,
    webRoot: path.join(__dirname, 'web'),
    aiSecretStorage,
  });
  origin = await backend.getUrl();
  const { ProxyService } = require('./server/proxy/proxy.service.js');
  const networkProxy = backend.get(ProxyService);
  const { UpdateService } = require('./update-service.cjs');
  const { registerUpdateIPC } = require('./update-ipc.cjs');
  const adapter = smokeTest
    ? require('./smoke.cjs').createUpdateAdapter(app.getVersion())
    : process.platform === 'darwin'
      ? require('./mac-updater.cjs').createMacUpdater({
          version: app.getVersion(),
          arch: process.arch,
          cacheDir: path.join(dataDir, 'updates'),
          shell,
          app,
          fetchImpl: networkProxy.fetch,
        })
      : require('./electron-updater-adapter.cjs').createElectronUpdater({
          updater: require('electron-updater').autoUpdater,
          nativeUpdater,
          proxyBridge: () => networkProxy.updaterBridge(),
        });
  if (adapter.install) {
    const install = adapter.install.bind(adapter);
    adapter.install = async (...args) => {
      quitting = true;
      try {
        await install(...args);
      } catch (error) {
        quitting = false;
        throw error;
      }
    };
  }
  const supported =
    smokeTest ||
    (app.isPackaged &&
      ((process.platform === 'darwin' && ['arm64', 'x64'].includes(process.arch)) ||
        (process.platform === 'win32' && process.arch === 'x64') ||
        (process.platform === 'linux' && process.arch === 'x64' && Boolean(process.env.APPIMAGE))));
  updates = new UpdateService({
    version: app.getVersion(),
    platform: process.platform,
    supported,
    adapter,
    closeBackend,
  });
  const installError =
    !smokeTest && process.platform === 'darwin'
      ? await require('./mac-installer.cjs')
          .takeInstallError(path.join(dataDir, 'updates'))
          .catch((error) => {
            console.error('读取上次更新结果失败', error);
            return '无法读取上次更新结果，请重新检查更新。';
          })
      : null;
  if (installError)
    updates.setState({ status: 'error', error: { action: 'check', message: installError } });
  registerUpdateIPC({
    ipcMain,
    service: updates,
    getWindow: () => window,
    getOrigin: () => origin,
  });
  const preferences = createWorkspacePreferences(path.join(dataDir, 'workspace.json'));
  ipcMain.handle('workspace:choose-directory', async (event) => {
    if (!isTrustedWorkspaceSender(event, window?.webContents, origin))
      throw new Error('Workspace access denied');
    const result = await dialog.showOpenDialog(window, {
      title: '打开本地 Git 仓库',
      buttonLabel: '选择仓库目录',
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0] || null;
  });
  for (const operation of ['load', 'save', 'clear']) {
    ipcMain.handle(`workspace:${operation}`, (event, value) => {
      if (!isTrustedWorkspaceSender(event, window?.webContents, origin))
        throw new Error('Workspace access denied');
      return preferences[operation](value);
    });
  }
  ipcMain.on('workspace:save-sync', (event, value) => {
    event.returnValue = saveWorkspacePreferences(
      event,
      window?.webContents,
      origin,
      preferences,
      value,
    );
  });
  const desktopSession = session.fromPartition('alune-desktop');
  const { canWriteClipboard } = require('./clipboard-permissions.cjs');
  desktopSession.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(
      canWriteClipboard(contents, permission, details.requestingUrl, window?.webContents, origin),
    ),
  );
  desktopSession.setPermissionCheckHandler((contents, permission, requestingOrigin) =>
    canWriteClipboard(contents, permission, requestingOrigin, window?.webContents, origin),
  );
  // Keep the per-launch credential in the main process, including WebSocket upgrades.
  desktopSession.webRequest.onBeforeSendHeaders(
    { urls: [`${origin}/*`, `${origin.replace('http:', 'ws:')}/*`] },
    (details, callback) =>
      callback({ requestHeaders: { ...details.requestHeaders, Authorization: `Bearer ${token}` } }),
  );
  desktopSession.webRequest.onHeadersReceived({ urls: [`${origin}/*`] }, (details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' ${origin.replace('http:', 'ws:')}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
        ],
      },
    });
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      {
        label: '文件',
        submenu: [
          {
            label: '连接',
            accelerator: 'CmdOrCtrl+1',
            click: () => window?.loadURL(`${origin}/connections`),
          },
          {
            label: '仓库',
            accelerator: 'CmdOrCtrl+2',
            click: () => window?.loadURL(`${origin}/repositories`),
          },
          { type: 'separator' },
          { role: process.platform === 'darwin' ? 'close' : 'quit' },
        ],
      },
      {
        label: '编辑',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      {
        label: '视图',
        submenu: [
          { role: 'reload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { role: 'togglefullscreen' },
        ],
      },
      { role: 'windowMenu' },
    ]),
  );
  await createWindow();
  if (!smokeTest && supported && !installError) {
    const timer = setTimeout(() => {
      if (!quitting) void updates.check({ background: true });
    }, 10000);
    timer.unref();
    app.once('before-quit', () => clearTimeout(timer));
  }
  if (smokeTest) {
    await require(
      process.env.ALUNE_TERMINAL_SMOKE === '1' ? './terminal-smoke.cjs' : './smoke.cjs',
    )({ window, origin, token, updates, closeBackend, backend, version: app.getVersion() });
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
    if (!quitting && updates?.getState().status === 'installing') {
      event.preventDefault();
      return;
    }
    if (quitting || !backend) return;
    event.preventDefault();
    if (terminalRegistry()?.impact({}).length) {
      if (!terminalClosePending) {
        terminalClosePending = true;
        void confirmTerminalShutdown()
          .then((confirmed) => {
            if (confirmed) app.quit();
          })
          .finally(() => {
            terminalClosePending = false;
          });
      }
      return;
    }
    quitting = true;
    const timeout = setTimeout(() => {
      console.error('关闭本地服务超时');
      app.exit(1);
    }, 5000);
    closeBackend()
      .then(() => {
        clearTimeout(timeout);
        app.quit();
      })
      .catch(fail);
  });
}

function closeBackend() {
  if (!backend) return Promise.resolve();
  if (!closingBackend) {
    closingBackend = Promise.resolve()
      .then(async () => {
        if (!(await confirmTerminalShutdown())) throw new Error('已取消关闭终端；应用保持运行。');
        await backend.close();
      })
      .then(() => {
        backend = null;
      })
      .finally(() => {
        closingBackend = null;
      });
  }
  return closingBackend;
}

function terminalRegistry() {
  return backend?.get(require('./server/terminal/terminal-registry.js').TerminalRegistry);
}

async function confirmTerminalShutdown() {
  const registry = terminalRegistry();
  const sessions = registry?.impact({}) || [];
  if (!sessions.length) return true;
  if (window && !window.isDestroyed() && !window.webContents.isCrashed()) {
    const target = window;
    const requestId = randomBytes(16).toString('hex');
    const confirmed = await new Promise((resolve) => {
      const cleanup = () => {
        ipcMain.removeListener('terminal:shutdown-response', respond);
        target.webContents.removeListener('render-process-gone', cancelled);
        target.removeListener('closed', cancelled);
      };
      const cancelled = () => {
        cleanup();
        resolve(false);
      };
      const respond = (event, id, consent) => {
        if (
          id !== requestId ||
          event.sender !== target.webContents ||
          !isTrustedWorkspaceSender(event, target.webContents, origin)
        )
          return;
        cleanup();
        resolve(consent === true);
      };
      ipcMain.on('terminal:shutdown-response', respond);
      target.webContents.once('render-process-gone', cancelled);
      target.once('closed', cancelled);
      target.webContents.send('terminal:shutdown-request', { requestId, sessions });
    });
    if (!confirmed) return false;
    try {
      registry.remove(
        {},
        sessions.map((item) => item.id),
      );
      return true;
    } catch {
      return false;
    }
  }
  // If the renderer has crashed, the native fallback still defaults to cancel.
  const options = {
    type: 'warning',
    title: '关闭终端会话？',
    message: `将关闭 ${sessions.length} 个终端会话`,
    detail:
      sessions
        .map((item) => `${item.repositoryName} · ${item.environment}\n${item.initialPath}`)
        .join('\n\n') + '\n\n会话无法恢复，文件改动不会回滚；脱离会话的远端任务可能继续运行。',
    buttons: ['取消', '关闭全部会话'],
    defaultId: 0,
    cancelId: 0,
    checkboxLabel: '我了解会话不可恢复，并确认关闭',
    checkboxChecked: false,
    noLink: true,
  };
  const result =
    window && !window.isDestroyed()
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options);
  if (result.response !== 1 || !result.checkboxChecked) return false;
  try {
    registry.remove(
      {},
      sessions.map((item) => item.id),
    );
    return true;
  } catch {
    return false;
  } // A new session requires a fresh confirmation.
}

function fail(error) {
  console.error(error);
  if (!smokeTest) dialog.showErrorBox('Alune 启动失败', error.message || String(error));
  app.exit(1);
}
