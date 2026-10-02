// The desktop shell: one window hosting core's app page over app://bundle, plus the host bridge. Nothing about the
// app lives here; the name comes from core/spec/naming.json.
import { app, BrowserWindow, protocol, ipcMain, Menu, Tray, nativeImage, safeStorage, Notification, shell, nativeTheme } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandlers, createSecureStore, mimeFor } from './bridge-handlers.js';
import { windowOptions } from './window-chrome.js';
import { clientReport } from '../../core/kit/rules/build.js';
import { controlLayout } from '../../core/app/rules/bar-layout.js';
import { tokenMismatches, expectedTokens } from './surface.js';
import updaterPackage from 'electron-updater';
import { startUpdates, checkForUpdates } from './updates.js';
import { createLifecycle, trayTemplate, trayIcon, appMenuTemplate } from './tray.js';

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
  const closeWindow = barLayout.drawn
    ? () => js("(() => { document.querySelector('.conv-head .window-control.close').click(); return true; })()")
    : () => { w.close(); };
  await js(`(() => { const t = document.querySelector('app-composer textarea'); t.value = ${JSON.stringify(IN_FLIGHT)}; document.querySelector('app-composer button.send').click(); return true; })()`);
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
  const trayOrder = trayMenu.items.filter((i) => i.type !== 'separator').map((i) => i.id).join('|');
  trayItem('settings').click();
  const settingsRaised = await visibleWithin(true);
  await waitFor("Boolean(document.querySelector('app-settings .sheet-back'))", 10000);
  w.minimize();
  for (const t0 = Date.now(); !w.isMinimized() && Date.now() - t0 < 3000;) await pause(100);
  const minimised = w.isMinimized();
  trayItem('about').click();
  await waitFor("Boolean(document.querySelector('app-about .sheet-back'))", 10000);
  const aboutRaised = w.isVisible() && !w.isMinimized();
  w.close();
  const hidAgain = await visibleWithin(false);
  trayItem('checkUpdates').click();
  const updatesRaised = await visibleWithin(true);
  await waitFor("!document.querySelector('.sheet') && (document.querySelector('.banner.update')?.textContent || '').includes('does not update itself')", 10000);
  await pause(300);
  await shot('04-tray-check-updates.png');
  await js("document.querySelector('.banner.update .banner-action').click()");
  await waitFor("!document.querySelector('.banner.update')", 5000);
  w.close();
  await visibleWithin(false);
  trayItem('show').click();
  const trayShown = await visibleWithin(true);
  const trayChecks = { order: trayOrder === 'show|settings|about|checkUpdates|quit', settingsRaised, aboutRaised, hidAgain, updatesRaised, shown: trayShown, quitting: !lifecycle.quitting };
  report.tray = Object.values(trayChecks).every(Boolean);
  console.log('tray: ' + JSON.stringify({ checks: trayChecks, minimised }));

  // The emoji panel: the grid draws first, the search field and the categories sit below it, and the panel keeps one
  // height, so typing a query narrows the grid without moving the composer or the grid's top edge. The order the eye
  // reads is the order the keyboard walks: the grid, then the field, then the tabs.
  await js("document.querySelector('app-composer button.tool[aria-label=\"Emoji\"]').click()");
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
  await js("document.querySelector('app-composer button.tool[aria-label=\"Emoji\"]').click()");

  // The attach menu (issue 72): the attach button sits beside the emoji button, opens a short menu upward from the
  // composer rather than a sheet, and a file picked there stages above the field, uploads, and sends with its caption.
  // The file is handed to the input the way the system picker would, since a smoke cannot drive the OS dialog.
  await js("document.querySelector('app-composer button.tool[aria-label=\"Attach\"]').click()");
  await waitFor("Boolean(document.querySelector('app-composer .attach-menu'))");
  const attachMenu = await js("(() => { const c = document.querySelector('app-composer'); const menu = c.querySelector('.attach-menu'); const tools = [...c.querySelectorAll('.composer-tools button.tool')].map((b) => b.getAttribute('aria-label')); return { tools, items: [...menu.querySelectorAll('[role=menuitem]')].map((b) => b.textContent.trim()), above: menu.getBoundingClientRect().bottom <= c.querySelector('form').getBoundingClientRect().top + 1, sheet: menu.getBoundingClientRect().width >= window.innerWidth }; })()");
  await js("document.querySelector('app-composer button.tool[aria-label=\"Attach\"]').click()");
  const ATTACH_CAPTION = 'smoke caption \u{1F44B}\u{1F3FD}';
  await js(`(() => { const c = document.querySelector('app-composer'); const input = c.querySelector('input[type=file]'); const dt = new DataTransfer(); dt.items.add(new File(['synthetic smoke file'], 'smoke-note.txt', { type: 'text/plain' })); input.files = dt.files; input.dispatchEvent(new Event('change')); return true; })()`);
  await waitFor("Boolean(document.querySelector('app-composer .staged-file'))");
  const staged = await js("document.querySelector('app-composer .staged-name').textContent");
  await js(`(() => { const t = document.querySelector('app-composer textarea'); t.value = ${JSON.stringify(ATTACH_CAPTION)}; document.querySelector('app-composer button.send').click(); return true; })()`);
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
  await js("document.querySelector('app-image-viewer .viewer-close').click()");
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
  await js("document.querySelector('app-image-viewer .viewer-close').click()");
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

  // The sidebar's Add group control stays on one line (issue 122): at the smallest window the shell allows and at every
  // text size from 50% to 300%, the label renders as one line, in full at 100%, and shortens with an ellipsis rather
  // than wrapping where the row is too narrow for it. The line count is read from the label's own text boxes and
  // checked against the button's height, so a wrap fails here on whichever platform drew it.
  if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
  const [minW, minH] = w.getMinimumSize();
  await cdp('Emulation.setDeviceMetricsOverride', { width: minW, height: minH, deviceScaleFactor: 1, mobile: false });
  const addGroupLine = () => js(`(() => {
    const b = document.querySelector('.add-group .add-group-button');
    if (!b) return null;
    const s = getComputedStyle(b);
    const size = parseFloat(s.fontSize);
    const line = parseFloat(s.lineHeight) || size * 1.2;
    const inner = b.getBoundingClientRect().height - ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'].reduce((n, k) => n + (parseFloat(s[k]) || 0), 0);
    const range = document.createRange();
    range.selectNodeContents(b);
    const lines = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size;
    return { size, line, inner, lines, full: b.scrollWidth <= b.clientWidth, label: b.textContent.trim(), title: b.title, wide: window.innerWidth };
  })()`);
  const addGroupSizes = {};
  const labelPx = "parseFloat(getComputedStyle(document.querySelector('.add-group .add-group-button')).fontSize)";
  const plainLabel = await js(labelPx);
  for (const scale of [50, 100, 200, 300]) {
    const scaleSet = await putSettings({ 'appearance.textScale': scale });
    if (!scaleSet.ok) throw new Error('the server refused the text size write: ' + scaleSet.status);
    await waitFor('Math.abs(' + labelPx + ' - ' + (plainLabel * scale / 100) + ') < 0.6', 10000);
    await pause(200);
    const m = await addGroupLine();
    addGroupSizes[scale] = m;
    if (scale !== 50) await shot('10-add-group-' + scale + '.png');
  }
  await putSettings({ 'appearance.textScale': 100 });
  await waitFor('Math.abs(' + labelPx + ' - ' + plainLabel + ') < 0.6', 10000);
  await cdp('Emulation.clearDeviceMetricsOverride', {});
  report.addGroup = Object.values(addGroupSizes).every((m) => m && m.lines === 1 && m.inner < m.line * 1.5 && m.label === 'Add group' && m.title === 'Add group' && m.wide === minW)
    && addGroupSizes[100].full;
  console.log('add group: ' + JSON.stringify({ minW, minH, sizes: addGroupSizes }));

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
  const pickSkin = (skin) => clickSkin(skin);
  await putSettings({ 'appearance.theme': { name: 'smoke', color: { light: { accent: '#2a6f4b' }, dark: { accent: '#7fd6a8' } } } });
  await pickSkin('light');
  await waitFor("document.documentElement.dataset.scheme === 'light' && getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() === '#2a6f4b'", 10000);
  report.themeLight = true;
  await pickSkin('dark');
  await waitFor("document.documentElement.dataset.scheme === 'dark' && getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() === '#7fd6a8'", 10000);
  report.themeDark = true;
  report.theme = report.themeLight && report.themeDark;

  // Importing a tweakcn theme from the settings page: the pasted export is converted, held by the server and drawn by
  // the page in the scheme in force (dark, from the step above), the page names what it refused, and Use default
  // clears it at the server. Values are checked at the server and in what the page resolves, not in the page's copy.
  const importCss = ':root { --primary: #8a3b12; --chart-1: #000000; }\n.dark { --primary: #e0a070; }';
  await js(`(() => { const s = document.querySelector('app-settings'); const n = s.querySelector('.theme-import-name'); n.value = 'smoke import'; n.dispatchEvent(new Event('input', { bubbles: true })); const t = s.querySelector('.theme-import-text'); t.value = ${JSON.stringify(importCss)}; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await waitFor("!document.querySelector('app-settings .theme-import-action').disabled");
  await js("document.querySelector('app-settings .theme-import-action').click()");
  for (let i = 0; i < 50 && (await held())['appearance.theme']?.name !== 'smoke import'; i += 1) await pause(200);
  const imported = (await held())['appearance.theme'];
  report.themeImportHeld = Boolean(imported) && imported.source === 'tweakcn' && imported.name === 'smoke import';
  await waitFor("getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() === '#e0a070'", 10000);
  report.themeImportDrawn = true;
  report.themeImportReported = await js("(() => { const n = document.querySelector('app-settings .theme-import-note'); return Boolean(n) && n.textContent.includes('chart-1'); })()");
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
  const themeHost = http.createServer((req, res) => {
    if (req.url === '/theme.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(registry)); return; }
    res.writeHead(404, { 'content-type': 'text/plain' }); res.end('no theme here');
  });
  await new Promise((resolve) => themeHost.listen(0, '127.0.0.1', resolve));
  const themeBase = 'http://127.0.0.1:' + themeHost.address().port;
  const importUrl = async (url) => {
    await js(`(() => { const i = document.querySelector('app-settings .theme-url-input'); i.value = ${JSON.stringify(url)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await waitFor("!document.querySelector('app-settings .theme-url-action').disabled");
    await js("document.querySelector('app-settings .theme-url-action').click()");
    await waitFor("Boolean(document.querySelector('app-settings .theme-url-note')) && !document.querySelector('app-settings').urlBusy", 15000);
    return js("document.querySelector('app-settings .theme-url-note').textContent");
  };
  try {
    const before = ((await held())['appearance.themes'] || []).length;
    const badNote = await importUrl(themeBase + '/missing.json');
    report.themeUrlRefused = badNote.includes('404') && ((await held())['appearance.themes'] || []).length === before;
    const goodNote = await importUrl(themeBase + '/theme.json');
    const themes = (await held())['appearance.themes'] || [];
    report.themeUrlHeld = themes.some((t) => t.id === 'smoke-url' && t.color.light.accent === '#1d4ed8') && (await held())['appearance.theme']?.id !== 'smoke-url';
    await waitFor("Boolean(document.querySelector('app-settings .theme-card[data-theme-id=\"smoke-url\"]'))", 10000);
    const scheme = await js('document.documentElement.dataset.scheme');
    const cardAccent = await js("getComputedStyle(document.querySelector('app-settings .theme-card[data-theme-id=\"smoke-url\"] .theme-swatch[data-token=\"accent\"]')).backgroundColor");
    report.themeUrlCard = cardAccent === (scheme === 'dark' ? 'rgb(147, 197, 253)' : 'rgb(29, 78, 216)');
    report.themeUrl = report.themeUrlRefused && report.themeUrlHeld && report.themeUrlCard;
    console.log('theme url: ' + JSON.stringify({ badNote, goodNote, scheme, cardAccent, refused: report.themeUrlRefused, held: report.themeUrlHeld, card: report.themeUrlCard }));
  } finally {
    themeHost.close();
  }

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
  // A new check replaces the failure with the check in progress, which offers nothing to press, and a check that finds
  // nothing newer says so and is dismissed in the page, which clears the banner.
  wc.send('bridge:event:update.state', { state: 'checking' });
  await waitFor("(document.querySelector('.banner.update')?.textContent || '').includes('Checking for updates') && !document.querySelector('.banner.update .banner-action')", 10000);
  wc.send('bridge:event:update.state', { state: 'current', version: '0.0.0', canInstall: true });
  await waitFor("(document.querySelector('.banner.update')?.textContent || '').includes('latest version')", 10000);
  smokeCalls.length = 0;
  await js("document.querySelector('.banner.update .banner-action').click()");
  await pause(300);
  report.updateBannerCleared = await js("!document.querySelector('.banner.update')") && smokeCalls.length === 0;
  report.updates = report.updateDownloadAction && report.updateBanner && report.updateInstallAction && report.updateFailure && report.updateBannerCleared;

  await putSettings({ 'appearance.theme': null, 'appearance.skin': 'system' });
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

  // About: every value comes from the server's info route, and it shares the sheet's chrome.
  await js("document.querySelector('app-settings [data-action=about]').click()");
  await waitFor("Boolean(document.querySelector('app-about .sheet-back'))");
  await pause(1000);
  report.sheetHitAreaAbout = await sheetHit('app-about');
  const narrowAbout = await sideways();
  report.sheetWidthAbout = narrowAbout.doc <= narrowAbout.inner && narrowAbout.body <= narrowAbout.inner;
  await cdp('Emulation.clearDeviceMetricsOverride', {});
  await pause(300);
  nativeTheme.themeSource = 'light';
  await pause(200);
  await shot('06-about.png');
  nativeTheme.themeSource = 'dark';
  await pause(300);
  await shot('06b-about-dark.png');
  nativeTheme.themeSource = 'light';
  await pause(200);
  // The client's own build and the server's, each from its own half, plus the one action that copies the lot.
  report.about = await js("(() => { const rows = [...document.querySelectorAll('app-about .setting-row')].map((r) => r.textContent); return rows.some((t) => t.includes('Client version')) && rows.some((t) => t.includes('Server version')) && rows.some((t) => t.includes('Electron')) && Boolean(document.querySelector('app-about .about-copy')); })()");
  report.sheet = report.sheetHitArea && report.sheetInsideKeeps && report.sheetDragKeeps && report.sheetBackdropReturns && report.sheetEscapeReturns && report.sheetHitAreaAbout && report.sheetWidthSettings && report.sheetWidthAbout;
  if (!report.sheet) console.error('sheet: ' + JSON.stringify({ hit: report.sheetHitArea, inside: report.sheetInsideKeeps, drag: report.sheetDragKeeps, backdrop: report.sheetBackdropReturns, escape: report.sheetEscapeReturns, hitAbout: report.sheetHitAreaAbout, wSettings: report.sheetWidthSettings, wAbout: report.sheetWidthAbout }));
  await js("document.querySelector('app-about .sheet-back').click()");
  await waitFor("Boolean(document.querySelector('app-settings'))");
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
    // The platform's own chrome: macOS keeps its traffic lights (the bar leaves them room), Windows and Linux draw no
    // platform frame at all, because core draws the bar and its controls there. See window-chrome.js.
    ...windowOptions(process.platform),
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
  // Closing hides the window to the tray and the app keeps running; only a quit closes it (tray.js).
  win.on('close', (e) => lifecycle.onClose(e));
  win.on('closed', () => { win = null; });
  win.webContents.on('did-finish-load', () => {
    if (lastUpdateState && win && !win.isDestroyed()) win.webContents.send('bridge:event:update.state', lastUpdateState);
    lifecycle.loaded();
  });
  if (SMOKE) {
    win.webContents.on('console-message', (e) => { if (e.level === 'error') console.error('page: ' + e.message); });
    runSmoke(win).catch((e) => { console.error('smoke failed: ' + (e && e.message)); app.exit(1); });
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
