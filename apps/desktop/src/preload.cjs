const { contextBridge, ipcRenderer } = require('electron');

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
