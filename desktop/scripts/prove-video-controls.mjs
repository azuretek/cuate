// A video in the viewer reaches the accessibility tree with every one of its player's controls, in the Chromium the
// desktop app uses (issue 446). The real viewer and the real media rules run over a stand-in client that holds the
// synthetic clip (core/test/video-controls-portrait.mp4 or -landscape.mp4) until the probe has read the tree with the
// empty video in it, as a server's answer arrives after the viewer has drawn the video. Then the clip is handed over and
// the probe asserts, from the tree Chromium builds for assistive tech: the video is not "Unable to play media", each of
// the player's controls (play or pause, the scrubber, mute, full screen) is in it, a press at each one's middle reaches
// the player, and none of the viewer's own controls covers one. Every wait is for a state the page reports.
// Run it with a display:
//
//   xvfb-run -a npx electron desktop/scripts/prove-video-controls.mjs
//
// With PROVE_OUT naming a folder, it also writes what it saw.
import { app, BrowserWindow, protocol } from 'electron';
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HARNESS = '/core/app/prove-video-controls.html';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.mp4': 'video/mp4' };

app.setPath('userData', mkdtempSync(path.join(os.tmpdir(), 'prove-')));
// The tree assistive tech reads is built only while something asks for it, as a screen reader does.
app.commandLine.appendSwitch('force-renderer-accessibility');

