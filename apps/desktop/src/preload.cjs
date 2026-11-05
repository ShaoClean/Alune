const { contextBridge, ipcRenderer } = require('electron');

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
  const listen = (name, fn) => {
    const listener = (_event, frame) => fn(frame);
    ipcRenderer.on(name, listener);
    return () => ipcRenderer.off(name, listener);
  };
  contextBridge.exposeInMainWorld('aluneAgent', {
    open: () => ipcRenderer.invoke('agent:open'),
    send: (frame) => ipcRenderer.invoke('agent:frame', frame),
    close: () => {
      void ipcRenderer.invoke('agent:close').catch(() => {});
    },
    onFrame: (fn) => listen('agent:frame', fn),
    onEnd: (fn) => listen('agent:end', fn),
  });
}
