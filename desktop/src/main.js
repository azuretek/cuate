// The desktop shell: one window hosting core's app page over app://bundle, plus the host bridge. Nothing about the
// app lives here; the name comes from core/spec/naming.json.
import { app, BrowserWindow, protocol, ipcMain, safeStorage, Notification, shell, nativeTheme } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandlers, createSecureStore, mimeFor } from './bridge-handlers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CORE = path.resolve(here, '../../core');
const naming = JSON.parse(readFileSync(path.join(CORE, 'spec/naming.json'), 'utf8'));
const bridgeSpec = JSON.parse(readFileSync(path.join(CORE, 'spec/host-bridge.json'), 'utf8'));
const version = JSON.parse(readFileSync(path.join(here, '../package.json'), 'utf8')).version;
const SMOKE = process.env.SMOKE_OUT || '';

app.setName(naming.product);
if (SMOKE) app.setPath('userData', path.join(SMOKE, 'user-data'));
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
if (!SMOKE && !app.requestSingleInstanceLock()) app.quit();

let win = null;
const secure = createSecureStore({ file: () => path.join(app.getPath('userData'), 'secure-store.json'), safeStorage, fs: { readFileSync, writeFileSync, existsSync, mkdirSync } });
const handlers = createHandlers({
  secure,
  notify: (title, body) => {
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
  const shot = async (name) => writeFileSync(path.join(SMOKE, name), (await wc.capturePage()).toPNG());
  const report = {};
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
  await js("document.querySelector('.sidebar-head .text-button').click()");
  await waitFor("Boolean(document.querySelector('app-onboarding form'))");
  await pause(300);
  await shot('04-onboarding.png');
  report.onboarding = true;
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
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
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
  app.on('activate', () => { if (!win) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin' || SMOKE) app.quit(); });
