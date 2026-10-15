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

// The app icon chosen in Settings (issue 167). A shell with no icon of its own to change answers that it applied none.
const noAppIcon = (icon) => ({ applied: false, icon });

// The app's own icons, redrawn from the theme and the unread count (issue 189). A shell with none to redraw answers false.
const noIcons = () => false;

// A document pressed in a conversation (issue 219). A shell with nowhere to save answers false.
const noSave = () => false;

// Open in (issue 374). A shell with no other app to hand a file to answers false.
const noOpen = () => false;

// A file's name, type and bytes as the page sent them, bounded and typed, never anything else it might carry.
const fileArgs = ({ name, mime, data }) => ({ name: String(name ?? '').slice(0, 255), mime: String(mime ?? '').slice(0, 100), data: typeof data === 'string' ? data : '' });

// The name a file is written under for Open in: its own last path part, with nothing that could leave the folder it is
// written to or that a file system refuses (a separator, a control character, a reserved Windows name), and never empty,
// so a copy can always be written and the app it opens in shows the name it was sent under.
export function openName(name) {
  // eslint-disable-next-line no-control-regex
  let base = String(name ?? '').split(/[\\/]/).pop().replace(/[\u0000-\u001f<>:"|?*]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '');
  if (/^(?:con|prn|aux|nul|com\d|lpt\d)(?:\..*)?$/i.test(base)) base = '_' + base;
  return base.slice(0, 200) || 'Attachment';
}

// Open in on the desktop (issue 374): each file is written to a fresh folder of its own inside one folder this run
// owns under the system's temporary directory, so two files with one name never meet, and opened in the system's
// default app for its type. The run's folder is removed when the app quits (cleanup), so no copy outlives the run.
// fs is node:fs's sync calls, openPath Electron's shell.openPath (it answers '' on success, an error string otherwise).
export function createFileOpener({ root, fs, openPath }) {
  let made = null;
  return {
    async open({ name, data }) {
      if (!data) return false;
      if (!made) { fs.mkdirSync(root, { recursive: true, mode: 0o700 }); made = root; }
      const dir = fs.mkdtempSync(path.join(root, 'f-'));
      const file = path.join(dir, openName(name));
      fs.writeFileSync(file, Buffer.from(data, 'base64'), { mode: 0o600 });
      const failed = await openPath(file);
      return !failed;
    },
    cleanup() {
      if (!made) return false;
      fs.rmSync(made, { recursive: true, force: true });
      made = null;
      return true;
    },
  };
}

// The colour tokens the page sends for the icon: strings only, a bounded handful, never anything else it might carry.
const iconColors = (colors) => (colors && typeof colors === 'object' && !Array.isArray(colors) ? Object.fromEntries(Object.entries(colors).filter(([k, v]) => /^[a-z][a-z-]{0,31}$/.test(k) && typeof v === 'string' && v.length <= 120).slice(0, 16)) : {});

// A notice's target as plain string ids, or null: the page's ids are strings, and nothing else is kept.
const noticeIds = ({ chatId, messageId }) => {
  const id = (v) => (typeof v === 'string' && v.length > 0 && v.length <= 200 ? v : null);
  return id(chatId) ? { chatId: id(chatId), messageId: id(messageId) } : null;
};

export function createHandlers({ secure, takeLink = () => null, notify, notifyPermission = () => 'unsupported', takeNotice = () => null, info, openExternal, saveFile = noSave, openFile = noOpen, checkUpdates = () => null, configureUpdates = () => false, downloadUpdates = () => false, installUpdate = () => false, windowControls = noWindow, appearance = noAppearance, appIcon = noAppIcon, icons = noIcons }) {
  return {
    'storage.get': async ({ key }) => secure.get(key),
    'storage.set': async ({ key, value }) => secure.set(key, value),
    'storage.delete': async ({ key }) => secure.delete(key),
    'app.info': async () => info(),
    // The messaging link the platform last opened this app with (issue 333), answered once.
    'link.take': async () => takeLink(),
    'app.icon': async ({ icon }) => appIcon(String(icon ?? '')),
    // A message notice carries where it leads (issue 331), kept with the notice for when it is pressed.
    notify: async ({ title, body, chatId, messageId }) => notify(String(title ?? '').slice(0, 200), String(body ?? '').slice(0, 500), noticeIds({ chatId, messageId })),
    // The notice last pressed, taken once (issue 331).
    'notify.take': async () => takeNotice(),
    // Where notifications stand (issue 327). A desktop shows them without asking; macOS asks on the first one shown.
    'notify.permission': async () => notifyPermission(),
    // A desktop keeps its connection open in the tray, so it has no push registration (issue 347).
    'push.token': async () => null,
    'open.external': async ({ url }) => openExternal(String(url ?? '')),
    // A document is offered for saving under its real name (issue 219): the page hands the bytes and the name, and the
    // shell shows its save dialog (desktop) or share or save sheet (phone).
    'file.save': async (args) => saveFile(fileArgs(args ?? {})),
    // Open in (issue 374): the shell writes a temporary copy and opens it in the system's default app for its type.
    'file.open': async (args) => openFile(fileArgs(args ?? {})),
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
    'icon.redraw': async ({ scheme, colors, unread }) => icons({ scheme: scheme === 'dark' ? 'dark' : 'light', colors: iconColors(colors), unread: Number.isFinite(unread) ? Math.max(0, Math.floor(unread)) : 0 }),
  };
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

export function mimeFor(file) {
  return TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
}
