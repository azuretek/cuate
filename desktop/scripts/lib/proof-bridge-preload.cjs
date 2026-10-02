// The window-chrome proof's stand-in for desktop/src/preload.cjs (desktop/scripts/prove-window-chrome.mjs). It is the
// window's preload, so window.bridge exists before any page script runs, exactly as in the app: the page's first calls
// (app.info, then storage.get for a saved server) are answered at boot instead of failing on a missing bridge. It
// answers as a shell with no saved server: app.info is the host the proof passes in, every other call is empty, so the
// page settles with no error and the proof then hands it a fixture chat to draw.
const { contextBridge } = require('electron');

const PREFIX = '--proof-host=';
const arg = process.argv.find((value) => value.startsWith(PREFIX));
const host = arg ? JSON.parse(decodeURIComponent(arg.slice(PREFIX.length))) : {};

contextBridge.exposeInMainWorld('bridge', Object.freeze({
  call: (name) => Promise.resolve(String(name) === 'app.info' ? host : null),
  on: () => () => {},
}));
