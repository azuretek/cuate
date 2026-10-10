// A video and a Live Photo are drawn as their picture with a small play mark in the corner, and a plain picture is not:
// three attachments drawn by the real component through the real stylesheets, in the real Chromium the app uses, with
// a client whose picture arrives as a server's would. It measures where the mark sits on each picture and fails when a
// moving one has no mark, the mark is not inside its picture's corner, or a still picture wears one.
// Run it with a display:
//
//   xvfb-run -a npx electron desktop/scripts/prove-play-mark.mjs
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
  return page('<div style="display: grid; grid-template-columns: repeat(3, 280px); gap: 24px; padding: 24px; align-items: start"><div><app-attachment data-case="live"></app-attachment></div><div><app-attachment data-case="video"></app-attachment></div><div><app-attachment data-case="still"></app-attachment></div></div>', `
import '/core/app/components/app-attachment.js';
const picture = (w, h, hue) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = 'hsl(' + hue + ' 55% 55%)'; g.fillRect(0, 0, w, h); return new Promise((r) => c.toBlob(r, 'image/png')); };
const client = { attachment: async (id) => picture(240, 180, id.length * 40) };
const cases = {
  live: { id: 'att-live-0001', name: 'IMG_0001.HEIC', mime: 'image/png', bytes: 1, sticker: false, missing: false, live: true },
  video: { id: 'att-video-0002', name: 'clip.mov', mime: 'video/quicktime', bytes: 1, sticker: false, missing: false },
  still: { id: 'att-still-0003', name: 'photo.png', mime: 'image/png', bytes: 1, sticker: false, missing: false },
};
for (const el of document.querySelectorAll('app-attachment')) { el.client = client; el.attachment = cases[el.dataset.case]; }
const box = (n) => { if (!n) return null; const r = n.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
window.measure = () => Object.fromEntries([...document.querySelectorAll('app-attachment')].map((el) => [el.dataset.case, { preview: box(el.querySelector('.attachment-preview')), mark: box(el.querySelector('.media-play')), label: el.querySelector('.attachment-preview')?.getAttribute('aria-label') || null }]));
window.probeReady = true;
`);
}

app.whenReady().then(async () => {
  protocol.handle('prove', serve);
  let failed = false;
  const win = new BrowserWindow({ show: true, width: 960, height: 380, webPreferences: { contextIsolation: true, backgroundThrottling: false } });
  await open(win, '');
  await ready(win, '[...document.querySelectorAll(".attachment-preview")].length === 3');
  await new Promise((r) => setTimeout(r, 400));
  const m = await win.webContents.executeJavaScript('window.measure()');
  for (const [name, v] of Object.entries(m)) {
    const moves = name !== 'still';
    const inCorner = v.mark && v.preview && v.mark.x >= v.preview.x && v.mark.x + v.mark.w <= v.preview.x + v.preview.w / 2 && v.mark.y + v.mark.h <= v.preview.y + v.preview.h && v.mark.y >= v.preview.y + v.preview.h / 2;
    const ok = moves ? Boolean(inCorner) : !v.mark;
    if (!ok) failed = true;
    console.log((ok ? 'OK   ' : 'FAIL ') + name + ': ' + (moves ? 'a play mark in the picture\'s lower corner' : 'no play mark') + '; picture ' + JSON.stringify(v.preview) + ', mark ' + JSON.stringify(v.mark) + ', label ' + JSON.stringify(v.label));
  }
  await shot(win, 'play-mark');
  console.log(failed ? 'PROOF FAILED' : 'PROOF OK');
  app.exit(failed ? 1 : 0);
});
