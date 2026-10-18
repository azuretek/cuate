// The load order proof on the desktop (issue 425): the real page in the Chromium the app ships, signed in through the
// load order fixture (core/test/load-order-fixture.js) to its stand-in server over the same emulated slow link the
// phone shells measure on, a conversation of synthetic photos opened at its newest message and then flung up through.
// It prints the measurement, keeps it and a capture under --shots, and fails when a picture off screen was asked for
// while one on screen was still waiting, or a fetch for a row flung past was still going when the view stopped.
// Synthetic records and pictures only: no server, token or account. Run it with a display:
//
//   xvfb-run -a ./desktop/node_modules/.bin/electron desktop/scripts/prove-load-order.mjs --shots <dir>
import { app, BrowserWindow, protocol } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const flag = process.argv.indexOf('--shots');
const output = flag > 0 ? path.resolve(process.argv[flag + 1]) : path.join(ROOT, 'desktop/out/load-order');
mkdirSync(output, { recursive: true });
// A profile of its own for every run, so the page boots with nothing stored and the fixture signs it in.
const profile = mkdtempSync(path.join(os.tmpdir(), 'prove-load-order-'));
app.setPath('userData', profile);
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

// The shell's bridge with nothing stored: the page boots to onboarding, as a fresh install does.
const BRIDGE = 'window.bridge = { call: async (name) => name === "app.info" ? ' + JSON.stringify({ platform: process.platform }) + ' : (name === "storage.get" ? undefined : false), on: () => () => {} };';

function serve(request) {
  const url = new URL(request.url);
  if (url.host !== 'bundle') return new Response('not found', { status: 404 });
  if (url.pathname === '/proof-bridge.js') return new Response(BRIDGE, { headers: { 'content-type': 'text/javascript' } });
  const file = path.resolve(ROOT, decodeURIComponent(url.pathname).replace(/^\/+/, ''));
  if (!file.startsWith(ROOT + path.sep) || !existsSync(file)) return new Response('not found', { status: 404 });
  let content = readFileSync(file);
  // The fixture is deferred, so it runs once the document is parsed and its body is there, as the phone shells run it.
  if (url.pathname === '/core/app/index.html') {
    content = content.toString().replace('<script type="module" src="main.js"></script>', '<script src="/proof-bridge.js"></script><script type="module" src="main.js"></script><script defer src="/core/test/load-order-fixture.js"></script>');
  }
  return new Response(content, { headers: { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' } });
}

let win;
const bound = setTimeout(() => { console.error('LOAD ORDER PROOF FAILED: exceeded its deadline'); app.exit(2); }, 240000);
const done = (code) => { if (win && !win.isDestroyed()) win.destroy(); rmSync(profile, { recursive: true, force: true }); clearTimeout(bound); app.exit(code); };

app.whenReady().then(async () => {
  protocol.handle('app', serve);
  win = new BrowserWindow({ show: true, width: 1000, height: 800, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  await win.loadURL('app://bundle/core/app/index.html');
  const deadline = Date.now() + 200000;
  let proof = null;
  while (!proof) {
    if (Date.now() > deadline) throw new Error('the load order fixture never measured');
    proof = await win.webContents.executeJavaScript('window.loadOrderProof || null');
    if (!proof) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (proof.error) throw new Error('the load order fixture failed: ' + proof.error);
  writeFileSync(path.join(output, 'load-order.png'), (await win.capturePage()).toPNG());
  const report = { platform: process.platform, ...proof };
  writeFileSync(path.join(output, 'load-order.json'), JSON.stringify(report, null, 2));
  console.log('LOAD ORDER PROOF ' + JSON.stringify(report));
  const problems = [];
  if (!proof.onScreen?.length) problems.push('no picture was on screen to measure');
  if (proof.offscreenBeforeOnscreen !== 0) problems.push('pictures off screen were asked for while one on screen was still waiting: ' + proof.offscreenBeforeOnscreenIds.join(', '));
  if (proof.fling?.allDrawn !== true) problems.push('the pictures where the fling stopped never all drew');
  if (proof.fling?.staleAtStop !== 0) problems.push('fetches for rows flung past were still going when the view stopped: ' + (proof.fling?.staleAtStopIds || []).join(', '));
  if (problems.length) throw new Error(problems.join('; '));
  done(0);
}).catch(async (error) => {
  console.error('LOAD ORDER PROOF FAILED: ' + error.message);
  if (win && !win.isDestroyed()) writeFileSync(path.join(output, 'failure.png'), (await win.capturePage()).toPNG());
  done(1);
});
