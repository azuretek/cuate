// The desktop shell: one window hosting core's app page over app://bundle, plus the host bridge. Nothing about the
// app lives here; the name comes from core/spec/naming.json.
import { app, BrowserWindow, protocol, ipcMain, safeStorage, Notification, shell, nativeTheme } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandlers, createSecureStore, mimeFor } from './bridge-handlers.js';
import updaterPackage from 'electron-updater';
import { startUpdates } from './updates.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CORE = app.isPackaged ? path.join(process.resourcesPath, 'core') : path.resolve(here, '../../core');
const naming = JSON.parse(readFileSync(path.join(CORE, 'spec/naming.json'), 'utf8'));
const bridgeSpec = JSON.parse(readFileSync(path.join(CORE, 'spec/host-bridge.json'), 'utf8'));
const version = app.getVersion();
const SMOKE = process.env.SMOKE_OUT || '';
// Every notice the shell is asked to show while smoking, so the smoke can prove one fired and one was suppressed.
const smokeNotices = [];

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
  info: () => ({ product: naming.product, version, platform: process.platform }),
  openExternal: (url) => {
    if (!/^https?:\/\//i.test(url)) return false;
    shell.openExternal(url);
    return true;
  },
  configureUpdates: (autoDownload) => (updateControl ? updateControl.setAutoDownload(autoDownload) : false),
});

ipcMain.handle('bridge', (event, name, args) => {
  if (!win || event.sender !== win.webContents) throw new Error('bridge call from an unknown page');
  if (!Object.hasOwn(bridgeSpec.commands, name) || !Object.hasOwn(handlers, name)) throw new Error('undeclared bridge command: ' + name);
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
  report.chats = await js("document.querySelectorAll('.chat-row').length");
  report.bubbles = await js("document.querySelectorAll('.bubble-row').length");
  report.images = await js("document.querySelectorAll('img.attachment-image').length");
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

  // Settings: the page reads what the server holds, writes a change back, and redraws when a change arrives on the
  // event stream from anywhere. Values are checked at the server, not from the page's own copy.
  const srv = process.env.SMOKE_SERVER_URL;
  const auth = { authorization: 'Bearer ' + process.env.SMOKE_TOKEN };
  const held = async () => (await (await fetch(srv + '/api/v1/settings', { headers: auth })).json()).values || {};
  const cdp = (method, params) => wc.debugger.sendCommand(method, params);

  await js("document.querySelector('.sidebar-head .text-button').click()");
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

  // Notices: an update state raises a native notice over the same bridge the message notices use, and a type the
  // server has switched off raises none. The shell records every notice it is asked to show.
  const putSettings = (values) => fetch(srv + '/api/v1/settings', { method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ values }) });
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

  // The download state draws the progress as an in-app banner, because a native notice cannot show a moving bar.
  wc.send('bridge:event:update.state', { state: 'downloading', version: '9.9.9', percent: 0.5, detail: '5.0 MB of 12 MB' });
  await waitFor("Boolean(document.querySelector('.banner.update .update-progress'))", 10000);
  report.updateBanner = await js("(() => { const p = document.querySelector('.update-progress'); return Boolean(p) && Number(p.value) > 0 && Number(p.value) < 1; })()");
  wc.send('bridge:event:update.state', { state: 'ready', version: '9.9.9' });
  await pause(300);
  report.updateBannerCleared = await js("!document.querySelector('.banner.update')");
  report.updates = report.updateBanner && report.updateBannerCleared;

  nativeTheme.themeSource = 'light';
  await pause(300);
  await shot('05-settings.png');

  // About: every value comes from the server's info route.
  await js("document.querySelector('app-settings [data-action=\"about\"]').click()");
  await waitFor("Boolean(document.querySelector('app-about'))");
  await pause(200);
  await shot('06-about.png');
  report.about = await js("[...document.querySelectorAll('app-about .setting-row')].some((r) => r.textContent.includes('Server version'))");
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
  report.phoneDrawer = await js("(() => { const r = document.querySelector('.shell .sidebar').getBoundingClientRect(); const back = getComputedStyle(document.querySelector('app-conversation .conv-back')).display !== 'none'; const scrim = getComputedStyle(document.querySelector('.scrim')); return back && r.width > 0 && r.width < window.innerWidth && scrim.visibility === 'visible'; })()");
  await shot('07-phone-list.png');
  await js("document.querySelector('.sidebar .chat-row').click()");
  await waitFor("document.querySelector('.shell')?.dataset.pane === 'conversation'");
  await pause(400); // the drawer slides on a 160ms transition; measure the settled position, not a frame of it.
  report.phone = await js("(() => { const r = document.querySelector('.shell .sidebar').getBoundingClientRect(); const scrim = document.querySelector('.scrim'); return r.right <= 0 && (!scrim || getComputedStyle(scrim).visibility === 'hidden'); })()");
  await shot('08-phone-conversation.png');
  await js("document.querySelector('app-conversation .conv-back').click()");
  await waitFor("document.querySelector('.shell')?.dataset.pane === 'list'");
  await cdp('Emulation.clearDeviceMetricsOverride', {});
  await pause(200);

  // Sign out lives on the settings page now.
  await js("document.querySelector('.sidebar-head .text-button').click()");
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
    icon: path.join(here, '../build/icon.png'),
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.on('page-title-updated', (e) => e.preventDefault());
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
