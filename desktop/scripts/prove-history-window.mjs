// Real Chromium, real app-root, real API and synthetic engine. No household database or account.
// Run with: xvfb-run -a electron desktop/scripts/prove-history-window.mjs
import { app, BrowserWindow, protocol } from 'electron';
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { boot } from '../../server/test/helpers.js';

assert.ok(!app.commandLine.hasSwitch('no-sandbox') && !app.commandLine.hasSwitch('disable-setuid-sandbox') && !process.env.ELECTRON_DISABLE_SANDBOX, 'history proof requires the Chromium sandbox');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = process.env.HISTORY_PROOF_OUT || path.join(root, 'desktop/out/history-window');
mkdirSync(output, { recursive: true });
const profile = mkdtempSync(path.join(os.tmpdir(), 'history-proof-'));
app.setPath('userData', profile);
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
let server;
let win;
const bound = setTimeout(() => { console.error('history proof exceeded its deadline'); app.exit(2); }, 180000);
app.whenReady().then(async () => {
  server = await boot();
  const photo = server.world.messages.flatMap((m) => m.attachments || []).find((a) => a.mime_type === 'image/png');
  assert.ok(photo);
  const video = path.join(server.root, 'synthetic.webm');
  const rows = Array.from({ length: 1000 }, (_, index) => {
    const id = index + 1;
    const media = id % 10 === 0;
    const moving = id % 20 === 0;
    const file = path.join(server.root, 'synthetic-' + id + (moving ? '.webm' : '.png'));
    if (media && !moving) copyFileSync(photo.original_path, file);
    return { id, guid: 'SYNTHETIC-' + id, chat_id: 1, created_at: '2026-01-01T00:00:00.000Z', is_from_me: false, sender: 'avery@example.com', text: 'Synthetic history message ' + id,
      attachments: media ? [{ ...photo, original_path: file, filename: file, transfer_name: 'synthetic-' + id, mime_type: moving ? 'video/webm' : 'image/png', total_bytes: photo.total_bytes }] : [] };
  });
  server.world.messages.splice(0, server.world.messages.length, ...rows);
  const storage = { 'server.url': server.base, 'server.token': server.tokens.device };
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    if (url.host !== 'bundle') return new Response('not found', { status: 404 });
    if (url.pathname === '/proof-bridge.js') return new Response('window.bridge = { call: async (name, args) => name === "storage.get" ? (' + JSON.stringify(storage) + ')[args.key] : name === "app.info" ? ' + JSON.stringify({ platform: process.platform }) + ' : false, on: () => () => {} };', { headers: { 'content-type': 'text/javascript' } });
    const file = path.resolve(root, decodeURIComponent(url.pathname).replace(/^\/+/, ''));
    if (!file.startsWith(root + path.sep) || !existsSync(file)) return new Response('not found', { status: 404 });
    let content = readFileSync(file);
    if (url.pathname === '/core/app/index.html') content = content.toString().replace('<script type="module" src="main.js"></script>', '<script src="/proof-bridge.js"></script><script type="module" src="main.js"></script><script type="module" src="/core/test/fixtures/history-proof.js"></script>');
    return new Response(content, { headers: { 'content-type': mime[path.extname(file)] || 'application/octet-stream' } });
  });
  win = new BrowserWindow({ show: true, width: 1000, height: 800, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  await win.loadURL('app://bundle/core/app/index.html');
  const bytes = await win.webContents.executeJavaScript('globalThis.historyProof.video()');
  writeFileSync(video, Buffer.from(bytes));
  for (const row of rows) for (const attachment of row.attachments) if (attachment.mime_type === 'video/webm') copyFileSync(video, attachment.original_path);
  const history = await win.webContents.executeJavaScript('globalThis.historyProof.history()');
  writeFileSync(path.join(output, 'scrollback.png'), (await win.capturePage()).toPNG());
  win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...history.click });
  win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...history.click });
  const media = [await win.webContents.executeJavaScript('globalThis.historyProof.media()')];
  const seen = new Set([media[0].id]);
  while (media.length < 60) {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
    const next = await win.webContents.executeJavaScript('globalThis.historyProof.changed(' + JSON.stringify(media.at(-1).id) + ')');
    assert.ok(!seen.has(next.id), 'each navigation reaches a distinct media item');
    seen.add(next.id); media.push(next);
  }
  assert.ok(media.some((entry) => entry.kind === 'video'));
  assert.ok(media.some((entry) => entry.kind === 'image'));
  assert.ok(Number(media.at(-1).messageId.split('-').at(-1)) > 500, 'viewer crosses beyond the resident message window');
  writeFileSync(path.join(output, 'media.png'), (await win.capturePage()).toPNG());
  const result = { history, media, passed: true };
  writeFileSync(path.join(output, 'report.json'), JSON.stringify(result, null, 2));
  console.log('HISTORY PROOF ' + JSON.stringify(result));
  win.destroy(); await server.close(); rmSync(profile, { recursive: true, force: true });
  clearTimeout(bound); app.exit(0);
}).catch(async (error) => {
  console.error('HISTORY PROOF FAILED: ' + error.stack);
  if (win && !win.isDestroyed()) { writeFileSync(path.join(output, 'failure.png'), (await win.capturePage()).toPNG()); win.destroy(); }
  if (server) await server.close();
  rmSync(profile, { recursive: true, force: true });
  clearTimeout(bound); app.exit(1);
});
