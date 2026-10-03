// The desktop's implementation of core/spec/host-bridge.json, kept free of Electron imports so it is tested in Node.
import path from 'node:path';

const KEY = /^[a-z][a-z0-9.]{0,63}$/;
const checkKey = (key) => {
  if (typeof key !== 'string' || !KEY.test(key)) throw new Error('storage keys are lower-case words joined by dots');
};

// Values are encrypted with the OS keychain through Electron's safeStorage. Where no keychain is available the
// values live in memory for the session only, so a token is never written to disk in the clear.
export function createSecureStore({ file, safeStorage, fs }) {
  let cache = null;
  const memory = new Map();
  const encrypted = () => {
    try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
  };
  const load = () => {
    if (cache) return cache;
    const f = file();
    cache = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
    return cache;
  };
  const save = () => {
    const f = file();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(cache), { mode: 0o600 });
  };
  return {
    encrypted,
    get(key) {
      checkKey(key);
      if (memory.has(key)) return memory.get(key);
      if (!encrypted()) return null;
      const v = load()[key];
      return v ? safeStorage.decryptString(Buffer.from(v, 'base64')) : null;
    },
    set(key, value) {
      checkKey(key);
      if (typeof value !== 'string' || value.length > 8192) throw new Error('values are strings of at most 8 KB');
      if (!encrypted()) { memory.set(key, value); return false; }
      load()[key] = safeStorage.encryptString(value).toString('base64');
      save();
      memory.delete(key);
      return true;
    },
    delete(key) {
      checkKey(key);
      const had = memory.delete(key);
      const c = encrypted() ? load() : {};
      const inFile = Object.hasOwn(c, key);
      if (inFile) { delete c[key]; save(); }
      return had || inFile;
    },
  };
}

// The window controls are the shell's own: a platform with no window answers false, so a page that never draws the
// bar (the phones) still shares the one bridge spec.
const noWindow = { minimize: () => false, toggleMaximize: () => false, close: () => false };

// The scheme the page draws, so a shell that draws system bars over the page can match their icons and fill to it. The
// desktop window draws its own bar inside the page, so it has nothing to match and answers false.
const noAppearance = () => false;

export function createHandlers({ secure, notify, info, openExternal, checkUpdates = () => null, configureUpdates = () => false, downloadUpdates = () => false, installUpdate = () => false, windowControls = noWindow, appearance = noAppearance }) {
  return {
    'storage.get': async ({ key }) => secure.get(key),
    'storage.set': async ({ key, value }) => secure.set(key, value),
    'storage.delete': async ({ key }) => secure.delete(key),
    'app.info': async () => info(),
    notify: async ({ title, body }) => notify(String(title ?? '').slice(0, 200), String(body ?? '').slice(0, 500)),
    'open.external': async ({ url }) => openExternal(String(url ?? '')),
    // About's Check for updates (issue 171): the tray's own check, answering the state it reached; the outcome that
    // follows arrives on update.state as the tray's does.
    'updates.check': async () => checkUpdates() ?? null,
    // The phones read their release feed through this (issue 192); the desktop's updater reads its own feed, so the
    // desktop has none to hand the page.
    'updates.releases': async () => null,
    // The page holds the server's settings, so it tells the shell whether a found release may be fetched on its own.
    'updates.configure': async ({ autoDownload }) => configureUpdates(autoDownload === true),
    // An explicit download and install, asked for by the page. Each answers whether the shell accepted it, so the page
    // can leave the banner as it is rather than pretending an action the shell refused was taken.
    'updates.download': async () => downloadUpdates(),
    'updates.install': async () => installUpdate(),
    'window.minimize': async () => windowControls.minimize(),
    'window.toggleMaximize': async () => windowControls.toggleMaximize(),
    'window.close': async () => windowControls.close(),
    'window.appearance': async ({ scheme, background }) => appearance(scheme === 'dark' ? 'dark' : 'light', String(background ?? '')),
  };
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

export function mimeFor(file) {
  return TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
}
