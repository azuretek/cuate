// The app icon picker's drawn size: each picture and the card it sits in, measured in the real Chromium the app uses,
// through the real stylesheets and the real settings component, at a phone width and a desktop width. Each picture is
// half its card's width, and the run fails when it is not.
// Run it with a display:
//
//   xvfb-run -a npx electron desktop/scripts/prove-app-icon-size.mjs
//
// With PROVE_OUT naming a folder, it also writes the pictures it measured.
import { app, BrowserWindow, protocol } from 'electron';
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HARNESS = '/core/app/X.html';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

// A profile of its own for every run: a zoom or any other setting one probe leaves behind never reaches the next.
app.setPath('userData', mkdtempSync(path.join(os.tmpdir(), 'prove-')));

protocol.registerSchemesAsPrivileged([{ scheme: 'prove', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

function serve(req) {
  const url = new URL(req.url);
  if (url.host !== 'bundle') return new Response('not found', { status: 404 });
  if (url.pathname === HARNESS) return new Response(harness(url.searchParams), { headers: { 'content-type': 'text/html' } });
  const file = path.resolve(ROOT, decodeURIComponent(url.pathname).replace(/^\/+/, ''));
  if (!file.startsWith(ROOT + path.sep) || !existsSync(file)) return new Response('not found', { status: 404 });
  return new Response(readFileSync(file), { headers: { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' } });
}

const page = (body, script, scheme) => '<!doctype html><html' + (scheme ? ' style="color-scheme: ' + scheme + '"' : '') + '><head><meta charset="utf-8">'
  + '<link rel="stylesheet" href="/core/app/styles/tokens.css">'
  + '<link rel="stylesheet" href="/core/app/styles/roles.css">'
  + '<link rel="stylesheet" href="/core/app/styles/app.css"></head><body>' + body
  + '<script type="module">' + script + '</script></body></html>';

// A probe that cannot run says why and stops, rather than hanging until its bound kills it.
const stop = (why) => { console.log('PROOF ERROR ' + why); app.exit(2); };
process.on('unhandledRejection', (e) => stop(e && e.stack ? e.stack : String(e)));
setTimeout(() => stop('the probe did not finish in time'), 180000).unref();
const shot = async (win, name) => {
  if (!process.env.PROVE_OUT) return;
  writeFileSync(path.join(process.env.PROVE_OUT, name + '.png'), (await win.webContents.capturePage()).toPNG());
};
const ready = async (win, test) => {
  for (let i = 0; i < 200; i += 1) {
    if (await win.webContents.executeJavaScript(test).catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
};
const open = async (win, query) => {
  // A custom scheme can report its load stopped while the page's own modules are still arriving; the probe waits on
  // the page itself, so the load's own answer is not what it trusts.
  await win.loadURL('prove://bundle' + HARNESS + '?' + query).catch(() => {});
  if (!(await ready(win, 'Boolean(window.probeReady)'))) stop('the page never became ready');
};

function harness() {
  const values = { 'appearance.skin': 'system', 'appearance.textScale': 100, 'notifications.newMessage': true };
  return page('', `
import '/core/app/components/app-settings.js';
const scrim = document.createElement('div'); scrim.className = 'sheet-scrim';
const card = document.createElement('section'); card.className = 'sheet';
const el = document.createElement('app-settings');
el.values = ${JSON.stringify(values)}; el.serverUrl = 'https://server.example.ts.net';
card.append(el); scrim.append(card); document.body.append(scrim);
const box = (n) => (n ? { w: Math.round(n.getBoundingClientRect().width), h: Math.round(n.getBoundingClientRect().height) } : null);
window.measure = () => {
  const grid = document.querySelector('.app-icon-choices');
  if (grid) grid.scrollIntoView({ block: 'center' });
  return { card: box(document.querySelector('.app-icon-choice')), picture: box(document.querySelector('.app-icon-picture')), columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0, choices: document.querySelectorAll('.app-icon-choice').length };
};
window.probeReady = true;
`);
}

app.whenReady().then(async () => {
  protocol.handle('prove', serve);
  let failed = false;
  const win = new BrowserWindow({ show: true, width: 380, height: 760, webPreferences: { contextIsolation: true, backgroundThrottling: false } });
  for (const [width, height] of [[380, 760], [900, 900]]) {
    win.setContentSize(width, height);
    await open(win, 'w=' + width);
    await ready(win, 'document.querySelectorAll(".app-icon-choice img").length > 0 && [...document.querySelectorAll(".app-icon-choice img")].every((i) => i.complete)');
    const r = await win.webContents.executeJavaScript('window.measure()');
    await new Promise((resolve) => setTimeout(resolve, 300));
    await shot(win, 'app-icons-' + width);
    // The card's content box is its width less its padding and border on each side.
    const inner = r.card ? r.card.w - 2 * 8 - 2 : 0;
    const share = inner ? r.picture.w / inner : 0;
    const ok = share > 0.45 && share < 0.55;
    if (!ok) failed = true;
    console.log((ok ? 'OK   ' : 'FAIL ') + 'at ' + width + 'px: picture ' + JSON.stringify(r.picture) + ' in a card ' + JSON.stringify(r.card) + ' (' + Math.round(share * 100) + '% of its width), ' + r.columns + ' columns, ' + r.choices + ' choices');
  }
  console.log(failed ? 'PROOF FAILED' : 'PROOF OK');
  app.exit(failed ? 1 : 0);
});
