const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('aluneTray', {
  getPreferences: () => ipcRenderer.invoke('tray:preferences'),
  setPreferences: (patch) => ipcRenderer.invoke('tray:set-preferences', patch),
  onPreferences: (callback) => subscribe('tray:preferences-changed', callback),
  publish: (snapshot) => ipcRenderer.send('tray:tabs', snapshot),
  repositoryChanged: (id) => ipcRenderer.send('tray:repository-changed', id),
  onSelect: (callback) => subscribe('tray:select', callback),
  onReadHead: (callback) => subscribe('tray:read-head', callback),
  replyHead: (reply) => ipcRenderer.send('tray:head', reply),
});

contextBridge.exposeInMainWorld('aluneTerminal', {
  onShutdownRequested: (callback) => {
    const listener = (_event, request) => callback(request);
    ipcRenderer.on('terminal:shutdown-request', listener);
    return () => ipcRenderer.removeListener('terminal:shutdown-request', listener);
  },
  respondToShutdown: (requestId, confirmed) =>
    ipcRenderer.send('terminal:shutdown-response', requestId, confirmed === true),
});

contextBridge.exposeInMainWorld('desktopUpdates', {
  getState: () => ipcRenderer.invoke('updates:state'),
  check: () => ipcRenderer.invoke('updates:check'),
  download: () => ipcRenderer.invoke('updates:download'),
  cancel: () => ipcRenderer.invoke('updates:cancel'),
  install: () => ipcRenderer.invoke('updates:install'),
  openFile: () => ipcRenderer.invoke('updates:open-file'),
  revealFile: () => ipcRenderer.invoke('updates:reveal-file'),
  subscribe: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('updates:changed', listener);
    return () => ipcRenderer.removeListener('updates:changed', listener);
  },
});

contextBridge.exposeInMainWorld('aluneWorkspace', {
  chooseDirectory: () => ipcRenderer.invoke('workspace:choose-directory'),
  load: () => ipcRenderer.invoke('workspace:load'),
  save: async (value) => {
    const error = ipcRenderer.sendSync('workspace:save-sync', value);
    if (error) throw new Error(error);
  },
  clear: () => ipcRenderer.invoke('workspace:clear'),
});

contextBridge.exposeInMainWorld('aluneLogs', {
  openWindow: () => ipcRenderer.invoke('logs:open-window'),
  openDirectory: () => ipcRenderer.invoke('logs:open-directory'),
  chooseDirectory: () => ipcRenderer.invoke('logs:choose-directory'),
});

if (process.argv.includes('--alune-agent-ui')) {
  let generation;
  const listen = (name, fn) => {
    const listener = (_event, id, frame) => {
      if (id === generation) fn(frame);
    };
    ipcRenderer.on(name, listener);
    return () => ipcRenderer.off(name, listener);
  };
  contextBridge.exposeInMainWorld('aluneAgent', {
    open: async () => {
      generation = await ipcRenderer.invoke('agent:open');
    },
    send: async (frame) => {
      if (!(await ipcRenderer.invoke('agent:frame', generation, frame)))
        throw new Error('工作区连接已关闭。');
    },
    close: () => {
      if (generation) ipcRenderer.send('agent:close', generation);
      generation = undefined;
    },
    onFrame: (fn) => listen('agent:frame', fn),
    onEnd: (fn) => listen('agent:end', fn),
  });
}
