// Shared by prove-settings-overflow.mjs and prove-about-overflow.mjs. It renders ONE of the two sheets in the real
// Chromium the app uses, through the real stylesheets and the real component, at a narrow window and a wide one, and
// reports whether the page scrolls sideways and whether the card stays narrower than the window (it tracks its
// content rather than filling a fixed sheet).
//
// It mounts the page's own component inside the same .sheet-scrim > .sheet the app draws, so the card's width, its
// sections and its back strip are the ones a person sees. Nothing here stubs the page's rules. Run it with a display:
//
//   xvfb-run -a npx electron desktop/scripts/prove-settings-overflow.mjs
import { app, BrowserWindow, protocol } from 'electron';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..', '..');
const HARNESS = '/core/app/prove-sheet.html';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

protocol.registerSchemesAsPrivileged([{ scheme: 'prove', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

function serve(req) {
  const url = new URL(req.url);
  if (url.host !== 'bundle') return new Response('not found', { status: 404 });
  if (url.pathname === HARNESS) return new Response(harness(url.searchParams.get('page')), { headers: { 'content-type': 'text/html' } });
  const file = path.resolve(ROOT, decodeURIComponent(url.pathname).replace(/^\/+/, ''));
  if (!file.startsWith(ROOT + path.sep) || !existsSync(file)) return new Response('not found', { status: 404 });
  return new Response(readFileSync(file), { headers: { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' } });
}

// The page, with the state each of its halves owns. The About page reads the shell's report and the server's; the
// settings page reads the server's settings. These are the shapes the app hands over, so the component draws its
// real sections and its real back strip.
function harness(page) {
  const about = page === 'about';
  const host = { product: 'The app', version: '1.0.1-dev.291.810552323b', commit: '810552323b', builtAt: '2026-09-20 03:34Z', versions: { electron: '44.4.1', chrome: '152.0.7977.78', node: '22.13.0' }, platform: 'linux', arch: 'x64', packaged: true };
  const info = { product: 'The app', serverVersion: '1.0.0', apiVersion: 1, engine: { kind: 'fake', version: '1.0.0' }, sending: true, epoch: 'abcdef0123' };
  const values = { 'appearance.skin': 'system', 'appearance.textScale': 100, 'notifications.newMessage': true, 'notifications.updateAvailable': true, 'notifications.updateReady': true, 'notifications.errors': true, 'updates.autoDownload': false };
  const tag = about ? 'app-about' : 'app-settings';
  const state = about
    ? 'el.host = ' + JSON.stringify(host) + '; el.info = ' + JSON.stringify(info) + ';'
    : 'el.values = ' + JSON.stringify(values) + '; el.serverUrl = "https://server.example.ts.net";';
  return '<!doctype html><html><head><meta charset="utf-8">'
    + '<link rel="stylesheet" href="/core/app/styles/tokens.css">'
    + '<link rel="stylesheet" href="/core/app/styles/app.css"></head><body>'
    + '<script type="module">'
    + 'import "/core/app/components/' + tag + '.js";'
    + 'const scrim = document.createElement("div"); scrim.className = "sheet-scrim";'
    + 'const card = document.createElement("section"); card.className = "sheet";'
    + 'const el = document.createElement("' + tag + '");'
    + state
    + 'card.append(el); scrim.append(card); document.body.append(scrim);'
    + '</script></body></html>';
}

// Every value the check reads. documentElement.scrollWidth vs clientWidth is the sideways scroll of the whole
// surface, and body's the same; either being non-zero is the failure chela's probes report for these two pages.
const PROBE = '(() => {'
  + ' const de = document.documentElement;'
  + ' const card = document.querySelector(".sheet");'
  + ' const box = card.getBoundingClientRect();'
  + ' const vw = de.clientWidth;'
  + ' const over = [];'
  + ' for (const el of document.querySelectorAll("*")) { const b = el.getBoundingClientRect(); if (b.right > vw + 0.5) over.push({ sel: (typeof el.className === "string" ? el.className.split(/\\s+/)[0] : el.tagName), right: Math.round(b.right) }); }'
  + ' over.sort((a, b) => b.right - a.right);'
  + ' return { viewportW: vw, docExcess: de.scrollWidth - de.clientWidth, bodyExcess: document.body.scrollWidth - document.body.clientWidth, cardWidth: Math.round(box.width), cardLeft: Math.round(box.left), widest: over.slice(0, 6) };'
  + ' })()';

export async function proveSheet(page) {
  await app.whenReady();
  protocol.handle('prove', serve);
  const win = new BrowserWindow({ show: false, width: 380, height: 760, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  const results = {};
  for (const width of [380, 900]) {
    win.setContentSize(width, 760);
    await win.loadURL('prove://bundle' + HARNESS + '?page=' + page);
    await new Promise((resolve) => setTimeout(resolve, 500));
    results[width] = await win.webContents.executeJavaScript(PROBE);
  }
  console.log(JSON.stringify(results, null, 2));
  let failed = false;
  for (const width of [380, 900]) {
    const r = results[width];
    const fits = r.docExcess <= 0 && r.bodyExcess <= 0 && r.widest.length === 0;
    console.log((fits ? 'OK   ' : 'FAIL ') + page + ' at ' + width + 'px: doc=' + r.docExcess + ' body=' + r.bodyExcess + ' card=' + r.cardWidth + 'px' + (r.widest.length ? ' widest=' + JSON.stringify(r.widest) : ''));
    if (!fits) failed = true;
  }
  if (!(results[900].cardWidth < 900)) {
    console.log('FAIL the card filled a wide window instead of tracking its content');
    failed = true;
  } else {
    console.log('OK   the card tracks its content (' + results[900].cardWidth + 'px at a 900px window)');
  }
  console.log(failed ? 'PROOF FAILED' : 'PROOF OK');
  win.destroy();
  app.exit(failed ? 1 : 0);
}
