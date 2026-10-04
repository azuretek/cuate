// Proof for issue 190: one action button renders its four states (idle, working, done, failed) on the SAME button,
// in light and dark, for the default palette and an imported theme, at desktop and phone width, and its box never
// changes size between its states. It mounts the real About page in the real stylesheets and drives the real kit press
// (core/kit/press.js) on Check for updates. Run it under a display:
//
//   xvfb-run -a ./desktop/node_modules/.bin/electron desktop/scripts/prove-action-buttons.mjs --shots <dir>
import { app, BrowserWindow, protocol } from 'electron';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HARNESS = '/desktop/scripts/lib/action-button-harness.html';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const argOf = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; };
const OUT = argOf('--shots', path.join(ROOT, 'desktop', 'out', 'proof-action-buttons'));
mkdirSync(OUT, { recursive: true });

protocol.registerSchemesAsPrivileged([{ scheme: 'prove', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
function serve(req) {
  const url = new URL(req.url);
  if (url.host !== 'bundle') return new Response('not found', { status: 404 });
  const rel = decodeURIComponent(url.pathname).split('/').filter(Boolean).join('/');
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep) || !existsSync(file)) return new Response('not found', { status: 404 });
  return new Response(readFileSync(file), { headers: { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' } });
}

await app.whenReady();
protocol.handle('prove', serve);
const win = new BrowserWindow({ show: true, width: 1100, height: 760, webPreferences: { contextIsolation: true, nodeIntegration: false } });
const wc = win.webContents;
const js = (code) => wc.executeJavaScript(code, true);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (expr, ms = 20000) => { const t0 = Date.now(); for (;;) { if (await js(expr)) return; if (Date.now() - t0 > ms) throw new Error('timed out: ' + expr); await pause(150); } };
const shot = async (name) => { const img = await wc.capturePage(); writeFileSync(path.join(OUT, name), img.toPNG()); };
const states = ['idle', 'pending', 'success', 'failure'];
const sameBox = (a, b) => Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5;

const plan = [
  ['default', 'light', 1100, 760, 'desktop'],
  ['default', 'dark', 1100, 760, 'desktop'],
  ['elegant-luxury', 'light', 1100, 760, 'desktop'],
  ['elegant-luxury', 'dark', 1100, 760, 'desktop'],
  ['default', 'light', 390, 780, 'phone'],
  ['default', 'dark', 390, 780, 'phone'],
  ['elegant-luxury', 'light', 390, 780, 'phone'],
  ['elegant-luxury', 'dark', 390, 780, 'phone'],
];
let failed = false;
const report = {};
for (const [theme, scheme, width, height, form] of plan) {
  win.setContentSize(width, height);
  await wc.loadURL('prove://bundle' + HARNESS);
  await waitFor('Boolean(document.querySelector(\'.about-check\'))');
  await js('__setTheme(' + JSON.stringify(theme) + ', ' + JSON.stringify(scheme) + ')');
  await pause(500);
  const tag = theme + '--' + scheme + '--' + form;
  const rects = {};
  rects.idle = await js('__rect()');
  await shot(tag + '--idle.png');
  await js('__hold()');
  await pause(120);
  rects.pending = await js('__rect()');
  await shot(tag + '--working.png');
  await js('__ok()');
  await pause(150);
  rects.success = await js('__rect()');
  await shot(tag + '--done.png');
  await pause(1400);
  await js('__hold()');
  await pause(120);
  await js('__bad()');
  await pause(150);
  rects.failure = await js('__rect()');
  await shot(tag + '--failed.png');
  await pause(1200);
  const same = states.every((s) => sameBox(rects[s], rects.idle));
  report[tag] = rects;
  console.log((same ? 'OK   ' : 'FAIL ') + tag + ' ' + JSON.stringify(rects));
  if (!same) failed = true;
}
writeFileSync(path.join(OUT, 'proof-action-buttons.json'), JSON.stringify({ report, failed }, null, 1));
console.log(failed ? 'PROOF FAILED' : 'PROOF OK');
win.destroy();
app.exit(failed ? 1 : 0);
