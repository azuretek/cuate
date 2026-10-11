// Motion comes from where a thing came from (issue 316). In the real conversation and viewer, in the Chromium the app
// uses, through the real stylesheets, it samples where each thing is drawn frame by frame: a message we send starts at
// the composer's field, a received one starts below its place and faded, another conversation starts faded and to
// the side, and the media viewer's picture starts over the preview it was opened from and ends at its own size.
// Run it with a display:
//
//   xvfb-run -a npx electron desktop/scripts/prove-motion.mjs
//
// With PROVE_OUT naming a folder, it also writes a picture mid-motion of each.
import { app, BrowserWindow, protocol } from 'electron';
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HARNESS = '/core/app/prove-motion.html';
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
  return page('<div class="pane" style="display: flex; flex-direction: column; height: 100vh"></div><div class="thumb" style="position: fixed; left: 24px; top: 420px; width: 120px; height: 90px; background: hsl(200 60% 50%)"></div><style>app-conversation { display: flex; flex-direction: column; flex: 1; min-height: 0; }</style>', `
import '/core/app/components/app-conversation.js';
import '/core/app/components/app-image-viewer.js';
import { mediaItems } from '/core/app/rules/media.js';
const t0 = Date.parse('2026-01-15T10:00:00.000Z');
const msg = (chat, i, text, o = {}) => ({ id: chat + '-' + String(i).padStart(4, '0'), chatId: chat, fromMe: i % 2 === 0, sender: i % 2 ? '+15555550100' : null, senderName: null, text, sentAt: new Date(t0 + i * 60000).toISOString(), replyTo: null, read: true, attachments: [], link: null, payloads: 0, reactions: [], ...o });
const chat = (id) => ({ id, name: 'Chat ' + id, isGroup: false, service: 'SMS', participants: ['+15555550100'], unread: 0 });
const el = document.createElement('app-conversation');
el.client = {}; el.sending = true; el.hasMore = false; el.chat = chat('A');
el.messages = [1, 2, 3, 4, 5].map((i) => msg('A', i, 'Message ' + i));
document.querySelector('.pane').append(el);
const rect = (e) => { const r = e.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height), opacity: Number(getComputedStyle(e).opacity) }; };
const frames = (get, ms) => new Promise((resolve) => { const out = []; const start = performance.now(); const tick = () => { const e = get(); if (e) out.push({ t: Math.round(performance.now() - start), ...rect(e) }); if (performance.now() - start < ms) requestAnimationFrame(tick); else resolve(out); }; requestAnimationFrame(tick); });
const bubbleOf = (id) => [...el.querySelectorAll('.bubble-row')].find((r) => r.dataset.id === id)?.querySelector('.bubble') || null;
window.field = () => rect(el.querySelector('app-composer textarea'));
window.send = async () => { const p = frames(() => bubbleOf('local:1'), 1000); el.messages = [...el.messages, msg('A', 6, 'On my way', { id: 'local:1', fromMe: true, sender: null, state: 'sending' })]; return p; };
window.receive = async () => { const p = frames(() => bubbleOf('A-0007'), 1000); el.messages = [...el.messages, msg('A', 7, 'See you soon')]; return p; };
window.switchTo = async () => { const p = frames(() => el.querySelector('.messages'), 700); el.chat = chat('B'); el.messages = [1, 2, 3].map((i) => msg('B', i, 'Other ' + i)); return p; };
window.view = async () => {
  const c = document.createElement('canvas'); c.width = 1200; c.height = 900; const g = c.getContext('2d'); g.fillStyle = 'hsl(30 70% 55%)'; g.fillRect(0, 0, 1200, 900);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const v = document.createElement('app-image-viewer');
  v.items = mediaItems([{ id: 'm1', attachments: [{ id: 'a1', name: 'photo.png', mime: 'image/png', missing: false }] }]); v.index = 0;
  v.client = { attachment: async () => blob }; v.from = document.querySelector('.thumb');
  const p = frames(() => { const i = v.querySelector('img.viewer-image'); return i && i.complete && i.naturalWidth ? i : null; }, 1200);
  document.body.append(v);
  window.viewer = v;
  return p;
};
window.closeViewer = async () => { const v = window.viewer; const i = v.querySelector('img.viewer-image'); const p = frames(() => (i.isConnected ? i : null), 700); let closed = false; v.addEventListener('close', () => { closed = true; v.remove(); }); v.close(); const out = await p; return { out, closed }; };
el.updateComplete.then(() => setTimeout(() => { window.probeReady = true; }, 300));
`);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  protocol.handle('prove', serve);
  let failed = false;
  const say = (ok, line) => { if (!ok) failed = true; console.log((ok ? 'OK   ' : 'FAIL ') + line); };
  const win = new BrowserWindow({ show: true, width: 420, height: 800, useContentSize: true, webPreferences: { contextIsolation: true, backgroundThrottling: false } });
  await open(win, '');
  const js = (s) => win.webContents.executeJavaScript(s);
  const brief = (f) => f.length ? { frames: f.length, first: f[0], last: f[f.length - 1] } : { frames: 0 };
  const field = await js('window.field()');
  const sent = brief(await js('window.send()'));
  await shot(win, 'motion-sent');
  say(sent.frames > 0 && sent.first.top > sent.last.top + 20 && Math.abs(sent.first.top - field.top) < field.height + 8 && sent.first.left < sent.last.left - 20, 'a sent message starts at the composer field ' + JSON.stringify(field) + ' and rises to its place: ' + JSON.stringify(sent));
  await wait(300);
  const got = brief(await js('window.receive()'));
  say(got.frames > 0 && got.first.top > got.last.top + 4 && got.first.opacity < 0.5 && got.last.opacity === 1, 'a received message starts below its place, faded, and slides up: ' + JSON.stringify(got));
  await wait(300);
  const sw = brief(await js('window.switchTo()'));
  say(sw.frames > 0 && sw.first.opacity < 0.5 && sw.first.left > sw.last.left && sw.last.opacity === 1, 'another conversation slides in from the side: ' + JSON.stringify(sw));
  await wait(300);
  const v = brief(await js('window.view()'));
  await shot(win, 'motion-viewer');
  say(v.frames > 0 && Math.abs(v.first.width - 120) < 40 && Math.abs(v.first.left - 24) < 40 && v.last.width > 300, 'the viewer grows out of the preview at left 24, 120 wide, to its own size: ' + JSON.stringify(v));
  const c = await js('window.closeViewer()');
  const cb = brief(c.out);
  say(c.closed && cb.frames > 1 && cb.last.width < cb.first.width / 2, 'and closing shrinks it back into the preview before it goes: ' + JSON.stringify({ closed: c.closed, ...cb }));
  console.log(failed ? 'PROOF FAILED' : 'PROOF OK');
  app.exit(failed ? 1 : 0);
});
