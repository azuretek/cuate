// The page's only way into the shell: one call, checked against core/spec/host-bridge.json in the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', Object.freeze({
  call: (name, args) => ipcRenderer.invoke('bridge', String(name), args ?? {}),
}));
