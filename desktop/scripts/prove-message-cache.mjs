// Issue 441's desktop proof: the device's message store measured in Electron's own web view, the same fixture the iOS
// and Android shells run (core/test/message-cache-fixture.js). Four launches over one profile, so a warm launch reads
// the store a cold one left: without the store (a web view with no IndexedDB, the page as it was before it) and with
// it, each cold and then warm. Each launch is a fresh window over the app's own scheme; the stand-in server and its
// emulated slow link are the fixture's. Synthetic records only. The report says what each launch cost.
// Run with: electron desktop/scripts/prove-message-cache.mjs [--out <dir>]
import { app, BrowserWindow, protocol } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outAt = process.argv.indexOf('--out');
const output = outAt > 0 ? process.argv[outAt + 1] : path.join(root, 'desktop/out/message-cache');
mkdirSync(output, { recursive: true });
const profile = mkdtempSync(path.join(os.tmpdir(), 'message-cache-proof-'));
app.setPath('userData', profile);
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const bound = setTimeout(() => { process.stderr.write('message cache proof exceeded its deadline\n'); app.exit(2); }, 300000);
const RUNS = [['off', 'cold'], ['off', 'warm'], ['on', 'cold'], ['on', 'warm']];

app.whenReady().then(async () => {
  let run = RUNS[0];
  protocol.handle('app', (request) => {
    try { return serve(request); } catch (error) {
      process.stderr.write('message cache proof: could not serve ' + request.url + ': ' + error.message + '\n');
      return new Response('error', { status: 500 });
    }
  });
  const serve = (request) => {
    const url = new URL(request.url);
    if (url.host !== 'bundle') return new Response('not found', { status: 404 });
    // The shell's bridge, holding no token, so the page boots to sign-in and the fixture signs it in.
    if (url.pathname === '/proof-bridge.js') return new Response('window.bridge = { call: async (name) => name === "app.info" ? ' + JSON.stringify({ platform: process.platform }) + ' : null, on: () => () => {} }; window.fixtureCacheMode = ' + JSON.stringify(run[0]) + '; window.fixtureCacheRun = ' + JSON.stringify(run[1]) + ';', { headers: { 'content-type': 'text/javascript' } });
    const file = path.resolve(root, decodeURIComponent(url.pathname).replace(/^\/+/, ''));
    if (!file.startsWith(root + path.sep) || !existsSync(file)) return new Response('not found', { status: 404 });
    let content = readFileSync(file);
    if (url.pathname === '/core/app/index.html') content = content.toString().replace('<script type="module" src="main.js"></script>', '<script src="/proof-bridge.js"></script><script type="module" src="main.js"></script><script defer src="/core/test/message-cache-fixture.js"></script>');
    return new Response(content, { headers: { 'content-type': mime[path.extname(file)] || 'application/octet-stream' } });
  };
  const results = [];
  for (const next of RUNS) {
    run = next;
    const win = new BrowserWindow({ show: true, width: 420, height: 860, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    win.webContents.on('did-fail-load', (_e, code, description, url, main) => process.stderr.write('message cache proof: load failed ' + JSON.stringify({ run, code, description, url, main }) + '\n'));
    win.webContents.on('render-process-gone', (_e, details) => process.stderr.write('message cache proof: renderer gone ' + JSON.stringify({ run, details }) + '\n'));
    await win.loadURL('app://bundle/core/app/index.html');
    let state = '';
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      state = String(await win.webContents.executeJavaScript('window.messageCacheState || ""'));
      if (state.startsWith('cache:result ') || state.startsWith('cache:fail')) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    writeFileSync(path.join(output, run.join('-') + '.png'), (await win.capturePage()).toPNG());
    win.destroy();
    assert.ok(state.startsWith('cache:result '), run.join(' ') + ': ' + (state || 'no answer'));
    const result = JSON.parse(state.slice('cache:result '.length));
    results.push(result);
    process.stdout.write('MESSAGE CACHE ' + JSON.stringify(result) + '\n');
  }
  const [offCold, offWarm, onCold, onWarm] = results;
  assert.equal(offCold.store || offWarm.store, false, 'with IndexedDB refused the page opens no store');
  assert.ok(onCold.store && onWarm.store, 'the desktop web view keeps the store');
  assert.equal(onWarm.pageReads, 0, 'a warm open reads no page of a conversation the store holds');
  assert.equal(onWarm.pictureReads, 0, 'nor any picture a tile drew before');
  assert.equal(onWarm.shownEdit, true, 'and still draws an edit made while it was closed');
  assert.ok(onWarm.bytes < offWarm.bytes / 4, 'a warm open costs a fraction of the bytes it did');
  assert.ok(onWarm.firstVisibleMs < offWarm.firstVisibleMs / 2, 'and draws its first message in a fraction of the time');
  writeFileSync(path.join(output, 'report.json'), JSON.stringify({ platform: process.platform, results }, null, 2));
  rmSync(profile, { recursive: true, force: true });
  clearTimeout(bound);
  app.exit(0);
}).catch((error) => {
  process.stderr.write('MESSAGE CACHE PROOF FAILED: ' + error.stack + '\n');
  rmSync(profile, { recursive: true, force: true });
  clearTimeout(bound);
  app.exit(1);
});
