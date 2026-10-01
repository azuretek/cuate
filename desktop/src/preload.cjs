// The page's only way into the shell: one call and one event subscription, checked against core/spec/host-bridge.json
// in the main process. Nothing else crosses.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', Object.freeze({
  call: (name, args) => ipcRenderer.invoke('bridge', String(name), args ?? {}),
  on: (name, handler) => {
    const channel = 'bridge:event:' + String(name);
    const listener = (_event, payload) => handler(payload ?? {});
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
}));
