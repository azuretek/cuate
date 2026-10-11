// Links in a message: a web address in a message's text is a link, a click on it asks the shell to open it in the
// browser (and the app never navigates), and a long click on it opens the message menu, whose Copy link puts that very
// address on the system clipboard. The real conversation runs in the Chromium the app uses, through the real
// stylesheets, over synthetic messages; the clipboard is read back from Electron's own.
// Run it with a display:
//
//   xvfb-run -a npx electron desktop/scripts/prove-message-links.mjs
//
// With PROVE_OUT naming a folder, it also writes the pictures it measured.
import { app, BrowserWindow, protocol, clipboard } from 'electron';
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HARNESS = '/core/app/prove-message-links.html';
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
  return page('<div class="pane" style="display: flex; flex-direction: column; height: 100vh"></div><style>app-conversation { display: flex; flex-direction: column; flex: 1; min-height: 0; }</style>', `
import '/core/app/components/app-conversation.js';
const t0 = Date.parse('2026-01-15T10:00:00.000Z');
const msg = (i, text, o = {}) => ({ id: 'FAKE-' + String(i).padStart(4, '0'), chatId: 'A', fromMe: i % 2 === 0, sender: i % 2 ? '+15555550100' : null, senderName: null, text, sentAt: new Date(t0 + i * 60000).toISOString(), replyTo: null, read: true, attachments: [], link: null, payloads: 0, reactions: [], ...o });
const el = document.createElement('app-conversation');
el.client = {}; el.sending = true; el.hasMore = false;
el.chat = { id: 'A', name: 'Chat A', isGroup: false, service: 'SMS', participants: ['+15555550100'], unread: 0 };
el.messages = [msg(1, 'Hi there'), msg(2, 'The plan is at https://example.com/plan?week=2 and the map at www.example.org/map.'), msg(3, 'Thanks')];
window.opened = [];
el.addEventListener('open-external', (e) => window.opened.push(e.detail.url));
document.querySelector('.pane').append(el);
const link = (i) => [...el.querySelectorAll('.bubble-row')].find((r) => r.dataset.id === 'FAKE-0002')?.querySelectorAll('.bubble a.message-link')[i] || null;
window.linkBox = (i) => { const a = link(i); if (!a) return null; a.scrollIntoView({ block: 'center' }); const r = a.getClientRects()[0]; return { x: Math.round(r.left + Math.min(r.width / 2, 30)), y: Math.round(r.top + r.height / 2), text: a.textContent, href: a.getAttribute('href') }; };
window.bubbleText = () => [...el.querySelectorAll('.bubble-row')].find((r) => r.dataset.id === 'FAKE-0002')?.querySelector('.bubble')?.textContent || '';
window.menu = () => { const b = el.querySelector('.message-menu button[aria-label="Copy link"]'); return { open: Boolean(el.querySelector('.message-menu')), copy: b ? b.dataset.link : null }; };
window.copy = () => { el.querySelector('.message-menu button[aria-label="Copy link"]').click(); };
window.note = () => el.querySelector('.message-note')?.textContent || '';
window.where = () => location.href;
el.updateComplete.then(() => setTimeout(() => { window.probeReady = true; }, 300));
`);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  protocol.handle('prove', serve);
  let failed = false;
  const say = (ok, line) => { if (!ok) failed = true; console.log((ok ? 'OK   ' : 'FAIL ') + line); };
  const win = new BrowserWindow({ show: true, width: 900, height: 700, webPreferences: { contextIsolation: true, backgroundThrottling: false } });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  await open(win, '');
  const js = (s) => win.webContents.executeJavaScript(s);
  const mouse = async (type, x, y, extra = {}) => win.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1, ...extra });
  const start = await js('location.href');
  const box = await js('window.linkBox(0)');
  const box2 = await js('window.linkBox(1)');
  await shot(win, 'links-drawn');
  say(Boolean(box) && box.href === 'https://example.com/plan?week=2', 'the address in the message is a link: ' + JSON.stringify(box) + ' (text: ' + JSON.stringify(await js('window.bubbleText()')) + ')');
  say(Boolean(box2) && box2.href === 'https://www.example.org/map' && box2.text === 'www.example.org/map', 'a www. address is a link to https, without the full stop after it: ' + JSON.stringify(box2));
  if (box) {
    await mouse('mouseDown', box.x, box.y); await wait(60); await mouse('mouseUp', box.x, box.y); await wait(400);
    const opened = await js('window.opened');
    say(JSON.stringify(opened) === JSON.stringify(['https://example.com/plan?week=2']), 'a click asks the shell to open it in the browser: ' + JSON.stringify(opened));
    say((await js('location.href')) === start && !(await js('window.menu()')).open, 'the app did not navigate, and no menu opened');
    // Electron 44's clipboard answers with promises, so each call is awaited.
    await clipboard.writeText('before');
    await mouse('mouseDown', box2.x, box2.y); await wait(800); await mouse('mouseUp', box2.x, box2.y); await wait(400);
    const m = await js('window.menu()');
    await shot(win, 'links-menu');
    say(m.open && m.copy === 'https://www.example.org/map', 'a long click on a link opens the menu with Copy link for that link: ' + JSON.stringify(m));
    say(JSON.stringify(await js('window.opened')) === JSON.stringify(['https://example.com/plan?week=2']), 'the long click did not open the link');
    if (m.copy) {
      await js('window.copy()'); await wait(400);
      await shot(win, 'links-copied');
      const got = await clipboard.readText();
      say(got === 'https://www.example.org/map', 'Copy link put the address on the system clipboard: ' + JSON.stringify(got));
      say((await js('window.note()')) === 'Link copied', 'and says so under the message: ' + JSON.stringify(await js('window.note()')));
    }
  }
  console.log(failed ? 'PROOF FAILED' : 'PROOF OK');
  app.exit(failed ? 1 : 0);
});
