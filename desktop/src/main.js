// The desktop shell: one window hosting core's app page over app://bundle, plus the host bridge. Nothing about the
// app lives here; the name comes from core/spec/naming.json.
import { app, BrowserWindow, protocol, ipcMain, Menu, Tray, nativeImage, safeStorage, Notification, shell, nativeTheme, dialog } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandlers, createSecureStore, mimeFor } from './bridge-handlers.js';
import { windowOptions } from './window-chrome.js';
import { clientReport } from '../../core/kit/rules/build.js';
import { controlLayout } from '../../core/app/rules/bar-layout.js';
import { contrastRatio } from '../../core/app/rules/theme.js';
import { settingsTabs } from '../../core/app/rules/settings.js';
import { tokenMismatches, expectedTokens } from './surface.js';
import updaterPackage from 'electron-updater';
import { startUpdates, checkForUpdates } from './updates.js';
import { createLifecycle, trayTemplate, trayIcon, appMenuTemplate } from './tray.js';
import { loadMasters, shellIcons, encodePng } from './icon-images.js';
import { renderIcon } from '../../core/app/rules/icon.js';
import { lockZoom } from './zoom-lock.js';
import { runDesign } from './design-capture.js';
import { retainSmokeFailure, captureRenderer, smokeTraceInstaller } from './smoke-failure.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CORE = app.isPackaged ? path.join(process.resourcesPath, 'core') : path.resolve(here, '../../core');
const naming = JSON.parse(readFileSync(path.join(CORE, 'spec/naming.json'), 'utf8'));
const bridgeSpec = JSON.parse(readFileSync(path.join(CORE, 'spec/host-bridge.json'), 'utf8'));
const tokenSpec = JSON.parse(readFileSync(path.join(CORE, 'spec/tokens.json'), 'utf8'));
const versionSpec = JSON.parse(readFileSync(path.join(CORE, 'spec/version.json'), 'utf8'));
const version = app.getVersion();
// The packaging step stamps the commit and the build date into the app's own package.json; a source run carries none.
function buildStamp() {
  try {
    const pkg = JSON.parse(readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8'));
    return { commit: pkg.buildCommit || null, builtAt: pkg.buildTime || null };
  } catch { return {}; }
}
const SMOKE = process.env.SMOKE_OUT || '';
// Every notice the shell is asked to show while smoking, so the smoke can prove one fired and one was suppressed.
const smokeNotices = [];
// Every bridge command the page calls while smoking, so the smoke can prove the banner's action called the command it
// says it does rather than trusting the button's label.
const smokeCalls = [];
// Every document the page asked to save while smoking, so the smoke can prove the press reached the shell under the
// file's real name rather than opening anything (issue 219).
const smokeSaves = [];

app.setName(naming.product);
if (SMOKE) app.setPath('userData', path.join(SMOKE, 'user-data'));
if (SMOKE && process.env.SMOKE_SOFTWARE_RENDERING) app.disableHardwareAcceleration();
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
if (!SMOKE && !app.requestSingleInstanceLock()) app.quit();

let win = null;
// The app icon chosen in Settings (issue 167): Follow theme, the default, leaves the icons to the theme (applyIcons,
// below); a fixed palette from core/spec/app-icons.json stands in for the theme's colours in every image the shell
// redraws, and on macOS, where the theme leaves the Dock to the bundle, it is drawn on the Dock while the app runs.
// The launcher's or the installed bundle's own icon is the platform's, and docs/features.md says so.
const appIconSpec = JSON.parse(readFileSync(path.join(CORE, 'spec/app-icons.json'), 'utf8'));
let appIconApplied = appIconSpec.default;
let appIconFixed = null;
function setAppIcon(icon) {
  const choice = appIconSpec.icons.find((i) => i.id === icon);
  if (!choice) return { applied: false, icon };
  appIconFixed = choice.colors ? { scheme: choice.scheme === 'dark' ? 'dark' : 'light', colors: choice.colors } : null;
  appIconApplied = icon;
  applyIcons();
  return { applied: true, icon };
}
// Set once the updater starts; the page calls updates.configure to apply the server's setting to it.
let updateControl = null;
// The last update state the shell reported. The check at start can finish before the page is listening, and a reload
// starts a page that heard nothing, so the state is told again once the page has loaded; the page announces a release
// once, so hearing it twice raises one notice.
let lastUpdateState = null;
// Every update state goes to the page the same way, whether the schedule's check, the tray's or a build that cannot
// update saying so.
const reportUpdate = (state) => {
  lastUpdateState = state;
  if (win && !win.isDestroyed()) win.webContents.send('bridge:event:update.state', state);
};
const updateFacts = () => ({ platform: process.platform, packaged: app.isPackaged, appImage: Boolean(process.env.APPIMAGE) });
// The tray, and the menu it carries. Closing the window hides it there; see tray.js.
let tray = null;
let trayMenu = null;
// The app's icons follow the active theme, the scheme and the unread count (issue 189): the page reports all three
// through icon.redraw, and the tray image, the window icon and the taskbar overlay are drawn again from the Flor de
// muerto masters whenever one of them would change. Until the page reports, the generated default-theme files stand.
const iconMasters = loadMasters(CORE);
let iconState = { scheme: 'light', colors: {}, unread: 0 };
let iconKey = null;
let windowIconKey = null;
let dockIconKey = null;
const smokeIcons = [];
// The badge the smoke draws at a count, whatever the page's own unread is, so the proof always has a counted image.
let smokeBadge = null;
const nativeFrom = (reps) => {
  const image = nativeImage.createEmpty();
  for (const r of reps) image.addRepresentation({ scaleFactor: r.scale, width: r.image.width, height: r.image.height, buffer: encodePng(r.image) });
  return image;
};
function applyIcons(next = {}) {
  iconState = { ...iconState, ...next };
  const out = shellIcons({ platform: process.platform, masters: iconMasters, tokens: tokenSpec.color, ...iconState, fixed: appIconFixed });
  // macOS: the Dock wears a fixed palette while the app runs, and the bundle's icon (the default theme's) once the
  // choice is Follow theme again.
  if (process.platform === 'darwin' && app.dock && (appIconFixed || dockIconKey)) {
    const dockKey = appIconFixed ? JSON.stringify(out.palette) : null;
    if (dockKey !== dockIconKey) {
      const palette = appIconFixed ? out.palette : shellIcons({ platform: process.platform, masters: iconMasters, tokens: tokenSpec.color }).palette;
      app.dock.setIcon(nativeFrom([{ scale: 1, image: renderIcon({ masters: iconMasters, palette, kind: 'app', size: 512 }) }]));
      dockIconKey = dockKey;
    }
  }
  if (out.key === iconKey) return true;
  iconKey = out.key;
  if (tray) {
    const image = nativeFrom(out.tray.reps);
    if (out.tray.template) image.setTemplateImage(true);
    tray.setImage(image);
    tray.setToolTip(out.description ? naming.product + ', ' + out.description : naming.product);
  }
  if (win && !win.isDestroyed()) {
    // The window icon depends on the palette alone, so a new count leaves it as it is.
    const paletteKey = JSON.stringify(out.palette);
    if (out.window && paletteKey !== windowIconKey) { win.setIcon(nativeFrom([{ scale: 1, image: out.window }])); windowIconKey = paletteKey; }
    if (process.platform === 'win32') win.setOverlayIcon(out.overlay ? nativeFrom(out.overlay) : null, out.description);
  }
  // macOS's Dock and a Linux launcher draw their own badge over the app icon; the shell gives them the same label
  // the overlay draws, so all three read alike: exact to 9, then 9+.
  if (process.platform === 'darwin' && app.dock) app.dock.setBadge(out.badgeText);
  else if (process.platform === 'linux') app.setBadgeCount(out.badgeCount);
  if (SMOKE) {
    // The badge at a count the taskbar shows, drawn whatever the page's own unread happens to be, so the proof always
    // has a counted image: the Windows overlay, or the tray macOS and the Linux panel draw.
    if (!smokeBadge) {
      const counted = shellIcons({ platform: process.platform, masters: iconMasters, tokens: tokenSpec.color, ...iconState, unread: 12, fixed: appIconFixed });
      const shot = counted.overlay ? counted.overlay[counted.overlay.length - 1] : counted.tray.reps[counted.tray.reps.length - 1];
      try { writeFileSync(path.join(SMOKE, 'icon-badge-12.png'), encodePng(shot.image)); } catch { /* a capture never fails the smoke */ }
      smokeBadge = { badgeText: counted.badgeText, overlay: Boolean(counted.overlay), unread: 12 };
    }
    smokeIcons.push({
      scheme: iconState.scheme,
      accent: iconState.colors.accent || null,
      unread: out.badgeCount,
      badge: out.badgeText,
      mark: out.palette.mark,
      tray: out.tray.reps.map((r) => r.image.data.reduce((s, v, i) => (s + v * ((i % 251) + 1)) % 1000003, 0)).join(','),
    });
  }
  return true;
}
const lifecycle = createLifecycle({
  getWindow: () => win,
  createWindow: () => createWindow(),
  send: (w, name, payload) => w.webContents.send('bridge:event:' + name, payload),
  quitApp: () => app.quit(),
  checkUpdates: () => checkForUpdates(updateControl, updateFacts(), reportUpdate),
});
const secure = createSecureStore({ file: () => path.join(app.getPath('userData'), 'secure-store.json'), safeStorage, fs: { readFileSync, writeFileSync, existsSync, mkdirSync } });
const handlers = createHandlers({
  secure,
  notify: (title, body) => {
    if (SMOKE) smokeNotices.push({ title, body });
    if (!Notification.isSupported()) return false;
    new Notification({ title, body }).show();
    return true;
  },
  // The client's own half of the build report: the version the bundle carries, the runtime versions only the shell
  // knows, and the commit and build date the packaging step stamped into the app. Nothing here reads the server.
  info: () => {
    const stamp = buildStamp();
    return clientReport({
      product: naming.product,
      version,
      channel: versionSpec.channel,
      commit: stamp.commit || null,
      builtAt: stamp.builtAt || null,
      versions: process.versions,
      platform: process.platform,
      arch: process.arch,
      packaged: app.isPackaged,
      appImage: Boolean(process.env.APPIMAGE),
    });
  },
  openExternal: (url) => {
    if (!/^https?:\/\//i.test(url)) return false;
    shell.openExternal(url);
    return true;
  },
  appIcon: (icon) => setAppIcon(icon),
  // A document is offered for saving under its real name (issue 219). While smoking, the dialog is not opened: the
  // request is recorded and answered, so the run never blocks on a modal the way a person's press would not.
  saveFile: async ({ name, mime, data }) => {
    if (SMOKE) { smokeSaves.push({ name, mime, bytes: data.length }); return true; }
    if (!win || win.isDestroyed()) return false;
    const picked = await dialog.showSaveDialog(win, { defaultPath: name || 'Attachment' });
    if (picked.canceled || !picked.filePath) return false;
    writeFileSync(picked.filePath, Buffer.from(data, 'base64'));
    return true;
  },
  // About's Check for updates runs the tray's own check and answers the state it reported, so the page draws the same
  // notice the event carries (issue 171).
  checkUpdates: () => {
    const before = lastUpdateState;
    checkForUpdates(updateControl, updateFacts(), reportUpdate);
    return lastUpdateState !== before ? lastUpdateState : null;
  },
  configureUpdates: (autoDownload) => (updateControl ? updateControl.setAutoDownload(autoDownload) : false),
  downloadUpdates: () => (updateControl ? updateControl.download() : false),
  installUpdate: () => (updateControl ? updateControl.install() : false),
  icons: (state) => applyIcons(state),
  // The window bar's controls: the page asks, and only the shell touches the BrowserWindow. On a platform with no
  // window the phones answer false, so the one bridge spec serves every shell.
  windowControls: {
    minimize: () => { if (!win || win.isDestroyed()) return false; win.minimize(); return true; },
    toggleMaximize: () => {
      if (!win || win.isDestroyed()) return false;
      if (win.isMaximized()) win.unmaximize(); else win.maximize();
      return win.isMaximized();
    },
    close: () => { if (!win || win.isDestroyed()) return false; win.close(); return true; },
  },
});

ipcMain.handle('bridge', (event, name, args) => {
  if (!win || event.sender !== win.webContents) throw new Error('bridge call from an unknown page');
  if (!Object.hasOwn(bridgeSpec.commands, name) || !Object.hasOwn(handlers, name)) throw new Error('undeclared bridge command: ' + name);
  if (SMOKE) smokeCalls.push(name);
  return handlers[name](args && typeof args === 'object' ? args : {});
});

function serve(req) {
  const url = new URL(req.url);
  const file = path.resolve(CORE, decodeURIComponent(url.pathname).replace(/^\/+/, ''));
  if (url.host !== 'bundle' || !file.startsWith(CORE + path.sep) || !existsSync(file)) return new Response('not found', { status: 404 });
  return new Response(readFileSync(file), { headers: { 'content-type': mimeFor(file) } });
}

async function runSmoke(w) {
  const wc = w.webContents;
  await new Promise((resolve) => wc.once('did-finish-load', resolve));
  const js = (code) => wc.executeJavaScript(code, true);
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (expr, ms = 30000) => {
    const t0 = Date.now();
    for (;;) {
      if (await js(expr)) return;
      if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + expr);
      await pause(200);
    }
  };
  // Captures are evidence and the report is the check, so a capture never fails or stalls the smoke.
  const within = (p, ms) => Promise.race([p, pause(ms).then(() => null)]);
  const captured = [];
  const shot = async (name) => {
    let png = null;
    try {
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
      const r = await within(wc.debugger.sendCommand('Page.captureScreenshot', { format: 'png' }), 8000);
      if (r && r.data) png = Buffer.from(r.data, 'base64');
    } catch { /* fall back to capturePage */ }
    if (!png) {
      try {
        const image = await within(wc.capturePage(), 8000);
        if (image && !image.isEmpty()) png = image.toPNG();
      } catch { /* no capture on this host */ }
    }
    if (png) {
      writeFileSync(path.join(SMOKE, name), png);
      captured.push(name);
    }
  };
  const report = { info: await js("window.bridge.call('app.info')"), packaged: app.isPackaged };
  await waitFor("document.querySelector('app-root')?.dataset.state === 'ready' && document.querySelectorAll('.bubble-row').length > 0");
  await pause(600);
  // No window bar: the app's surfaces reach the top edge and the top strip drags. The platform's arrangement is core's
  // own rules, so the smoke reads the DOM back and holds it to that answer: macOS keeps its traffic lights and leaves
  // room for them, while Windows and Linux draw min, max, close at the right of the contact header. Nothing renders the
  // product name, a bar or an icon over the top.
  const bar = await js(`(() => {
    if (document.querySelector('.window-bar') || document.querySelector('.window-title') || document.querySelector('.window-icon')) return null;
    const side = document.querySelector('.sidebar-head');
    const head = document.querySelector('.conv-head');
    if (!side || !head) return null;
    const group = head.querySelector('.window-controls');
    const c = group ? [...group.querySelectorAll('.window-control')] : [];
    const region = (el) => (el ? getComputedStyle(el).getPropertyValue('-webkit-app-region').trim() : null);
    const rect = (el) => { const b = el.getBoundingClientRect(); return { top: b.top, left: b.left, right: b.right, height: b.height }; };
    return {
      sidebarTop: rect(side).top, headTop: rect(head).top, sideRegion: region(side), headRegion: region(head),
      controls: Boolean(group), groupRegion: region(group), labelled: c.every((el) => (el.getAttribute('aria-label') || '').length > 0),
      order: c.map((el) => el.className.split(' ').find((k) => ['minimize', 'maximize', 'close'].includes(k))),
      head: rect(head), group: group ? rect(group) : null,
    };
  })()`);
  const barLayout = controlLayout({ platform: process.platform });
  report.windowBar = Boolean(bar) && bar.sidebarTop === 0 && bar.headTop === 0 && bar.sideRegion === 'drag' && bar.headRegion === 'drag'
    && JSON.stringify(bar.order) === JSON.stringify(barLayout.drawn ? barLayout.order : []);
  if (barLayout.drawn) report.windowBar = report.windowBar && bar.controls && bar.labelled && bar.groupRegion === 'no-drag' && bar.group.right <= bar.head.right + 0.5;
  else report.windowBar = report.windowBar && !bar.controls;
  if (!report.windowBar) console.error('window chrome: ' + JSON.stringify({ bar, barLayout }));
  // No application menu on Windows and Linux (issue 109); on macOS the minimal one, whose Quit carries Cmd+Q.
  const appMenu = Menu.getApplicationMenu();
  if (process.platform === 'darwin') {
    const quitItem = appMenu && appMenu.getMenuItemById('quit');
    const editRoles = appMenu && appMenu.items[1] && appMenu.items[1].submenu ? appMenu.items[1].submenu.items.map((i) => String(i.role).toLowerCase()) : [];
    report.appMenu = Boolean(appMenu) && appMenu.items.length === 2 && Boolean(quitItem) && quitItem.accelerator === 'Command+Q'
      && Boolean(appMenu.getMenuItemById('settings')) && Boolean(appMenu.getMenuItemById('about')) && ['copy', 'paste', 'cut', 'selectall'].every((r) => editRoles.includes(r));
    if (!report.appMenu) console.error('app menu: ' + JSON.stringify({ items: appMenu ? appMenu.items.map((i) => i.label) : null, quit: quitItem ? quitItem.accelerator : null, editRoles }));
  } else {
    report.appMenu = appMenu === null;
  }
  report.chats = await js("document.querySelectorAll('.chat-row').length");
  report.bubbles = await js("document.querySelectorAll('.bubble-row').length");
  report.images = await js("document.querySelectorAll('img.attachment-image').length");
  // Every popover wears the shared caret (issue 217). The guard reads each open panel back from the page: it must carry
  // the popover marks and its --caret-x must be a real offset inside the panel, aimed at the control that opened it.
  const carets = [];
  const caretOf = async (sel) => { const r = await js("(() => { const p = document.querySelector(" + JSON.stringify(sel) + "); if (!p) return { ok: false, why: 'no panel' }; const x = getComputedStyle(p).getPropertyValue('--caret-x').trim(); const m = /^(-?[0-9.]+)px$/.exec(x); const box = p.getBoundingClientRect(); return { ok: Boolean(p.hasAttribute('data-popover')) && Boolean(p.getAttribute('data-popover-edge')) && Boolean(m) && parseFloat(m[1]) >= 0 && parseFloat(m[1]) <= box.width, why: x }; })()"); carets.push({ sel, ...r }); return r; };
  // A resync refetches the open conversation in place: every DOM change while it runs is watched, and the conversation
  // never drops to no messages on the way. Emptying it first was what let a late first-connection resync read as none.
  const resync = await js(`(async () => {
    const root = document.querySelector('app-root');
    const count = () => document.querySelectorAll('.bubble-row').length;
    let least = count();
    const watch = new MutationObserver(() => { least = Math.min(least, count()); });
    watch.observe(document, { childList: true, subtree: true });
    await root.reload();
    await root.updateComplete;
    await new Promise((r) => setTimeout(r, 50));
    watch.disconnect();
    return { least, after: count() };
  })()`);
  report.resyncKeeps = resync.least > 0 && resync.after > 0;
  if (!report.resyncKeeps) console.error('resync: ' + JSON.stringify(resync));
  // The chats header is a search field with its mode, a filter icon, a sort icon and a gear, and no heading text, no
  // Settings text button and no pencil Edit button (issue 137).
  report.header = await js("(() => { const h = document.querySelector('.sidebar-head'); if (!h) return false; const gone = !h.querySelector('.title') && !h.querySelector('.text-button') && !h.querySelector('h1') && !h.querySelector('.edit-button'); return Boolean(h.querySelector('.search-box .search-mode-button') && h.querySelector('.search-box .chat-search') && h.querySelector('.filter-button') && h.querySelector('.sort-button') && h.querySelector('.gear-button') && gone); })()");
  const setSearch = (v) => js("(() => { const i = document.querySelector('.sidebar-head .chat-search'); i.value = " + JSON.stringify(v) + "; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
  // The search field's arrow opens our own menu (issue 173); a mode is chosen from it, and the caret is read while it is open.
  const setMode = async (v) => {
    await js("document.querySelector('.sidebar-head .search-mode-button').click()");
    await waitFor("Boolean(document.querySelector('.search-menu'))");
    await caretOf('.search-menu');
    await js("[...document.querySelectorAll('.search-menu .sort-choice')].find((b) => b.textContent.includes(" + JSON.stringify(v === 'text' ? 'Full text' : 'Contact') + ")).click()");
    await waitFor("!document.querySelector('.search-menu')");
  };
  const pressEnter = () => js("(() => { const i = document.querySelector('.sidebar-head .chat-search'); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()");
  const rowNames = "[...document.querySelectorAll('.chat-row .chat-name')].map((n) => n.textContent)";
  const namesAre = (list) => 'JSON.stringify(' + rowNames + ') === ' + JSON.stringify(JSON.stringify(list));
  // Typing narrows the list live: Contact reads the chat's name, Full text its messages.
  await setMode('contact');
  await setSearch('weekend');
  await waitFor(namesAre(['Weekend plans']));
  report.headerSearchName = true;
  await setMode('text');
  await setSearch('thank');
  await waitFor(namesAre(['+15555550142']));
  report.headerSearchMessage = true;
  await setSearch('');
  await setMode('contact');
  await waitFor("document.querySelectorAll('.chat-row').length >= 3");
  // Enter makes a term of what was typed and each later term refines, each in its own mode (issue 133): a Contact
  // "a" keeps the two chats whose names or people carry it, then a Full text "corner" keeps the one whose messages do.
  // Switching that chip to Contact empties the list and the empty text names both terms; removing chips widens it again.
  await setSearch('a');
  await pressEnter();
  await waitFor("document.querySelectorAll('.search-term').length === 1 && document.querySelector('.sidebar-head .chat-search').value === '' && " + namesAre(['Avery Quinn', 'Weekend plans']));
  await setMode('text');
  await setSearch('corner');
  await pressEnter();
  await waitFor("document.querySelectorAll('.search-term').length === 2 && " + namesAre(['Weekend plans']));
  const termModes = await js("JSON.stringify([...document.querySelectorAll('.search-term')].map((t) => [t.querySelector('.term-text').textContent, t.dataset.mode, t.querySelector('.term-mode').value]))");
  const termPad = await js("(() => { const s = getComputedStyle(document.querySelector('.search-term')); return { top: s.paddingTop, left: s.paddingLeft, right: s.paddingRight, gap: getComputedStyle(document.querySelector('.search-terms')).gap }; })()");
  nativeTheme.themeSource = 'light';
  await pause(300);
  await shot('13-search-terms-light.png');
  nativeTheme.themeSource = 'dark';
  await pause(300);
  await shot('13b-search-terms-dark.png');
  nativeTheme.themeSource = 'light';
  await js("(() => { const s = document.querySelectorAll('.search-term .term-mode')[1]; s.value = 'contact'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
  await waitFor("document.querySelectorAll('.chat-row').length === 0 && Boolean(document.querySelector('.list-empty'))");
  const emptyText = await js("document.querySelector('.list-empty').textContent.trim()");
  await js("document.querySelectorAll('.search-term .chip-clear')[1].click()");
  await waitFor("document.querySelectorAll('.search-term').length === 1 && " + namesAre(['Avery Quinn', 'Weekend plans']));
  await js("document.querySelector('.search-term .chip-clear').click()");
  await waitFor("document.querySelectorAll('.search-term').length === 0 && document.querySelectorAll('.chat-row').length >= 3");
  await setMode('contact');
  const searchChecks = {
    modes: termModes === JSON.stringify([['a', 'contact', 'contact'], ['corner', 'text', 'text']]),
    padded: parseFloat(termPad.top) > 0 && parseFloat(termPad.left) > 0 && parseFloat(termPad.gap) > 0,
    emptyNames: emptyText === 'No conversations match "a" (Contact) and "corner" (Contact).',
  };
  report.searchTerms = Object.values(searchChecks).every(Boolean);
  console.log('search terms: ' + JSON.stringify({ checks: searchChecks, termModes, termPad, emptyText }));
  // The sort icon is one of the header's icons (issue 136): its computed look matches the filter button's, and its
  // menu orders the list Recent, Name A to Z and Name Z to A, marks the choice and stores it on the server.
  const iconStyle = await js(`(() => {
    const keys = ['backgroundColor', 'color', 'fontSize', 'lineHeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderTopStyle', 'borderTopLeftRadius', 'boxShadow', 'cursor'];
    const read = (sel) => { const s = getComputedStyle(document.querySelector(sel)); return Object.fromEntries(keys.map((k) => [k, s[k]])); };
    return { sort: read('.sidebar-head .sort-button'), filter: read('.sidebar-head .filter-button'), gear: read('.sidebar-head .gear-button') };
  })()`);
  const sortHeld = async () => (await (await fetch(process.env.SMOKE_SERVER_URL + '/api/v1/settings', { headers: { authorization: 'Bearer ' + process.env.SMOKE_TOKEN } })).json()).values || {};
  const recentNames = await js('JSON.stringify(' + rowNames + ')');
  const byName = await js("JSON.stringify(" + rowNames + ".sort(new Intl.Collator(navigator.language, { sensitivity: 'base', numeric: true }).compare))");
  const chooseSort = async (label, value) => {
    await js("document.querySelector('.sidebar-head .sort-button').click()");
    await waitFor("Boolean(document.querySelector('.sort-menu'))");
    await caretOf('.sort-menu');
    const menu = await js("JSON.stringify([...document.querySelectorAll('.sort-menu .sort-choice')].map((b) => b.textContent.replace(/\\u2713/g, '').trim()))");
    if (label === 'Name A to Z') {
      nativeTheme.themeSource = 'light';
      await pause(300);
      await shot('14-sort-menu-light.png');
      nativeTheme.themeSource = 'dark';
      await pause(300);
      await shot('14b-sort-menu-dark.png');
      nativeTheme.themeSource = 'light';
    }
    await js("[...document.querySelectorAll('.sort-menu .sort-choice')].find((b) => b.textContent.includes(" + JSON.stringify(label) + ")).click()");
    await waitFor("!document.querySelector('.sort-menu')");
    const t0 = Date.now();
    while ((await sortHeld())['chats.sort'] !== value && Date.now() - t0 < 10000) await pause(200);
    await js("document.querySelector('.sidebar-head .sort-button').click()");
    await waitFor("Boolean(document.querySelector('.sort-menu'))");
    const marked = await js("[...document.querySelectorAll('.sort-menu .sort-choice[aria-checked=true]')].map((b) => b.textContent.replace(/\\u2713/g, '').trim()).join('|')");
    await js("document.querySelector('.sidebar-head .sort-button').click()");
    return { menu, marked, held: (await sortHeld())['chats.sort'], names: await js('JSON.stringify(' + rowNames + ')') };
  };
  const sortAZ = await chooseSort('Name A to Z', 'name');
  const sortZA = await chooseSort('Name Z to A', 'name-desc');
  const sortRecent = await chooseSort('Recent', 'recent');
  const sameLook = JSON.stringify(iconStyle.sort) === JSON.stringify(iconStyle.filter) && JSON.stringify(iconStyle.gear) === JSON.stringify(iconStyle.filter);
  const sortChecks = {
    sameLook,
    menu: sortAZ.menu === JSON.stringify(['Recent', 'Name A to Z', 'Name Z to A']),
    az: sortAZ.names === byName && sortAZ.marked === 'Name A to Z' && sortAZ.held === 'name',
    za: sortZA.names === JSON.stringify(JSON.parse(byName).reverse()) && sortZA.marked === 'Name Z to A' && sortZA.held === 'name-desc',
    recent: sortRecent.names === recentNames && sortRecent.marked === 'Recent' && sortRecent.held === 'recent',
    changes: byName !== recentNames,
  };
  report.sort = Object.values(sortChecks).every(Boolean);
  console.log('sort: ' + JSON.stringify({ checks: sortChecks, iconStyle, recentNames, byName, sortAZ, sortZA, sortRecent }));
  // The header's icons are the icon set (core/spec/tokens.json icons, issue 59): each control draws its glyph as a mask
  // painted in its own text colour at icon.size, so the glyph follows the scheme. Read in light and in dark.
  const iconRead = () => js(`(() => {
    const root = getComputedStyle(document.documentElement);
    return ['.filter-button', '.sort-button', '.gear-button'].map((sel) => {
      const b = document.querySelector('.sidebar-head ' + sel);
      const i = b && b.querySelector('.icon[data-icon]');
      if (!i) return { sel, icon: null, text: b ? b.textContent.trim() : null };
      const s = getComputedStyle(i);
      const r = i.getBoundingClientRect();
      return { sel, icon: i.dataset.icon, mask: (s.maskImage || s.webkitMaskImage || '').slice(0, 30), paint: s.backgroundColor, color: getComputedStyle(b).color, width: r.width, size: parseFloat(root.getPropertyValue('--icon-size')), text: b.textContent.trim() };
    });
  })()`);
  // Each read waits for the page to draw the scheme it was switched to, read from the scheme the page wrote on its root
  // (app-root's applyTheme), never from matchMedia: the query's answer flips before its change event reaches the page,
  // and the page's own data-scheme wins over the media query in the stylesheet, so a read taken on matchMedia alone saw
  // the dark icons still painted light on a busy macOS runner, with nothing wrong in the icons.
  nativeTheme.themeSource = 'light';
  await waitFor("document.documentElement.dataset.scheme === 'light'", 5000);
  await pause(300);
  const iconsLight = await iconRead();
  nativeTheme.themeSource = 'dark';
  await waitFor("document.documentElement.dataset.scheme === 'dark'", 5000);
  await pause(300);
  const iconsDark = await iconRead();
  nativeTheme.themeSource = 'light';
  const iconOk = (list) => list.every((x) => x.icon && x.mask.startsWith('url("data:image/svg+xml') && x.paint === x.color && x.width === x.size && x.text === '');
  const iconChecks = {
    light: iconOk(iconsLight),
    dark: iconOk(iconsDark),
    names: JSON.stringify(iconsLight.map((x) => x.icon)) === JSON.stringify(['list-filter', 'arrow-up-down', 'settings']),
    follows: iconsLight.every((x, n) => x.paint !== iconsDark[n].paint),
  };
  report.icons = Object.values(iconChecks).every(Boolean);
  console.log('icons: ' + JSON.stringify({ checks: iconChecks, iconsLight, iconsDark }));
  // The filter icon opens a dropdown holding the filters, the filter in force shows as a clearable chip, and clearing
  // the chip lifts it.
  await js("document.querySelector('.sidebar-head .filter-button').click()");
  await waitFor("Boolean(document.querySelector('.filter-menu'))");
  await caretOf('.filter-menu');
  await js("[...document.querySelectorAll('.filter-menu .chip')].find((c) => c.textContent.trim() === 'Unread').click()");
  report.headerFilter = await js("Boolean(document.querySelector('.filter-menu .chip[aria-pressed=true]')) && Boolean(document.querySelector('.active-chip'))");
  await js("document.querySelector('.active-chip .chip-clear').click()");
  await waitFor("!document.querySelector('.active-chip')");
  await js("document.querySelector('.sidebar-head .filter-button').click()");
  report.header = report.header && report.headerSearchName && report.headerSearchMessage && report.headerFilter;
  nativeTheme.themeSource = 'light';
  await pause(400);
  await shot('01-conversation-light.png');
  nativeTheme.themeSource = 'dark';
  await pause(400);
  await shot('02-conversation-dark.png');
  nativeTheme.themeSource = 'light';
  const live = process.env.SMOKE_LIVE_TEXT;
  if (live) {
    await waitFor(`[...document.querySelectorAll('.bubble')].some((b) => b.textContent.includes(${JSON.stringify(live)}))`, 20000);
    report.live = true;
  }
  // Every send waits for the send button to finish the one before: a press while a send is in flight is dropped
  // (core/kit/press.js, issue 140), which is the point, so the smoke does not race its own earlier send.
  const sendIdle = "document.querySelector('app-composer button.send')?.dataset.press !== 'pending'";
  const sendText = async (value) => {
    await waitFor(sendIdle, 20000);
    await js(`(() => { const t = document.querySelector('app-composer textarea'); t.value = ${JSON.stringify(value)}; document.querySelector('app-composer button.send').click(); return true; })()`);
  };
  const text = process.env.SMOKE_SEND_TEXT;
  if (text) {
    // A double press sends once (issue 140): the field is filled again and Send pressed again while the first send is
    // in flight. The second press is dropped and its text stays in the field; the server holds one message.
    const srvUrl = process.env.SMOKE_SERVER_URL;
    const srvAuth = { authorization: 'Bearer ' + process.env.SMOKE_TOKEN };
    const sentCount = async () => {
      const chatId = await js("document.querySelector('app-root').openChatId");
      const page = await (await fetch(srvUrl + '/api/v1/chats/' + encodeURIComponent(chatId) + '/messages?limit=100', { headers: srvAuth })).json();
      return (page.messages || []).filter((m) => m.text === text).length;
    };
    await waitFor(sendIdle, 20000);
    const double = await js(`(() => {
      const t = document.querySelector('app-composer textarea');
      const b = document.querySelector('app-composer button.send');
      t.value = ${JSON.stringify(text)};
      b.click();
      const first = { press: b.dataset.press || 'idle', busy: b.getAttribute('aria-busy') };
      t.value = ${JSON.stringify(text)};
      b.click();
      const kept = t.value;
      t.value = '';
      return { ...first, kept };
    })()`);
    await waitFor(`[...document.querySelectorAll('.bubble-row.mine')].some((r) => r.textContent.includes(${JSON.stringify(text)}) && !r.dataset.id.startsWith('local:'))`, 20000);
    await waitFor(sendIdle, 20000);
    await pause(800);
    const bubblesSent = await js(`[...document.querySelectorAll('.bubble-row.mine')].filter((r) => r.textContent.includes(${JSON.stringify(text)})).length`);
    const serverHeld = await sentCount();
    report.sendOnce = double.press === 'pending' && double.busy === 'true' && double.kept === text && bubblesSent === 1 && serverHeld === 1;
    console.log('send once: ' + JSON.stringify({ double, bubblesSent, serverHeld }));
    report.sent = true;
  }
  await pause(300);
  await shot('03-after-send.png');

  // The message box (issue 139) grows a line at a time with its text and scrolls only past its maximum, with the app's
  // themed bar. One, three and many lines are typed into it; each reading is the field's height and whether it draws a
  // bar, which is the width the bar takes from the field's box. Shift+Enter is pressed as a real key and adds a line,
  // Enter sends, and the send brings the field back to one line.
  const fieldReading = (value) => js(`(() => {
    const t = document.querySelector('app-composer textarea');
    t.value = ${JSON.stringify(value)};
    t.dispatchEvent(new Event('input', { bubbles: true }));
    const s = getComputedStyle(t);
    const edge = parseFloat(s.borderLeftWidth) + parseFloat(s.borderRightWidth);
    return { h: t.offsetHeight, max: parseFloat(s.maxHeight), bar: t.offsetWidth - t.clientWidth - edge, overflow: s.overflowY, hidden: t.scrollHeight - t.clientHeight, color: s.scrollbarColor };
  })()`);
  const empty = await fieldReading('');
  const one = await fieldReading('one line');
  const three = await fieldReading('first line\nsecond line\nthird line');
  nativeTheme.themeSource = 'light';
  await pause(300);
  await shot('03e-composer-three-lines-light.png');
  nativeTheme.themeSource = 'dark';
  await pause(300);
  await shot('03f-composer-three-lines-dark.png');
  const many = await fieldReading(Array.from({ length: 30 }, (_, i) => 'line ' + (i + 1)).join('\n'));
  await js("(() => { const t = document.querySelector('app-composer textarea'); t.scrollTop = t.scrollHeight; return true; })()");
  await pause(300);
  await shot('03g-composer-many-lines-dark.png');
  nativeTheme.themeSource = 'light';
  await pause(300);
  await shot('03h-composer-many-lines-light.png');
  const cleared = await fieldReading('');
  await js("(() => { const t = document.querySelector('app-composer textarea'); t.focus(); return document.activeElement === t; })()");
  for (const ch of 'Typed in') wc.sendInputEvent({ type: 'char', keyCode: ch });
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter', modifiers: ['shift'] });
  wc.sendInputEvent({ type: 'char', keyCode: '\r', modifiers: ['shift'] });
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter', modifiers: ['shift'] });
  for (const ch of 'the smoke') wc.sendInputEvent({ type: 'char', keyCode: ch });
  await pause(200);
  const typed = await js("(() => { const t = document.querySelector('app-composer textarea'); return { value: t.value, h: t.offsetHeight }; })()");
  // Enter sends on its key press, so no character follows it into the emptied field.
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  await waitFor(`[...document.querySelectorAll('.bubble-row.mine')].some((r) => r.textContent.includes('Typed in') && r.textContent.includes('the smoke') && !r.dataset.id.startsWith('local:'))`, 20000);
  const sentBack = await js("(() => { const t = document.querySelector('app-composer textarea'); return { value: t.value, h: t.offsetHeight }; })()");
  const composerChecks = {
    oneLine: one.h === empty.h && one.bar === 0 && one.hidden <= 0,
    threeLines: three.h > one.h * 2 && three.h < three.max && three.bar === 0 && three.hidden <= 0 && three.overflow === 'hidden',
    atMaximum: Math.abs(many.h - many.max) < 1 && many.hidden > 0 && many.overflow === 'auto',
    themedBar: many.color !== 'auto' && many.color !== '',
    shrinks: cleared.h === empty.h && cleared.overflow === 'hidden',
    shiftEnter: typed.value === 'Typed in\nthe smoke' && typed.h > empty.h,
    enterSends: sentBack.value === '' && sentBack.h === empty.h,
  };
  report.composerGrows = Object.values(composerChecks).every(Boolean);
  console.log('composer grows: ' + JSON.stringify({ checks: composerChecks, empty, one, three, many, cleared, typed, sentBack }));

  // Close goes to the tray (issue 115). A send is started and the window closed before it lands, through the control the
  // platform's user would press: the close in the contact header on Windows and Linux, the native close on macOS. The
  // window must hide rather than close, the app keep running, the server answer a request from outside while it is
  // hidden, the page's own event stream keep delivering, and the send finish.
  const traySrv = process.env.SMOKE_SERVER_URL;
  const trayAuth = { authorization: 'Bearer ' + process.env.SMOKE_TOKEN, 'content-type': 'application/json' };
  const IN_FLIGHT = 'Sent as the window closed';
  const visibleWithin = async (want, ms = 5000) => {
    for (const t0 = Date.now(); w.isVisible() !== want && Date.now() - t0 < ms;) await pause(100);
    return w.isVisible() === want;
  };
  // Restoring a minimised window is asynchronous on macOS: the window stays minimised until the restore animation ends,
  // which can be after the page has already drawn what the click asked for. The raise is read as a state the window
  // reaches, the same way the minimise is, never sampled once.
  const raisedWithin = async (ms = 5000) => {
    const raised = () => w.isVisible() && !w.isMinimized();
    for (const t0 = Date.now(); !raised() && Date.now() - t0 < ms;) await pause(100);
    return raised();
  };
  const closeWindow = barLayout.drawn
    ? () => js("(() => { document.querySelector('.conv-head .window-control.close').click(); return true; })()")
    : () => { w.close(); };
  await sendText(IN_FLIGHT);
  await closeWindow();
  const hid = await visibleWithin(false);
  const kept = !w.isDestroyed() && !lifecycle.quitting;
  const answered = (await fetch(traySrv + '/api/v1/settings', { headers: trayAuth })).ok;
  await fetch(traySrv + '/api/v1/settings', { method: 'PUT', headers: trayAuth, body: JSON.stringify({ values: { 'notifications.updateReady': false } }) });
  await waitFor("document.querySelector('app-root')?.settings?.['notifications.updateReady'] === false", 15000);
  const streamed = !w.isVisible();
  await fetch(traySrv + '/api/v1/settings', { method: 'PUT', headers: trayAuth, body: JSON.stringify({ values: { 'notifications.updateReady': true } }) });
  await waitFor(`[...document.querySelectorAll('.bubble-row.mine')].some((r) => r.textContent.includes(${JSON.stringify(IN_FLIGHT)}) && !r.dataset.id.startsWith('local:'))`, 20000);
  const finished = !w.isVisible();
  const closeChecks = { hid, kept, answered, streamed, finished };
  report.closeToTray = Object.values(closeChecks).every(Boolean);
  console.log('close to tray: ' + JSON.stringify(closeChecks));

  // The tray's menu opens screens in the app. Each item is clicked on the real tray menu, the one the icon carries, and
  // each must raise the window first: shown from hidden, restored from minimised. Check for updates runs the existing
  // check, and its outcome is drawn where the scheduled check reports, the update banner; a run from source cannot
  // update itself, so it says that in the app.
  const trayItem = (id) => trayMenu.getMenuItemById(id);
  // The About page is the sheet's page (issue 171): the sheet is named About, it draws app-about with its rows and no
  // settings page, and any push that brought it has finished.
  const aboutShown = "(() => { const s = document.querySelector('.sheet'); const a = document.querySelector('app-about'); return Boolean(s && s.getAttribute('aria-label') === 'About' && a && a.querySelector('.about-row') && !document.querySelector('app-settings') && !a.getAnimations().some((x) => x.playState === 'running')); })()";
  const trayOrder = trayMenu.items.filter((i) => i.type !== 'separator').map((i) => i.id).join('|');
  trayItem('settings').click();
  const settingsRaised = await visibleWithin(true);
  await waitFor("Boolean(document.querySelector('app-settings .sheet-back'))", 10000);
  w.minimize();
  for (const t0 = Date.now(); !w.isMinimized() && Date.now() - t0 < 3000;) await pause(100);
  const minimised = w.isMinimized();
  // The tray's About opens the About page (issue 171); with Settings up it is pushed over Settings.
  trayItem('about').click();
  await waitFor(aboutShown, 10000);
  const aboutRaised = await raisedWithin();
  const aboutState = { visible: w.isVisible(), minimised: w.isMinimized() };
  w.close();
  const hidAgain = await visibleWithin(false);
  trayItem('checkUpdates').click();
  const updatesRaised = await visibleWithin(true);
  await waitFor("!document.querySelector('.sheet') && (document.querySelector('.app-notice')?.textContent || '').includes('does not update itself')", 10000);
  await pause(300);
  await shot('04-tray-check-updates.png');
  await js("document.querySelector('.app-notice .close-button').click()");
  await waitFor("!document.querySelector('.app-notice')", 5000);
  w.close();
  await visibleWithin(false);
  trayItem('show').click();
  const trayShown = await visibleWithin(true);
  const trayChecks = { order: trayOrder === 'show|settings|about|checkUpdates|quit', settingsRaised, aboutRaised, hidAgain, updatesRaised, shown: trayShown, quitting: !lifecycle.quitting };
  report.tray = Object.values(trayChecks).every(Boolean);
  console.log('tray: ' + JSON.stringify({ checks: trayChecks, minimised, aboutState }));

  // The emoji panel: the grid draws first, the search field and the categories sit below it, the recently used row
  // (once there is one) sits last, nearest the emoji button, and the panel keeps one height, so typing a query
  // narrows the grid without moving the composer or the grid's top edge. The order the eye reads is the order the
  // keyboard walks: the grid, then the field, then the tabs, then the recents.
  await js("document.querySelector('app-composer button.tool[aria-label=\"Emoji\"]').click()");
  await waitFor("Boolean(document.querySelector('app-emoji-picker .emoji-grid'))");
  await caretOf('.emoji-picker');
  await pause(250);
  const emojiBefore = await js("(() => { const picker = document.querySelector('app-emoji-picker'); const grid = picker.querySelector('.emoji-grid'); const panel = picker.querySelector('.emoji-picker'); return { composerTop: document.querySelector('app-composer').getBoundingClientRect().top, gridTop: grid.getBoundingClientRect().top, rows: picker.querySelectorAll('.emoji-grid .emoji-cell').length, tabs: picker.querySelectorAll('.emoji-tab').length, active: picker.querySelectorAll('.emoji-tab.active').length, order: [...panel.children].map((n) => n.className) }; })()");
  await js("(() => { const f = document.querySelector('app-emoji-picker .emoji-search'); f.value = 'heart'; f.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
  await pause(250);
  const emojiAfter = await js("(() => { const picker = document.querySelector('app-emoji-picker'); const grid = picker.querySelector('.emoji-grid'); return { composerTop: document.querySelector('app-composer').getBoundingClientRect().top, gridTop: grid ? grid.getBoundingClientRect().top : null, rows: picker.querySelectorAll('.emoji-grid .emoji-cell').length, tabs: picker.querySelectorAll('.emoji-tab').length }; })()");
  // With recents present (issue 123), the recently used row is the edge of the panel facing the emoji button: the
  // panel opens upward from the composer, so the row is its last child and sits at its bottom, just above the composer.
  await js("(() => { const f = document.querySelector('app-emoji-picker .emoji-search'); f.value = ''; f.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
  await pause(150);
  await js("(() => { const cells = [...document.querySelectorAll('app-emoji-picker .emoji-grid .emoji-cell')].slice(0, 3); cells.forEach((c) => c.click()); cells[0].click(); return cells.length; })()");
  await waitFor("Boolean(document.querySelector('app-emoji-picker .emoji-row'))", 5000);
  await pause(250);
  const emojiRecents = await js("(() => { const picker = document.querySelector('app-emoji-picker'); const panel = picker.querySelector('.emoji-picker'); const row = picker.querySelector('.emoji-row'); const grid = picker.querySelector('.emoji-grid'); const button = document.querySelector('app-composer button.tool[aria-label=\"Emoji\"]').getBoundingClientRect(); const r = row.getBoundingClientRect(); const p = panel.getBoundingClientRect(); return { side: panel.dataset.side, last: panel.lastElementChild === row, cells: row.querySelectorAll('.emoji-cell').length, rowBottom: r.bottom, panelBottom: p.bottom, gridBottom: grid.getBoundingClientRect().bottom, rowTop: r.top, buttonTop: button.top, order: [...panel.children].map((n) => n.className) }; })()");
  nativeTheme.themeSource = 'light';
  await pause(300);
  await shot('03c-emoji-recents-light.png');
  nativeTheme.themeSource = 'dark';
  await pause(300);
  await shot('03d-emoji-recents-dark.png');
  nativeTheme.themeSource = 'light';
  await js("(() => { const t = document.querySelector('app-composer textarea'); t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
  const emojiOrder = emojiBefore.order.join('|');
  const emojiPanelChecks = {
    recentsNearButton: emojiRecents.side === 'above' && emojiRecents.last && emojiRecents.cells === 3 && emojiRecents.rowTop > emojiRecents.gridBottom && emojiRecents.panelBottom - emojiRecents.rowBottom < 40 && emojiRecents.rowBottom <= emojiRecents.buttonTop,
    order: emojiOrder.indexOf('emoji-grid') >= 0 && emojiOrder.indexOf('emoji-grid') < emojiOrder.indexOf('emoji-search') && emojiOrder.indexOf('emoji-search') < emojiOrder.indexOf('emoji-tabs'),
    active: emojiBefore.active === 1,
    tabs: emojiBefore.tabs > 4 && emojiAfter.tabs === emojiBefore.tabs,
    narrowed: emojiBefore.rows > emojiAfter.rows && emojiAfter.rows > 0,
    gridHeld: Math.abs(emojiBefore.gridTop - emojiAfter.gridTop) < 1,
    composerHeld: Math.abs(emojiBefore.composerTop - emojiAfter.composerTop) < 1,
  };
  report.emojiPanel = Object.values(emojiPanelChecks).every(Boolean);
  console.log('emoji panel: ' + JSON.stringify({ checks: emojiPanelChecks, before: emojiBefore, after: emojiAfter, recents: emojiRecents, order: emojiOrder }));
  await js("document.querySelector('app-composer button.tool[aria-label=\"Emoji\"]').click()");

  // The attach menu (issue 72): the attach button sits beside the emoji button, opens a short menu upward from the
  // composer rather than a sheet, and a file picked there stages above the field, uploads, and sends with its caption.
  // The file is handed to the input the way the system picker would, since a smoke cannot drive the OS dialog.
  await js("document.querySelector('app-composer button.tool[aria-label=\"Attach\"]').click()");
  await waitFor("Boolean(document.querySelector('app-composer .attach-menu'))");
  await caretOf('.attach-menu');
  const attachMenu = await js("(() => { const c = document.querySelector('app-composer'); const menu = c.querySelector('.attach-menu'); const tools = [...c.querySelectorAll('.composer-tools button.tool')].map((b) => b.getAttribute('aria-label')); return { tools, items: [...menu.querySelectorAll('[role=menuitem]')].map((b) => b.textContent.trim()), above: menu.getBoundingClientRect().bottom <= c.querySelector('form').getBoundingClientRect().top + 1, sheet: menu.getBoundingClientRect().width >= window.innerWidth }; })()");
  await js("document.querySelector('app-composer button.tool[aria-label=\"Attach\"]').click()");
  const ATTACH_CAPTION = 'smoke caption \u{1F44B}\u{1F3FD}';
  await js(`(() => { const c = document.querySelector('app-composer'); const input = c.querySelector('input[type=file]'); const dt = new DataTransfer(); dt.items.add(new File(['synthetic smoke file'], 'smoke-note.txt', { type: 'text/plain' })); input.files = dt.files; input.dispatchEvent(new Event('change')); return true; })()`);
  await waitFor("Boolean(document.querySelector('app-composer .staged-file'))");
  const staged = await js("document.querySelector('app-composer .staged-name').textContent");
  await sendText(ATTACH_CAPTION);
  await waitFor(`[...document.querySelectorAll('.bubble-row.mine')].some((r) => r.textContent.includes(${JSON.stringify(ATTACH_CAPTION)}) && r.textContent.includes('smoke-note.txt') && !r.dataset.id.startsWith('local:'))`, 20000);
  const attachChecks = {
    beside: attachMenu.tools.join('|') === 'Attach|Emoji',
    items: attachMenu.items.length === 2,
    above: attachMenu.above,
    notSheet: !attachMenu.sheet,
    staged: staged === 'smoke-note.txt',
    cleared: await js("!document.querySelector('app-composer .staged-file')"),
  };
  report.attachMenu = Object.values(attachChecks).every(Boolean);
  console.log('attach menu: ' + JSON.stringify({ checks: attachChecks, menu: attachMenu }));
  await shot('03b-after-file-send.png');

  // A message's actions (issues 138 and 169). A right click, or a long click with the mouse, opens one menu on a
  // message: its time, then Reply in thread and React as icons from the shared set, and on your own message the time and
  // React only. React opens the composer's own emoji panel, never a second picker in the list; a standard tapback chosen
  // there goes out through the server and shows on the bubble as yours, choosing it again takes it off, and an emoji the
  // engine cannot send is refused under the message. Reply in thread fades every message outside the thread, the
  // composer says it is replying without repeating the message, and cancelling brings the conversation back.
  const TARGET = 'FAKE-0013';
  const OWN = 'FAKE-0012';
  const REPLY = 'Replying from the desktop smoke';
  const row = '.bubble-row[data-id="' + TARGET + '"]';
  const ownRow = '.bubble-row[data-id="' + OWN + '"]';
  const q = (s) => JSON.stringify(s);
  const rightClick = (sel) => js(`(() => { const b = document.querySelector(${q(sel + ' .bubble')}); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: r.left + 4, clientY: r.top + 4 })); return true; })()`);
  const escape = () => js("(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })()");
  const menuOf = (sel) => js(`(() => {
    const m = document.querySelector(${q(sel + ' .message-menu')});
    if (!m) return null;
    const list = document.querySelector('.messages').getBoundingClientRect();
    const r = m.getBoundingClientRect();
    const icons = [...m.querySelectorAll('.message-action .icon')];
    return {
      time: (m.querySelector('.message-time')?.textContent || '').trim(), datetime: m.querySelector('.message-time')?.getAttribute('datetime') || '',
      labels: [...m.querySelectorAll('.message-action')].map((x) => x.getAttribute('aria-label')), icons: icons.map((i) => i.dataset.icon),
      drawn: icons.every((i) => { const s = getComputedStyle(i); return (s.maskImage || s.webkitMaskImage || 'none') !== 'none' && i.getBoundingClientRect().width > 0; }),
      tapbacks: m.querySelectorAll('.tapback').length, inside: r.top >= list.top - 1 && r.bottom <= list.bottom + 1,
    };
  })()`);
  const both = async (name) => {
    await pause(250);
    await shot(name + '-light.png');
    nativeTheme.themeSource = 'dark';
    await pause(400);
    await shot(name + '-dark.png');
    nativeTheme.themeSource = 'light';
    await pause(250);
  };
  await rightClick(row);
  await waitFor(`Boolean(document.querySelector(${q(row + ' .message-menu')}))`, 10000);
  const theirMenu = await menuOf(row);
  await caretOf('.message-menu');
  await both('13-message-menu');
  await escape();
  await waitFor(`!document.querySelector(${q(row + ' .message-menu')})`, 5000);
  // A long click: the main mouse button held on your own message, then released, opens the menu and presses nothing.
  await js(`(() => { const b = document.querySelector(${q(ownRow + ' .bubble')}); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 3, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX: r.left + 6, clientY: r.top + 6 })); return true; })()`);
  await pause(700);
  await js(`(() => { const b = document.querySelector(${q(ownRow + ' .bubble')}); const r = b.getBoundingClientRect(); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 3, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 0, clientX: r.left + 6, clientY: r.top + 6 })); b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })); return true; })()`);
  await waitFor(`Boolean(document.querySelector(${q(ownRow + ' .message-menu')}))`, 10000);
  const ownMenu = await menuOf(ownRow);
  await both('13c-own-message-menu');
  await escape();
  // React opens the composer's emoji panel; the panel's pick is the reaction.
  const reactFrom = async (query) => {
    await rightClick(row);
    await waitFor(`Boolean(document.querySelector(${q(row + ' .message-menu .message-action[aria-label="React"]')}))`, 10000);
    await js(`document.querySelector(${q(row + ' .message-menu .message-action[aria-label="React"]')}).click()`);
    await waitFor("Boolean(document.querySelector('app-composer app-emoji-picker .emoji-grid .emoji-cell'))", 10000);
    await pause(300); // the list makes room above the panel and brings the message into it
    const state = await js(`({ composer: Boolean(document.querySelector('app-composer app-emoji-picker')), inList: Boolean(document.querySelector('.messages app-emoji-picker')), menu: Boolean(document.querySelector(${q(row + ' .message-menu')})), targeted: document.querySelector(${q(row)}).classList.contains('targeted'), clear: document.querySelector(${q(row + ' .bubble')}).getBoundingClientRect().bottom <= document.querySelector('app-composer .emoji-picker').getBoundingClientRect().top })`);
    await js(`(() => { const f = document.querySelector('app-composer .emoji-search'); f.value = ${q(query)}; f.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await pause(250);
    return state;
  };
  const pick = (glyph) => js(`(() => { const cells = [...document.querySelectorAll('app-composer app-emoji-picker .emoji-grid .emoji-cell')]; const c = cells.find((x) => x.textContent === ${q(glyph)}); if (!c) return null; c.click(); return c.textContent; })()`);
  const panel = await reactFrom('thumbs up');
  await both('14-react-panel');
  // Reactions float at the bubble's top outer corner with no background, and adding one moves no message (issue 182).
  const layout = () => js("[...document.querySelectorAll('.messages .bubble-row')].map((r) => [r.dataset.id, r.offsetTop, r.offsetHeight])");
  const corner = (sel) => js(`(() => { const body = document.querySelector(${q(sel + ' .bubble-body')}); const re = body && body.querySelector('.reactions'); if (!re) return null; const b = body.getBoundingClientRect(); const r = re.getBoundingClientRect(); const s = getComputedStyle(re.querySelector('.reaction')); return { dx: Math.round(r.left + r.width / 2 - b.left), dy: Math.round(r.top + r.height / 2 - b.top), w: Math.round(b.width), bg: s.backgroundColor, border: s.borderTopWidth, shadow: s.boxShadow }; })()`);
  const beforeReact = await layout();
  const liked = await pick('\u{1F44D}');
  await waitFor(`[...document.querySelectorAll(${q(row + ' .reaction.mine')})].some((r) => r.textContent.includes('\u{1F44D}'))`, 10000);
  const reacted = Boolean(liked) && await js("!document.querySelector('app-composer app-emoji-picker') && !document.querySelector('.message-menu') && !document.querySelector('.bubble-row.targeted')");
  const afterReact = await layout();
  const receivedCorner = await corner(row);
  const sentCorner = await corner(ownRow);
  const floats = (c, side) => Boolean(c) && Math.abs(c.dy) <= 4 && (side === 'right' ? Math.abs(c.dx - c.w) <= 6 : Math.abs(c.dx) <= 6) && c.bg === 'rgba(0, 0, 0, 0)' && c.border === '0px' && c.shadow === 'none';
  const reactionGeometry = { received: floats(receivedCorner, 'right'), sent: floats(sentCorner, 'left'), noShift: JSON.stringify(beforeReact) === JSON.stringify(afterReact) };
  console.log('reaction geometry: ' + JSON.stringify({ checks: reactionGeometry, received: receivedCorner, sent: sentCorner }));
  await both('14-reacted');
  await reactFrom('thumbs up');
  await pick('\u{1F44D}');
  await waitFor(`!document.querySelector(${q(row + ' .reaction.mine')})`, 10000);
  const unreacted = await js("!document.querySelector('app-composer app-emoji-picker')");
  await reactFrom('party');
  const customPicked = await pick('\u{1F389}');
  await waitFor(`(document.querySelector(${q(row + ' .message-note')})?.textContent || '').includes('standard tapbacks')`, 10000);
  const refusedCustom = await js(`!document.querySelector(${q(row + ' .reaction.mine')}) && !document.querySelector('app-emoji-picker')`);
  // Any emoji someone else reacted with arrives as a reaction on the message it names (issue 188): the fixture's raised
  // hands on your own message, drawn at the bubble's corner like a tapback and not marked as yours, on a desktop window
  // and at a phone's width, light and dark.
  const EMOJI_TARGET = '.bubble-row[data-id="FAKE-0009"]';
  const emojiOn = () => js(`(() => { const row = document.querySelector(${q(EMOJI_TARGET)}); if (!row) return null; row.querySelector('.bubble').scrollIntoView({ block: 'center' }); return [...row.querySelectorAll('.reaction')].map((r) => ({ text: r.textContent.trim(), mine: r.classList.contains('mine') })); })()`);
  const emojiDesktop = await emojiOn();
  await pause(1200); // the refused pick's failure mark on the emoji control settles back to idle before the capture
  await both('14e-emoji-reaction');
  // A phone's width is emulated, as the phone checks below do, since the window has a minimum width. The conversation is
  // the pane there, and the drawer is left as it was found, since a later check opens it.
  const emojiListOpen = await js("document.querySelector('app-root').listOpen");
  if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
  await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await waitFor('window.innerWidth === 390', 5000);
  await js("(() => { const root = document.querySelector('app-root'); if (root.listOpen) root.closeDrawer(); return true; })()");
  await waitFor("document.querySelector('.shell')?.dataset.pane === 'conversation'", 5000);
  await pause(400);
  const emojiPhone = await emojiOn();
  await both('14f-emoji-reaction-phone');
  await wc.debugger.sendCommand('Emulation.clearDeviceMetricsOverride', {});
  await js(`(() => { document.querySelector('app-root').listOpen = ${JSON.stringify(emojiListOpen)}; return true; })()`);
  await pause(300);
  const shows = (list) => Array.isArray(list) && list.some((r) => r.text.includes('\u{1F64C}') && !r.mine);
  const receivedEmoji = shows(emojiDesktop) && shows(emojiPhone);
  console.log('emoji reaction: ' + JSON.stringify({ desktop: emojiDesktop, phone: emojiPhone }));
  const reactChecks = {
    menu: Boolean(theirMenu) && Boolean(theirMenu.time) && theirMenu.datetime.length > 0 && theirMenu.labels.join('|') === 'Reply in thread|React' && theirMenu.icons.join('|') === 'reply|smile-plus' && theirMenu.drawn && theirMenu.tapbacks === 0,
    inside: Boolean(theirMenu) && theirMenu.inside,
    ownNoReply: Boolean(ownMenu) && Boolean(ownMenu.time) && ownMenu.labels.join('|') === 'React',
    composerPanel: panel.composer && !panel.inList && !panel.menu && panel.targeted && panel.clear,
    reacted, unreacted, refusedCustom: Boolean(customPicked) && refusedCustom, receivedEmoji,
  };
  report.react = Object.values(reactChecks).every(Boolean);
  console.log('react: ' + JSON.stringify({ checks: reactChecks, theirMenu, ownMenu, panel, customPicked }));

  // Reply in thread opens the thread as its own conversation over the rest, which blurs behind it; the composer repeats
  // none of the message (issues 169 and 183).
  const inThread = '.thread-view ' + row;
  const startReply = async () => {
    await rightClick(row);
    await waitFor(`Boolean(document.querySelector(${q(row + ' .message-action[aria-label="Reply in thread"]')}))`, 10000);
    await js(`document.querySelector(${q(row + ' .message-action[aria-label="Reply in thread"]')}).click()`);
    await waitFor(`document.querySelector('.conv-body')?.dataset.thread === ${q(TARGET)} && Boolean(document.querySelector(${q(inThread)}))`, 10000);
    await pause(400); // the thread arrives on --motion-normal; read it settled, not a frame of it.
  };
  const focusState = () => js(`(() => {
    const view = document.querySelector('.thread-view');
    const list = document.querySelector('.messages');
    const c = document.querySelector('app-composer');
    const sharp = view ? [...view.querySelectorAll('.bubble-row')] : [];
    return {
      thread: document.querySelector('.conv-body').dataset.thread || null,
      ids: sharp.map((r) => r.dataset.id), sharp: sharp.every((r) => { for (let e = r; e; e = e.parentElement) if (getComputedStyle(e).filter !== 'none') return false; return true; }),
      blurred: getComputedStyle(list).filter.includes('blur'), inert: list.inert, behind: list.querySelectorAll('.bubble-row').length,
      indicator: (c.querySelector('.composer-thread')?.textContent || '').trim(), repeats: c.textContent.includes('See you soon'), banner: Boolean(c.querySelector('.composer-reply')),
      placeholder: c.querySelector('textarea')?.placeholder || '', close: Boolean(document.querySelector('.thread-view .thread-list > .thread-card-head .close-button')) && !document.querySelector('.conv-head .close-button'), back: Boolean(document.querySelector('.conv-head .conv-back')),
      separators: view ? view.querySelectorAll('.separator').length : 0,
      focused: document.activeElement === c.querySelector('textarea'), animation: view ? getComputedStyle(view).animationName : null, labels: document.querySelectorAll('.messages .reply-link').length + [...list.querySelectorAll('.bubble-row')].filter((r) => /Reply to/.test(r.textContent)).length,
    };
  })()`);
  await pause(1200); // the refused reaction's failure mark on the emoji button runs out before the capture
  // Motion is pinned both ways rather than inherited: a Windows runner reports reduced motion of its own.
  if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
  await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await startReply();
  const focused = await focusState();
  await both('15-thread-focus');
  await js("document.querySelector('.thread-view .close-button').click()");
  await waitFor("!document.querySelector('.conv-body').dataset.thread && !document.querySelector('.thread-view')", 5000);
  await pause(400);
  const cancelled = await focusState();
  await shot('15b-thread-cancelled-light.png');
  // Reduced motion keeps the thread without its arrival animation.
  await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await startReply();
  const still = await focusState();
  await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { media: '', features: [] });
  const threadChecks = {
    view: focused.thread === TARGET && focused.ids.join('|') === TARGET && focused.sharp && focused.blurred && focused.inert && focused.behind > 1,
    noBanner: !focused.indicator && focused.placeholder === 'Reply' && !focused.repeats && !focused.banner,
    header: focused.close && focused.back && focused.separators === focused.ids.length,
    noLabels: focused.labels === 0,
    focused: focused.focused,
    restored: !cancelled.thread && !cancelled.blurred && !cancelled.inert && !cancelled.indicator && cancelled.ids.length === 0 && cancelled.placeholder === 'Message' && !cancelled.close,
    reduced: still.animation === 'none' && focused.animation === 'thread-in' && still.blurred,
  };
  console.log('thread view: ' + JSON.stringify({ checks: threadChecks, focused, cancelled, still }));
  const replyFocused = Object.values(threadChecks).every(Boolean);

  // The message box grows while the conversation is scrolled back and while it is at its end, and the conversation keeps
  // its place through both (issues 139 and 142). The reply is typed as real keys, Shift+Enter between its lines, with the
  // conversation scrolled back: the first message in view must stay within 2px, the reply's quote must stay above the
  // field, and the text, caret and a selection must survive the growth and window resizes that rewrap its long line,
  // with the field growing and shrinking to fit each width. At the end of the conversation the same growth and resize
  // must leave it at its end. The field is then emptied and the reply below is sent as before, still threaded.
  const typeKeys = async (lines) => {
    lines.forEach((line, i) => {
      if (i) {
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter', modifiers: ['shift'] });
        wc.sendInputEvent({ type: 'char', keyCode: '\r', modifiers: ['shift'] });
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter', modifiers: ['shift'] });
      }
      for (const ch of line) wc.sendInputEvent({ type: 'char', keyCode: ch });
    });
    await pause(400);
  };
  const growPlace = () => js(`(() => {
    const m = document.querySelector('.messages');
    const top = m.getBoundingClientRect().top;
    const first = [...m.querySelectorAll('.bubble-row')].find((r) => r.getBoundingClientRect().bottom - top > 0);
    const t = document.querySelector('app-composer textarea');
    const s = getComputedStyle(t);
    return {
      key: first ? first.dataset.id : null, offset: first ? Math.round(first.getBoundingClientRect().top - top) : null,
      scrollTop: Math.round(m.scrollTop), fromEnd: Math.round(m.scrollHeight - m.clientHeight - m.scrollTop),
      text: t.value, start: t.selectionStart, end: t.selectionEnd, focused: document.activeElement === t,
      h: t.offsetHeight, max: parseFloat(s.maxHeight), hidden: t.scrollHeight - t.clientHeight, overflow: s.overflowY,
      thread: document.querySelector('.conv-body').dataset.thread || '', indicator: t.placeholder === 'Reply',
    };
  })()`);
  const fits = (s) => s.hidden <= 0 || (s.overflow === 'auto' && Math.abs(s.h - s.max) < 1);
  const sameRow = (a, b) => Boolean(a.key) && a.key === b.key && Math.abs(a.offset - b.offset) <= 2;
  const [w0, h0] = w.getSize();
  const BACK = ['Typed while', 'scrolled back', 'and a last line long enough that a narrower window has to wrap it onto more lines than the wide window needed, so the field must grow again'];
  await js("(() => { const m = document.querySelector('.messages'); m.scrollTop = Math.round((m.scrollHeight - m.clientHeight) / 2); document.querySelector('app-composer textarea').focus(); return true; })()");
  await pause(400);
  const backBefore = await growPlace();
  await typeKeys(BACK);
  const backGrown = await growPlace();
  await shot('15c-composer-scrolled-back-light.png');
  await js("(() => { const t = document.querySelector('app-composer textarea'); t.setSelectionRange(6, 19); return true; })()");
  const backSteps = [];
  for (const [width, height] of [[760, 600], [900, 640], [w0, h0]]) {
    w.setSize(width, height);
    await pause(600);
    backSteps.push({ step: width + 'x' + height, ...(await growPlace()) });
  }
  await js("(() => { const t = document.querySelector('app-composer textarea'); t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); const m = document.querySelector('.messages'); m.scrollTop = m.scrollHeight; t.focus(); return true; })()");
  await pause(500);
  const END = ['At the end', 'it stays', 'at the end'];
  const endBefore = await growPlace();
  await typeKeys(END);
  const endGrown = await growPlace();
  await shot('15d-composer-at-end-light.png');
  w.setSize(760, 600);
  await pause(600);
  const endResized = await growPlace();
  w.setSize(w0, h0);
  await pause(600);
  const endBack = await growPlace();
  await js("(() => { const t = document.querySelector('app-composer textarea'); t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); t.focus(); return true; })()");
  await pause(300);
  const keepChecks = {
    scrolledBack: backBefore.scrollTop > 0 && backBefore.fromEnd > 100,
    grewBack: backGrown.h > backBefore.h * 2 && backGrown.text === BACK.join('\n') && backGrown.start === backGrown.text.length && backGrown.end === backGrown.text.length && backGrown.focused,
    placeOnGrowth: sameRow(backGrown, backBefore),
    threadKept: [backGrown, ...backSteps, endGrown, endResized].every((s) => s.thread === TARGET && s.indicator),
    placeOnResize: backSteps.every((s) => sameRow(s, backGrown)),
    draftOnResize: backSteps.every((s) => s.text === backGrown.text && s.start === 6 && s.end === 19),
    fitsEveryWidth: [backGrown, ...backSteps].every(fits),
    rewraps: backSteps[0].h > backGrown.h && Math.abs(backSteps[2].h - backGrown.h) <= 1,
    endStays: endBefore.fromEnd <= 2 && endGrown.fromEnd <= 2 && endResized.fromEnd <= 2 && endBack.fromEnd <= 2,
    grewAtEnd: endGrown.h > endBefore.h * 2 && endGrown.text === END.join('\n') && endGrown.start === endGrown.text.length && fits(endResized),
  };
  report.composerGrows = report.composerGrows && Object.values(keepChecks).every(Boolean);
  console.log('composer keeps place: ' + JSON.stringify({ checks: keepChecks, backBefore, backGrown, backSteps, endBefore, endGrown, endResized, endBack }));
  await js(`(() => { const t = document.querySelector('app-composer textarea'); t.value = ${q(REPLY)}; document.querySelector('app-composer button.send').click(); return true; })()`);
  const replySel = `[...document.querySelectorAll('.messages .bubble-row.mine')].find((r) => r.textContent.includes(${q(REPLY)}) && !r.dataset.id.startsWith('local:'))`;
  await waitFor(`Boolean(${replySel}?.previousElementSibling?.matches('.thread-ghost-row'))`, 20000);
  const replied = await js(`(() => { const r = ${replySel}; const g = r.previousElementSibling; return { id: r.dataset.id, root: g.dataset.thread, ghost: (g.querySelector('.thread-ghost')?.textContent || '').trim(), count: (g.querySelector('.thread-count')?.textContent || '').trim(), side: g.classList.contains('theirs') ? 'theirs' : 'mine', line: Boolean(r.querySelector('.thread-line')), text: r.textContent, enabled: !g.querySelector('.thread-ghost').disabled, cleared: !document.querySelector('.conv-body').dataset.thread && !document.querySelector('.messages.behind') && document.querySelector('app-composer textarea').placeholder === 'Message' }; })()`);
  await js(`(() => { const r = ${replySel}; r.scrollIntoView({ block: 'center' }); return true; })()`);
  await pause(300);
  await shot('16-replied-light.png');
  nativeTheme.themeSource = 'dark';
  await pause(400);
  await shot('16b-replied-dark.png');
  nativeTheme.themeSource = 'light';
  // The reply count opens its thread, and the reply sent from the thread is in it, after its first message.
  await js(`${replySel}.previousElementSibling.querySelector('.thread-count').click()`);
  await waitFor(`Boolean(document.querySelector(${q('.thread-view .bubble-row[data-id="' + TARGET + '"]')}))`, 5000);
  await pause(400);
  const landed = await js(`[...document.querySelectorAll('.thread-view .bubble-row')].map((r) => r.dataset.id)`);
  await both('16c-thread-with-reply');
  await escape();
  await waitFor("!document.querySelector('.thread-view')", 5000);
  // The fixture's own thread (issue 195): Avery's reply to your earlier message carries the line, the ghost of your
  // message sits above the two replies with their count, and the ordinary messages, which the engine chains to the
  // message before them, carry nothing. The thread opens from the line, and on a phone from the reply itself, with
  // exactly its three messages, on a desktop window and at a phone's width, light and dark.
  const FIXTURE_ROOT = 'FAKE-0009';
  const FIXTURE_REPLY = 'FAKE-0014';
  const marksState = () => js(`(() => {
    const list = document.querySelector('.messages');
    const rows = [...list.querySelectorAll('.bubble-row')];
    const reply = list.querySelector('.bubble-row[data-id="${FIXTURE_REPLY}"]');
    const ghost = reply && reply.previousElementSibling;
    if (reply) reply.scrollIntoView({ block: 'center' });
    const lines = [...list.querySelectorAll('.thread-line')].map((l) => ({ from: l.dataset.from, to: l.dataset.to, side: l.dataset.side, lane: Number(l.dataset.lane), hidden: l.hidden }));
    return {
      pairs: lines.map((l) => l.from + '>' + l.to),
      lanes: lines.map((l) => l.side + l.lane),
      lines,
      ghosts: [...list.querySelectorAll('.thread-ghost-row')].map((g) => ({ root: g.dataset.thread, side: g.classList.contains('mine') ? 'mine' : 'theirs', count: (g.querySelector('.thread-count')?.textContent || '').trim(), fill: getComputedStyle(g.querySelector('.thread-ghost')).backgroundColor })),
      marked: rows.filter((r) => r.classList.contains('thread-reply')).map((r) => r.dataset.id),
      ghostRoot: ghost && ghost.matches('.thread-ghost-row') ? ghost.dataset.thread : null,
      count: ghost ? (ghost.querySelector('.thread-count')?.textContent || '').trim() : '', ghostFill: ghost && ghost.querySelector('.thread-ghost') ? getComputedStyle(ghost.querySelector('.thread-ghost')).backgroundColor : '',
    };
  })()`);
  const marks = await marksState();
  await both('16d-thread-marks');
  await js(`document.querySelector('.messages .thread-line[data-from="${FIXTURE_ROOT}"][data-to="${FIXTURE_REPLY}"]').click()`);
  await waitFor(`document.querySelector('.conv-body')?.dataset.thread === ${q(FIXTURE_ROOT)}`, 5000);
  await pause(400);
  const fixtureThread = await focusState();
  await both('16e-fixture-thread');
  await js("document.querySelector('.thread-view .close-button').click()");
  await waitFor("!document.querySelector('.thread-view')", 5000);
  const marksListOpen = await js("document.querySelector('app-root').listOpen");
  if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
  await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await waitFor('window.innerWidth === 390', 5000);
  await js("(() => { const root = document.querySelector('app-root'); if (root.listOpen) root.closeDrawer(); return true; })()");
  await waitFor("document.querySelector('.shell')?.dataset.pane === 'conversation'", 5000);
  await pause(400);
  const phoneMarks = await marksState();
  await both('16f-thread-marks-phone');
  await js(`document.querySelector('.messages .bubble-row[data-id="${FIXTURE_REPLY}"] .bubble').click()`);
  await waitFor(`document.querySelector('.conv-body')?.dataset.thread === ${q(FIXTURE_ROOT)}`, 5000);
  await pause(400);
  const fixturePhoneThread = await focusState();
  await both('16g-fixture-thread-phone');
  await js("document.querySelector('.thread-view .close-button').click()");
  await waitFor("!document.querySelector('.thread-view')", 5000);
  await wc.debugger.sendCommand('Emulation.clearDeviceMetricsOverride', {});
  await js(`(() => { document.querySelector('app-root').listOpen = ${JSON.stringify(marksListOpen)}; return true; })()`);
  await pause(300);
  const fixtureIds = [FIXTURE_ROOT, FIXTURE_REPLY, 'FAKE-0015'].join('|');
  // Two interleaved threads (issue 214): each draws a line only where it changes hands, T2's own side sits on its own
  // lane beside T1's, and no message outside the two threads (the document included) is marked.
  const marksOk = (m) => {
    const laneOf = (pair) => { const i = m.pairs.indexOf(pair); return i < 0 ? null : m.lanes[i]; };
    const expected = ['FAKE-0009>FAKE-0014', 'FAKE-0014>FAKE-0015', 'FAKE-0016>FAKE-0017', 'FAKE-0017>FAKE-0018'];
    const markedOk = ['FAKE-0014', 'FAKE-0015', 'FAKE-0017', 'FAKE-0018'].every((id) => m.marked.includes(id)) && m.marked.includes(replied.id) && !m.marked.includes('FAKE-0013') && !m.marked.includes('FAKE-0019');
    return expected.every((p) => m.pairs.includes(p)) && m.lines.every((l) => !l.hidden)
      && laneOf('FAKE-0009>FAKE-0014') !== laneOf('FAKE-0017>FAKE-0018')
      && markedOk && m.ghostFill === 'rgba(0, 0, 0, 0)'
      && m.ghosts.some((g) => g.root === 'FAKE-0009' && g.side === 'mine' && g.count === '2 Replies' && g.fill === 'rgba(0, 0, 0, 0)')
      && m.ghosts.some((g) => g.root === 'FAKE-0016' && g.side === 'theirs' && g.count === '2 Replies' && g.fill === 'rgba(0, 0, 0, 0)');
  };
  const threadOk = (t) => t.ids.join('|') === fixtureIds && t.close && t.back && t.placeholder === 'Reply' && t.separators === 3 && t.blurred;
  const replyChecks = { focused: replyFocused, relationship: replied.root === TARGET && replied.ghost.includes('See you soon') && replied.side === 'theirs' && replied.count === '1 Reply' && !replied.line && !/Reply to/.test(replied.text), enabled: replied.enabled, cleared: replied.cleared, landsInThread: landed[0] === TARGET && landed.includes(replied.id) && landed.length === 2, marks: marksOk(marks), phoneMarks: marksOk(phoneMarks), fixtureThread: threadOk(fixtureThread), phoneThread: threadOk(fixturePhoneThread) };
  report.reply = Object.values(replyChecks).every(Boolean) && Object.values(reactionGeometry).every(Boolean);
  console.log('reply: ' + JSON.stringify({ checks: replyChecks, replied, landed, marks, phoneMarks, fixtureThread, fixturePhoneThread }));

  // A document (issue 219): the booking PDF is a save control on a message in no thread; pressing it offers to save it
  // under its real name and never opens a thread.
  const docSel = '.messages .bubble-row[data-id="FAKE-0019"]';
  await js(`(() => { const r = document.querySelector(${q(docSel)}); if (r) r.scrollIntoView({ block: 'center' }); return true; })()`);
  await pause(300);
  await both('16h-document');
  const docMark = await js(`(() => { const r = document.querySelector(${q(docSel)}); if (!r) return null; const b = r.querySelector('.attachment-file'); return { marked: r.classList.contains('thread-reply'), tag: b && b.tagName, label: b && b.getAttribute('aria-label') }; })()`);
  smokeSaves.length = 0;
  await js(`document.querySelector(${q(docSel + ' .attachment-file')}).click()`);
  for (let i = 0; i < 40 && !smokeSaves.length; i += 1) await pause(100);
  const docSave = smokeSaves[0] || null;
  const docAfter = await js(`({ thread: Boolean(document.querySelector('.thread-view')), marked: document.querySelector(${q(docSel)})?.classList.contains('thread-reply') })`);
  const documentChecks = { found: Boolean(docMark), button: docMark?.tag === 'BUTTON', label: docMark?.label === 'Save booking.pdf', unmarked: docMark ? docMark.marked === false : false, saved: docSave?.name === 'booking.pdf' && docSave?.mime === 'application/pdf', bytes: docSave ? docSave.bytes > 0 : false, noThread: docAfter.thread === false && docAfter.marked === false };
  report.document = Object.values(documentChecks).every(Boolean);
  console.log('document: ' + JSON.stringify({ checks: documentChecks, docMark, docSave, docAfter }));

  // Pictures (issue 126): a received picture and a staged one both show an aspect-correct, dressed preview, and the
  // viewer opens over the sheet's own blurred, darkened backdrop. The desktop drives the viewer with real mouse input
  // (sendInputEvent): a left click zooms in, a right click zooms out with no context menu, the wheel zooms about the
  // pointer. A finger's pinch, drag and double tap are driven as touch pointers through the same component the phone
  // shells host. Each reading is the scale the viewer says it drew, so a click that did nothing fails.
  const previewOf = (sel) => js('(() => { const img = document.querySelector(' + JSON.stringify(sel) + '); if (!img || !img.complete || !img.naturalWidth) return null; const box = img.closest(".attachment-preview") || img; const r = img.getBoundingClientRect(); const s = getComputedStyle(box); return { w: r.width, h: r.height, nw: img.naturalWidth, nh: img.naturalHeight, shadow: s.boxShadow, radius: parseFloat(s.borderTopLeftRadius), border: s.borderTopWidth }; })()');
  const dressed = (p) => Boolean(p) && Math.abs(p.w / p.h - p.nw / p.nh) < 0.02 && p.shadow !== 'none' && p.radius > 0 && p.border !== '0px';
  await js("(() => { const img = document.querySelector('app-attachment .attachment-preview img'); if (img) img.scrollIntoView({ block: 'center' }); return true; })()");
  await waitFor("Boolean(document.querySelector('app-attachment .attachment-preview img.attachment-image')?.naturalWidth)", 10000);
  const received = await previewOf('app-attachment .attachment-preview img.attachment-image');
  await pause(200);
  await shot('10-image-received-light.png');
  nativeTheme.themeSource = 'dark';
  await pause(400);
  await shot('10b-image-received-dark.png');
  nativeTheme.themeSource = 'light';
  await pause(200);
  // A picture staged in the composer, drawn on a canvas in the page so the smoke carries no image file of its own.
  await js("(() => { const c = document.createElement('canvas'); c.width = 360; c.height = 240; const g = c.getContext('2d'); const grad = g.createLinearGradient(0, 0, 360, 240); grad.addColorStop(0, 'rgb(40, 90, 160)'); grad.addColorStop(1, 'rgb(240, 170, 90)'); g.fillStyle = grad; g.fillRect(0, 0, 360, 240); c.toBlob((blob) => { const input = document.querySelector('app-composer input[type=file]'); const dt = new DataTransfer(); dt.items.add(new File([blob], 'smoke-picture.png', { type: 'image/png' })); input.files = dt.files; input.dispatchEvent(new Event('change')); }, 'image/png'); return true; })()");
  await waitFor("Boolean(document.querySelector('app-composer .staged-preview-image')?.naturalWidth)", 10000);
  const composed = await previewOf('app-composer .staged-preview-image');
  await pause(200);
  await shot('11-image-composer-light.png');
  nativeTheme.themeSource = 'dark';
  await pause(400);
  await shot('11b-image-composer-dark.png');
  nativeTheme.themeSource = 'light';
  await pause(200);
  const imagePreviewChecks = { received: dressed(received), composer: dressed(composed) };
  report.imagePreview = Object.values(imagePreviewChecks).every(Boolean);
  console.log('image preview: ' + JSON.stringify({ checks: imagePreviewChecks, received, composed }));
  // The staged picture opens the viewer too; then it comes back off, so nothing is sent.
  await js("document.querySelector('app-composer .staged-preview').click()");
  await waitFor("Boolean(document.querySelector('app-image-viewer .viewer-image')?.naturalWidth)", 10000);
  const stagedOpens = await js("document.querySelector('app-image-viewer .viewer-image').alt === 'smoke-picture.png'");
  await js("document.querySelector('app-image-viewer .close-button').click()");
  await waitFor("!document.querySelector('app-image-viewer')", 5000);
  await js("document.querySelector('app-composer .staged-remove').click()");

  const scale = () => js("Number(document.querySelector('app-image-viewer .viewer')?.dataset.scale || 0)");
  const viewerOpen = () => js("Boolean(document.querySelector('app-image-viewer'))");
  const openViewer = async () => {
    await js("document.querySelector('app-attachment .attachment-preview').click()");
    await waitFor("Boolean(document.querySelector('app-image-viewer .viewer-image')?.naturalWidth)", 10000);
    await pause(350);
  };
  const imageCentre = () => js("(() => { const r = document.querySelector('app-image-viewer .viewer-image').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: r.width, h: r.height }; })()");
  const mouse = async (button, x, y) => {
    wc.sendInputEvent({ type: 'mouseMove', x, y });
    wc.sendInputEvent({ type: 'mouseDown', x, y, button, clickCount: 1 });
    await pause(60);
    wc.sendInputEvent({ type: 'mouseUp', x, y, button, clickCount: 1 });
    await pause(450);
  };
  let electronMenus = 0;
  const onMenu = () => { electronMenus += 1; };
  wc.on('context-menu', onMenu);
  wc.focus();
  await openViewer();
  const backdrop = await js("(() => { const v = document.querySelector('app-image-viewer .viewer'); const s = getComputedStyle(v); const probe = document.createElement('div'); probe.className = 'sheet-scrim'; probe.hidden = true; document.body.appendChild(probe); const p = getComputedStyle(probe); const same = { background: s.backgroundColor === p.backgroundColor, blur: s.backdropFilter === p.backdropFilter }; probe.remove(); return { background: s.backgroundColor, filter: s.backdropFilter, sheetClass: v.classList.contains('sheet-scrim'), same, label: v.getAttribute('aria-label'), focus: document.activeElement && document.activeElement.className }; })()");
  await shot('12-viewer-light.png');
  nativeTheme.themeSource = 'dark';
  await pause(400);
  await shot('12b-viewer-dark.png');
  nativeTheme.themeSource = 'light';
  await pause(200);
  await js("(() => { window.__ctx = { fired: 0, prevented: 0 }; document.addEventListener('contextmenu', (e) => { window.__ctx.fired += 1; if (e.defaultPrevented) window.__ctx.prevented += 1; }); return true; })()");
  const fit = await scale();
  const geometry = await js("(() => { const v = document.querySelector('app-image-viewer'); const i = v.picture(); return { ...v.box(), naturalWidth: i.naturalWidth, naturalHeight: i.naturalHeight }; })()");
  const c0 = await imageCentre();
  await mouse('left', c0.x + Math.round(c0.w / 6), c0.y);
  const afterLeft = await scale();
  await shot('12c-viewer-zoomed.png');
  await mouse('right', c0.x, c0.y);
  const afterRight = await scale();
  const ctx = await js('window.__ctx');
  wc.sendInputEvent({ type: 'mouseMove', x: c0.x, y: c0.y });
  // Electron's wheel sign is the platform's; one turn each way, and the scale must have moved on one of them.
  wc.sendInputEvent({ type: 'mouseWheel', x: c0.x, y: c0.y, deltaX: 0, deltaY: 240 });
  await pause(400);
  const wheelOne = await scale();
  wc.sendInputEvent({ type: 'mouseWheel', x: c0.x, y: c0.y, deltaX: 0, deltaY: -240 });
  await pause(400);
  const wheelTwo = await scale();
  const afterWheel = wheelOne !== afterRight ? wheelOne : wheelTwo;
  const key = (k) => js('document.dispatchEvent(new KeyboardEvent("keydown", { key: ' + JSON.stringify(k) + ', bubbles: true, cancelable: true }))');
  await key('0');
  await pause(300);
  const afterReset = await scale();
  await key('+');
  await pause(300);
  const afterPlus = await scale();
  // The 480px fixture is still narrower than this stage at 2x. Test that it stays centred,
  // then zoom again before requiring a pan; do not mistake the correct clamp for a lost input.
  await key('ArrowLeft');
  const smallPan = await js("document.querySelector('app-image-viewer').view.x");
  await key('+');
  await pause(300);
  const panScale = await scale();
  const panBefore = await js("document.querySelector('app-image-viewer .viewer-image').style.getPropertyValue('--zoom-x')");
  await key('ArrowLeft');
  await pause(300);
  const panAfter = await js("document.querySelector('app-image-viewer .viewer-image').style.getPropertyValue('--zoom-x')");
  await key('-');
  await pause(300);
  const afterMinus = await scale();

  await key('0');
  await pause(300);

  // A finger: two touch pointers spread from 80 to 160 apart pinch to twice the scale; a one-finger drag then pans;
  // two quick taps go back to fit, and two more zoom in again about the tap.
  const touch = (type, id, x, y) => js('(() => { const v = document.querySelector("app-image-viewer .viewer"); const t = document.elementFromPoint(' + x + ', ' + y + ') || v; t.dispatchEvent(new PointerEvent(' + JSON.stringify(type) + ', { bubbles: true, cancelable: true, pointerId: ' + id + ', pointerType: "touch", isPrimary: ' + (id === 31) + ', clientX: ' + x + ', clientY: ' + y + ', button: 0, buttons: ' + (type === 'pointerup' ? 0 : 1) + ' })); return true; })()');
  const c1 = await imageCentre();
  await touch('pointerdown', 31, c1.x - 40, c1.y);
  await touch('pointerdown', 32, c1.x + 40, c1.y);
  await touch('pointermove', 32, c1.x + 120, c1.y);
  const afterPinch = await scale();
  await touch('pointerup', 32, c1.x + 120, c1.y);
  await touch('pointerup', 31, c1.x - 40, c1.y);
  await pause(300);
  // Keep the 2x pinch assertion, then make room to pan the small fixture.
  await key('+');
  await pause(300);
  const dragScale = await scale();
  const mouseFrom = await js("document.querySelector('app-image-viewer').view.x");
  wc.sendInputEvent({ type: 'mouseDown', button: 'left', x: c1.x, y: c1.y, clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseMove', x: c1.x + 60, y: c1.y });
  wc.sendInputEvent({ type: 'mouseUp', button: 'left', x: c1.x + 60, y: c1.y, clickCount: 1 });
  await pause(300);
  const mouseTo = await js("document.querySelector('app-image-viewer').view.x");
  const dragFrom = await js("document.querySelector('app-image-viewer .viewer-image').style.getPropertyValue('--zoom-x')");
  await touch('pointerdown', 31, c1.x, c1.y);
  await touch('pointermove', 31, c1.x + 30, c1.y);
  await touch('pointermove', 31, c1.x + 60, c1.y);
  await touch('pointerup', 31, c1.x + 60, c1.y);
  await pause(300);
  const dragTo = await js("document.querySelector('app-image-viewer .viewer-image').style.getPropertyValue('--zoom-x')");
  const doubleTap = async (x, y) => {
    await touch('pointerdown', 31, x, y);
    await touch('pointerup', 31, x, y);
    await touch('pointerdown', 31, x, y);
    await touch('pointerup', 31, x, y);
    await pause(350);
  };
  await doubleTap(c1.x, c1.y);
  const afterDoubleOut = await scale();
  await doubleTap(c1.x, c1.y);
  const afterDoubleIn = await scale();
  await key('0');
  await pause(200);

  // The three ways out: Escape, the close control and a real click on the backdrop beside the picture.
  await key('Escape');
  await pause(200);
  const escapeCloses = !(await viewerOpen());
  await openViewer();
  await js("document.querySelector('app-image-viewer .close-button').click()");
  await pause(200);
  const closeCloses = !(await viewerOpen());
  await openViewer();
  await mouse('left', 6, Math.round(c0.y));
  const backdropCloses = !(await viewerOpen());
  wc.removeListener('context-menu', onMenu);
  const imageViewerChecks = {
    backdrop: backdrop.sheetClass && backdrop.same.background && backdrop.same.blur && /blur/.test(backdrop.filter),
    labelled: backdrop.label === 'sunset.png',
    stagedOpens,
    fit: fit === 1,
    leftZoomsIn: afterLeft > fit,
    rightZoomsOut: afterRight < afterLeft,
    noContextMenu: electronMenus === 0 && ctx.fired === ctx.prevented,
    wheel: afterWheel !== afterRight,
    smallImageCentred: geometry.width * afterPlus < geometry.stageWidth && smallPan === 0,
    panOverflows: geometry.width * panScale > geometry.stageWidth && geometry.width * dragScale > geometry.stageWidth,
    keys: afterReset === 1 && afterPlus > 1 && Number(panAfter) > Number(panBefore) && afterMinus < panScale,
    mouseDrag: mouseTo > mouseFrom,
    pinch: afterPinch > 1.9 && afterPinch < 2.1,
    drag: Number(dragTo) > Number(dragFrom),
    doubleTap: afterDoubleOut === 1 && afterDoubleIn > 1,
    escapeCloses, closeCloses, backdropCloses,
  };
  report.imageViewer = Object.values(imageViewerChecks).every(Boolean);
  console.log('image viewer: ' + JSON.stringify({ checks: imageViewerChecks, geometry, backdrop, scales: { fit, afterLeft, afterRight, wheelOne, wheelTwo, afterReset, afterPlus, afterMinus, afterPinch, afterDoubleOut, afterDoubleIn }, pan: { smallPan, panScale, panBefore, panAfter, dragScale, mouseFrom, mouseTo, dragFrom, dragTo }, ctx, electronMenus }));

  // Settings: the page reads what the server holds, writes a change back, and redraws when a change arrives on the
  // event stream from anywhere. Values are checked at the server, not from the page's own copy.
  const srv = process.env.SMOKE_SERVER_URL;
  const auth = { authorization: 'Bearer ' + process.env.SMOKE_TOKEN };
  const held = async () => (await (await fetch(srv + '/api/v1/settings', { headers: auth })).json()).values || {};
  const cdp = (method, params) => wc.debugger.sendCommand(method, params);
  const putSettings = (values) => fetch(srv + '/api/v1/settings', { method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ values }) });

  // Edit is a small text control at the left of the row above the list (issue 137); the pencil, the New group field and
  // the Add group button are gone. Edit shows a checkbox on every row; two chats are grouped with no name and take the
  // default; then one chat is deleted, and only carrying the slider to the end deletes it: a press on the thumb and a
  // drag let go halfway both leave everything as it was. Values are checked at the server.
  if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
  const editTheme = async (name) => {
    nativeTheme.themeSource = 'light';
    await pause(300);
    await shot(name + '-light.png');
    nativeTheme.themeSource = 'dark';
    await pause(300);
    await shot(name + '-dark.png');
    nativeTheme.themeSource = 'light';
  };
  const rowCheck = (name) => js("(() => { const r = [...document.querySelectorAll('.chat-row')].find((x) => x.querySelector('.chat-name').textContent === " + JSON.stringify(name) + "); r.querySelector('.chat-check').click(); return r.dataset.chat; })()");
  const editLayout = await js(`(() => {
    const row = document.querySelector('.sidebar .list-tools');
    const t = row && row.querySelector('.edit-toggle');
    if (!t) return null;
    const pad = parseFloat(getComputedStyle(row).paddingLeft);
    return {
      label: t.textContent.trim(), first: row.firstElementChild === t, inset: t.getBoundingClientRect().left - row.getBoundingClientRect().left - pad,
      gone: !document.querySelector('.edit-button') && !document.querySelector('.new-group-name') && !document.querySelector('.add-group-button') && !document.querySelector('.add-group'),
      radius: getComputedStyle(t).borderTopLeftRadius,
    };
  })()`);
  await js("document.querySelector('.list-tools .edit-toggle').click()");
  await waitFor("document.querySelector('.list-tools .edit-toggle').getAttribute('aria-pressed') === 'true' && document.querySelectorAll('.chat-row .chat-check').length === document.querySelectorAll('.chat-row').length");
  const activeBg = await js("getComputedStyle(document.querySelector('.list-tools .edit-toggle')).backgroundColor");
  const groupIds = [await rowCheck('Avery Quinn'), await rowCheck('+15555550142')];
  await waitFor("document.querySelector('.edit-count').textContent.trim() === '2 selected'");
  // Edit, select-all, the count and the three actions share one row.
  const editRowTops = await js("[...document.querySelectorAll('.list-tools.editing > *, .list-tools.editing .edit-actions > *')].map((el) => { const b = el.getBoundingClientRect(); return Math.round(b.top + b.height / 2); })");
  await editTheme('15-edit-mode');
  await js("document.querySelector('.edit-group').click()");
  await waitFor("Boolean(document.querySelector('.group-prompt .group-name-input'))");
  await pause(900);
  // The prompt sits on the sheet backdrop, centred in the window.
  const prompt = await js("(() => { const p = document.querySelector('.group-prompt'); const b = p.getBoundingClientRect(); return { backdrop: p.parentElement.classList.contains('sheet-scrim') && getComputedStyle(p.parentElement).position === 'fixed', dx: Math.abs(b.left + b.width / 2 - window.innerWidth / 2), dy: Math.abs(b.top + b.height / 2 - window.innerHeight / 2) }; })()");
  await editTheme('16-group-prompt');
  await js("document.querySelector('.group-prompt .group-create').click()");
  const t1 = Date.now();
  let groupedHeld = await held();
  while (!(Array.isArray(groupedHeld['chats.groups']) && groupedHeld['chats.groups'].length === 1) && Date.now() - t1 < 10000) { await pause(200); groupedHeld = await held(); }
  await waitFor("!document.querySelector('.group-prompt') && document.querySelector('.list-tools .edit-toggle').getAttribute('aria-pressed') === 'false' && [...document.querySelectorAll('.section-name')].some((s) => s.textContent === 'Group 1')");
  const madeGroup = (groupedHeld['chats.groups'] || [])[0] || {};
  const grouped = madeGroup.name === 'Group 1' && groupIds.every((id) => (groupedHeld['chats.placement'] || {})[id] === madeGroup.id);
  await js("document.querySelector('.list-tools .edit-toggle').click()");
  await waitFor("document.querySelectorAll('.chat-row .chat-check').length > 0");
  const deleteId = await rowCheck('Weekend plans');
  await js("document.querySelector('.edit-delete').click()");
  await waitFor("Boolean(document.querySelector('.confirm-modal app-slide-confirm .slide-thumb'))");
  // The card rises on the sheet's own motion; the thumb is measured once it has settled.
  await pause(900);
  const modal = await js("({ title: document.querySelector('#confirm-title').textContent.trim(), what: document.querySelector('.confirm-what').textContent.trim(), backdrop: document.querySelector('.confirm-modal').parentElement.classList.contains('sheet-scrim'), button: Boolean(document.querySelector('.confirm-modal .confirm-delete, .confirm-modal .danger-button')) })");
  await editTheme('17-delete-confirm');
  const thumbBox = () => js("(() => { const t = document.querySelector('.confirm-modal .slide-thumb').getBoundingClientRect(); const k = document.querySelector('.confirm-modal .slide-track').getBoundingClientRect(); return { x: t.left + t.width / 2, y: t.top + t.height / 2, end: k.right - 2, start: k.left }; })()");
  const slideMouse = (type, x, y) => cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
  const slideTo = async (fraction, release = true) => {
    const b = await thumbBox();
    const to = b.x + (b.end - b.x) * fraction;
    await slideMouse('mousePressed', b.x, b.y);
    for (let i = 1; i <= 8; i += 1) await slideMouse('mouseMoved', b.x + ((to - b.x) * i) / 8, b.y);
    if (release) await slideMouse('mouseReleased', to, b.y);
  };
  // A press alone is not a slide.
  const pressAt = await thumbBox();
  await slideMouse('mousePressed', pressAt.x, pressAt.y);
  await slideMouse('mouseReleased', pressAt.x, pressAt.y);
  await pause(400);
  const afterPress = { open: await js("Boolean(document.querySelector('.confirm-modal'))"), hidden: (await held())['chats.hidden'] || [] };
  // Let go halfway and the thumb returns to the start; the delete has not happened.
  await slideTo(0.5, false);
  await pause(150);
  await shot('17c-delete-sliding.png');
  const b2 = await thumbBox();
  await slideMouse('mouseReleased', b2.x, b2.y);
  await pause(500);
  const afterHalf = { open: await js("Boolean(document.querySelector('.confirm-modal'))"), value: await js("document.querySelector('.confirm-modal .slide-thumb').getAttribute('aria-valuenow')"), hidden: (await held())['chats.hidden'] || [] };
  // Carried to the end, it deletes.
  await slideTo(1);
  await waitFor("!document.querySelector('.confirm-modal')", 10000);
  const t2 = Date.now();
  let deletedHeld = await held();
  while (!(deletedHeld['chats.hidden'] || []).includes(deleteId) && Date.now() - t2 < 10000) { await pause(200); deletedHeld = await held(); }
  const leftNames = await js('JSON.stringify(' + rowNames + ')');
  const editChecks = {
    layout: Boolean(editLayout) && editLayout.label === 'Edit' && editLayout.first && Math.abs(editLayout.inset) < 1 && editLayout.gone && parseFloat(editLayout.radius) > 0,
    active: activeBg !== 'rgba(0, 0, 0, 0)' && activeBg !== 'transparent',
    oneRow: editRowTops.length >= 5 && Math.max(...editRowTops) - Math.min(...editRowTops) <= 2,
    prompt: prompt.backdrop && prompt.dx < 2 && prompt.dy < 2,
    grouped,
    modal: modal.title === 'Are you sure?' && modal.what === 'Delete 1 conversation?' && modal.backdrop && !modal.button,
    pressIsNotSlide: afterPress.open && !afterPress.hidden.includes(deleteId),
    halfReturns: afterHalf.open && afterHalf.value === '0' && !afterHalf.hidden.includes(deleteId),
    deleted: (deletedHeld['chats.hidden'] || []).includes(deleteId) && !JSON.parse(leftNames).includes('Weekend plans'),
  };
  report.editMode = Object.values(editChecks).every(Boolean);
  console.log('edit mode: ' + JSON.stringify({ checks: editChecks, editLayout, activeBg, editRowTops, prompt, groupIds, madeGroup, deleteId, modal, afterPress, afterHalf, leftNames }));
  // The smoke's own changes go back, so every later step sees the three chats ungrouped. The page's own delete write
  // has to have answered first: an answer is taken for the keys it wrote (settingsAfterWrite), so one landing after the
  // reset would draw the deleted chat as hidden again.
  await waitFor("document.querySelector('app-root').settingsBusy === false", 10000);
  const reset = await putSettings({ 'chats.hidden': [], 'chats.groups': [], 'chats.placement': {} });
  if (!reset.ok) throw new Error('the server refused the chat arrangement reset: ' + reset.status);
  try {
    await waitFor("document.querySelectorAll('.chat-row').length >= 3 && !document.querySelector('.section-actions')", 10000);
  } catch (e) {
    const page = await js("(() => { const s = document.querySelector('app-root').settings; return { hidden: s['chats.hidden'], groups: s['chats.groups'], placement: s['chats.placement'], rows: document.querySelectorAll('.chat-row').length, busy: document.querySelector('app-root').settingsBusy }; })()");
    console.error('chat arrangement reset: ' + JSON.stringify({ page, held: await held() }));
    throw e;
  }

  // The Edit control stays one line (it replaced Add group, which issue 122 held to this): at the smallest window the
  // shell allows and at every text size from 50% to 300%, its label renders as one line, in full. The line count is
  // read from the label's own text boxes and checked against the control's height, so a wrap fails here on whichever
  // platform drew it.
  const [minW, minH] = w.getMinimumSize();
  await cdp('Emulation.setDeviceMetricsOverride', { width: minW, height: minH, deviceScaleFactor: 1, mobile: false });
  const editLine = () => js(`(() => {
    const b = document.querySelector('.list-tools .edit-toggle');
    if (!b) return null;
    const s = getComputedStyle(b);
    const size = parseFloat(s.fontSize);
    const line = parseFloat(s.lineHeight) || size * 1.2;
    const inner = b.getBoundingClientRect().height - ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'].reduce((n, k) => n + (parseFloat(s[k]) || 0), 0);
    const range = document.createRange();
    range.selectNodeContents(b);
    const lines = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size;
    return { size, line, inner, lines, full: b.scrollWidth <= b.clientWidth, label: b.textContent.trim(), wide: window.innerWidth };
  })()`);
  const editSizes = {};
  const labelPx = "parseFloat(getComputedStyle(document.querySelector('.list-tools .edit-toggle')).fontSize)";
  const plainLabel = await js(labelPx);
  for (const scale of [50, 100, 200, 300]) {
    const scaleSet = await putSettings({ 'appearance.textScale': scale });
    if (!scaleSet.ok) throw new Error('the server refused the text size write: ' + scaleSet.status);
    await waitFor('Math.abs(' + labelPx + ' - ' + (plainLabel * scale / 100) + ') < 0.6', 10000);
    await pause(200);
    editSizes[scale] = await editLine();
    if (scale !== 50) await shot('10-edit-row-' + scale + '.png');
  }
  await putSettings({ 'appearance.textScale': 100 });
  await waitFor('Math.abs(' + labelPx + ' - ' + plainLabel + ') < 0.6', 10000);
  await cdp('Emulation.clearDeviceMetricsOverride', {});
  report.editLine = Object.values(editSizes).every((m) => m && m.lines === 1 && m.inner < m.line * 1.5 && m.label === 'Edit' && m.full && m.wide === minW);
  console.log('edit line: ' + JSON.stringify({ minW, minH, sizes: editSizes }));

  // The press states (issue 140), drawn on real controls in both schemes: the send button and a text button are each
  // put through pending, success and failure by the kit itself, with the hold token stretched so each capture shows
  // the state it names. The page's own module is imported, so this is the same press the app runs.
  const pressStates = {};
  await js("document.documentElement.style.setProperty('--motion-press-hold', '60s'); true");
  await js("import('../kit/press.js').then((m) => { window.__press = m; return true; })");
  const pressAll = (outcome) => js('(() => { const settle = ' + JSON.stringify(outcome) + '; window.__settle = []; for (const sel of ["app-composer button.send", ".edit-toggle"]) { const b = document.querySelector(sel); window.__press.runPress(b, () => new Promise((ok, no) => window.__settle.push(() => (settle === "failure" ? no(new Error("synthetic")) : ok(true))))); } return true; })()');
  // Motion is asked for explicitly: a runner whose platform has animations switched off (the Windows one) otherwise
  // reports reduced motion, and every state would rightly draw still.
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  const readPress = () => js("[...document.querySelectorAll('app-composer button.send, .edit-toggle')].map((b) => { const a = getComputedStyle(b, '::after'); return { state: b.dataset.press || 'idle', busy: b.getAttribute('aria-busy'), content: a.content, animation: a.animationName }; })");
  for (const scheme of ['light', 'dark']) {
    nativeTheme.themeSource = scheme;
    await waitFor('document.documentElement.dataset.scheme === ' + JSON.stringify(scheme), 10000);
    await pressAll('success');
    await pause(150);
    const pending = await readPress();
    await shot('13-press-pending-' + scheme + '.png');
    await js('window.__settle.forEach((s) => s()); true');
    await pause(250);
    const success = await readPress();
    await shot('13b-press-success-' + scheme + '.png');
    await pressAll('failure');
    await js('window.__settle.forEach((s) => s()); true');
    await pause(250);
    const failure = await readPress();
    await shot('13c-press-failure-' + scheme + '.png');
    pressStates[scheme] = { pending, success, failure };
  }
  // Reduced motion: still pending, still busy, and nothing turns.
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await pressAll('success');
  await pause(150);
  const pressReduced = await readPress();
  await js('window.__settle.forEach((s) => s()); true');
  await cdp('Emulation.setEmulatedMedia', { media: '', features: [] });
  await js("document.documentElement.style.removeProperty('--motion-press-hold'); for (const b of document.querySelectorAll('[data-press]')) { delete b.dataset.press; b.removeAttribute('aria-busy'); b.removeAttribute('aria-disabled'); } true");
  nativeTheme.themeSource = 'light';
  const every = (list, check) => Array.isArray(list) && list.length === 2 && list.every(check);
  report.pressStates = ['light', 'dark'].every((s) => {
    const p = pressStates[s];
    return every(p.pending, (b) => b.state === 'pending' && b.busy === 'true' && b.animation === 'spin')
      && every(p.success, (b) => b.state === 'success' && b.busy === null && b.content.includes('\u2713'))
      && every(p.failure, (b) => b.state === 'failure' && b.busy === null && b.content.includes('!'));
  }) && every(pressReduced, (b) => b.state === 'pending' && b.busy === 'true' && b.animation === 'none');
  console.log('press states: ' + JSON.stringify({ states: pressStates, reduced: pressReduced }));

  // Resizing keeps your place (issue 142). The conversation and the chat list are scrolled back, text is typed in the
  // composer with the caret inside it, and then the window is resized several times and the text size changed: each
  // view must still show the same message or row at the same height, and the composer the same text and caret. The
  // list is made long enough to scroll with groups, which are put back afterwards.
  const keptBefore = await held();
  const smokeGroups = Array.from({ length: 8 }, (_, i) => ({ id: 'smoke-g' + i, name: 'Smoke group ' + (i + 1) }));
  await putSettings({ 'chats.groups': smokeGroups, 'chats.placement': { 1: 'smoke-g1', 2: 'smoke-g4', 3: 'smoke-g7' }, 'appearance.textScale': 200 });
  await waitFor("document.querySelectorAll('.chat-section').length >= 8 && document.documentElement.style.getPropertyValue('--font-size-md') !== ''", 10000);
  await pause(400);
  const COMPOSED = 'Kept through\nevery resize';
  const place = () => js(`(() => {
    const at = (view, sel, key) => {
      const top = view.getBoundingClientRect().top;
      const rows = [...view.querySelectorAll(sel)];
      const first = rows.find((r) => r.getBoundingClientRect().bottom - top > 0);
      return first ? { key: first.dataset[key], offset: Math.round(first.getBoundingClientRect().top - top), scrollTop: Math.round(view.scrollTop), room: view.scrollHeight - view.clientHeight } : null;
    };
    const t = document.querySelector('app-composer textarea');
    return {
      conversation: at(document.querySelector('.messages'), '.bubble-row', 'id'),
      list: at(document.querySelector('app-chat-list'), '.chat-row', 'chat'),
      open: document.querySelector('app-root').openChatId,
      text: t.value, caret: t.selectionStart, caretEnd: t.selectionEnd, fieldHidden: t.scrollHeight - t.clientHeight, fieldScrolls: getComputedStyle(t).overflowY === 'auto',
      width: window.innerWidth, height: window.innerHeight,
    };
  })()`);
  await js(`(() => {
    const m = document.querySelector('.messages');
    const rows = [...m.querySelectorAll('.bubble-row')];
    const row = rows[Math.min(2, rows.length - 1)];
    m.scrollTop = row.getBoundingClientRect().top - m.getBoundingClientRect().top + m.scrollTop - 7;
    const l = document.querySelector('app-chat-list');
    const room = l.scrollHeight - l.clientHeight;
    const targets = [...l.querySelectorAll('.chat-row')].map((c) => c.getBoundingClientRect().top - l.getBoundingClientRect().top + l.scrollTop - 9);
    l.scrollTop = targets.find((y) => y > 0 && y < room - 20) ?? Math.round(room / 2);
    const t = document.querySelector('app-composer textarea');
    t.value = ${JSON.stringify(COMPOSED)};
    t.dispatchEvent(new Event('input', { bubbles: true }));
    t.focus();
    t.setSelectionRange(5, 15);
    return true;
  })()`);
  await pause(300);
  const start = await place();
  const steps = [];
  for (const [width, height] of [[900, 540], [760, 500], [1040, 560], [820, 520]]) {
    w.setSize(width, height);
    await pause(500);
    steps.push({ step: width + 'x' + height, ...(await place()) });
  }
  // Text sizes at or above the one the views were scrolled at, so neither view is ever too short to hold its place.
  for (const scale of [300, 200]) {
    await putSettings({ 'appearance.textScale': scale });
    await pause(700);
    steps.push({ step: scale + '%', ...(await place()) });
  }
  await shot('14-resize-kept.png');
  const same = (a, b) => Boolean(a && b) && a.key === b.key && Math.abs(a.offset - b.offset) <= 2;
  const resizeChecks = {
    scrolledBack: Boolean(start.conversation) && start.conversation.scrollTop > 0 && start.conversation.room - start.conversation.scrollTop > 100 && Boolean(start.list) && start.list.scrollTop > 0,
    conversation: steps.every((s) => same(s.conversation, start.conversation)),
    list: steps.every((s) => same(s.list, start.list)),
    open: steps.every((s) => s.open === start.open),
    composer: steps.every((s) => s.text === COMPOSED && s.caret === 5 && s.caretEnd === 15 && (s.fieldHidden <= 0 || s.fieldScrolls)),
    resized: new Set(steps.map((s) => s.width)).size >= 3,
  };
  report.resizeKeeps = Object.values(resizeChecks).every(Boolean);
  console.log('resize keeps: ' + JSON.stringify({ checks: resizeChecks, start, steps }));
  w.setSize(1100, 720);
  await js("(() => { const t = document.querySelector('app-composer textarea'); t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");

  // The conversation header stays pinned and nothing but media zooms (issue 180). A long conversation is scrolled to
  // each end, the page itself is told to scroll and a field takes focus, then a pinch (ctrl and the wheel) and the zoom
  // keys are tried over the messages; at a desktop width and at a phone's, in light and dark, the header must still sit
  // at the top with the name and the way back, the page must not have moved, and the scale must still be 1.
  const pinSrv = process.env.SMOKE_SERVER_URL;
  const pinAuth = { authorization: 'Bearer ' + process.env.SMOKE_TOKEN };
  const skinBefore = ((await (await fetch(pinSrv + '/api/v1/settings', { headers: pinAuth })).json()).values || {})['appearance.skin'] || 'system';
  const putSkin = (skin) => fetch(pinSrv + '/api/v1/settings', { method: 'PUT', headers: { ...pinAuth, 'content-type': 'application/json' }, body: JSON.stringify({ values: { 'appearance.skin': skin } }) });
  const pinMinimum = w.getMinimumSize();
  const pinListWasOpen = await js("document.querySelector('app-root').listOpen");
  const pinned = [];
  for (const [label, width, height] of [['desktop', 1100, 720], ['phone', 390, 760]]) {
    if (label === 'phone') w.setMinimumSize(320, 400);
    w.setSize(width, height);
    await pause(500);
    // On a phone the conversation is the pane under test, so the list's drawer is put away first.
    if (label === 'phone') { await js("(() => { document.querySelector('app-root').closeDrawer(); return true; })()"); await pause(600); }
    const box = await js(String.raw`(() => {
      const m = document.querySelector('.messages');
      const before = m.scrollHeight - m.clientHeight;
      m.scrollTop = 0; m.dispatchEvent(new Event('scroll'));
      m.scrollTop = m.scrollHeight; m.dispatchEvent(new Event('scroll'));
      window.scrollTo(0, 100000);
      document.scrollingElement.scrollTop = 100000;
      document.querySelector('app-composer textarea').focus();
      const r = m.getBoundingClientRect();
      return { room: before, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    for (const deltaY of [-240, 240]) wc.sendInputEvent({ type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY, modifiers: ['control'] });
    for (const keyCode of ['=', 'Plus', '-']) {
      for (const mod of ['control', 'meta']) {
        wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers: [mod] });
        wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers: [mod] });
      }
    }
    await pause(400);
    for (const skin of ['light', 'dark']) {
      await putSkin(skin);
      await pause(500);
      const state = await js("(() => { const h = document.querySelector('.conv-head'); const r = h.getBoundingClientRect(); const back = document.querySelector('.conv-back'); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { visible: Boolean(hit) && h.contains(hit), top: r.top, bottom: r.bottom, scrollY: window.scrollY, doc: document.scrollingElement.scrollTop, scale: window.visualViewport ? window.visualViewport.scale : 1, name: Boolean(h.querySelector('.conv-title') && h.querySelector('.conv-title').textContent.trim()), back: Boolean(back) && getComputedStyle(back).display !== 'none', scheme: document.documentElement.dataset.scheme }; })()");
      pinned.push({ label, skin, room: box.room, factor: wc.getZoomFactor(), ...state });
      await shot('15-pinned-header-' + label + '-' + skin + '.png');
    }
  }
  await putSkin(skinBefore);
  w.setSize(1100, 720);
  w.setMinimumSize(...pinMinimum);
  await js("document.querySelector('app-root').listOpen = " + JSON.stringify(Boolean(pinListWasOpen)));
  await pause(300);
  report.headerPinned = pinned.length === 4 && pinned.every((p) => p.room > 0 && p.visible && Math.abs(p.top) <= 0.5 && p.bottom > 0 && p.scrollY === 0 && p.doc === 0 && p.name && p.scheme === p.skin)
    && pinned.filter((p) => p.label === 'phone').every((p) => p.back);
  report.noPageZoom = pinned.length === 4 && pinned.every((p) => p.factor === 1 && p.scale === 1);
  console.log('header pinned: ' + JSON.stringify(pinned));
  await js("(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); return true; })()");

  // Nothing refreshes or shows a loading page (issue 142): while the stream reconnects, a resync runs, the theme
  // changes and a setting changes, every DOM change is watched, and no view may drop to empty, no splash may appear and
  // nothing but a pressed button may say it is busy.
  await js(`(() => {
    const count = (sel) => document.querySelectorAll(sel).length;
    const seen = { bubbles: count('.bubble-row'), rows: count('.chat-row'), splash: false, busy: [] };
    const look = () => {
      seen.bubbles = Math.min(seen.bubbles, count('.bubble-row'));
      seen.rows = Math.min(seen.rows, count('.chat-row'));
      if (document.querySelector('.splash')) seen.splash = true;
      for (const el of document.querySelectorAll('[aria-busy="true"]')) if (el.tagName !== 'BUTTON') seen.busy.push(el.className || el.tagName);
    };
    window.__blank = seen;
    window.__blankWatch = new MutationObserver(look);
    window.__blankWatch.observe(document, { childList: true, subtree: true, attributes: true });
    return true;
  })()`);
  await js("(() => { const root = document.querySelector('app-root'); window.__conn = []; const was = root.onConnState.bind(root); root.onConnState = (s) => { window.__conn.push(s); was(s); }; root.client.reconnect(); return true; })()");
  await waitFor("window.__conn.includes('reconnecting') && document.querySelector('app-root').conn === 'open'", 15000);
  const connStates = await js('window.__conn');
  await js("document.querySelector('app-root').onEvent({ name: 'resync', data: {} }); true");
  await pause(1500);
  await putSettings({ 'appearance.theme': { name: 'smoke blank', color: { light: { accent: '#2a6f4b' }, dark: { accent: '#7fd6a8' } } } });
  await waitFor("getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() === '#2a6f4b'", 10000);
  await putSettings({ 'appearance.theme': null, 'appearance.textScale': 125 });
  await waitFor("getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() !== '#2a6f4b'", 10000);
  await pause(500);
  const blank = await js('(() => { window.__blankWatch.disconnect(); return window.__blank; })()');
  report.noBlank = blank.bubbles > 0 && blank.rows > 0 && !blank.splash && blank.busy.length === 0 && connStates.includes('reconnecting');
  console.log('no blank: ' + JSON.stringify({ blank, connStates }));
  await putSettings({ 'chats.groups': keptBefore['chats.groups'] ?? [], 'chats.placement': keptBefore['chats.placement'] ?? {}, 'appearance.textScale': 100 });
  await waitFor("document.querySelectorAll('.section-actions').length === 0", 10000);

  await js("document.querySelector('.sidebar-head .gear-button').click()");
  // The skin is a three-position switch (System, Light, Dark), one radio per position, not a dropdown (issue 112).
  const skinInput = (v) => "document.querySelector('app-settings input[data-key=\"appearance.skin\"][value=\"" + v + "\"]')";
  // The page disables its controls while a write is in flight, and a click on a disabled radio does nothing (a
  // dispatched change on the old select went through regardless), so a pick waits for the control to take input. A
  // pick made while the previous write was still answering is what timed out on ubuntu (run 37066896432).
  const clickSkin = async (v) => {
    await waitFor('Boolean(' + skinInput(v) + ') && !' + skinInput(v) + '.disabled', 10000);
    await js(skinInput(v) + '.click()');
  };
  await waitFor("Boolean(document.querySelector('app-settings .segmented[data-key=\"appearance.skin\"]'))");
  const shown = await js("document.querySelector('app-settings input[data-key=\"appearance.skin\"]:checked')?.value");
  report.settingsRead = shown === ((await held())['appearance.skin'] || 'system');
  report.skinSwitch = await js("[...document.querySelectorAll('app-settings .segmented[data-key=\"appearance.skin\"] .segment')].map((l) => l.textContent.trim()).join('|')") === 'System|Light|Dark'
    && await js("!document.querySelector('app-settings select[data-key=\"appearance.skin\"]')");
  await clickSkin('dark');
  for (let i = 0; i < 50 && (await held())['appearance.skin'] !== 'dark'; i += 1) await pause(200);
  report.settingsWrote = (await held())['appearance.skin'] === 'dark';
  // This step flaked on macOS (run 37000805003): the page's own answer to the skin write above landed after a change
  // made at the server, and put the old value back. The page now takes only the written keys from an answer
  // (settingsAfterWrite), so a change made elsewhere survives a late answer, and this step is the live check of that.
  // It wrote the density until issue 112 removed it; the text size is the setting it changes now.
  // A refused write would leave the wait below timing out on a value that was never stored, so it fails here instead.
  const scaleWrite = await fetch(srv + '/api/v1/settings', { method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ values: { 'appearance.textScale': 150 } }) });
  if (!scaleWrite.ok) throw new Error('the server refused the text size write: ' + scaleWrite.status);
  await waitFor("document.querySelector('app-settings input[data-key=\"appearance.textScale\"][value=\"150\"]')?.checked === true", 10000);
  report.settingsStreamed = true;
  // Text size is a percentage of the type tokens: at 150% the page and the chat list both draw their text half as
  // large again, and back at 100% they draw exactly what the tokens say (the surface check below holds that).
  const fontPx = (sel) => js("(() => { const e = document.querySelector(" + JSON.stringify(sel) + "); return e ? parseFloat(getComputedStyle(e).fontSize) : 0; })()");
  report.textScaleChoices = await js("[...document.querySelectorAll('app-settings .scale-choice')].map((l) => l.textContent.trim()).join('|')");
  const scaledList = await fontPx('.chat-row .chat-name');
  const scaledPage = await fontPx('app-settings .setting-label');
  await putSettings({ 'appearance.textScale': 100 });
  await waitFor("document.querySelector('app-settings input[data-key=\"appearance.textScale\"][value=\"100\"]')?.checked === true", 10000);
  const plainList = await fontPx('.chat-row .chat-name');
  const plainPage = await fontPx('app-settings .setting-label');
  const near = (a, b) => Math.abs(a - b) < 0.6;
  report.textScale = report.textScaleChoices === '50%|75%|100%|125%|150%|200%|300%' && plainList > 0 && plainPage > 0 && near(scaledList, plainList * 1.5) && near(scaledPage, plainPage * 1.5)
    && await js("!document.querySelector('app-settings [data-key=\"appearance.density\"]')");
  console.log('text scale: ' + JSON.stringify({ choices: report.textScaleChoices, scaledList, plainList, scaledPage, plainPage }));
  report.settings = report.settingsRead && report.skinSwitch && report.settingsWrote && report.settingsStreamed && report.textScale;

  // The rendered surface: the values the page RESOLVES must be the ones the one spec holds, in each scheme. The
  // colour scheme follows the platform's, so the shell drives nativeTheme and the page is read back. A platform whose
  // chrome did not take the tokens, or a scheme a change only half applied, fails here and names the scheme and the
  // token rather than being assumed to match the platform it was written on.
  // The scheme the page resolves follows the platform only while the skin is 'system',
  // and the settings step above pinned that skin to dark. Put it back, and wait for the
  // page to report a scheme it resolved, so a pinned skin cannot make every light token
  // read dark and fail a check about the scheme the platform is driving.
  await fetch(srv + '/api/v1/settings', { method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ values: { 'appearance.skin': 'system' } }) });
  await waitFor("document.documentElement.dataset.scheme === 'light' || document.documentElement.dataset.scheme === 'dark'");
  const platformAccent = {};
  const surface = async (scheme) => {
    const expected = expectedTokens(tokenSpec, scheme);
    nativeTheme.themeSource = scheme;
    await waitFor(`document.documentElement.dataset.scheme === ${JSON.stringify(scheme)}`);
    const resolved = await js(`(() => { const s = getComputedStyle(document.documentElement); const out = {}; for (const n of ${JSON.stringify(Object.keys(expected))}) out[n] = s.getPropertyValue(n).trim(); return out; })()`);
    // The caret and native controls wear the scheme's accent, never the platform's system blue (issue 59): what the
    // root resolves for each is compared with the accent token drawn as a colour in the same scheme.
    const accent = await js("(() => { const p = document.createElement('i'); p.style.color = 'var(--color-accent)'; document.body.append(p); const want = getComputedStyle(p).color; p.remove(); const s = getComputedStyle(document.documentElement); return { want, caret: s.caretColor, control: s.accentColor }; })()");
    platformAccent[scheme] = accent.caret === accent.want && accent.control === accent.want;
    if (!platformAccent[scheme]) console.error('platform accent ' + scheme + ': ' + JSON.stringify(accent));
    return tokenMismatches({ expected, resolved });
  };
  const surfaceFound = { light: await surface('light'), dark: await surface('dark') };
  report.surfaceLight = surfaceFound.light.length === 0;
  report.surfaceDark = surfaceFound.dark.length === 0;
  report.platformAccent = platformAccent.light === true && platformAccent.dark === true;
  report.surface = report.surfaceLight && report.surfaceDark && report.platformAccent;
  if (!report.surface) console.error('surface mismatches: ' + JSON.stringify(surfaceFound));
  // A theme the server holds reaches the page without a rebuild, and both schemes render it: the accent the theme
  // sets is what the page resolves, whether the skin in force is the explicit light or the explicit dark one.
  const pickSkin = (skin) => clickSkin(skin);
  await putSettings({ 'appearance.theme': { name: 'smoke', color: { light: { accent: '#2a6f4b' }, dark: { accent: '#7fd6a8' } } } });
  await pickSkin('light');
  await waitFor("document.documentElement.dataset.scheme === 'light' && getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() === '#2a6f4b'", 10000);
  report.themeLight = true;
  await pickSkin('dark');
  await waitFor("document.documentElement.dataset.scheme === 'dark' && getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() === '#7fd6a8'", 10000);
  report.themeDark = true;
  report.theme = report.themeLight && report.themeDark;
  // The app's icons follow the theme and the scheme (issue 189): the page reported each to the shell, which drew the
  // tray again in that theme's colours. macOS's template is a silhouette the menu bar recolours, so there only the
  // palette is compared.
  const iconFor = (scheme, accent) => smokeIcons.find((i) => i.scheme === scheme && i.accent === accent);
  for (let i = 0; i < 50 && !(iconFor('light', '#2a6f4b') && iconFor('dark', '#7fd6a8')); i += 1) await pause(100);
  const lightIcon = iconFor('light', '#2a6f4b');
  const darkIcon = iconFor('dark', '#7fd6a8');
  report.trayIcon = Boolean(lightIcon && darkIcon) && lightIcon.mark === '#2a6f4b' && lightIcon.mark !== darkIcon.mark && (process.platform === 'darwin' || lightIcon.tray !== darkIcon.tray);
  console.log('tray icon: ' + JSON.stringify({ lightIcon, darkIcon, redraws: smokeIcons.length }));
  // The unread count on the icon (issue 218): the shell drew the badge at a count, exact to 9 then 9+, and kept it
  // beside the report; on Windows that is the taskbar overlay, on macOS and Linux the tray's own badge.
  report.overlayIcon = Boolean(smokeBadge && smokeBadge.badgeText === '9+' && smokeBadge.unread === 12 && (process.platform !== 'win32' || smokeBadge.overlay));
  console.log('overlay icon: ' + JSON.stringify({ smokeBadge, redraws: smokeIcons.length }));
  if (!report.overlayIcon) console.error('overlay icon: no counted badge');

  // Importing a tweakcn theme from the settings page: the pasted export is converted, held by the server and drawn by
  // the page in the scheme in force (dark, from the step above), the page names what it refused, and Use default
  // clears it at the server. Values are checked at the server and in what the page resolves, not in the page's copy.
  const importCss = ':root { --primary: #8a3b12; --font-serif: serif; }\n.dark { --primary: #e0a070; }';
  await js(`(() => { const s = document.querySelector('app-settings'); const n = s.querySelector('.theme-import-name'); n.value = 'smoke import'; n.dispatchEvent(new Event('input', { bubbles: true })); const t = s.querySelector('.theme-import-text'); t.value = ${JSON.stringify(importCss)}; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await waitFor("!document.querySelector('app-settings .theme-import-action').disabled");
  await js("document.querySelector('app-settings .theme-import-action').click()");
  for (let i = 0; i < 50 && (await held())['appearance.theme']?.name !== 'smoke import'; i += 1) await pause(200);
  const imported = (await held())['appearance.theme'];
  report.themeImportHeld = Boolean(imported) && imported.source === 'tweakcn' && imported.name === 'smoke import';
  await waitFor("getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() === '#e0a070'", 10000);
  report.themeImportDrawn = true;
  report.themeImportReported = await js("(() => { const n = document.querySelector('app-settings .theme-import-note'); return Boolean(n) && n.textContent.includes('font-serif'); })()");
  await waitFor("!document.querySelector('app-settings [data-action=\"theme-default\"]').disabled", 10000);
  await js("document.querySelector('app-settings [data-action=\"theme-default\"]').click()");
  for (let i = 0; i < 50 && (await held())['appearance.theme'] !== null; i += 1) await pause(200);
  report.themeImportCleared = (await held())['appearance.theme'] === null;
  report.themeImport = report.themeImportHeld && report.themeImportDrawn && report.themeImportReported && report.themeImportCleared;
  if (!report.themeImport) console.error('theme import: ' + JSON.stringify({ imported, held: report.themeImportHeld, reported: report.themeImportReported, cleared: report.themeImportCleared }));

  // Importing a theme by URL: the server fetches it, converts it and offers it in the picker without putting it in
  // force; the card shows the theme's own colours; a URL that answers with no theme is refused with the reason and
  // stores nothing. The theme is served from a loopback server this smoke owns, in tweakcn's registry shape.
  const registry = { name: 'smoke-url', title: 'Smoke URL', cssVars: { theme: { radius: '0.5rem' }, light: { primary: '#1d4ed8', background: '#f0f4ff' }, dark: { primary: '#93c5fd', background: '#0b1020' } } };
  let themeFetches = 0;
  // The same host also answers as tweakcn does for Elegant Luxury (issue 132): its editor page is HTML, and its theme is
  // a registry item at /r/themes/elegant-luxury.json (a fixture copy of tweakcn's own), so pasting the page URL
  // proves the page is read from its registry.
  // The runner names the fixture, since a packaged app carries no fixtures of its own.
  const elegant = readFileSync(process.env.SMOKE_THEME_FIXTURE || path.join(CORE, 'fixtures/themes/elegant-luxury.json'), 'utf8');
  const themeHost = http.createServer((req, res) => {
    if (req.url === '/theme.json') themeFetches += 1;
    if (req.url === '/theme.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(registry)); return; }
    if (req.url === '/r/themes/elegant-luxury.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(elegant); return; }
    if (req.url.startsWith('/editor/theme')) { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>tweakcn</title>'); return; }
    res.writeHead(404, { 'content-type': 'text/plain' }); res.end('no theme here');
  });
  await new Promise((resolve) => themeHost.listen(0, '127.0.0.1', resolve));
  const themeBase = 'http://127.0.0.1:' + themeHost.address().port;
  // The Import button shows the import in flight (issue 140), so the step waits for its press to settle. presses is how
  // many times it is pressed at once: the double press must reach the theme's host once.
  const importButton = "document.querySelector('app-settings .theme-url-action')";
  const importUrl = async (url, presses = 1) => {
    await waitFor(importButton + ".dataset.press !== 'pending'", 15000);
    await js(`(() => { const i = document.querySelector('app-settings .theme-url-input'); i.value = ${JSON.stringify(url)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await waitFor('!' + importButton + '.disabled');
    const states = await js('(() => { const b = ' + importButton + '; const seen = []; for (let i = 0; i < ' + presses + '; i += 1) { b.click(); seen.push(b.dataset.press || \'idle\'); } return seen; })()');
    await waitFor(importButton + ".dataset.press !== 'pending' && Boolean(document.querySelector('app-settings .theme-url-note'))", 15000);
    return { note: await js("document.querySelector('app-settings .theme-url-note').textContent"), states };
  };
  try {
    const before = ((await held())['appearance.themes'] || []).length;
    const bad = await importUrl(themeBase + '/missing.json');
    const badNote = bad.note;
    report.themeUrlRefused = badNote.includes('404') && ((await held())['appearance.themes'] || []).length === before;
    const good = await importUrl(themeBase + '/theme.json', 2);
    const goodNote = good.note;
    // Pressed twice at once: the first press is pending when the second lands, and the host is fetched once.
    report.importOnce = good.states.join('|') === 'pending|pending' && themeFetches === 1;
    console.log('import once: ' + JSON.stringify({ states: good.states, themeFetches }));
    const themes = (await held())['appearance.themes'] || [];
    report.themeUrlHeld = themes.some((t) => t.id === 'smoke-url' && t.color.light.accent === '#1d4ed8') && (await held())['appearance.theme']?.id !== 'smoke-url';
    await waitFor("Boolean(document.querySelector('app-settings .theme-card[data-theme-id=\"smoke-url\"]'))", 10000);
    const scheme = await js('document.documentElement.dataset.scheme');
    const cardAccent = await js("getComputedStyle(document.querySelector('app-settings .theme-card[data-theme-id=\"smoke-url\"] .theme-swatch[data-token=\"accent\"]')).backgroundColor");
    report.themeUrlCard = cardAccent === (scheme === 'dark' ? 'rgb(147, 197, 253)' : 'rgb(29, 78, 216)');
    report.themeUrl = report.themeUrlRefused && report.themeUrlHeld && report.themeUrlCard;
    console.log('theme url: ' + JSON.stringify({ badNote, goodNote, scheme, cardAccent, refused: report.themeUrlRefused, held: report.themeUrlHeld, card: report.themeUrlCard }));

    // A tweakcn theme PAGE URL imports the theme the page shows, its whole design language: put in force from the
    // picker, light and dark each resolve its colours, and both share its type, radius, spacing and shadows (issue
    // 132). Its fonts come from Google Fonts through the server, so whether they drew is logged, not required: a
    // runner without the network still imports the theme, named in the note. The System, Light, Dark switch and the
    // text size chips are read in each scheme, in this theme and in the default palette, and every label must hold
    // 4.5:1 against what it is drawn on, with the thumb under the selected label (issue 135).
    const pageNote = await importUrl(themeBase + '/editor/theme?theme=elegant-luxury');
    const lux = ((await held())['appearance.themes'] || []).find((t) => t.id === 'elegant-luxury');
    report.themePageHeld = Boolean(lux) && lux.name === 'Elegant Luxury' && lux.font?.family === 'Poppins, sans-serif' && lux.radius?.md === '0.375rem' && Boolean(lux.shadow?.md);
    await waitFor("Boolean(document.querySelector('app-settings .theme-card[data-theme-id=\"elegant-luxury\"]'))", 10000);
    await waitFor("!document.querySelector('app-settings').busy", 10000);
    await js("document.querySelector('app-settings .theme-card[data-theme-id=\"elegant-luxury\"]').click()");
    for (let i = 0; i < 50 && (await held())['appearance.theme']?.id !== 'elegant-luxury'; i += 1) await pause(200);
    const readVars = "(() => { const s = getComputedStyle(document.documentElement); const v = (n) => s.getPropertyValue(n).trim(); return { accent: v('--color-accent'), bg: v('--color-bg'), radius: v('--radius-md'), family: v('--font-family'), shadow: v('--shadow-md'), space: v('--space-5'), tracking: v('--font-tracking'), poppins: document.fonts.check('16px Poppins') }; })()";
    const choicePairs = `(() => {
      const cv = document.createElement('canvas'); cv.width = 1; cv.height = 1; const g = cv.getContext('2d', { willReadFrequently: true });
      const rgb = (c) => { g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = c; g.fillRect(0, 0, 1, 1); return [...g.getImageData(0, 0, 1, 1).data].slice(0, 3).map((n) => n / 255); };
      const s = document.querySelector('app-settings');
      const seg = s.querySelector('.segmented[data-key="appearance.skin"]');
      const thumb = seg.querySelector('.segment-thumb');
      const track = getComputedStyle(seg).backgroundColor;
      const fill = getComputedStyle(thumb).backgroundColor;
      const out = [];
      for (const l of seg.querySelectorAll('.segment')) {
        const on = l.hasAttribute('data-selected');
        const a = l.getBoundingClientRect(); const b = thumb.getBoundingClientRect();
        out.push({ what: 'switch ' + l.textContent.trim(), on, under: on ? Math.abs((a.left + a.right) / 2 - (b.left + b.right) / 2) < 2 : true, fg: rgb(getComputedStyle(l).color), bg: rgb(on ? fill : track) });
      }
      for (const l of s.querySelectorAll('.scale-choice')) out.push({ what: 'size ' + l.textContent.trim(), on: l.hasAttribute('data-selected'), under: true, fg: rgb(getComputedStyle(l).color), bg: rgb(getComputedStyle(l).backgroundColor) });
      return out;
    })()`;
    const contrastIn = async (label) => {
      await pause(400);
      const pairs = await js(choicePairs);
      const rows = pairs.map((p) => ({ what: p.what, on: p.on, under: p.under, ratio: Math.round(contrastRatio(p.fg, p.bg) * 100) / 100 }));
      const ok = rows.length >= 10 && rows.filter((r) => r.on).length === 2 && rows.every((r) => r.under && r.ratio >= 4.5);
      console.log('choice contrast ' + label + ': ' + JSON.stringify({ ok, rows }));
      return ok;
    };
    const drawn = {};
    const contrast = {};
    for (const skin of ['light', 'dark']) {
      await clickSkin(skin);
      await waitFor(`document.documentElement.dataset.scheme === ${JSON.stringify(skin)} && getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() === ${JSON.stringify(lux?.color?.[skin]?.accent ?? '')}`, 10000);
      // A font the server fetched is added by the page once it is read; give it the moment it takes before the capture.
      for (let i = 0; i < 20 && lux?.fonts?.length && !(await js("document.fonts.check('16px Poppins')")); i += 1) await pause(200);
      const v = await js(readVars);
      drawn[skin] = v.bg === lux.color[skin].bg && v.radius === '0.375rem' && v.family === 'Poppins, sans-serif' && v.shadow === lux.shadow.md && v.space === 'calc(0.25rem * 6)' && v.tracking === '0em';
      contrast['elegant-' + skin] = await contrastIn('elegant luxury ' + skin);
      console.log('theme page ' + skin + ': ' + JSON.stringify({ drawn: drawn[skin], ...v, fontsHeld: (lux.fonts || []).length }));
      await shot('05c-theme-page-' + skin + '.png');
    }
    report.themePage = report.themePageHeld && drawn.light && drawn.dark;
    console.log('theme page: ' + JSON.stringify({ pageNote, held: report.themePageHeld, drawn }));
    await putSettings({ 'appearance.theme': null });
    await waitFor("document.querySelector('app-settings .theme-card[data-theme-id=\"default\"]')?.getAttribute('aria-checked') === 'true'", 10000);
    for (const skin of ['light', 'dark']) {
      await clickSkin(skin);
      await waitFor(`document.documentElement.dataset.scheme === ${JSON.stringify(skin)}`, 10000);
      contrast['default-' + skin] = await contrastIn('default ' + skin);
      await shot('05d-switch-default-' + skin + '.png');
    }
    report.choiceContrast = Object.values(contrast).length === 4 && Object.values(contrast).every(Boolean);
  } finally {
    themeHost.close();
  }

  // The picker lists EVERY held theme and previews each in its own colours (issue 186). Two more themes are pasted
  // with no name, so both arrive as "Imported theme": with the earlier three that is five held themes, and the two
  // that share a name must be two cards, not one replacing the other. Each card is read against the server's own list,
  // in light and dark, before and after leaving Settings and coming back (a fresh page, which drew every card in the
  // default palette before), at desktop width and at a phone's.
  const pasteUnnamed = async (light, dark) => {
    const count = ((await held())['appearance.themes'] || []).length;
    await waitFor("!document.querySelector('app-settings').busy", 10000);
    const css = ':root { --primary: ' + light[0] + '; --background: ' + light[1] + '; --card: ' + light[1] + '; } .dark { --primary: ' + dark[0] + '; --background: ' + dark[1] + '; --card: ' + dark[1] + '; }';
    await js(`(() => { const s = document.querySelector('app-settings'); const n = s.querySelector('.theme-import-name'); n.value = ''; n.dispatchEvent(new Event('input', { bubbles: true })); const t = s.querySelector('.theme-import-text'); t.value = ${JSON.stringify(css)}; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await waitFor("!document.querySelector('app-settings .theme-import-action').disabled");
    await js("document.querySelector('app-settings .theme-import-action').click()");
    for (let i = 0; i < 50 && ((await held())['appearance.themes'] || []).length === count; i += 1) await pause(200);
  };
  await pasteUnnamed(['#0f766e', '#ecfdf5'], ['#5eead4', '#04201c']);
  await pasteUnnamed(['#9d174d', '#fdf2f8'], ['#f9a8d4', '#2a0a18']);
  const pickerThemes = (await held())['appearance.themes'] || [];
  // What the page draws, read against what the server holds: the cards in order, and each card's background and
  // accent swatches as the page resolves them, next to the theme's own colour resolved the same way.
  const pickerRead = (scheme) => js(`(() => {
    const themes = ${JSON.stringify(pickerThemes)};
    const probe = document.createElement('span');
    document.body.append(probe);
    const resolve = (v) => { probe.style.backgroundColor = ''; probe.style.backgroundColor = v; return getComputedStyle(probe).backgroundColor; };
    const cards = [...document.querySelectorAll('app-settings .theme-card')].map((c) => {
      const t = themes.find((x) => x.id === c.dataset.themeId);
      const sw = (token) => getComputedStyle(c.querySelector('.theme-swatch[data-token="' + token + '"]')).backgroundColor;
      const own = t && t.color && t.color[${JSON.stringify(scheme)}];
      return { id: c.dataset.themeId, name: c.querySelector('.theme-card-name').textContent.trim(), bg: sw('bg'), accent: sw('accent'), wantBg: own && own.bg ? resolve(own.bg) : null, wantAccent: own && own.accent ? resolve(own.accent) : null };
    });
    probe.remove();
    return cards;
  })()`);
  const pickerOk = (cards) => cards.map((c) => c.id).join('|') === ['default', ...pickerThemes.map((t) => t.id)].join('|')
    && cards.every((c) => c.id === 'default' || ((c.wantAccent === null || c.accent === c.wantAccent) && (c.wantBg === null || c.bg === c.wantBg)))
    && new Set(cards.map((c) => c.bg + ' ' + c.accent)).size === cards.length;
  const reopenSettings = async () => {
    await js("document.querySelector('app-settings .sheet-back').click()");
    await waitFor("!document.querySelector('.sheet')", 10000);
    await js("document.querySelector('.sidebar-head .gear-button').click()");
    await waitFor("document.querySelectorAll('app-settings .theme-card').length > 0 && !document.querySelector('.sheet').getAnimations().some((a) => a.playState === 'running')", 10000);
    await pause(300);
  };
  const showPicker = () => js("(() => { document.querySelector('app-settings .theme-grid').scrollIntoView({ block: 'start' }); return true; })()");
  const picker = {};
  for (const skin of ['light', 'dark']) {
    await clickSkin(skin);
    await waitFor(`document.documentElement.dataset.scheme === ${JSON.stringify(skin)}`, 10000);
    await pause(300);
    const before = await pickerRead(skin);
    await reopenSettings();
    const after = await pickerRead(skin);
    await showPicker();
    await pause(200);
    await shot('05e-theme-picker-' + skin + '.png');
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await waitFor('window.innerWidth === 390', 5000);
    await pause(300);
    const phone = await pickerRead(skin);
    await showPicker();
    await pause(200);
    await shot('05f-theme-picker-phone-' + skin + '.png');
    await cdp('Emulation.clearDeviceMetricsOverride', {});
    await waitFor('window.innerWidth > 390', 5000);
    picker[skin] = { before: pickerOk(before), after: pickerOk(after), phone: pickerOk(phone), cards: after };
  }
  report.themePicker = pickerThemes.length >= 5 && new Set(pickerThemes.map((t) => t.id)).size === pickerThemes.length && Object.values(picker).every((p) => p.before && p.after && p.phone);
  console.log('theme picker: ' + JSON.stringify({ held: pickerThemes.map((t) => t.id), picker }));
  await putSettings({ 'appearance.theme': null });
  await waitFor("document.querySelector('app-settings .theme-card[data-theme-id=\"default\"]')?.getAttribute('aria-checked') === 'true'", 10000);

  // Notices: an update state raises a native notice over the same bridge the message notices use, and a type the
  // server has switched off raises none. The shell records every notice it is asked to show.
  smokeNotices.length = 0;
  wc.send('bridge:event:update.state', { state: 'available', version: '9.9.9' });
  for (let i = 0; i < 50 && !smokeNotices.some((n) => n.title === 'Update available'); i += 1) await pause(100);
  report.noticeFired = smokeNotices.some((n) => n.title === 'Update available');
  await putSettings({ 'notifications.updateAvailable': false });
  await waitFor("document.querySelector('app-root')?.settings?.['notifications.updateAvailable'] === false", 10000);
  smokeNotices.length = 0;
  wc.send('bridge:event:update.state', { state: 'available', version: '9.9.9' });
  await pause(600);
  report.noticeSuppressed = smokeNotices.length === 0;
  await putSettings({ 'notifications.updateAvailable': true });
  report.notices = report.noticeFired && report.noticeSuppressed;

  // The update banner runs the whole flow in the app: an available state offers the download, the button's action
  // calls the bridge command it says it does, the download shows its progress, ready offers the restart, and a failure
  // says so. The shell records every bridge command the page calls, so the assertion reads the command actually sent.
  const bannerCommand = () => js("(() => { const b = document.querySelector('.app-notice .app-notice-action'); if (!b) return null; const c = b.dataset.command; b.click(); return c; })()");
  const called = async (name) => { for (let i = 0; i < 50 && !smokeCalls.includes(name); i += 1) await pause(100); return smokeCalls.includes(name); };
  smokeCalls.length = 0;
  wc.send('bridge:event:update.state', { state: 'available', version: '9.9.9', canInstall: true });
  await waitFor("Boolean(document.querySelector('.app-notice .app-notice-action'))", 10000);
  const downloadCommand = await bannerCommand();
  report.updateDownloadAction = downloadCommand === 'updates.download' && (await called('updates.download'));
  wc.send('bridge:event:update.state', { state: 'downloading', version: '9.9.9', percent: 0.5, detail: '5.0 MB of 12 MB', canInstall: true });
  await waitFor("Boolean(document.querySelector('.app-notice .app-notice-progress'))", 10000);
  report.updateBanner = await js("(() => { const p = document.querySelector('.app-notice-progress'); return Boolean(p) && Number(p.value) > 0 && Number(p.value) < 1; })()");
  smokeCalls.length = 0;
  wc.send('bridge:event:update.state', { state: 'ready', version: '9.9.9', canInstall: true });
  await waitFor("Boolean(document.querySelector('.app-notice .app-notice-action'))", 10000);
  const installCommand = await bannerCommand();
  report.updateInstallAction = installCommand === 'updates.install' && (await called('updates.install'));
  wc.send('bridge:event:update.state', { state: 'error', version: '9.9.9', detail: 'The download was interrupted.', canInstall: true });
  await waitFor("Boolean(document.querySelector('.app-notice'))", 10000);
  report.updateFailure = await js("(() => { const b = document.querySelector('.app-notice'); return Boolean(b) && b.textContent.includes('interrupted') && Boolean(b.querySelector('.app-notice-action')); })()");
  // A new check replaces the failure with the check in progress, which offers nothing to press, and a check that finds
  // nothing newer says so and is dismissed in the page, which clears the banner.
  wc.send('bridge:event:update.state', { state: 'checking' });
  await waitFor("(document.querySelector('.app-notice')?.textContent || '').includes('Checking for updates') && !document.querySelector('.app-notice .app-notice-action')", 10000);
  // The check in progress is a transient state, so its answer waits out the min-visible floor rather than flashing it.
  const checkSeen = Date.now();
  wc.send('bridge:event:update.state', { state: 'current', version: '0.0.0', canInstall: true });
  await waitFor("(document.querySelector('.app-notice')?.textContent || '').includes('latest version')", 10000);
  const floorMs = Number.parseFloat(await js("getComputedStyle(document.documentElement).getPropertyValue('--motion-min-visible')"));
  report.noticeFloor = Number.isFinite(floorMs) && floorMs > 0 && Date.now() - checkSeen >= floorMs / 2;
  smokeCalls.length = 0;
  await js("document.querySelector('.app-notice .close-button').click()");
  await pause(300);
  report.updateBannerCleared = await js("!document.querySelector('.app-notice')") && smokeCalls.length === 0;
  // The same update event updates one card and its progress node, without replaying arrival.
  await js("document.querySelector('app-root').onUpdate({state:'downloading',version:'9.9.10',percent:0.2,canInstall:true})");
  await waitFor("Boolean(document.querySelector('.app-notice-progress'))");
  await js("window.noticeProofNode = document.querySelector('.app-notice-progress'); document.querySelector('app-root').onUpdate({state:'downloading',version:'9.9.10',percent:0.8,canInstall:true})");
  await waitFor("document.querySelector('.app-notice-progress')?.value === 0.8");
  report.noticeInPlace = await js("window.noticeProofNode === document.querySelector('.app-notice-progress') && document.querySelectorAll('.app-notice').length === 1");
  await js("document.querySelector('.close-button').click()");
  await waitFor("!document.querySelector('.app-notice')");
  await js("document.querySelector('app-root').onUpdate({state:'downloading',version:'9.9.10',percent:0.9,canInstall:true})");
  report.noticeDismissed = await js("!document.querySelector('.app-notice')");
  report.updates = report.updateDownloadAction && report.updateBanner && report.updateInstallAction && report.updateFailure && report.updateBannerCleared && report.noticeInPlace && report.noticeDismissed && report.noticeFloor;

  // Issue 167: the sections are tabs, one per section the schema declares and in its order, and every setting is
  // reached from one. Each tab is pressed in turn: its section alone shows, and every key it offers is drawn inside
  // the window. The same walk runs at a phone's width below, so a setting the desktop offers and a phone does not
  // fails here rather than ships.
  const tabSel = (id) => "document.querySelector('app-settings .settings-tab[data-tab=\"" + id + "\"]')";
  const showTab = async (id) => {
    await js(tabSel(id) + '.click()');
    await waitFor(tabSel(id) + ".getAttribute('aria-selected') === 'true'", 5000);
    await pause(200);
  };
  const tabWalk = async () => {
    const out = {};
    for (const tab of settingsTabs()) {
      await showTab(tab.id);
      out[tab.id] = await js("(() => { const keys = " + JSON.stringify(tab.keys) + "; const s = document.querySelector('app-settings'); const shown = [...s.querySelectorAll('.sheet-section')].filter((x) => !x.hidden && x.getBoundingClientRect().height > 0).map((x) => x.dataset.section); const seen = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.left >= -0.5 && r.right <= innerWidth + 0.5; }; const panel = s.querySelector('.sheet-section:not([hidden])'); const missing = keys.filter((k) => !seen(panel.querySelector('[data-key=\"' + k + '\"]'))); const extra = " + JSON.stringify(tab.kind) + " === 'about' ? seen(panel.querySelector('[data-action=about]')) : " + JSON.stringify(tab.kind) + " === 'device' ? seen(panel.querySelector('[data-action=signout]')) : true; return { shown: shown.join('|'), missing, extra, doc: document.documentElement.scrollWidth <= innerWidth }; })()");
    }
    return out;
  };
  const tabsOk = (walk) => settingsTabs().every((t) => walk[t.id] && walk[t.id].shown === t.id && walk[t.id].missing.length === 0 && walk[t.id].extra && walk[t.id].doc);
  const tabLabels = await js("[...document.querySelectorAll('app-settings [role=tablist] [role=tab]')].map((t) => t.textContent.trim()).join('|')");
  const desktopWalk = await tabWalk();
  report.settingsTabs = tabLabels === settingsTabs().map((t) => t.label).join('|') && tabsOk(desktopWalk);
  if (!report.settingsTabs) console.error('settings tabs: ' + JSON.stringify({ tabLabels, desktopWalk }));
  // The app icon: Follow theme, drawn by the page in the theme in force, then the fixed palettes; a choice is written to
  // the server like any setting and applied by this shell to the images it draws (and the Dock on macOS). Put back to
  // the default after.
  await showTab('appearance');
  const iconChoice = (id) => "document.querySelector('app-settings .app-icon-choice[data-icon-id=\"" + id + "\"]')";
  await waitFor("[...document.querySelectorAll('app-settings .app-icon-choice img')].every((i) => i.complete && i.naturalWidth > 0)", 10000).catch(() => {});
  const iconPictures = await js("[...document.querySelectorAll('app-settings .app-icon-choice img')].length === " + appIconSpec.icons.length + " && [...document.querySelectorAll('app-settings .app-icon-choice img')].every((i) => i.complete && i.naturalWidth > 0)");
  const themePicture = await js(iconChoice(appIconSpec.default) + ".querySelector('img').getAttribute('src').startsWith('data:image/png')");
  await waitFor('Boolean(' + iconChoice('night') + ') && !' + iconChoice('night') + '.disabled', 10000);
  await js(iconChoice('night') + '.click()');
  for (let i = 0; i < 50 && ((await held())['appearance.appIcon'] !== 'night' || appIconApplied !== 'night'); i += 1) await pause(200);
  const iconHeld = (await held())['appearance.appIcon'] === 'night';
  const iconApplied = appIconApplied === 'night';
  // A fixed palette stands in for the theme in the images the shell draws (the tray's mark is the palette's).
  const nightMark = shellIcons({ platform: process.platform, masters: iconMasters, tokens: tokenSpec.color, fixed: { scheme: appIconSpec.icons.find((i) => i.id === 'night').scheme, colors: appIconSpec.icons.find((i) => i.id === 'night').colors } }).palette.mark;
  const iconDrawn = smokeIcons.length > 0 && smokeIcons.at(-1).mark === nightMark;
  const iconMarked = await js(iconChoice('night') + ".getAttribute('aria-checked') === 'true'");
  await waitFor('!' + iconChoice(appIconSpec.default) + '.disabled', 10000);
  await js(iconChoice(appIconSpec.default) + '.click()');
  for (let i = 0; i < 50 && appIconApplied !== appIconSpec.default; i += 1) await pause(200);
  const themeAgain = smokeIcons.at(-1).mark !== nightMark;
  report.appIcon = iconPictures && themePicture && iconHeld && iconApplied && iconDrawn && iconMarked && themeAgain && appIconApplied === appIconSpec.default && (await held())['appearance.appIcon'] === appIconSpec.default;
  if (!report.appIcon) console.error('app icon: ' + JSON.stringify({ iconPictures, themePicture, iconHeld, iconApplied, iconDrawn, iconMarked, themeAgain, now: appIconApplied }));

  await putSettings({ 'appearance.theme': null, 'appearance.skin': 'system' });
  await showTab('notifications');
  nativeTheme.themeSource = 'light';
  await pause(300);
  await shot('05e-settings-notifications.png');
  nativeTheme.themeSource = 'dark';
  await pause(300);
  await shot('05f-settings-notifications-dark.png');
  await showTab('appearance');
  nativeTheme.themeSource = 'light';
  await pause(300);
  await shot('05-settings.png');
  nativeTheme.themeSource = 'dark';
  await pause(300);
  await shot('05b-settings-dark.png');
  nativeTheme.themeSource = 'light';
  await pause(200);

  // The sheet's shape: the whole top strip is the back control, and the ways back are the strip, Escape and a press
  // on the backdrop. The hit area is read with elementFromPoint, so it is the real click target at the strip's own
  // corners rather than the label alone. A press INSIDE the card, and a drag that starts inside and is released over
  // the backdrop, must both leave the page where it is; only a press that both starts and ends on the backdrop
  // returns. This is the desktop smoke's check for what the sibling app proves with its own per-page overflow probes.
  const sheetHit = (tag) => js('(() => { const b = document.querySelector("' + tag + ' .sheet-back"); if (!b) return false; const r = b.getBoundingClientRect(); const y = r.top + r.height / 2; const pts = [[r.left + 2, y], [r.left + r.width / 2, y], [r.right - 2, y]]; return pts.every(function (q) { const el = document.elementFromPoint(q[0], q[1]); return Boolean(el) && b.contains(el); }); })()');
  const pressSheet = (downSel, upSel) => js('(() => {' +
    ' var down = ' + JSON.stringify(downSel) + '; var up = ' + JSON.stringify(upSel) + ';' +
    ' var scrim = document.querySelector(".sheet-scrim");' +
    ' var card = document.querySelector(".sheet");' +
    ' var sr = scrim.getBoundingClientRect(); var cr = card.getBoundingClientRect();' +
    ' var at = function (sel) { return sel === "backdrop" ? [sr.left + 6, sr.top + 6] : [cr.left + 14, cr.top + 14]; };' +
    ' var a = at(down); var b = at(up);' +
    ' var ev = function (type, q, buttons) { return new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 21, pointerType: "mouse", isPrimary: true, clientX: q[0], clientY: q[1], button: 0, buttons: buttons }); };' +
    ' (down === "backdrop" ? scrim : card).dispatchEvent(ev("pointerdown", a, 1));' +
    ' (up === "backdrop" ? scrim : card).dispatchEvent(ev("pointerup", b, 0));' +
    ' return true; })()');
  const proveAppNotices = async () => {
    const originalSize = w.getSize();
    const originalMinimum = w.getMinimumSize();
    w.setMinimumSize(320, 400);
    const originalTheme = nativeTheme.themeSource;
    const geometry = "(() => { const card = document.querySelector('.app-notice'); if (!card) return false; const r = card.getBoundingClientRect(); const controls = [...document.querySelectorAll('.conv-head button, .sidebar-head button, app-composer button, app-composer textarea')]; return r.width > 200 && r.left >= 0 && r.right <= innerWidth && controls.every((b) => { const q = b.getBoundingClientRect(); return !q.width || !q.height || r.right <= q.left || r.left >= q.right || r.bottom <= q.top || r.top >= q.bottom; }); })()";
    // On a phone the notice must clear EVERY control the visible surface offers, the open drawer's included: its Edit
    // control, its rows and the conversation's own header and composer. Each state is read once it has settled, and
    // what the card lands on is named in the report, so a failure says which control was covered rather than only that
    // one was. The scrim is the drawer's backdrop, not a control on the surface, and the card's own buttons are its own.
    // A control counts where it can be seen: its box is cut to every scrolling or clipping ancestor and to the window,
    // so a message's actions scrolled out of the list above are not read as sitting under the card.
    const covered = () => js("(() => { const card = document.querySelector('.app-notice'); if (!card) return ['no notice']; const r = card.getBoundingClientRect(); const shown = (el) => { const q = el.getBoundingClientRect(); let l = Math.max(q.left, 0), t = Math.max(q.top, 0), rt = Math.min(q.right, innerWidth), b = Math.min(q.bottom, innerHeight); for (let a = el.parentElement; a; a = a.parentElement) { const s = getComputedStyle(a); if (s.overflowX === 'visible' && s.overflowY === 'visible') continue; const c = a.getBoundingClientRect(); l = Math.max(l, c.left); t = Math.max(t, c.top); rt = Math.min(rt, c.right); b = Math.min(b, c.bottom); } return rt > l && b > t ? { left: l, top: t, right: rt, bottom: b } : null; }; return [...document.querySelectorAll('button, input, select, textarea, a[href], [role=button], [role=option], .chat-row')].filter((el) => !card.contains(el) && !el.classList.contains('scrim') && getComputedStyle(el).visibility !== 'hidden').filter((el) => { const q = shown(el); return q && !(r.right <= q.left || r.left >= q.right || r.bottom <= q.top || r.top >= q.bottom); }).map((el) => (el.className || el.tagName.toLowerCase()) + ':' + (el.getAttribute('aria-label') || el.textContent.trim().slice(0, 24))); })()");
    const pane = (want) => js("(() => { const root = document.querySelector('app-root'); if (" + JSON.stringify(want) + " === 'list') root.listOpen = true; else root.closeDrawer(); return true; })()");
    const clear = {};
    const listWasOpen = await js("document.querySelector('app-root').listOpen");
    for (const [label, width, height, theme, drawer] of [['light', 1100, 800, 'light'], ['dark', 1100, 800, 'dark'], ['mobile', 390, 844, 'light', 'list'], ['mobile-conversation', 390, 844, 'light', 'conversation']]) {
      w.setSize(width, height);
      nativeTheme.themeSource = theme;
      if (drawer) {
        await pane(drawer);
        await waitFor("document.querySelector('.shell')?.dataset.pane === " + JSON.stringify(drawer), 5000);
        await pause(400); // the drawer slides on a 160ms transition; read the settled surface, not a frame of it.
      }
      await js("document.querySelector('app-root').onUpdate({state:'downloading',version:'9.9.11',percent:0.6,detail:'6 MB of 10 MB',canInstall:true})");
      await waitFor("Boolean(document.querySelector('.app-notice-progress'))");
      if (drawer) {
        let hits = await covered();
        for (const t0 = Date.now(); hits.length && Date.now() - t0 < 3000; hits = await covered()) await pause(100);
        clear[label] = hits;
      } else {
        await waitFor(geometry);
      }
      await shot('05-notices-' + label + '.png');
    }
    await js("document.querySelector('app-root').listOpen = " + JSON.stringify(Boolean(listWasOpen)));
    report.noticeClearMobile = Object.values(clear).every((hits) => hits.length === 0);
    report.noticeCovers = clear;
    report.updates = report.updates && report.noticeClearMobile;
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    report.noticeReducedMotion = await js("getComputedStyle(document.querySelector('.app-notice')).animationName === 'none'");
    await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
    report.updates = report.updates && report.noticeReducedMotion;
    await js("document.querySelector('.close-button').click()");
    await waitFor("!document.querySelector('.app-notice')");
    w.setMinimumSize(...originalMinimum);
    w.setSize(...originalSize);
    nativeTheme.themeSource = originalTheme;
  };
  const sheetVisible = () => js("Boolean(document.querySelector('.sheet'))");
  const sideways = async () => js("(() => { const d = document.documentElement; return { inner: window.innerWidth, doc: d.scrollWidth, body: document.body.scrollWidth }; })()");

  await waitFor("Boolean(document.querySelector('app-settings .sheet-back'))");
  report.sheetHitArea = await sheetHit('app-settings');
  await pressSheet('card', 'card');
  await pause(200);
  report.sheetInsideKeeps = await sheetVisible();
  await pressSheet('card', 'backdrop');
  await pause(200);
  report.sheetDragKeeps = await sheetVisible();
  await pressSheet('backdrop', 'backdrop');
  await waitFor("!document.querySelector('.sheet')", 10000);
  await proveAppNotices();
  report.sheetBackdropReturns = !(await sheetVisible());

  // Escape is the keyboard's own way back, and the strip names the key that does it.
  await js("document.querySelector('.sidebar-head .gear-button').click()");
  await waitFor("Boolean(document.querySelector('app-settings .sheet-back'))");
  await js("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  await waitFor("!document.querySelector('.sheet')", 10000);
  report.sheetEscapeReturns = !(await sheetVisible());

  // The card is only as wide as its content needs: at a narrow window the page and the card must not scroll sideways.
  if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
  await js("document.querySelector('.sidebar-head .gear-button').click()");
  await waitFor("Boolean(document.querySelector('app-settings .sheet-back'))");
  await cdp('Emulation.setDeviceMetricsOverride', { width: 400, height: 720, deviceScaleFactor: 1, mobile: false });
  await pause(300);
  const narrowSettings = await sideways();
  report.sheetWidthSettings = narrowSettings.doc <= narrowSettings.inner && narrowSettings.body <= narrowSettings.inner;

  // Issue 167: on a phone Settings is a page that fills the screen, not a card, with the same tabs and every setting the
  // desktop offers; issue 168: its way back to the chats list is the chats icon, labelled with where it goes.
  await cdp('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
  await waitFor('window.innerWidth === 375', 5000);
  await pause(400);
  const phonePage = await js("(() => { const s = document.querySelector('.sheet').getBoundingClientRect(); const b = document.querySelector('app-settings .sheet-back'); const vis = (e) => Boolean(e) && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0; const narrow = b.querySelector('.sheet-back-narrow'); const icon = narrow && narrow.querySelector('.icon'); return { fills: Math.abs(s.left) < 1 && Math.abs(s.top) < 1 && Math.abs(s.width - innerWidth) < 1 && Math.abs(s.height - innerHeight) < 1, narrow: vis(narrow), wide: vis(b.querySelector('.sheet-back-wide')), esc: vis(b.querySelector('.sheet-esc')), label: narrow ? narrow.querySelector('.sheet-back-label').textContent.trim() : '', icon: icon ? icon.dataset.icon : '', iconDrawn: vis(icon) }; })()");
  const phoneWalk = await tabWalk();
  await showTab('appearance');
  nativeTheme.themeSource = 'light';
  await pause(300);
  await shot('05g-settings-phone.png');
  nativeTheme.themeSource = 'dark';
  await pause(300);
  await shot('05h-settings-phone-dark.png');
  await showTab('notifications');
  await shot('05j-settings-phone-notifications-dark.png');
  nativeTheme.themeSource = 'light';
  await pause(300);
  await shot('05i-settings-phone-notifications.png');
  report.phoneSettings = phonePage.fills && phonePage.narrow && !phonePage.wide && !phonePage.esc && phonePage.label === 'Back to chats' && phonePage.icon === 'messages-square' && phonePage.iconDrawn && tabsOk(phoneWalk);
  if (!report.phoneSettings) console.error('phone settings: ' + JSON.stringify({ phonePage, phoneWalk }));
  // About lives under Settings (issue 171): its row is on the About tab.
  await showTab('about');

  // About: a page of its own on every platform (issue 171), opened from Settings' last row, every value from the half
  // that owns it, and checked at the same narrow width. Its structure is read the same way at a phone's width and at the
  // desktop's, and the two must match: one component, one page, whatever the window.
  const aboutStructure = "(() => { const a = document.querySelector('app-about'); const i = a && a.querySelector('.about-icon'); return a ? JSON.stringify({ title: (a.querySelector('.sheet-title') || {}).textContent || '', back: (a.querySelector('.sheet-back-label') || {}).textContent || '', parts: [...a.querySelectorAll('.sheet-body > [data-section]')].map((s) => s.dataset.section), icon: Boolean(i && i.complete && i.naturalWidth > 0 && i.getBoundingClientRect().width > 0 && i.getBoundingClientRect().top < a.querySelector('[data-action=check-updates]').getBoundingClientRect().top), check: Boolean(a.querySelector('button[data-action=check-updates]')), rows: [...a.querySelectorAll('.about-row')].map((r) => r.dataset.key) }) : null; })()";
  const aboutRow = await js("(() => { const s = [...document.querySelectorAll('app-settings .sheet-section')]; return s.length > 1 && s.at(-1).dataset.section === 'about' && Boolean(s.at(-1).querySelector('button[data-action=about]')) && !document.querySelector('app-settings app-about'); })()");
  await js("document.querySelector('app-settings [data-action=about]').click()");
  await waitFor(aboutShown);
  await pause(1000);
  report.sheetHitAreaAbout = await sheetHit('app-about');
  const narrowAbout = await sideways();
  report.sheetWidthAbout = narrowAbout.doc <= narrowAbout.inner && narrowAbout.body <= narrowAbout.inner;
  // The phone: the same page at a phone's width, light and dark.
  await cdp('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
  await waitFor('window.innerWidth === 375', 5000);
  await pause(300);
  const phoneAbout = await js(aboutStructure);
  nativeTheme.themeSource = 'light';
  await pause(300);
  await shot('06c-about-phone.png');
  nativeTheme.themeSource = 'dark';
  await pause(300);
  await shot('06d-about-phone-dark.png');
  nativeTheme.themeSource = 'light';
  // The notice is seen: its dismiss control (the one part of the stack that takes a press) is the topmost thing at its
  // centre, so the sheet does not cover it; and the sheet starts below the notice's band, on a phone and on the
  // desktop alike, so the card covers no part of the sheet.
  const noticeSeen = "(() => { const n = document.querySelector('.app-notice'); const d = n && n.querySelector('.close-button'); if (!d || !(n.textContent || '').includes('does not update itself')) return false; const r = d.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); const sheet = document.querySelector('.sheet'); return Boolean(top && top.closest('.close-button') && sheet && document.querySelector('app-about') && sheet.getBoundingClientRect().top >= n.getBoundingClientRect().bottom); })()";
  await js("document.querySelector('app-about [data-action=check-updates]').click()");
  report.aboutPhoneNotice = await waitFor(noticeSeen, 10000).then(() => true, () => false);
  await waitFor("!document.querySelector('app-about [data-action=check-updates]').dataset.press", 5000).catch(() => {});
  await pause(300);
  await shot('06g-about-phone-notice.png');
  nativeTheme.themeSource = 'dark';
  await pause(300);
  await shot('06h-about-phone-notice-dark.png');
  nativeTheme.themeSource = 'light';
  await js("document.querySelector('.app-notice .close-button').click()");
  await waitFor("!document.querySelector('.app-notice')", 5000);
  await cdp('Emulation.clearDeviceMetricsOverride', {});
  await pause(300);
  const desktopAbout = await js(aboutStructure);
  report.aboutSameEverywhere = Boolean(desktopAbout) && desktopAbout === phoneAbout;
  const aboutPage = desktopAbout ? JSON.parse(desktopAbout) : {};
  report.aboutPage = aboutRow && aboutPage.title === 'About' && aboutPage.back === 'Back to settings' && aboutPage.parts.join('|') === 'identity|updates|build' && aboutPage.icon && aboutPage.check;
  await pause(200);
  await shot('06-about.png');
  nativeTheme.themeSource = 'dark';
  await pause(300);
  await shot('06b-about-dark.png');
  nativeTheme.themeSource = 'light';
  await pause(200);
  // Check for updates runs the tray's own check, and its answer is the app notice; a run with no updater says why.
  await js("document.querySelector('app-about [data-action=check-updates]').click()");
  report.aboutCheckNotice = await waitFor(noticeSeen, 10000).then(() => true, () => false);
  await waitFor("!document.querySelector('app-about [data-action=check-updates]').dataset.press", 5000).catch(() => {});
  await pause(300);
  await shot('06e-about-check-notice.png');
  nativeTheme.themeSource = 'dark';
  await pause(300);
  await shot('06f-about-check-notice-dark.png');
  nativeTheme.themeSource = 'light';
  await js("document.querySelector('.app-notice .close-button').click()");
  await waitFor("!document.querySelector('.app-notice')", 5000);
  // A second press after the notice was dismissed is a new question, so its answer shows again.
  await js("document.querySelector('app-about [data-action=check-updates]').click()");
  report.aboutCheckAgain = await waitFor("(document.querySelector('.app-notice')?.textContent || '').includes('does not update itself')", 10000).then(() => true, () => false);
  await js("document.querySelector('.app-notice .close-button').click()");
  await waitFor("!document.querySelector('.app-notice')", 5000);
  // The client's own build and the server's, in chela's order, each value copyable, the links, and the one action that
  // copies the lot.
  const aboutOrder = ['product', 'version', 'channel', 'build', 'commit', 'builtAt', 'serverVersion', 'serverCommit', 'serverChannel', 'serverBuild', 'serverBuiltAt', 'platform', 'arch', 'electron', 'chromium', 'node', 'installSource', 'packaged', 'updateChannel', 'serverPlatform', 'engine.kind', 'engine.version', 'apiVersion'];
  const aboutSeen = await js("(() => ({ keys: [...document.querySelectorAll('app-about .about-row')].map((r) => r.dataset.key), copyable: [...document.querySelectorAll('app-about .about-row')].every((r) => Boolean(r.querySelector('button.about-value'))), links: [...document.querySelectorAll('app-about .about-link')].map((a) => a.dataset.link), electron: (document.querySelector('app-about .about-row[data-key=electron] .about-value-text') || {}).textContent || '', copyAll: Boolean(document.querySelector('app-about .about-copy')) }))()");
  // Back from About returns to Settings, the page it was pushed over.
  await js("document.querySelector('app-about .sheet-back').click()");
  report.aboutBack = await waitFor("Boolean(document.querySelector('app-settings .sheet-back')) && !document.querySelector('app-about') && document.querySelector('.sheet').getAttribute('aria-label') === 'Settings'", 10000).then(() => true, () => false);
  // Back from About lands on the About tab it was opened from, not on the first tab.
  report.aboutBackTab = await js(tabSel('about') + "?.getAttribute('aria-selected') === 'true'");
  report.about = report.aboutBackTab && report.aboutPage && report.aboutSameEverywhere && report.aboutPhoneNotice && report.aboutCheckNotice && report.aboutCheckAgain && report.aboutBack && aboutSeen.keys.join('|') === aboutOrder.join('|') && aboutSeen.copyable && aboutSeen.links.join('|') === 'source|licence|report' && aboutSeen.electron === process.versions.electron && aboutSeen.copyAll;
  if (!report.about) console.error('about: ' + JSON.stringify({ page: report.aboutPage, same: report.aboutSameEverywhere, phoneNotice: report.aboutPhoneNotice, phone: phoneAbout, desktop: desktopAbout, notice: report.aboutCheckNotice, again: report.aboutCheckAgain, back: report.aboutBack, ...aboutSeen }));
  report.sheet = report.sheetHitArea && report.sheetInsideKeeps && report.sheetDragKeeps && report.sheetBackdropReturns && report.sheetEscapeReturns && report.sheetHitAreaAbout && report.sheetWidthSettings && report.sheetWidthAbout;
  if (!report.sheet) console.error('sheet: ' + JSON.stringify({ hit: report.sheetHitArea, inside: report.sheetInsideKeeps, drag: report.sheetDragKeeps, backdrop: report.sheetBackdropReturns, escape: report.sheetEscapeReturns, hitAbout: report.sheetHitAreaAbout, wSettings: report.sheetWidthSettings, wAbout: report.sheetWidthAbout }));
  await js("document.querySelector('app-settings .sheet-back').click()");
  await waitFor("Boolean(document.querySelector('.sidebar .chat-row'))");

  // The phone: one pane at a time. The conversation is the pane; the list is a drawer that slides in over it from the
  // left, the sibling's slide menu mirrored, with a scrim behind it and a back control returning. Checked at three
  // phone widths so a hidden right edge fails rather than ships, and the composer's field is checked for iOS's
  // focus-zoom floor: under the floor a tap zooms the whole page and the send control goes off the right of the screen.
  if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
  let phoneFits = true;
  for (const width of [320, 375, 414]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 812, deviceScaleFactor: 1, mobile: false });
    await pause(250);
    const m = await js("({ inner: window.innerWidth, doc: document.documentElement.scrollWidth, body: document.body.scrollWidth })");
    if (m.inner !== width || m.doc > width || m.body > width) phoneFits = false;
  }
  report.phoneFits = phoneFits;
  await cdp('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
  await waitFor('window.innerWidth === 375', 5000);
  report.phoneComposer = await js("parseFloat(getComputedStyle(document.querySelector('app-composer textarea')).fontSize) >= 16");
  report.phoneSend = await js("(() => { const b = document.querySelector('app-composer button.send'); if (!b) return false; const s = getComputedStyle(b); const box = b.getBoundingClientRect(); const size = Math.min(box.width, box.height); const glyph = parseFloat(s.fontSize); return glyph >= 20 && glyph < size && parseInt(s.fontWeight, 10) >= 600 && size >= 36; })()");
  // The open drawer is read until it has settled, as the closed one is below. One read straight after the resize failed
  // on the macOS arm64 runner while the screenshot taken next shows the drawer open, and the single boolean could not
  // say which part it was, so each part is reported when the drawer never settles open.
  const drawerParts = () => js("(() => { const r = document.querySelector('.shell .sidebar').getBoundingClientRect(); return { back: getComputedStyle(document.querySelector('app-conversation .conv-back')).display, width: r.width, inner: window.innerWidth, scrim: getComputedStyle(document.querySelector('.scrim')).visibility, pane: document.querySelector('.shell').dataset.pane }; })()");
  const drawerOpen = (d) => d.back !== 'none' && d.width > 0 && d.width < d.inner && d.scrim === 'visible';
  let drawer = await drawerParts();
  for (const t0 = Date.now(); !drawerOpen(drawer) && Date.now() - t0 < 3000; drawer = await drawerParts()) await pause(100);
  report.phoneDrawer = drawerOpen(drawer);
  if (!report.phoneDrawer) console.error('phone drawer: ' + JSON.stringify(drawer));
  await shot('07-phone-list.png');
  // A tap still selects a chat and closes the drawer, unchanged by the gesture.
  await js("document.querySelector('.sidebar .chat-row').click()");
  await waitFor("document.querySelector('.shell')?.dataset.pane === 'conversation'");
  await pause(400); // the drawer slides on a 160ms transition; measure the settled position, not a frame of it.
  report.phone = await js("(() => { const r = document.querySelector('.shell .sidebar').getBoundingClientRect(); const scrim = document.querySelector('.scrim'); return r.right <= 0 && (!scrim || getComputedStyle(scrim).visibility === 'hidden'); })()");
  await shot('08-phone-conversation.png');
  // Issue 168: the way back to the chats list is the chats icon from the shared set, named for where it goes, and no
  // back arrow.
  report.chatsBack = await js("(() => { const b = document.querySelector('app-conversation .conv-back'); const i = b && b.querySelector('.icon'); if (!i) return false; const r = i.getBoundingClientRect(); return getComputedStyle(b).display !== 'none' && b.getAttribute('aria-label') === 'Back to chats' && i.dataset.icon === 'messages-square' && r.width > 0 && r.height > 0 && b.textContent.trim() === '' && !b.querySelector('[data-icon=arrow-left]'); })()");
  if (!report.chatsBack) console.error('chats back: ' + JSON.stringify(await js("document.querySelector('app-conversation .conv-back')?.outerHTML || null")));
  nativeTheme.themeSource = 'dark';
  await pause(300);
  await shot('08b-phone-conversation-dark.png');
  nativeTheme.themeSource = 'light';
  await pause(300);

  // A message's menu at phone width (issue 169): a finger held on someone else's message opens it with the time, Reply
  // in thread and React, then Reply in thread fades every message outside the thread. Light and dark of each.
  const phoneRow = '.bubble-row[data-id="FAKE-0013"]';
  const touchAt = (type) => js(`(() => { const b = document.querySelector(${JSON.stringify(phoneRow + ' .bubble')}); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); b.dispatchEvent(new PointerEvent(${JSON.stringify(type)}, { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'touch', isPrimary: true, button: 0, buttons: ${type === 'pointerdown' ? 1 : 0}, clientX: r.left + 8, clientY: r.top + 8 })); return true; })()`);
  const phoneBoth = async (name) => {
    await pause(300);
    await shot(name + '-light.png');
    nativeTheme.themeSource = 'dark';
    await pause(400);
    await shot(name + '-dark.png');
    nativeTheme.themeSource = 'light';
    await pause(250);
  };
  await touchAt('pointerdown');
  await pause(700);
  await touchAt('pointerup');
  await waitFor(`Boolean(document.querySelector(${JSON.stringify(phoneRow + ' .message-menu')}))`, 10000);
  const phoneMenu = await js(`(() => { const m = document.querySelector(${JSON.stringify(phoneRow + ' .message-menu')}); const r = m.getBoundingClientRect(); return { labels: [...m.querySelectorAll('.message-action')].map((x) => x.getAttribute('aria-label')), time: (m.querySelector('.message-time')?.textContent || '').trim(), inView: r.left >= 0 && r.right <= window.innerWidth }; })()`);
  await phoneBoth('08b-phone-message-menu');
  await js(`document.querySelector(${JSON.stringify(phoneRow + ' .message-action[aria-label="Reply in thread"]')}).click()`);
  await waitFor("Boolean(document.querySelector('.conv-body')?.dataset.thread) && Boolean(document.querySelector('.thread-view .bubble-row'))", 10000);
  await pause(400);
  const phoneThread = await js("(() => { const list = document.querySelector('.messages'); return { ids: [...document.querySelectorAll('.thread-view .bubble-row')].map((r) => r.dataset.id), blurred: getComputedStyle(list).filter.includes('blur'), placeholder: document.querySelector('app-composer textarea')?.placeholder || '', close: Boolean(document.querySelector('.thread-view .thread-list > .thread-card-head .close-button')) && !document.querySelector('.conv-head .close-button'), back: Boolean(document.querySelector('.conv-head .conv-back')) }; })()");
  await phoneBoth('08c-phone-thread-focus');
  await js("document.querySelector('.thread-view .close-button').click()");
  await waitFor("!document.querySelector('.thread-view')", 5000);
  report.phoneMessageMenu = phoneMenu.labels.join('|') === 'Reply in thread|React' && Boolean(phoneMenu.time) && phoneMenu.inView && phoneThread.ids[0] === 'FAKE-0013' && phoneThread.ids.length === 2 && phoneThread.blurred && phoneThread.placeholder === 'Reply' && phoneThread.close && phoneThread.back;
  console.log('phone message menu: ' + JSON.stringify({ phoneMenu, phoneThread }));

  // The gesture: the drawer follows the finger from the left edge, settles by where the finger left it, and takes no
  // drag that began in the middle of the conversation. A drag is a pointerdown on the shell, then moves and an up on
  // the window, which is where the component listens while a drag is live.
  const pane = () => js("document.querySelector('.shell').dataset.pane");
  const sidebarX = () => js("new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.shell .sidebar')).transform).m41");
  const down = (x) => js(`(() => { document.querySelector('.shell').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: ${x}, clientY: 400, button: 0, buttons: 1 })); return true; })()`);
  const windowPointer = (type, x, buttons) => js(`(() => { window.dispatchEvent(new PointerEvent('${type}', { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: ${x}, clientY: 400, button: 0, buttons: ${buttons} })); return true; })()`);

  // A drag that starts in the conversation's middle is not the drawer: the pane stays on the conversation.
  await down(200);
  await windowPointer('pointermove', 280, 1);
  await windowPointer('pointerup', 280, 0);
  await pause(300);
  report.phoneEdgeOnly = (await pane()) === 'conversation';

  // A short edge drag settles back: it never reaches half the drawer's width, so it returns to the conversation.
  await down(4);
  await windowPointer('pointermove', 44, 1);
  await windowPointer('pointerup', 44, 0);
  await pause(300);
  report.phoneSettle = (await pane()) === 'conversation';

  // A longer edge drag carries the drawer with it. Halfway across the panel it is strictly between the two ends,
  // which is what "follows the finger" means, and past the threshold it settles open.
  await down(4);
  await windowPointer('pointermove', 120, 1);
  const mid = await sidebarX();
  await windowPointer('pointermove', 220, 1);
  await windowPointer('pointerup', 220, 0);
  await pause(400);
  const drawerWidth = await js("document.querySelector('.shell .sidebar').getBoundingClientRect().width");
  report.phoneTracks = mid > -drawerWidth && mid < 0;
  report.phoneEdgeDrag = (await pane()) === 'list' && Math.abs(await sidebarX()) < 1;

  // Reduced motion: the finger still moves the panel, but the settle runs no animation. Emulated here so the path is
  // checked rather than assumed.
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await pause(150);
  await down(200);
  await windowPointer('pointermove', 170, 1);
  const reducedMid = await sidebarX();
  await windowPointer('pointerup', 170, 0);
  await pause(300);
  const reduced = await js("parseFloat(getComputedStyle(document.querySelector('.shell .sidebar')).transitionDuration) === 0");
  report.phoneReduced = reduced && reducedMid > -drawerWidth && reducedMid < 0 && (await pane()) === 'list';
  await cdp('Emulation.setEmulatedMedia', { media: '', features: [] });
  await pause(150);
  await cdp('Emulation.clearDeviceMetricsOverride', {});
  await pause(200);

  // Every popover and modal panel closes on a press outside it and on Escape, through the kit's one behaviour (issue
  // 170), at desktop width with a mouse and at phone width with a finger. Each panel is opened, captured, and pressed
  // outside over a real control (a chat row, the gear, the conversation's back control), with the press sent as real
  // input so the browser delivers its own click; the panel must close, the control must receive nothing (the press,
  // its click or its context menu), and the page's state (open chat, pane, edit selection) must not move. A second
  // pass in dark opens each again and closes it with a real Escape key.
  const DISMISS_ROW = '.bubble-row[data-id="FAKE-0013"]';
  const dq = (s) => JSON.stringify(s);
  const dismissPanels = [
    { name: 'filter', pane: 'list', open: "document.querySelector('.sidebar-head .filter-button').click()", panel: '.filter-menu' },
    { name: 'sort', pane: 'list', open: "document.querySelector('.sidebar-head .sort-button').click()", panel: '.sort-menu' },
    { name: 'attach', pane: 'conversation', open: "document.querySelector('app-composer button.tool[aria-label=\"Attach\"]').click()", panel: 'app-composer .attach-menu' },
    { name: 'emoji', pane: 'conversation', open: "document.querySelector('app-composer button.tool[aria-label=\"Emoji\"]').click()", panel: 'app-composer .emoji-picker' },
    { name: 'message-menu', pane: 'conversation', open: '(() => { const b = document.querySelector(' + dq(DISMISS_ROW + ' .bubble') + '); b.scrollIntoView({ block: "center" }); b.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 })); return true; })()', panel: DISMISS_ROW + ' .message-menu' },
    { name: 'thread', pane: 'conversation', open: '(async () => { const b = document.querySelector(' + dq(DISMISS_ROW + ' .bubble') + '); b.scrollIntoView({ block: "center" }); b.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 })); const sel = ' + dq(DISMISS_ROW + ' .message-action[aria-label="Reply in thread"]') + '; for (let i = 0; i < 50 && !document.querySelector(sel); i += 1) await new Promise((r) => setTimeout(r, 50)); document.querySelector(sel).click(); return true; })()', panel: '.thread-view .thread-list' },
    { name: 'group', pane: 'list', edit: true, open: "document.querySelector('.list-tools .edit-group').click()", panel: '.group-prompt' },
    { name: 'confirm', pane: 'list', edit: true, open: "document.querySelector('.list-tools .edit-delete').click()", panel: '.confirm-modal:not(.group-prompt)' },
    // On a phone Settings is a page that fills the screen (issue 167), so there is no outside to press: its way back is
    // the strip at its top, pressed there with a finger, which must close it and reach nothing underneath.
    { name: 'sheet', pane: 'list', phonePage: true, open: "document.querySelector('.sidebar-head .gear-button').click()", panel: '.sheet' },
  ];
  const dismissState = "(() => { const r = document.querySelector('app-root'); return { chat: r.openChatId, list: r.listOpen, editing: r.editing, checked: (r.checked || []).length }; })()";
  // Each panel starts from the same page: no edit mode, no sheet up, and on the phone the pane that holds its trigger.
  const dismissSetup = async (p, phone) => {
    await js("(() => { const r = document.querySelector('app-root'); if (r.editing) r.exitEdit(); if (r.sheetShowing) r.closeView(); return true; })()");
    await waitFor("!document.querySelector('.sheet')", 5000);
    if (phone) await js('(() => { document.querySelector("app-root").listOpen = ' + (p.pane === 'list') + '; return true; })()');
    await pause(phone ? 450 : 100);
    if (p.edit) {
      await js("document.querySelector('.list-tools .edit-toggle').click()");
      await waitFor("Boolean(document.querySelector('.chat-row .chat-check'))", 5000);
      await js("document.querySelector('.chat-row .chat-check').click()");
      await waitFor("(document.querySelector('app-root').checked || []).length === 1", 5000);
    }
  };
  // The control under the press: the first candidate with a point on screen and outside the panel (its centre, or near
  // either end, which is where a phone's sheet leaves its backdrop showing), where the point lands on the control itself
  // or on the modal backdrop drawn over it. Probes on it count anything that reaches it.
  const dismissTarget = (panel) => js('(() => {'
    + ' const panel = document.querySelector(' + dq(panel) + ');'
    // The contact's avatar is the control a press outside an open thread lands on when no other candidate shows.
    + ' const cands = [".chat-row:not(.selected)", ".sidebar-head .gear-button", "app-conversation .conv-back", "app-conversation .conv-head .avatar"];'
    + ' for (const sel of cands) {'
    + '   for (const el of document.querySelectorAll(sel)) {'
    + '     const b = el.getBoundingClientRect();'
    + '     if (b.width < 4 || b.height < 4) continue;'
    + '     const y = b.top + b.height / 2;'
    + '     const x = [b.left + b.width / 2, b.left + 4, b.right - 4].find((px) => { if (px < 0 || y < 0 || px > innerWidth || y > innerHeight) return false; const hit = document.elementFromPoint(px, y); return Boolean(hit) && !(panel && panel.contains(hit)) && (el.contains(hit) || Boolean(hit.closest(".sheet-scrim"))); });'
    + '     if (x === undefined) continue;'
    + '     const at = document.elementFromPoint(x, y);'
    + '     window.dismissHits = 0;'
    + '     if (!el.dataset.dismissProbe) { el.dataset.dismissProbe = "1"; for (const t of ["pointerdown", "pointerup", "click", "contextmenu"]) el.addEventListener(t, () => { window.dismissHits += 1; }); }'
    + '     return { sel, x, y, over: String(at.className || at.tagName) };'
    + '   }'
    + ' }'
    // A sheet that fills the phone leaves only its margin of backdrop: press there, over whatever the backdrop covers.
    + ' for (const x of [4, 10, innerWidth - 10, innerWidth - 4]) {'
    + '   for (let y = 60; y < innerHeight - 40; y += 40) {'
    + '     const hit = document.elementFromPoint(x, y);'
    + '     if (!hit || !hit.closest(".sheet-scrim") || (panel && panel.contains(hit))) continue;'
    + '     const under = document.elementsFromPoint(x, y).find((e) => !e.closest(".sheet-scrim") && e !== document.documentElement && e !== document.body);'
    + '     if (!under) continue;'
    + '     const el = under.closest("button, .chat-row, textarea, .bubble-row") || under;'
    + '     window.dismissHits = 0;'
    + '     if (!el.dataset.dismissProbe) { el.dataset.dismissProbe = "1"; for (const t of ["pointerdown", "pointerup", "click", "contextmenu"]) el.addEventListener(t, () => { window.dismissHits += 1; }); }'
    + '     return { sel: "backdrop margin", x, y, over: String(hit.className || hit.tagName), under: String(el.className || el.tagName) };'
    + '   }'
    + ' }'
    + ' return null;'
    + ' })()');
  const dismissPress = async (x, y, phone) => {
    if (phone) {
      await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await pause(40);
      await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    }
  };
  const panelGone = async (panel) => { try { await waitFor('!document.querySelector(' + dq(panel) + ')', 3000); return true; } catch { return false; } };
  const dismissChecks = {};
  const dismissPass = async (width, phone) => {
    for (const p of dismissPanels) {
      const key = width + ':' + p.name;
      await dismissSetup(p, phone);
      await js(p.open);
      let opened = true;
      try { await waitFor('Boolean(document.querySelector(' + dq(p.panel) + '))', 5000); } catch { opened = false; }
      await pause(300);
      await shot('20-dismiss-' + width + '-' + p.name + '-light.png');
      const target = !opened ? null : phone && p.phonePage
        ? await js("(() => { const b = document.querySelector('.sheet .sheet-back'); if (!b) return null; const r = b.getBoundingClientRect(); window.dismissHits = 0; return { sel: 'back strip', x: r.left + r.width / 2, y: r.top + r.height / 2, over: 'sheet-back' }; })()")
        : await dismissTarget(p.panel);
      const before = await js(dismissState);
      if (target) await dismissPress(target.x, target.y, phone);
      const closed = Boolean(target) && await panelGone(p.panel);
      await pause(150);
      const hits = await js('window.dismissHits');
      const after = await js(dismissState);
      const held = before.chat === after.chat && before.list === after.list && before.editing === after.editing && before.checked === after.checked;
      dismissChecks[key] = { opened, closed, hits, held, target };
      if (!(opened && closed && hits === 0 && held)) console.error('dismiss failed: ' + key + ' ' + JSON.stringify({ before, after, target, hits }));
    }
    nativeTheme.themeSource = 'dark';
    await pause(300);
    for (const p of dismissPanels) {
      const key = width + ':' + p.name;
      await dismissSetup(p, phone);
      await js(p.open);
      try { await waitFor('Boolean(document.querySelector(' + dq(p.panel) + '))', 5000); } catch { /* the Escape check below reports it */ }
      await pause(250);
      await shot('20-dismiss-' + width + '-' + p.name + '-dark.png');
      await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
      await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
      dismissChecks[key].escape = await panelGone(p.panel);
      if (!dismissChecks[key].escape) console.error('dismiss failed: Escape left ' + key + ' open');
    }
    nativeTheme.themeSource = 'light';
    await js("(() => { const r = document.querySelector('app-root'); if (r.editing) r.exitEdit(); return true; })()");
    await pause(300);
  };
  if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
  await dismissPass('desktop', false);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await waitFor('window.innerWidth === 375', 5000);
  await dismissPass('phone', true);
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
  await js("(() => { document.querySelector('app-root').listOpen = false; return true; })()");
  await cdp('Emulation.clearDeviceMetricsOverride', {});
  await pause(300);
  report.dismiss = Object.keys(dismissChecks).length === dismissPanels.length * 2 && Object.values(dismissChecks).every((c) => c.opened && c.closed && c.hits === 0 && c.held && c.escape);
  console.log('dismiss: ' + JSON.stringify(dismissChecks));

  // Placeholder text is dimmed from its token (issue 185): every visible field's hint resolves to the placeholder token
  // in the scheme in force, and never to the colour the field draws your own text in, in light and dark, at desktop
  // width and at phone width with the list and with the conversation in front.
  const readPlaceholders = () => js("(() => { const probe = document.createElement('i'); probe.style.color = 'var(--color-placeholder)'; document.body.append(probe); const want = getComputedStyle(probe).color; probe.remove(); return [...document.querySelectorAll('input[placeholder], textarea[placeholder]')].filter((f) => f.placeholder && f.getClientRects().length > 0).map((f) => ({ field: f.getAttribute('aria-label') || f.tagName, hint: getComputedStyle(f, '::placeholder').color, text: getComputedStyle(f).color, want })); })()");
  const placeholderChecks = {};
  const placeholderPass = async (width, phone) => {
    for (const scheme of ['light', 'dark']) {
      nativeTheme.themeSource = scheme;
      await waitFor('document.documentElement.dataset.scheme === ' + JSON.stringify(scheme), 5000);
      const fields = [];
      for (const list of phone ? [true, false] : [null]) {
        if (list !== null) await js('(() => { document.querySelector("app-root").listOpen = ' + list + '; return true; })()');
        await pause(phone ? 450 : 150);
        fields.push(...await readPlaceholders());
        await shot('21-placeholder-' + width + (list === null ? '' : list ? '-list' : '-conversation') + '-' + scheme + '.png');
      }
      const names = new Set(fields.map((f) => f.field));
      const ok = names.has('Search conversations') && names.has('Message') && fields.every((f) => f.hint === f.want && f.hint !== f.text);
      placeholderChecks[width + ':' + scheme] = { ok, fields };
      if (!ok) console.error('placeholder failed: ' + width + ' ' + scheme + ' ' + JSON.stringify(fields));
    }
  };
  await placeholderPass('desktop', false);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
  await waitFor('window.innerWidth === 375', 5000);
  await placeholderPass('phone', true);
  await js("(() => { document.querySelector('app-root').listOpen = false; return true; })()");
  await cdp('Emulation.clearDeviceMetricsOverride', {});
  nativeTheme.themeSource = 'light';
  await pause(300);
  report.placeholder = Object.keys(placeholderChecks).length === 4 && Object.values(placeholderChecks).every((c) => c.ok);
  console.log('placeholder: ' + JSON.stringify(placeholderChecks));

  // Every close (X) control closes on a click anywhere on its drawn circle (issue 213): the image viewer's, the thread
  // card's, a notice's, and a notice's while the viewer is up (the notices then take their band over the backdrop), at
  // three window sizes down to the smallest, maximised, and at phone width. A press on a frameless window that lands in a drag region moves the window and
  // never reaches the page, whatever is drawn over that spot, so a synthetic click alone cannot see the fault. Each
  // probe point (the centre, and near each edge at 85% of the radius, eight ways) is held to four things: the control
  // is the topmost element there (nothing covers it); the point is outside every drag region as Chromium builds them
  // (each element whose app-region is drag or no-drag adds or removes its box in tree order, so the last one containing
  // the point decides, and the drawing order plays no part); the point is not over a drag strip at all, even one a
  // no-drag box cancels, so the control never depends on the window picking up a region that changed under it; and a
  // real click at the centre and at the four edges closes the surface.
  const closeSurfaces = ['viewer', 'thread', 'notice', 'noticeOverViewer'];
  const CLOSE_NOTICE = 'smoke-close-213';
  const closeSel = {
    viewer: 'app-image-viewer .close-button',
    thread: '.thread-view .thread-list .close-button',
    notice: '.app-notice[data-id="' + CLOSE_NOTICE + '"] .close-button',
  };
  closeSel.noticeOverViewer = closeSel.notice;
  const closedExpr = {
    viewer: "!document.querySelector('app-image-viewer')",
    thread: "!document.querySelector('.thread-view')",
    notice: "!document.querySelector('.app-notice[data-id=\"" + CLOSE_NOTICE + "\"]')",
  };
  closedExpr.noticeOverViewer = closedExpr.notice + " && Boolean(document.querySelector('app-image-viewer'))";
  const settled = "document.getAnimations().every((a) => a.playState !== 'running')";
  const viewerSrc = await js("(document.querySelector('img.attachment-image') || {}).src || null");
  let closeRevision = 0;
  const putCloseNotice = () => js('(() => { const root = document.querySelector("app-root"); root.appNotices = [...root.appNotices.filter((n) => n.id !== ' + q(CLOSE_NOTICE) + '), { id: ' + q(CLOSE_NOTICE) + ', revision: ' + (++closeRevision) + ', tone: "info", message: "A notice to close", percent: null, read: false }]; return true; })()');
  const openViewerAt = () => js('(() => { document.querySelector("app-root").viewing = { src: ' + q(viewerSrc) + ', alt: "smoke-close" }; return true; })()');
  const openSurface = async (name) => {
    if (name === 'viewer' || name === 'noticeOverViewer') {
      await openViewerAt();
      await waitFor("Boolean(document.querySelector('app-image-viewer'))", 5000);
    }
    if (name === 'thread') {
      await js("(() => { const c = document.querySelector('app-conversation'); const m = c.messages.find((x) => !x.fromMe); c.openThread(m); return true; })()");
      await waitFor("Boolean(document.querySelector('.thread-view'))", 5000);
    }
    if (name === 'notice' || name === 'noticeOverViewer') {
      await putCloseNotice();
      await waitFor("Boolean(document.querySelector('.app-notice[data-id=\"" + CLOSE_NOTICE + "\"]'))", 5000);
    }
    await waitFor(settled, 5000);
    await pause(60);
  };
  // Whatever a failed press left open is closed by hand, so the next probe starts from the plain conversation.
  const resetSurfaces = () => js('(() => { const root = document.querySelector("app-root"); root.viewing = null; root.appNotices = root.appNotices.filter((n) => n.id !== ' + q(CLOSE_NOTICE) + '); const c = document.querySelector("app-conversation"); if (c) c.closeThread(); return true; })()');
  const closeGeometry = (sel) => js('(() => {'
    + ' const b = document.querySelector(' + q(sel) + ');'
    + ' if (!b) return null;'
    + ' const r = b.getBoundingClientRect();'
    + ' const regions = [];'
    + ' for (const el of document.querySelectorAll("*")) {'
    + '   const s = getComputedStyle(el);'
    + '   const mode = (s.getPropertyValue("-webkit-app-region") || s.getPropertyValue("app-region") || "").trim();'
    + '   if ((mode !== "drag" && mode !== "no-drag") || s.visibility !== "visible") continue;'
    + '   const q = el.getBoundingClientRect();'
    + '   if (q.width && q.height) regions.push({ drag: mode === "drag", q, name: String(el.getAttribute("class") || el.tagName).split(" ")[0] });'
    + ' }'
    + ' const cx = r.left + r.width / 2; const cy = r.top + r.height / 2; const rad = Math.min(r.width, r.height) / 2 * 0.85; const d = Math.SQRT1_2;'
    + ' const dirs = { centre: [0, 0], top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0], topRight: [d, -d], bottomRight: [d, d], bottomLeft: [-d, d], topLeft: [-d, -d] };'
    + ' const points = {};'
    + ' for (const [k, [dx, dy]] of Object.entries(dirs)) {'
    + '   const x = Math.round(cx + dx * rad); const y = Math.round(cy + dy * rad);'
    + '   const top = document.elementFromPoint(x, y);'
    + '   let region = null; let strip = null;'
    + '   for (const g of regions) if (x >= g.q.left && x < g.q.right && y >= g.q.top && y < g.q.bottom) { region = g; if (g.drag) strip = g.name; }'
    + '   points[k] = { x, y, hit: Boolean(top) && b.contains(top), over: top && !b.contains(top) ? String(top.getAttribute("class") || top.tagName) : null, drag: Boolean(region && region.drag), region: region ? region.name : null, strip };'
    + ' }'
    + ' return { size: [Math.round(r.width), Math.round(r.height)], round: getComputedStyle(b).borderTopLeftRadius, points };'
    + '})()');
  const closeControlChecks = {};
  const closePass = async (label) => {
    for (const name of closeSurfaces) {
      await resetSurfaces();
      await openSurface(name);
      const geo = await closeGeometry(closeSel[name]);
      if (label === '1100x720' && (name === 'thread' || name === 'viewer')) {
        await shot('22-close-' + name + '-light.png');
        nativeTheme.themeSource = 'dark';
        await waitFor("document.documentElement.dataset.scheme === 'dark'", 5000);
        await pause(300);
        await shot('22b-close-' + name + '-dark.png');
        nativeTheme.themeSource = 'light';
        await waitFor("document.documentElement.dataset.scheme === 'light'", 5000);
        await pause(200);
      }
      const clicks = {};
      for (const k of ['centre', 'top', 'right', 'bottom', 'left']) {
        if (k !== 'centre') { await resetSurfaces(); await openSurface(name); }
        const g = await closeGeometry(closeSel[name]);
        if (!g) { clicks[k] = false; continue; }
        const { x, y } = g.points[k];
        wc.sendInputEvent({ type: 'mouseMove', x, y });
        wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
        await pause(40);
        wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
        try { await waitFor(closedExpr[name], 1500); clicks[k] = true; } catch { clicks[k] = false; }
      }
      await resetSurfaces();
      const points = geo ? geo.points : {};
      const ok = Boolean(geo) && Object.values(points).every((p) => p.hit && !p.drag && !p.strip) && Object.values(clicks).every(Boolean);
      closeControlChecks[label + ':' + name] = ok;
      if (!ok) console.error('close control failed: ' + label + ' ' + name + ' ' + JSON.stringify({ geo, clicks }));
    }
  };
  const closeSize0 = w.getSize();
  wc.focus();
  for (const [width, height] of [[1100, 720], [880, 600], [720, 480]]) {
    w.setSize(width, height);
    await waitFor('window.innerWidth === ' + width, 5000).catch(() => {});
    await pause(300);
    await closePass(width + 'x' + height);
  }
  w.maximize();
  await pause(800);
  await closePass('maximized');
  w.unmaximize();
  await pause(300);
  w.setSize(closeSize0[0], closeSize0[1]);
  await pause(300);
  // And at phone width, where a notice takes its band at the top of the window.
  await cdp('Emulation.setDeviceMetricsOverride', { width: 560, height: 760, deviceScaleFactor: 1, mobile: false });
  await waitFor('window.innerWidth === 560', 5000);
  await js("(() => { document.querySelector('app-root').listOpen = false; return true; })()");
  await pause(400);
  await closePass('560x760');
  await cdp('Emulation.clearDeviceMetricsOverride', {});
  await pause(300);
  report.closeControls = Object.keys(closeControlChecks).length === closeSurfaces.length * 5 && Boolean(viewerSrc) && Object.values(closeControlChecks).every(Boolean);
  console.log('close controls: ' + JSON.stringify(closeControlChecks));

  // Sign out lives on the settings page now.
  await js("document.querySelector('.sidebar-head .gear-button').click()");
  await waitFor("Boolean(document.querySelector('app-settings [data-action=\"signout\"]'))");
  // The host's own motion preference decides which arrival the form runs, and hosts differ: Windows Server, which the
  // windows-latest runner is, has client-area animation off, so Chromium reports prefers-reduced-motion: reduce there
  // and the form takes the plain fade. Both paths are pinned by emulation rather than inherited, so the spring is
  // checked on every platform and the reduced path is checked too. The host's own value is reported for the record.
  report.hostReducedMotion = await js("matchMedia('(prefers-reduced-motion: reduce)').matches");
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await pause(150);
  await js("document.querySelector('app-settings [data-action=\"signout\"]').click()");
  await waitFor("Boolean(document.querySelector('app-onboarding form'))");
  // The form arrives on the sibling app's spring (motion.spring and motion.spring-ease, issue 59), so the capture waits
  // the spring out and the check reads the animation the form actually runs.
  const readArrival = "(() => { const s = getComputedStyle(document.querySelector('app-onboarding .onboarding')); const r = getComputedStyle(document.documentElement); return { name: s.animationName, duration: s.animationDuration, ease: s.animationTimingFunction, spring: r.getPropertyValue('--motion-spring').trim(), normal: r.getPropertyValue('--motion-normal').trim() }; })()";
  const arrival = await js(readArrival);
  await pause(800);
  await shot('09-onboarding.png');
  nativeTheme.themeSource = 'dark';
  await pause(300);
  await shot('09b-onboarding-dark.png');
  nativeTheme.themeSource = 'light';
  await pause(200);
  // Under reduced motion the same form takes the plain fade for motion.normal, never the spring.
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await pause(150);
  const reducedArrival = await js(readArrival);
  await cdp('Emulation.setEmulatedMedia', { media: '', features: [] });
  const springOk = arrival.name === 'onboarding-in' && arrival.ease.startsWith('linear(') && Math.round(parseFloat(arrival.duration) * 1000) === parseFloat(arrival.spring);
  const reducedOk = reducedArrival.name === 'surface-scrim-in' && !reducedArrival.ease.startsWith('linear(') && Math.round(parseFloat(reducedArrival.duration) * 1000) === parseFloat(reducedArrival.normal);
  report.onboarding = springOk && reducedOk;
  if (!report.onboarding) console.error('onboarding arrival: ' + JSON.stringify({ arrival, reducedArrival, host: report.hostReducedMotion }));
  report.captures = captured.length;
  report.carets = carets.length >= 6 && carets.every((c) => c.ok);
  if (!report.carets) console.error('carets: ' + JSON.stringify(carets));
  writeFileSync(path.join(SMOKE, 'report.json'), JSON.stringify(report, null, 1));
  console.log('SMOKE ' + JSON.stringify(report));
  app.exit(0);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    title: naming.product,
    // The platform's own chrome: macOS keeps its traffic lights (the bar leaves them room), Windows and Linux draw no
    // platform frame at all, because core draws the bar and its controls there. See window-chrome.js.
    ...windowOptions(process.platform),
    icon: path.join(here, '../build/icon.png'),
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.on('page-title-updated', (e) => e.preventDefault());
  lockZoom(win.webContents);
  // The bar's restore glyph follows the window wherever the change came from, a control or the platform's double-click.
  win.on('maximize', () => { if (!win.isDestroyed()) win.webContents.send('bridge:event:window.state', { maximized: true }); });
  win.on('unmaximize', () => { if (!win.isDestroyed()) win.webContents.send('bridge:event:window.state', { maximized: false }); });
  win.webContents.setWindowOpenHandler(({ url }) => {
    handlers['open.external']({ url });
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://bundle/')) e.preventDefault(); });
  // Closing hides the window to the tray and the app keeps running; only a quit closes it (tray.js).
  win.on('close', (e) => lifecycle.onClose(e));
  win.on('closed', () => { win = null; });
  win.webContents.on('did-finish-load', () => {
    if (lastUpdateState && win && !win.isDestroyed()) win.webContents.send('bridge:event:update.state', lastUpdateState);
    lifecycle.loaded();
  });
  if (SMOKE) {
    win.webContents.on('console-message', (e) => { if (e.level === 'error') console.error('page: ' + e.message); });
    // The sheet's event history, kept from every load so a failure can say whether a departure started (smoke-failure.js).
    win.webContents.on('did-finish-load', () => { win.webContents.executeJavaScript(smokeTraceInstaller(), true).catch(() => {}); });
    (process.env.SMOKE_DESIGN ? runDesign(win, { nativeTheme, out: SMOKE, core: CORE, serverUrl: process.env.SMOKE_SERVER_URL, token: process.env.SMOKE_TOKEN, themeText: readFileSync(process.env.SMOKE_THEME_FIXTURE, 'utf8'), app }) : runSmoke(win)).catch(async (e) => {
      console.error('smoke failed: ' + (e && e.message));
      // Retain what the renderer held when the step failed, bounded and sanitized, so a stuck surface is
      // read from evidence rather than guessed. It runs only on the failure path and never rethrows.
      await retainSmokeFailure({
        evaluate: (code) => win.webContents.executeJavaScript(code, true),
        capture: () => captureRenderer(win.webContents),
        write: (name, data) => writeFileSync(path.join(SMOKE, name), data),
        error: e,
        shell: () => ({ visible: win.isVisible(), minimized: win.isMinimized(), focused: win.isFocused(), throttled: win.webContents.getBackgroundThrottling() }),
        secrets: [process.env.SMOKE_TOKEN, process.env.SMOKE_SERVER_URL].filter(Boolean),
      }).catch(() => {});
      app.exit(1);
    });
  }
  win.loadURL('app://bundle/app/index.html');
  return win;
}

// The tray icon and its menu. On Windows and Linux a click on the icon raises the window; macOS opens the menu on a
// click, as its menu bar does for every item there.
function createTray() {
  const icon = trayIcon(process.platform);
  const image = nativeImage.createFromPath(path.join(here, 'assets', 'tray', icon.file));
  if (icon.template) image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip(naming.product);
  trayMenu = Menu.buildFromTemplate(trayTemplate({ appName: naming.product, commands: lifecycle.commands() }));
  tray.setContextMenu(trayMenu);
  if (process.platform !== 'darwin') tray.on('click', () => lifecycle.show());
}

app.whenReady().then(() => {
  // No application menu on Windows and Linux: the window draws its own bar, and no File, Edit, View or Window bar appears.
  // macOS keeps the minimal one its menu bar needs for Cmd+Q, Settings and copy and paste; its Quit is the tray's Quit.
  const appMenu = appMenuTemplate({ platform: process.platform, appName: naming.product, commands: lifecycle.commands() });
  Menu.setApplicationMenu(appMenu ? Menu.buildFromTemplate(appMenu) : null);
  protocol.handle('app', serve);
  if (SMOKE && process.env.SMOKE_SERVER_URL) {
    secure.set('server.url', process.env.SMOKE_SERVER_URL);
    secure.set('server.token', process.env.SMOKE_TOKEN || '');
  }
  createWindow();
  createTray();
  if (app.isPackaged && !SMOKE) {
    updateControl = startUpdates({
      updater: updaterPackage.autoUpdater,
      version,
      // The platform facts and the download preference decide what this build may do; the page supplies the setting.
      platform: process.platform,
      packaged: app.isPackaged,
      appImage: Boolean(process.env.APPIMAGE),
      // The page owns the notice and the banner, so updates use the same bridge path the new message notices use.
      onState: reportUpdate,
      logError: (message) => console.error(message),
      // An update's restart is a quit, so the window that hides on close lets it through.
      onQuit: () => lifecycle.markQuitting(),
    });
    app.once('before-quit', () => updateControl.stop());
  }
  // The Dock icon, and a second launch, raise the window the tray holds.
  app.on('activate', () => lifecycle.show());
  app.on('second-instance', () => lifecycle.show());
});

// A quit the platform asks for (the Dock's Quit, a log out, an update's restart) lets the window close; the tray's Quit
// marks it the same way before it asks.
app.on('before-quit', () => lifecycle.markQuitting());

// Closing the window never reaches here, because it hides; the window is only destroyed while quitting. The handler is
// kept so Electron's default, quitting once every window has closed, can never be the way the app ends.
app.on('window-all-closed', () => { if (SMOKE) app.quit(); });