protocol.registerSchemesAsPrivileged([{ scheme: 'prove', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

function serve(req) {
  const url = new URL(req.url);
  if (url.host !== 'bundle') return new Response('not found', { status: 404 });
  if (url.pathname === HARNESS) return new Response(harness(url.searchParams.get('shape')), { headers: { 'content-type': 'text/html' } });
  const file = path.resolve(ROOT, decodeURIComponent(url.pathname).replace(/^\/+/, ''));
  if (!file.startsWith(ROOT + path.sep) || !existsSync(file)) return new Response('not found', { status: 404 });
  return new Response(readFileSync(file), { headers: { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' } });
}

const stop = (why) => { console.log('PROOF ERROR ' + why); app.exit(2); };
process.on('unhandledRejection', (e) => stop(e && e.stack ? e.stack : String(e)));
setTimeout(() => stop('the probe did not finish in time'), 180000).unref();

function harness(shape) {
  const clip = JSON.stringify('/core/test/video-controls-' + (shape === 'landscape' ? 'landscape' : 'portrait') + '.mp4');
  return '<!doctype html><html><head><meta charset="utf-8">'
    + '<link rel="stylesheet" href="/core/app/styles/tokens.css"><link rel="stylesheet" href="/core/app/styles/roles.css"><link rel="stylesheet" href="/core/app/styles/app.css">'
    + '</head><body><script type="module">' + `
import { mediaItems } from '/core/app/rules/media.js';
import '/core/app/components/app-image-viewer.js';
let release;
const released = new Promise((resolve) => { release = resolve; });
const client = { attachment: async () => { await released; const r = await fetch(${clip}); return new Blob([await r.arrayBuffer()], { type: 'video/mp4' }); } };
const attachments = [1, 2, 3].map((n) => ({ id: 'v' + n, name: 'clip-' + n + '.mp4', mime: 'video/mp4', missing: false }));
const el = document.createElement('app-image-viewer');
el.items = mediaItems([{ id: 'm1', attachments }]);
el.index = 1;
el.client = client;
document.body.append(el);
const video = () => el.querySelector('video.viewer-image');
const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
// Each answers once the state it names holds, from the page's own events.
window.held = async () => { await el.updateComplete; await frames(); const v = video(); return { drawn: Boolean(v), ready: v ? v.readyState : null, controls: v ? v.hasAttribute('controls') : null }; };
window.release = async () => {
  const v = video();
  const loaded = new Promise((r) => v.addEventListener('loadeddata', r, { once: true }));
  release();
  await loaded;
  await el.updateComplete;
  v.pause();
  if (Math.abs(v.currentTime - 1) > 0.05) { const seeked = new Promise((r) => v.addEventListener('seeked', r, { once: true })); v.currentTime = 1; await seeked; }
  await frames();
  return { ready: v.readyState, controls: v.hasAttribute('controls'), paused: v.paused, t: Math.round(v.currentTime * 100) / 100 };
};
window.hit = (x, y) => { const e = document.elementFromPoint(x, y); if (!e) return 'nothing'; if (e.matches('video.viewer-image')) return 'video'; for (const [n, s] of [['close', '.close-button'], ['prev', '.viewer-prev'], ['next', '.viewer-next'], ['bar', '.viewer-bar']]) if (e.closest(s)) return n; return e.tagName.toLowerCase(); };
window.ours = () => Object.fromEntries([['close', '.close-button'], ['prev', '.viewer-prev'], ['next', '.viewer-next'], ['bar', '.viewer-bar'], ['video', 'video.viewer-image']].map(([n, s]) => { const r = el.querySelector(s)?.getBoundingClientRect(); return [n, r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null]; }));
window.probeReady = true;
` + '</script></body></html>';
}

const PLAYER = { 'play or pause': (n) => /^(play|pause)$/i.test(n), scrubber: (n, role) => role === 'slider' && /scrubber|time/i.test(n), mute: (n) => /^(mute|unmute)$/i.test(n), 'full screen': (n) => /full ?screen/i.test(n) };
const overlaps = (a, b) => a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

async function check(win, shape, say) {
  await win.loadURL('prove://bundle' + HARNESS + '?shape=' + shape).catch(() => {});
  const js = (s) => win.webContents.executeJavaScript(s);
  if (!(await js('new Promise((r) => { const t = () => window.probeReady ? r(true) : requestAnimationFrame(t); t(); })'))) stop('the page never became ready');
  const cdp = win.webContents.debugger;
  if (!cdp.isAttached()) cdp.attach('1.3');
  await cdp.sendCommand('Accessibility.enable');
  await cdp.sendCommand('DOM.enable');
  const tree = async () => (await cdp.sendCommand('Accessibility.getFullAXTree')).nodes.filter((n) => !n.ignored);
  const name = (n) => String(n.name?.value || '');
  const role = (n) => String(n.role?.value || '');

  const held = await js('window.held()');
  const before = await tree();
  const videoBefore = before.find((n) => role(n) === 'Video' || /unable to play media/i.test(name(n)));
  console.log('     ' + shape + ' held: ' + JSON.stringify(held) + ', the video in the tree: ' + (videoBefore ? role(videoBefore) + ' "' + name(videoBefore) + '"' : 'none'));
  say(held.drawn && held.ready === 0, shape + ': the video is drawn, empty, before its clip arrives: ' + JSON.stringify(held));

  const loaded = await js('window.release()');
  say(loaded.ready >= 2 && loaded.controls, shape + ': once its clip has a frame the video carries the player\'s controls: ' + JSON.stringify(loaded));
  // Read until every player control is in the tree, re-reading on each tree change the page reports, to a bound.
  let nodes = await tree();
  const found = () => Object.fromEntries(Object.entries(PLAYER).map(([k, f]) => [k, nodes.find((n) => f(name(n), role(n)))]));
  const deadline = Date.now() + 15000;
  while (Object.values(found()).some((n) => !n) && Date.now() < deadline) {
    await new Promise((r) => { const t = setTimeout(r, 1000); cdp.once('message', () => { clearTimeout(t); r(); }); });
    nodes = await tree();
  }
  const unplayable = nodes.find((n) => /unable to play media/i.test(name(n)));
  say(!unplayable, shape + ': the tree never calls the loaded video unplayable' + (unplayable ? ': ' + role(unplayable) + ' "' + name(unplayable) + '"' : ''));
  const ours = await js('window.ours()');
  for (const [k, n] of Object.entries(found())) {
    if (!n) { say(false, shape + ': ' + k + ' is in the tree'); continue; }
    const box = await cdp.sendCommand('DOM.getBoxModel', { backendNodeId: n.backendDOMNodeId }).catch(() => null);
    const q = box && box.model.border;
    const r = q ? { x: q[0], y: q[1], w: q[2] - q[0], h: q[5] - q[1] } : null;
    const hit = r ? await js('window.hit(' + (r.x + r.w / 2) + ', ' + (r.y + r.h / 2) + ')') : 'no box';
    const covered = Object.entries(ours).filter(([o, b]) => o !== 'video' && overlaps(b, r)).map(([o]) => o);
    say(Boolean(r) && r.w > 0 && r.h > 0 && hit === 'video' && covered.length === 0, shape + ': ' + k + ' "' + name(n) + '" at ' + JSON.stringify(r) + ' is pressed at its middle (' + hit + ')' + (covered.length ? ', covered by ' + covered.join(', ') : ', and none of ours covers it'));
  }
  for (const o of ['close', 'prev', 'next', 'bar']) say(!overlaps(ours[o], ours.video), shape + ': ' + o + ' is clear of the video: ' + JSON.stringify(ours[o]));
  if (process.env.PROVE_OUT) {
    writeFileSync(path.join(process.env.PROVE_OUT, 'video-controls-' + shape + '.png'), (await win.webContents.capturePage()).toPNG());
    writeFileSync(path.join(process.env.PROVE_OUT, 'video-controls-' + shape + '-tree.json'), JSON.stringify(nodes.map((n) => ({ role: role(n), name: name(n) })), null, 1));
  }
  cdp.detach();
}

app.whenReady().then(async () => {
  protocol.handle('prove', serve);
  let failed = false;
  const say = (ok, line) => { if (!ok) failed = true; console.log((ok ? 'OK   ' : 'FAIL ') + line); };
  const win = new BrowserWindow({ show: true, width: 400, height: 760, webPreferences: { contextIsolation: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' } });
  for (const shape of ['portrait', 'landscape']) await check(win, shape, say);
  console.log(failed ? 'PROOF FAILED' : 'PROOF OK');
  app.exit(failed ? 1 : 0);
});
