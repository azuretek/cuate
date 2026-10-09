// Where a conversation stays through what happens to it: a refetch of the open conversation, a switch to another and
// back, a live message, a picture loading, and older messages loading above. It mounts the real conversation component
// in the real Chromium the app uses, through the real stylesheets, over two long synthetic conversations whose pictures
// arrive late and at their own sizes, as they do from a server, and measures the view after every step: how far it sits
// from its end, and which message is at its top. Every step states where the person should still be, and the run fails
// when the view moved. Run it with a display:
//
//   xvfb-run -a npx electron desktop/scripts/prove-scroll-place.mjs
import { app, BrowserWindow, protocol } from 'electron';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HARNESS = '/core/app/prove-scroll-place.html';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

// A profile of its own for every run: a zoom or any other setting one probe leaves behind never reaches the next.
app.setPath('userData', mkdtempSync(path.join(os.tmpdir(), 'prove-')));

protocol.registerSchemesAsPrivileged([{ scheme: 'prove', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

function serve(req) {
  const url = new URL(req.url);
  if (url.host !== 'bundle') return new Response('not found', { status: 404 });
  if (url.pathname === HARNESS) return new Response(harness(), { headers: { 'content-type': 'text/html' } });
  const file = path.resolve(ROOT, decodeURIComponent(url.pathname).replace(/^\/+/, ''));
  if (!file.startsWith(ROOT + path.sep) || !existsSync(file)) return new Response('not found', { status: 404 });
  return new Response(readFileSync(file), { headers: { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' } });
}

// The page: the conversation component in the pane the app gives it, a client whose pictures arrive late and at their
// own sizes, and the steps the probe drives, exposed on window.probe.
function harness() {
  return '<!doctype html><html><head><meta charset="utf-8">'
    + '<link rel="stylesheet" href="/core/app/styles/tokens.css">'
  + '<link rel="stylesheet" href="/core/app/styles/roles.css">'
    + '<link rel="stylesheet" href="/core/app/styles/app.css">'
    + '<style>html, body { height: 100%; } .pane { display: flex; flex-direction: column; height: 100%; } app-conversation { display: flex; flex-direction: column; flex: 1; min-height: 0; }</style>'
    + '</head><body><div class="pane"></div>'
    + '<script type="module">' + PAGE + '</script></body></html>';
}

const PAGE = `
import '/core/app/components/app-conversation.js';
const sizes = new Map();
const picture = (id) => {
  if (!sizes.has(id)) { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; sizes.set(id, [240 + (h % 160), 160 + ((h >> 8) % 220)]); }
  const [w, h] = sizes.get(id);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.fillStyle = 'hsl(' + (w * 7 % 360) + ' 60% 50%)'; g.fillRect(0, 0, w, h);
  return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
};
const client = {
  async attachment(id) { await new Promise((r) => setTimeout(r, 40 + (id.length * 37) % 260)); return picture(id); },
};
const chat = (id, name) => ({ id, name, isGroup: false, service: 'SMS', participants: ['+15555550100'], unread: 0 });
const t0 = Date.parse('2026-01-15T10:00:00.000Z');
const message = (chatId, i) => ({
  id: chatId + '-' + String(i).padStart(4, '0'), chatId, fromMe: i % 3 === 0, sender: i % 3 === 0 ? null : '+15555550100', senderName: null,
  text: i % 7 === 0 ? '' : 'Message ' + i + ' in ' + chatId + (i % 5 === 0 ? '. A longer line that wraps across the bubble so rows are not all one height, as a real conversation is.' : ''),
  sentAt: new Date(t0 + i * 60000).toISOString(), replyTo: null, read: true,
  attachments: i % 7 === 0 ? [{ id: 'att-' + chatId + '-' + i, name: 'photo-' + i + '.png', mime: 'image/png', bytes: 1000, sticker: false, missing: false }] : [],
  link: null, payloads: 0, reactions: [],
});
const held = {};
const page = (chatId, from, to) => { const out = []; for (let i = from; i < to; i += 1) out.push(message(chatId, i)); return out; };
const copy = (list) => list.map((m) => ({ ...m, attachments: m.attachments.map((a) => ({ ...a })), reactions: [...m.reactions] }));
const el = document.createElement('app-conversation');
el.client = client; el.sending = true; el.hasMore = false; el.chat = chat('A', 'Chat A'); el.messages = [];
// The page's answer to a request for older messages: the next page lands above, as app-root's loadOlder does.
let autoLoaded = false;
el.addEventListener('older', () => { if (el.chat.id !== 'A' || autoLoaded) return; autoLoaded = true; held.A = [...page('A', 50, 100), ...held.A]; el.messages = held.A; el.hasMore = false; });
document.querySelector('.pane').append(el);
const view = () => el.querySelector('.messages');
// Settled: every picture in view has landed or failed and the view's height has held still for a while, through real
// frames (the window is shown, so layout, resize observers and frames all run as they do for a person).
const settle = async () => {
  let last = -1; let still = 0;
  for (let i = 0; i < 400 && still < 12; i += 1) {
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 20)));
    const h = view() ? view().scrollHeight : 0;
    still = h === last ? still + 1 : 0;
    last = h;
  }
  await el.updateComplete;
};
const topId = () => { const v = view(); const top = v.getBoundingClientRect().top; const row = [...v.querySelectorAll('.bubble-row')].find((r) => r.getBoundingClientRect().bottom > top + 1); return row ? row.dataset.id : null; };
const where = () => { const v = view(); return { fromEnd: Math.round(v.scrollHeight - v.scrollTop - v.clientHeight), top: topId(), scrollTop: Math.round(v.scrollTop), scrollHeight: v.scrollHeight, placeholders: v.querySelectorAll('.attachment-image.placeholder').length, anchor: JSON.stringify(el.keep && el.keep.anchor) }; };

held.A = page('A', 100, 200); held.B = page('B', 100, 200);
const show = async (id, list) => { el.chat = chat(id, 'Chat ' + id); el.messages = list; await settle(); };
// The person scrolls: their wheel, then the view moving and the scroll event it raises, as a finger or a trackpad does.
const scrollTo = async (top) => { const v = view(); v.dispatchEvent(new WheelEvent('wheel', { deltaY: top < v.scrollTop ? -120 : 120 })); v.scrollTop = top; v.dispatchEvent(new Event('scroll')); await settle(); };
window.probe = {
  async run() {
    const steps = [];
    const step = (name, expect, extra = {}) => { const w = where(); steps.push({ name, expect, ...w, ...extra }); return w; };
    el.hasMore = true;
    await show('A', held.A);
    step('A opened for the first time', 'end');
    await show('A', copy(held.A));
    step('A refetched in place while at its end', 'end');
    await show('B', held.B);
    step('B opened for the first time', 'end');
    await show('A', held.A);
    step('back to A, which was left at its end', 'end');
    await show('A', copy(held.A));
    step('A refetched after coming back', 'end');
    const live = message('A', 200);
    held.A = [...held.A, live];
    await show('A', held.A);
    step('a live message while at the end', 'end');
    await scrollTo(Math.round(view().scrollHeight * 0.4));
    const mid = step('the person scrolls A to the middle', 'here');
    await show('A', copy(held.A));
    step('A refetched while in the middle', mid.top);
    await show('B', held.B);
    step('B again, left at its end', 'end');
    await show('A', held.A);
    step('back to A, which was left in the middle', mid.top);
    await scrollTo(Math.min(view().scrollTop, Math.round(view().clientHeight * 0.5)));
    const top = step('the person scrolls A up near its top', 'here');
    const auto = autoLoaded;
    // Without loading as the person scrolls, the button does it: the same page lands above the same way.
    if (!autoLoaded) { autoLoaded = true; held.A = [...page('A', 50, 100), ...held.A]; await show('A', held.A); }
    await settle();
    step('older messages land above while the person is near the top', top.top, { loadedAsScrolled: auto });
    return steps;
  },
};
window.probeReady = true;
`;

// A probe that cannot run says why and stops, rather than hanging until its bound kills it.
const stop = (why) => { console.log('PROOF ERROR ' + why); app.exit(2); };
process.on('unhandledRejection', (e) => stop(e && e.stack ? e.stack : String(e)));
setTimeout(() => stop('the probe did not finish in time'), 240000).unref();

// The run waits for the app inside its ready handler rather than at the top level: an ES module entry that awaits
// ready at its top level holds the very load that ready waits for, so the window never opens.
app.whenReady().then(async () => {
  protocol.handle('prove', serve);
  let failed = false;
  const results = {};
  // One window for both widths, resized and reloaded between them.
  const win = new BrowserWindow({ show: true, width: 900, height: 760, webPreferences: { contextIsolation: true, backgroundThrottling: false } });
  win.webContents.on('console-message', (e) => { const m = e.message || ''; if (e.level === 'error' || /error/i.test(m)) console.log('PAGE ' + m); });
  for (const [label, width, height] of [['desktop', 900, 760], ['phone', 390, 800]]) {
    win.setContentSize(width, height);
    // A custom scheme can report its load stopped while the page's own modules are still arriving; whether the page is
    // ready is what the probe waits on, so the load's own answer is not.
    await win.loadURL('prove://bundle' + HARNESS + '?w=' + width).catch(() => {});
    for (let i = 0; i < 200 && !(await win.webContents.executeJavaScript('Boolean(window.probeReady)')); i += 1) await new Promise((r) => setTimeout(r, 50));
    if (!(await win.webContents.executeJavaScript('Boolean(window.probeReady)'))) stop('the page never became ready');
    console.log('running ' + label);
    const steps = await win.webContents.executeJavaScript('window.probe.run()');
    results[label] = steps;
    for (const s of steps) {
      const ok = s.expect === 'here' ? true : s.expect === 'end' ? s.fromEnd <= 1 : s.top === s.expect;
      if (!ok) failed = true;
      console.log((ok ? 'OK   ' : 'FAIL ') + label + ': ' + s.name + ': ' + (s.expect === 'end' ? 'at the end' : s.expect === 'here' ? 'now at ' + s.top : 'should be at ' + s.expect) + '; measured ' + s.fromEnd + 'px from the end, ' + s.top + ' at the top (scrollTop ' + s.scrollTop + ' of ' + s.scrollHeight + ')');
    }
  }
  win.destroy();
  console.log('RESULT ' + JSON.stringify(results));
  console.log(failed ? 'PROOF FAILED' : 'PROOF OK');
  app.exit(failed ? 1 : 0);
});
