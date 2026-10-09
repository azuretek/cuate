// Every dropdown's caret, drawn the way the app draws it: a menu marked data-popover through the real stylesheets, in
// the real Chromium the app uses, in light and in dark. It reads back, in pixels, the panel's own fill and border, the
// colour inside the caret, the colour along its edge and the colour across its base where it meets the panel, and the
// run fails when the inside is not the panel's fill, the edge is not the panel's border, or the panel's border is drawn
// across the base as a seam. The pictures are enlarged so the caret can be judged by eye.
// Run it with a display:
//
//   xvfb-run -a npx electron desktop/scripts/prove-caret.mjs
//
// With PROVE_OUT naming a folder, it also writes the pictures it measured.
import { app, BrowserWindow, protocol, nativeTheme } from 'electron';
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HARNESS = '/core/app/prove-caret.html';
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


// The stylesheets are written into the page rather than linked, so the caret is never measured before they apply.
const styles = () => ['tokens.css', 'roles.css', 'app.css'].map((f) => readFileSync(path.join(ROOT, 'core/app/styles', f), 'utf8')).join('\n');

function harness() {
  return page('<style>' + styles() + '</style>' + '<div style="position: absolute; left: 30px; top: 40px; width: 140px"><div class="sort-menu" role="menu" data-popover data-popover-edge="top" style="--caret-x: 70px"><button class="sort-choice" aria-checked="true">Recent</button><button class="sort-choice">Name A to Z</button><button class="sort-choice">Name Z to A</button></div></div>', `
const menu = document.querySelector('.sort-menu');
window.geometry = () => {
  const r = menu.getBoundingClientRect();
  const cs = getComputedStyle(menu);
  return { left: r.left, top: r.top, width: r.width, border: parseFloat(cs.borderTopWidth), caretX: 70, size: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--size-caret')) };
};
window.probeReady = true;
`);
}

// Drawn at four device pixels to the CSS pixel, so the caret can be read pixel by pixel and judged by eye.
const ZOOM = 4;
app.commandLine.appendSwitch('force-device-scale-factor', String(ZOOM));
const px = (bmp, w, x, y) => { const i = (Math.round(y) * w + Math.round(x)) * 4; return [bmp[i + 2], bmp[i + 1], bmp[i]]; };
const near = (a, b, t = 6) => a.every((v, i) => Math.abs(v - b[i]) <= t);

app.whenReady().then(async () => {
  protocol.handle('prove', serve);
  let failed = false;
  const win = new BrowserWindow({ show: true, width: 400, height: 300, webPreferences: { contextIsolation: true, backgroundThrottling: false } });
  for (const scheme of ['light', 'dark']) {
    nativeTheme.themeSource = scheme;
    await open(win, 'scheme=' + scheme);
    await ready(win, 'getComputedStyle(document.querySelector(".sort-menu")).borderTopStyle === "solid"');
    await new Promise((r) => setTimeout(r, 400));
    const g = await win.webContents.executeJavaScript('window.geometry()');
    const image = await win.webContents.capturePage();
    const { width } = image.getSize();
    const scale = width / (await win.webContents.executeJavaScript('innerWidth'));
    const bmp = image.toBitmap();
    const at = (x, y) => px(bmp, width, x * scale, y * scale);
    const cx = g.left + g.caretX;
    const fill = at(g.left + 20, g.top + g.border + 3);
    const border = at(g.left + 20, g.top + g.border / 2);
    // Inside the caret, a little above the panel's edge; along its near edge, halfway up; across its base, where the
    // panel's border would run if it were drawn through the caret.
    const inside = at(cx, g.top - g.size * 0.15);
    const base = at(cx, g.top + g.border / 2);
    // The caret's edge, found by walking out from its middle along a row partway up it: of the pixels it crosses on the
    // way out, the one furthest from the fill is the outline at its strongest, which is what the eye reads as its edge.
    const y = g.top - g.size * 0.2;
    const dist = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0);
    let edge = fill;
    for (let x = cx; x > cx - g.size; x -= 1 / scale) { const p = at(x, y); if (dist(p, fill) > dist(edge, fill)) edge = p; }
    const checks = [
      // Without this the rest could pass on a page with no panel drawn at all.
      ['the panel is drawn: its border is not its fill', !near(border, fill, 6), border, fill],
      ['the inside of the caret is the panel fill', near(inside, fill), inside, fill],
      ['no seam: the panel border is not drawn across the caret base', near(base, fill), base, fill],
      ['the caret is outlined in the panel border colour', near(edge, border, 24), edge, border],
    ];
    for (const [name, ok, got, want] of checks) {
      if (!ok) failed = true;
      console.log((ok ? 'OK   ' : 'FAIL ') + scheme + ': ' + name + ' (measured rgb ' + got.join(',') + ', panel ' + want.join(',') + ')');
    }
    await shot(win, 'caret-' + scheme);
  }
  console.log(failed ? 'PROOF FAILED' : 'PROOF OK');
  app.exit(failed ? 1 : 0);
});
