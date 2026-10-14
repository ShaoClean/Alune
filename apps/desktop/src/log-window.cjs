const path = require('node:path');
const { createExternalLinkHandler } = require('./external-links.cjs');

// A single standalone log viewer window, sharing the main window's session so the
// per-launch Authorization header and CSP apply to it as well.
function createLogWindow({ BrowserWindow, getOrigin, iconPath, openExternal, show = true }) {
  let logWindow = null;

  function open() {
    const origin = getOrigin();
    if (!origin) return null;
    if (logWindow && !logWindow.isDestroyed()) {
      if (show) {
        if (logWindow.isMinimized()) logWindow.restore();
        logWindow.show();
        logWindow.focus();
      }
      return logWindow;
    }
    logWindow = new BrowserWindow({
      title: 'Alune 日志',
      icon: iconPath,
      width: 1040,
      height: 680,
      minWidth: 560,
      minHeight: 360,
      backgroundColor: '#171c27',
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
    const target = logWindow;
    target.webContents.setWindowOpenHandler(createExternalLinkHandler(openExternal));
    const guardNavigation = (event, url) => {
      if (new URL(url).origin !== origin) event.preventDefault();
    };
    target.webContents.on('will-navigate', guardNavigation);
    target.webContents.on('will-redirect', guardNavigation);
    target.webContents.on('will-attach-webview', (event) => event.preventDefault());
    target.once('ready-to-show', () => {
      if (show) target.show();
    });
    target.on('closed', () => {
      if (logWindow === target) logWindow = null;
    });
    void target.loadURL(`${origin}/logs`).catch(() => {});
    return target;
  }

  return {
    open,
    contents: () => (logWindow && !logWindow.isDestroyed() ? logWindow.webContents : null),
    close: () => {
      if (logWindow && !logWindow.isDestroyed()) logWindow.close();
    },
  };
}

module.exports = { createLogWindow };
