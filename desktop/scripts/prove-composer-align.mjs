// The composer's attach and send controls sit on the field's last line: centred on a one-line field, and level with its
// bottom line as it grows to its maximum. Measured in the real Chromium the app uses, through the real stylesheets and
// the real component, at a desktop width and at a phone's, where the field's type is larger.
// Run it with a display:
//
//   xvfb-run -a npx electron desktop/scripts/prove-composer-align.mjs
//
// With PROVE_OUT naming a folder, it also writes the pictures it measured.
import { app, BrowserWindow, protocol } from 'electron';
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HARNESS = '/core/app/prove-composer-align.html';
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
const box = (s) => { const n = el.querySelector(s); if (!n) return null; const r = n.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, mid: (r.top + r.bottom) / 2, h: r.height }; };
window.type = async (text) => { const t = el.querySelector('textarea'); t.value = text; t.dispatchEvent(new Event('input', { bubbles: true })); await el.updateComplete; for (let i = 0; i < 6; i += 1) await new Promise((r) => requestAnimationFrame(r)); };
window.measure = () => ({ attach: box('button.tool[aria-label="Attach"]'), field: box('textarea'), send: box('button.send') });
el.updateComplete.then(() => { window.probeReady = true; });
`);
}

app.whenReady().then(async () => {
  protocol.handle('prove', serve);
  let failed = false;
  const say = (ok, line) => { if (!ok) failed = true; console.log((ok ? 'OK   ' : 'FAIL ') + line); };
  const r1 = (n) => Math.round(n * 10) / 10;
  const win = new BrowserWindow({ show: true, width: 900, height: 700, webPreferences: { contextIsolation: true, backgroundThrottling: false } });
  for (const [label, width, phone] of [['desktop', 900, 0], ['phone', 390, 1]]) {
    win.setContentSize(width, 700);
    await open(win, 'phone=' + phone);
    let gap = null;
    for (const [lines, text] of [['one line', 'Hello'], ['three lines', 'one\ntwo\nthree'], ['the maximum', Array.from({ length: 14 }, (_, i) => 'line ' + (i + 1)).join('\n')]]) {
      await win.webContents.executeJavaScript('window.type(' + JSON.stringify(text) + ')');
      const m = await win.webContents.executeJavaScript('window.measure()');
      await shot(win, 'align-' + label + '-' + lines.replace(/ /g, '-'));
      for (const k of ['attach', 'send']) {
        const below = m.field.bottom - m[k].bottom;
        if (lines === 'one line') {
          say(Math.abs(m[k].mid - m.field.mid) <= 1, label + ', ' + lines + ': ' + k + ' centred on the field; centre ' + r1(m[k].mid) + ' against ' + r1(m.field.mid) + ' (field ' + r1(m.field.h) + 'px tall)');
          if (k === 'send') gap = below;
        } else {
          say(gap !== null && Math.abs(below - gap) <= 1, label + ', ' + lines + ': ' + k + ' level with the bottom line; ' + r1(below) + 'px above the field bottom, ' + r1(gap) + 'px on one line (field ' + r1(m.field.h) + 'px tall)');
        }
      }
    }
  }
  console.log(failed ? 'PROOF FAILED' : 'PROOF OK');
  app.exit(failed ? 1 : 0);
});
