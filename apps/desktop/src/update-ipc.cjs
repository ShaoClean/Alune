const channels = ['state', 'check', 'download', 'cancel', 'install', 'open-file', 'reveal-file'];

function trustedSender(event, window, origin) {
  try {
    return Boolean(window && !window.isDestroyed() && event.sender === window.webContents
      && event.senderFrame === window.webContents.mainFrame
      && new URL(event.senderFrame.url).origin === origin);
  } catch { return false; }
}

function registerUpdateIPC({ ipcMain, service, getWindow, getOrigin }) {
  const actions = {
    state: () => service.getState(), check: () => service.check(), download: () => service.download(),
    cancel: () => service.cancel(), install: () => service.install(),
    'open-file': () => service.openFile(), 'reveal-file': () => service.openFile(true),
  };
  for (const channel of channels) {
    ipcMain.handle(`updates:${channel}`, (event, ...args) => {
      if (!trustedSender(event, getWindow(), getOrigin()) || args.length) throw new Error('不允许的更新请求');
      return actions[channel]();
    });
  }
  const listener = (state) => {
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    try {
      if (new URL(window.webContents.getURL()).origin === getOrigin()) window.webContents.send('updates:changed', state);
    } catch { /* The window may be closing or navigating. */ }
  };
  service.on('state', listener);
  return () => {
    service.off('state', listener);
    for (const channel of channels) ipcMain.removeHandler(`updates:${channel}`);
  };
}

module.exports = { registerUpdateIPC, trustedSender };
