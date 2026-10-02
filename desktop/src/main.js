// The desktop shell: one window hosting core's app page over app://bundle, plus the host bridge. Nothing about the
// app lives here; the name comes from core/spec/naming.json.
import { app, BrowserWindow, protocol, ipcMain, Menu, safeStorage, Notification, shell, nativeTheme } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandlers, createSecureStore, mimeFor } from './bridge-handlers.js';
import { clientReport } from '../../core/kit/rules/build.js';
import { tokenMismatches, expectedTokens } from './surface.js';
import updaterPackage from 'electron-updater';
import { startUpdates } from './updates.js';

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

app.setName(naming.product);
if (SMOKE) app.setPath('userData', path.join(SMOKE, 'user-data'));
if (SMOKE && process.env.SMOKE_SOFTWARE_RENDERING) app.disableHardwareAcceleration();
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
if (!SMOKE && !app.requestSingleInstanceLock()) app.quit();

let win = null;
// Set once the updater starts; the page calls updates.configure to apply the server's setting to it.
let updateControl = null;
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
  configureUpdates: (autoDownload) => (updateControl ? updateControl.setAutoDownload(autoDownload) : false),
  downloadUpdates: () => (updateControl ? updateControl.download() : false),
  installUpdate: () => (updateControl ? updateControl.install() : false),
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
  // The window bar, not a platform frame: our title area and three controls are drawn, and no application menu exists.
  report.windowBar = await js("(() => { const bar = document.querySelector('.window-bar'); if (!bar) return false; const c = [...bar.querySelectorAll('.window-control')]; return c.length === 3 && c.every((b) => (b.getAttribute('aria-label') || '').length > 0); })()");
  report.menuRemoved = Menu.getApplicationMenu() === null;
  report.chats = await js("document.querySelectorAll('.chat-row').length");
  report.bubbles = await js("document.querySelectorAll('.bubble-row').length");
  report.images = await js("document.querySelectorAll('img.attachment-image').length");
  // The chats header is a search field, a filter icon and a gear, and no heading text or Settings text button.
  report.header = await js("(() => { const h = document.querySelector('.sidebar-head'); if (!h) return false; const gone = !h.querySelector('.title') && !h.querySelector('.text-button') && !h.querySelector('h1'); return Boolean(h.querySelector('.chat-search') && h.querySelector('.filter-button') && h.querySelector('.gear-button') && gone); })()");
  // Typing narrows the list live, by the chat's name and by its last message.
  await js("(() => { const i = document.querySelector('.sidebar-head .chat-search'); i.value = 'weekend'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
  await waitFor("document.querySelectorAll('.chat-row').length === 1 && document.querySelector('.chat-row .chat-name')?.textContent === 'Weekend plans'");
  report.headerSearchName = true;
  await js("(() => { const i = document.querySelector('.sidebar-head .chat-search'); i.value = 'thank'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
  await waitFor("document.querySelectorAll('.chat-row').length === 1 && document.querySelector('.chat-row .chat-name')?.textContent === '+15555550142'");
  report.headerSearchMessage = true;
  await js("(() => { const i = document.querySelector('.sidebar-head .chat-search'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
  await waitFor("document.querySelectorAll('.chat-row').length >= 3");
  // The filter icon opens a dropdown holding the filters, the filter in force shows as a clearable chip, and clearing
  // the chip lifts it.
  await js("document.querySelector('.sidebar-head .filter-button').click()");
  await waitFor("Boolean(document.querySelector('.filter-menu'))");
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
  const text = process.env.SMOKE_SEND_TEXT;
  if (text) {
    await js(`(() => { const t = document.querySelector('app-composer textarea'); t.value = ${JSON.stringify(text)}; document.querySelector('app-composer button.send').click(); return true; })()`);
    await waitFor(`[...document.querySelectorAll('.bubble-row.mine')].some((r) => r.textContent.includes(${JSON.stringify(text)}) && !r.dataset.id.startsWith('local:'))`, 20000);
    report.sent = true;
  }
  await pause(300);
  await shot('03-after-send.png');

  // The emoji panel: the grid draws first, the search field and the categories sit below it, and the panel keeps one
  // height, so typing a query narrows the grid without moving the composer or the grid's top edge. The order the eye
  // reads is the order the keyboard walks: the grid, then the field, then the tabs.
  await js("document.querySelector('app-composer button.tool').click()");
  await waitFor("Boolean(document.querySelector('app-emoji-picker .emoji-grid'))");
  await pause(250);
  const emojiBefore = await js("(() => { const picker = document.querySelector('app-emoji-picker'); const grid = picker.querySelector('.emoji-grid'); const panel = picker.querySelector('.emoji-picker'); return { composerTop: document.querySelector('app-composer').getBoundingClientRect().top, gridTop: grid.getBoundingClientRect().top, rows: picker.querySelectorAll('.emoji-grid .emoji-cell').length, tabs: picker.querySelectorAll('.emoji-tab').length, active: picker.querySelectorAll('.emoji-tab.active').length, order: [...panel.children].map((n) => n.className) }; })()");
  await js("(() => { const f = document.querySelector('app-emoji-picker .emoji-search'); f.value = 'heart'; f.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
  await pause(250);
  const emojiAfter = await js("(() => { const picker = document.querySelector('app-emoji-picker'); const grid = picker.querySelector('.emoji-grid'); return { composerTop: document.querySelector('app-composer').getBoundingClientRect().top, gridTop: grid ? grid.getBoundingClientRect().top : null, rows: picker.querySelectorAll('.emoji-grid .emoji-cell').length, tabs: picker.querySelectorAll('.emoji-tab').length }; })()");
  const emojiOrder = emojiBefore.order.join('|');
  const emojiPanelChecks = {
    order: emojiOrder.indexOf('emoji-grid') >= 0 && emojiOrder.indexOf('emoji-grid') < emojiOrder.indexOf('emoji-search') && emojiOrder.indexOf('emoji-search') < emojiOrder.indexOf('emoji-tabs'),
    active: emojiBefore.active === 1,
    tabs: emojiBefore.tabs > 4 && emojiAfter.tabs === emojiBefore.tabs,
    narrowed: emojiBefore.rows > emojiAfter.rows && emojiAfter.rows > 0,
    gridHeld: Math.abs(emojiBefore.gridTop - emojiAfter.gridTop) < 1,
    composerHeld: Math.abs(emojiBefore.composerTop - emojiAfter.composerTop) < 1,
  };
  report.emojiPanel = Object.values(emojiPanelChecks).every(Boolean);
  console.log('emoji panel: ' + JSON.stringify({ checks: emojiPanelChecks, before: emojiBefore, after: emojiAfter, order: emojiOrder }));
  await js("document.querySelector('app-composer button.tool').click()");

  // Settings: the page reads what the server holds, writes a change back, and redraws when a change arrives on the
  // event stream from anywhere. Values are checked at the server, not from the page's own copy.
  const srv = process.env.SMOKE_SERVER_URL;
  const auth = { authorization: 'Bearer ' + process.env.SMOKE_TOKEN };
  const held = async () => (await (await fetch(srv + '/api/v1/settings', { headers: auth })).json()).values || {};
  const cdp = (method, params) => wc.debugger.sendCommand(method, params);

  await js("document.querySelector('.sidebar-head .gear-button').click()");
  await waitFor("Boolean(document.querySelector('app-settings select[data-key=\"appearance.skin\"]'))");
  const shown = await js("document.querySelector('app-settings select[data-key=\"appearance.skin\"]').value");
  report.settingsRead = shown === ((await held())['appearance.skin'] || 'system');
  await js("(() => { const s = document.querySelector('app-settings select[data-key=\"appearance.skin\"]'); s.value = 'dark'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
  for (let i = 0; i < 50 && (await held())['appearance.skin'] !== 'dark'; i += 1) await pause(200);
  report.settingsWrote = (await held())['appearance.skin'] === 'dark';
  await fetch(srv + '/api/v1/settings', { method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ values: { 'appearance.density': 'compact' } }) });
  await waitFor("document.querySelector('app-settings select[data-key=\"appearance.density\"]')?.value === 'compact'", 10000);
  report.settingsStreamed = true;
  report.settings = report.settingsRead && report.settingsWrote && report.settingsStreamed;

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
  const surface = async (scheme) => {
    const expected = expectedTokens(tokenSpec, scheme);
    nativeTheme.themeSource = scheme;
    await waitFor(`document.documentElement.dataset.scheme === ${JSON.stringify(scheme)}`);
    const resolved = await js(`(() => { const s = getComputedStyle(document.documentElement); const out = {}; for (const n of ${JSON.stringify(Object.keys(expected))}) out[n] = s.getPropertyValue(n).trim(); return out; })()`);
    return tokenMismatches({ expected, resolved });
  };
  const surfaceFound = { light: await surface('light'), dark: await surface('dark') };
  report.surfaceLight = surfaceFound.light.length === 0;
  report.surfaceDark = surfaceFound.dark.length === 0;
  report.surface = report.surfaceLight && report.surfaceDark;
  if (!report.surface) console.error('surface mismatches: ' + JSON.stringify(surfaceFound));
  // A theme the server holds reaches the page without a rebuild, and both schemes render it: the accent the theme
  // sets is what the page resolves, whether the skin in force is the explicit light or the explicit dark one.
  const putSettings = (values) => fetch(srv + '/api/v1/settings', { method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ values }) });
  const pickSkin = (skin) => js(`(() => { const s = document.querySelector('app-settings select[data-key="appearance.skin"]'); s.value = ${JSON.stringify(skin)}; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await putSettings({ 'appearance.theme': { name: 'smoke', color: { light: { accent: '#2a6f4b' }, dark: { accent: '#7fd6a8' } } } });
  await pickSkin('light');
  await waitFor("document.documentElement.dataset.scheme === 'light' && getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() === '#2a6f4b'", 10000);
  report.themeLight = true;
  await pickSkin('dark');
  await waitFor("document.documentElement.dataset.scheme === 'dark' && getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() === '#7fd6a8'", 10000);
  report.themeDark = true;
  report.theme = report.themeLight && report.themeDark;

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
  const bannerCommand = () => js("(() => { const b = document.querySelector('.banner.update .banner-action'); if (!b) return null; const c = b.dataset.command; b.click(); return c; })()");
  const called = async (name) => { for (let i = 0; i < 50 && !smokeCalls.includes(name); i += 1) await pause(100); return smokeCalls.includes(name); };
  smokeCalls.length = 0;
  wc.send('bridge:event:update.state', { state: 'available', version: '9.9.9', canInstall: true });
  await waitFor("Boolean(document.querySelector('.banner.update .banner-action'))", 10000);
  const downloadCommand = await bannerCommand();
  report.updateDownloadAction = downloadCommand === 'updates.download' && (await called('updates.download'));
  wc.send('bridge:event:update.state', { state: 'downloading', version: '9.9.9', percent: 0.5, detail: '5.0 MB of 12 MB', canInstall: true });
  await waitFor("Boolean(document.querySelector('.banner.update .update-progress'))", 10000);
  report.updateBanner = await js("(() => { const p = document.querySelector('.update-progress'); return Boolean(p) && Number(p.value) > 0 && Number(p.value) < 1; })()");
  smokeCalls.length = 0;
  wc.send('bridge:event:update.state', { state: 'ready', version: '9.9.9', canInstall: true });
  await waitFor("Boolean(document.querySelector('.banner.update .banner-action'))", 10000);
  const installCommand = await bannerCommand();
  report.updateInstallAction = installCommand === 'updates.install' && (await called('updates.install'));
  wc.send('bridge:event:update.state', { state: 'error', version: '9.9.9', detail: 'The download was interrupted.', canInstall: true });
  await waitFor("Boolean(document.querySelector('.banner.update'))", 10000);
  report.updateFailure = await js("(() => { const b = document.querySelector('.banner.update'); return Boolean(b) && b.textContent.includes('interrupted') && Boolean(b.querySelector('.banner-action')); })()");
  wc.send('bridge:event:update.state', { state: 'checking' });
  await pause(300);
  report.updateBannerCleared = await js("!document.querySelector('.banner.update')");
  report.updates = report.updateDownloadAction && report.updateBanner && report.updateInstallAction && report.updateFailure && report.updateBannerCleared;

  await putSettings({ 'appearance.theme': null, 'appearance.skin': 'system' });
  nativeTheme.themeSource = 'light';
  await pause(300);
  await shot('05-settings.png');

  // About: every value comes from the server's info route.
  await js("document.querySelector('app-settings [data-action=\"about\"]').click()");
  await waitFor("Boolean(document.querySelector('app-about'))");
  await pause(200);
  await shot('06-about.png');
  // The client's own build and the server's, each from its own half, plus the one action that copies the lot.
  report.about = await js("(() => { const rows = [...document.querySelectorAll('app-about .setting-row')].map((r) => r.textContent); return rows.some((t) => t.includes('Client version')) && rows.some((t) => t.includes('Server version')) && rows.some((t) => t.includes('Electron')) && Boolean(document.querySelector('app-about .about-copy')); })()");
  await js("document.querySelector('app-about .back').click()");
  await waitFor("Boolean(document.querySelector('app-settings'))");
  await js("document.querySelector('app-settings .back').click()");
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
  await pause(250);
  report.phoneComposer = await js("parseFloat(getComputedStyle(document.querySelector('app-composer textarea')).fontSize) >= 16");
  report.phoneSend = await js("(() => { const b = document.querySelector('app-composer button.send'); if (!b) return false; const s = getComputedStyle(b); const box = b.getBoundingClientRect(); const size = Math.min(box.width, box.height); const glyph = parseFloat(s.fontSize); return glyph >= 20 && glyph < size && parseInt(s.fontWeight, 10) >= 600 && size >= 36; })()");
  report.phoneDrawer = await js("(() => { const r = document.querySelector('.shell .sidebar').getBoundingClientRect(); const back = getComputedStyle(document.querySelector('app-conversation .conv-back')).display !== 'none'; const scrim = getComputedStyle(document.querySelector('.scrim')); return back && r.width > 0 && r.width < window.innerWidth && scrim.visibility === 'visible'; })()");
  await shot('07-phone-list.png');
  // A tap still selects a chat and closes the drawer, unchanged by the gesture.
  await js("document.querySelector('.sidebar .chat-row').click()");
  await waitFor("document.querySelector('.shell')?.dataset.pane === 'conversation'");
  await pause(400); // the drawer slides on a 160ms transition; measure the settled position, not a frame of it.
  report.phone = await js("(() => { const r = document.querySelector('.shell .sidebar').getBoundingClientRect(); const scrim = document.querySelector('.scrim'); return r.right <= 0 && (!scrim || getComputedStyle(scrim).visibility === 'hidden'); })()");
  await shot('08-phone-conversation.png');

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

  // Sign out lives on the settings page now.
  await js("document.querySelector('.sidebar-head .gear-button').click()");
  await waitFor("Boolean(document.querySelector('app-settings [data-action=\"signout\"]'))");
  await js("document.querySelector('app-settings [data-action=\"signout\"]').click()");
  await waitFor("Boolean(document.querySelector('app-onboarding form'))");
  await pause(300);
  await shot('09-onboarding.png');
  report.onboarding = true;
  report.captures = captured.length;
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
    // No platform frame: core draws the bar and its three controls, so the title area is ours on every platform.
    frame: false,
    icon: path.join(here, '../build/icon.png'),
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.on('page-title-updated', (e) => e.preventDefault());
  // The bar's restore glyph follows the window wherever the change came from, a control or the platform's double-click.
  win.on('maximize', () => { if (!win.isDestroyed()) win.webContents.send('bridge:event:window.state', { maximized: true }); });
  win.on('unmaximize', () => { if (!win.isDestroyed()) win.webContents.send('bridge:event:window.state', { maximized: false }); });
  win.webContents.setWindowOpenHandler(({ url }) => {
    handlers['open.external']({ url });
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://bundle/')) e.preventDefault(); });
  win.on('closed', () => { win = null; });
  if (SMOKE) {
    win.webContents.on('console-message', (e) => { if (e.level === 'error') console.error('page: ' + e.message); });
    runSmoke(win).catch((e) => { console.error('smoke failed: ' + (e && e.message)); app.exit(1); });
  }
  win.loadURL('app://bundle/app/index.html');
}

app.whenReady().then(() => {
  // No application menu on any platform: the window draws its own bar, and no File, Edit, View or Window bar appears.
  Menu.setApplicationMenu(null);
  protocol.handle('app', serve);
  if (SMOKE && process.env.SMOKE_SERVER_URL) {
    secure.set('server.url', process.env.SMOKE_SERVER_URL);
    secure.set('server.token', process.env.SMOKE_TOKEN || '');
  }
  createWindow();
  if (app.isPackaged && !SMOKE) {
    updateControl = startUpdates({
      updater: updaterPackage.autoUpdater,
      version,
      // The platform facts and the download preference decide what this build may do; the page supplies the setting.
      platform: process.platform,
      packaged: app.isPackaged,
      appImage: Boolean(process.env.APPIMAGE),
      // The page owns the notice and the banner, so updates use the same bridge path the new message notices use.
      onState: (state) => { if (win && !win.isDestroyed()) win.webContents.send('bridge:event:update.state', state); },
      logError: (message) => console.error(message),
    });
    app.once('before-quit', () => updateControl.stop());
  }
  app.on('activate', () => { if (!win) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin' || SMOKE) app.quit(); });
