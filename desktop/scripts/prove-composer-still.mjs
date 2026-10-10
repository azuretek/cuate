// The composer's row holds still while the emoji panel opens: the attach control, the field and the send control are
// measured in the real Chromium the app uses, through the real stylesheets and the real component, before and after
// the panel opens, and the run fails when any of them moved. At a phone's width it also checks that no emoji control
// is drawn, since a phone's own keyboard carries emoji.
// Run it with a display:
//
//   xvfb-run -a npx electron desktop/scripts/prove-composer-still.mjs
//
// With PROVE_OUT naming a folder, it also writes the pictures it measured.
import { app, BrowserWindow, protocol } from 'electron';
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HARNESS = '/core/app/prove-composer-still.html';
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

function harness(q) {
  const phone = q.get('phone') === '1';
  return page('<div style="position: fixed; left: 0; right: 0; bottom: 0"><app-composer></app-composer></div>', `
import '/core/app/components/app-composer.js';
const el = document.querySelector('app-composer');
el.placeholder = 'Message'; el.disabled = false; el.phone = ${phone};
const box = (s) => { const n = el.querySelector(s); if (!n) return null; const r = n.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
window.measure = () => ({ attach: box('button.tool[aria-label="Attach"]'), emoji: box('button.tool[aria-label="Emoji"]'), field: box('textarea'), send: box('button.send'), panel: box('.emoji-picker') });
window.openPanel = async () => { el.toggleEmoji(); await el.updateComplete; for (let i = 0; i < 10; i += 1) await new Promise((r) => requestAnimationFrame(r)); };
el.updateComplete.then(() => { window.probeReady = true; });
`);
}

app.whenReady().then(async () => {
  protocol.handle('prove', serve);
  let failed = false;
  const win = new BrowserWindow({ show: true, width: 900, height: 700, webPreferences: { contextIsolation: true, backgroundThrottling: false } });
  await open(win, 'phone=0');
  const before = await win.webContents.executeJavaScript('window.measure()');
  await shot(win, 'composer-closed');
  await win.webContents.executeJavaScript('window.openPanel()');
  const after = await win.webContents.executeJavaScript('window.measure()');
  await shot(win, 'composer-open');
  for (const k of ['attach', 'emoji', 'field', 'send']) {
    const same = JSON.stringify(before[k]) === JSON.stringify(after[k]);
    if (!same) failed = true;
    console.log((same ? 'OK   ' : 'FAIL ') + k + ' before ' + JSON.stringify(before[k]) + ' after ' + JSON.stringify(after[k]));
  }
  console.log((after.panel ? 'OK   ' : 'FAIL ') + 'the panel opened at ' + JSON.stringify(after.panel));
  if (!after.panel) failed = true;
  win.setContentSize(390, 800);
  await open(win, 'phone=1');
  const phone = await win.webContents.executeJavaScript('window.measure()');
  await shot(win, 'composer-phone');
  console.log((phone.emoji ? 'FAIL ' : 'OK   ') + 'a phone draws ' + (phone.emoji ? 'an' : 'no') + ' emoji control; attach ' + JSON.stringify(phone.attach) + ', field ' + JSON.stringify(phone.field));
  if (phone.emoji) failed = true;
  console.log(failed ? 'PROOF FAILED' : 'PROOF OK');
  app.exit(failed ? 1 : 0);
});
