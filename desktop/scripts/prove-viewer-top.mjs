// The media viewer opens a picture at the top of its stage (issue 315), not its middle: a wide photo on a phone sits
// under the close control rather than floating in the middle of the screen. Zooming keeps the point under the pointer,
// and a picture zoomed past the stage's height is no longer lifted. The real viewer runs in the Chromium the app uses,
// at a phone's width and a desktop's, over a synthetic picture drawn on a canvas.
// Run it with a display:
//
//   xvfb-run -a npx electron desktop/scripts/prove-viewer-top.mjs
//
// With PROVE_OUT naming a folder, it also writes the pictures it measured.
import { app, BrowserWindow, protocol } from 'electron';
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HARNESS = '/core/app/prove-viewer-top.html';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

// A profile of its own for every run: a zoom or any other setting one probe leaves behind never reaches the next.
app.setPath('userData', mkdtempSync(path.join(os.tmpdir(), 'prove-')));

protocol.registerSchemesAsPrivileged([{ scheme: 'prove', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

function serve(req) {
  const url = new URL(req.url);
  if (url.host !== 'bundle') return new Response('not found', { status: 404 });
  if (url.pathname.startsWith('/fixture/')) {
    const f = path.join(process.env.PROVE_FIX || '', path.basename(url.pathname));
    if (!existsSync(f)) return new Response('not found', { status: 404 });
    const type = { '.png': 'image/png', '.mov': 'video/quicktime', '.mp4': 'video/mp4' }[path.extname(f)] || 'application/octet-stream';
    return new Response(readFileSync(f), { headers: { 'content-type': type } });
  }
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
  return page('', `
import '/core/app/components/app-image-viewer.js';
import { mediaItems } from '/core/app/rules/media.js';
const q = new URLSearchParams(location.search); const PW = Number(q.get('w')) || 1600; const PH = Number(q.get('h')) || 600;
const picture = () => { const c = document.createElement('canvas'); c.width = PW; c.height = PH; const g = c.getContext('2d'); g.fillStyle = 'hsl(200 60% 50%)'; g.fillRect(0, 0, PW, PH); g.fillStyle = 'hsl(30 80% 60%)'; g.fillRect(0, 0, PW, Math.round(PH / 10)); return new Promise((r) => c.toBlob(r, 'image/png')); };
const client = { attachment: () => picture() };
const el = document.createElement('app-image-viewer');
el.items = mediaItems([{ id: 'm1', attachments: [{ id: 'a1', name: 'photo.png', mime: 'image/png', missing: false }] }]); el.index = 0; el.client = client;
document.body.append(el);
window.place = () => {
  const img = el.querySelector('img.viewer-image'); const stage = el.querySelector('.viewer');
  if (!img || !(img.complete && img.naturalWidth > 0)) return null;
  const r = img.getBoundingClientRect(); const b = stage.getBoundingClientRect(); const cs = getComputedStyle(stage);
  const s = { top: b.top + parseFloat(cs.paddingTop), bottom: b.bottom - parseFloat(cs.paddingBottom), height: b.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) };
  return { top: Math.round(r.top - s.top), bottom: Math.round(s.bottom - r.bottom), h: Math.round(r.height), stage: Math.round(s.height), scale: el.view.scale };
};
window.zoomAt = (x, y) => { el.zoom(4, el.point({ clientX: x, clientY: y })); };
window.pictureY = (y) => { const r = el.querySelector('img.viewer-image').getBoundingClientRect(); return (y - r.top) / r.height; };
el.updateComplete.then(() => { window.probeReady = true; });
`);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  protocol.handle('prove', serve);
  let failed = false;
  const say = (ok, line) => { if (!ok) failed = true; console.log((ok ? 'OK   ' : 'FAIL ') + line); };
  // A 4:3 photo on a phone, which a 4x zoom makes taller than the screen, and a wide one on the desktop.
  for (const [w, h, name, pw, ph] of [[390, 844, 'phone', 1200, 900], [1100, 720, 'desktop', 1600, 600]]) {
    const win = new BrowserWindow({ show: true, width: w, height: h, useContentSize: true, webPreferences: { contextIsolation: true, backgroundThrottling: false } });
    await open(win, 'w=' + pw + '&h=' + ph);
    const js = (s) => win.webContents.executeJavaScript(s);
    let p = null;
    for (let i = 0; i < 60 && !p; i += 1) { p = await js('window.place()'); if (!p) await wait(100); }
    await wait(500);
    p = await js('window.place()');
    await shot(win, 'viewer-' + name);
    say(Boolean(p) && p.top <= 2 && p.bottom > 40, name + ': the picture opens at the top of the stage: ' + JSON.stringify(p));
    // A point on the picture, away from where a pan bound would stop it.
    const y = Math.round(p.top + p.h * 0.6);
    const before = await js('window.pictureY(' + y + ')');
    await js('window.zoomAt(' + Math.round(w / 2) + ', ' + y + ')');
    await wait(600);
    const after = await js('window.pictureY(' + y + ')');
    const z = await js('window.place()');
    say(z.h > z.stage && z.top <= 1 && z.bottom <= 1, name + ': zoomed past the stage height, the picture covers the stage: ' + JSON.stringify(z));
    // On the desktop the wide picture has room to zoom about the point; on the phone the picture sits in the top third,
    // so a 4x zoom there is held by the pan bound (the picture keeps covering the screen) rather than by the point.
    if (name === 'desktop') say(Math.abs(before - after) < 0.01, name + ': zooming keeps the point under the pointer: ' + before.toFixed(3) + ' then ' + after.toFixed(3));
    else console.log('INFO ' + name + ': the point under the pointer went from ' + before.toFixed(3) + ' to ' + after.toFixed(3) + ' of the picture, held by the pan bound');
    win.hide();
  }
  console.log(failed ? 'PROOF FAILED' : 'PROOF OK');
  app.exit(failed ? 1 : 0);
});
