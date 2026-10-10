// A Live Photo in the viewer: it opens on its still, offers its motion on a play control, plays it, and comes back to
// the still when it ends. The real viewer and the real media rules run in the Chromium the app uses, over a stand-in
// client that answers as the server does: the still, and for the live part the motion file named by PROVE_MOTION
// (an HEVC QuickTime file as an iPhone writes it, or the H.264 MP4 the server now converts it to). The files come from
// PROVE_FIX, a folder of synthetic fixtures.
// Run it with a display:
//
//   PROVE_FIX=/tmp/fix PROVE_MOTION=motion.mp4 xvfb-run -a npx electron desktop/scripts/prove-live-viewer.mjs
//
// With PROVE_OUT naming a folder, it also writes the pictures it measured.
import { app, BrowserWindow, protocol } from 'electron';
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HARNESS = '/core/app/prove-live-viewer.html';
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
  const motion = JSON.stringify(process.env.PROVE_MOTION || 'motion.mp4');
  return page('', `
import { mediaItems } from '/core/app/rules/media.js';
import '/core/app/components/app-image-viewer.js';
const get = async (name) => { const r = await fetch('/fixture/' + name); if (!r.ok) throw new Error(name + ' ' + r.status); return r.blob(); };
const client = { attachment: (id, o = {}) => get(o.part === 'live' ? ${motion} : 'still.png') };
const items = mediaItems([{ id: 'm1', attachments: [{ id: 'a1', name: 'IMG_0001.HEIC', mime: 'image/png', missing: false, live: true }] }]);
const el = document.createElement('app-image-viewer');
el.items = items; el.index = 0; el.client = client;
document.body.append(el);
window.state = () => {
  const img = el.querySelector('img.viewer-image'); const v = el.querySelector('video.viewer-image'); const play = el.querySelector('.viewer-play');
  return { img: img ? { loaded: img.complete && img.naturalWidth > 0, w: img.naturalWidth } : null, video: v ? { ready: v.readyState, t: Math.round(v.currentTime * 100) / 100, error: v.error ? v.error.code : null, paused: v.paused } : null, play: play ? { label: play.getAttribute('aria-label'), pressed: play.getAttribute('aria-pressed'), disabled: play.disabled } : null };
};
window.press = () => el.querySelector('.viewer-play')?.click();
el.updateComplete.then(() => { window.probeReady = true; });
`);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  protocol.handle('prove', serve);
  let failed = false;
  const say = (ok, line) => { if (!ok) failed = true; console.log((ok ? 'OK   ' : 'FAIL ') + line); };
  const win = new BrowserWindow({ show: true, width: 900, height: 700, webPreferences: { contextIsolation: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' } });
  await open(win, '');
  const state = () => win.webContents.executeJavaScript('window.state()');
  let s = null;
  for (let i = 0; i < 60; i += 1) { s = await state(); if ((s.img && s.img.loaded) || (s.video && (s.video.ready >= 2 || s.video.error))) break; await wait(100); }
  await shot(win, 'live-opened');
  say(Boolean(s.img && s.img.loaded) && !s.video, 'it opens on the still: ' + JSON.stringify(s));
  say(Boolean(s.play) && !s.play.disabled, 'a play control is offered: ' + JSON.stringify(s.play));
  if (s.play) {
    await win.webContents.executeJavaScript('window.press()');
    let p = null;
    for (let i = 0; i < 60; i += 1) { p = await state(); if (p.video && (p.video.t > 0.3 || p.video.error)) break; await wait(100); }
    await shot(win, 'live-playing');
    say(Boolean(p.video) && p.video.error === null && p.video.t > 0.3, 'its motion plays: ' + JSON.stringify(p));
    let e = null;
    for (let i = 0; i < 60; i += 1) { e = await state(); if (e.img && !e.video) break; await wait(100); }
    say(Boolean(e.img) && !e.video, 'the still is back when the motion ends: ' + JSON.stringify(e));
  } else if (s.video) {
    console.log('     (the viewer drew the motion instead: error code ' + s.video.error + ', ready state ' + s.video.ready + ')');
  }
  console.log(failed ? 'PROOF FAILED' : 'PROOF OK');
  app.exit(failed ? 1 : 0);
});
