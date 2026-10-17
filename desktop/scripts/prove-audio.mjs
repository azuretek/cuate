// Real Chromium, the real page and synthetic audio. No server, household database or account (issue 432).
// The audio fixture (core/test/audio-fixture.js) draws recordings in a conversation; this presses play with real mouse
// input at the play control's own middle, as a person would, and reads the page's report that the recording plays in
// its message: its time and elapsed clock move, its waveform fills and its mark goes, and pause holds it part way in.
// Run with: xvfb-run -a electron desktop/scripts/prove-audio.mjs
import { app, BrowserWindow, protocol } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

assert.ok(!app.commandLine.hasSwitch('no-sandbox') && !app.commandLine.hasSwitch('disable-setuid-sandbox') && !process.env.ELECTRON_DISABLE_SANDBOX, 'audio proof requires the Chromium sandbox');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = process.env.AUDIO_PROOF_OUT || path.join(root, 'desktop/out/audio');
mkdirSync(output, { recursive: true });
const profile = mkdtempSync(path.join(os.tmpdir(), 'audio-proof-'));
app.setPath('userData', profile);
// A window that is not on screen still plays: the proof never depends on a focused window or an audio device.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.m4a': 'audio/mp4', '.caf': 'audio/x-caf' };
const fixtures = new Set(['/audio-fixture.m4a', '/voice-fixture.caf']);
let win;
const bound = setTimeout(() => { console.error('audio proof exceeded its deadline'); app.exit(2); }, 120000);
const report = async () => win.webContents.executeJavaScript('window.audioFixtureState || null');
async function until(prefix, ms) {
  const deadline = Date.now() + ms;
  let state = null;
  while (Date.now() < deadline) {
    state = await report();
    if (state && state.startsWith('au:fail')) throw new Error('the audio fixture failed: ' + state);
    if (state && state.startsWith(prefix + ' ')) return { state, scene: JSON.parse(state.slice(state.indexOf(' ') + 1)) };
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('the audio fixture never reached ' + prefix + ': ' + state);
}
// A press at the middle of the named play control, as real mouse input to the page.
async function press(label) {
  const box = await win.webContents.executeJavaScript('(() => { const b = [...document.querySelectorAll(".voice-play")].find((x) => x.getAttribute("aria-label") === ' + JSON.stringify(label) + '); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()');
  assert.ok(box, label + ' is on the page');
  win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...box });
  win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...box });
}
const shot = async (name) => writeFileSync(path.join(output, name), (await win.capturePage()).toPNG());
app.whenReady().then(async () => {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    if (url.host !== 'bundle') return new Response('not found', { status: 404 });
    if (url.pathname === '/proof-bridge.js') return new Response('window.bridge = { call: async (name) => name === "app.info" ? ' + JSON.stringify({ platform: process.platform }) + ' : name === "storage.get" ? null : name === "storage.set", on: () => () => {} };', { headers: { 'content-type': 'text/javascript' } });
    const file = fixtures.has(url.pathname) ? path.join(root, 'core/test', url.pathname.slice(1)) : path.resolve(root, decodeURIComponent(url.pathname).replace(/^\/+/, ''));
    if (!file.startsWith(root + path.sep) || !existsSync(file)) return new Response('not found', { status: 404 });
    let content = readFileSync(file);
    if (url.pathname === '/core/app/index.html') content = content.toString().replace('<script type="module" src="main.js"></script>', '<script src="/proof-bridge.js"></script><script type="module" src="main.js"></script><script src="/core/test/audio-fixture.js"></script>');
    return new Response(content, { headers: { 'content-type': mime[path.extname(file)] || 'application/octet-stream' } });
  });
  win = new BrowserWindow({ show: true, width: 800, height: 900, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  await win.loadURL('app://bundle/core/app/index.html');
  const ready = await until('au:ready', 60000);
  const [theirs, mine] = ready.scene.players;
  assert.equal(theirs.unplayed, true, 'the recording someone else sent is marked not played');
  assert.equal(theirs.length, '0:04', 'it says how long it runs');
  assert.equal(mine.unplayed, false, 'ours is never marked');
  await shot('audio-ready.png');
  await press('Play ' + theirs.label.replace(/^Play /, ''));
  const playing = await until('au:playing', 30000);
  const first = playing.scene.players[0];
  assert.ok(first.currentTime >= 1 && first.elapsed !== '0:00', 'its time and elapsed clock moved');
  assert.ok(first.filled > 0, 'its waveform fills');
  assert.equal(first.unplayed, false, 'its mark is gone once played');
  await shot('audio-playing.png');
  await press('Pause ' + theirs.label.replace(/^Play /, ''));
  const paused = await until('au:paused', 10000);
  await shot('audio-paused.png');
  const result = { platform: process.platform, ready: ready.scene, playing: playing.scene, paused: paused.scene, passed: true };
  writeFileSync(path.join(output, 'report.json'), JSON.stringify(result, null, 2));
  console.log('AUDIO PROOF ' + JSON.stringify({ platform: result.platform, playing: first, paused: paused.scene.players[0] }));
  win.destroy(); rmSync(profile, { recursive: true, force: true });
  clearTimeout(bound); app.exit(0);
}).catch(async (error) => {
  console.error('AUDIO PROOF FAILED: ' + error.stack);
  if (win && !win.isDestroyed()) { writeFileSync(path.join(output, 'failure.png'), (await win.capturePage()).toPNG()); win.destroy(); }
  rmSync(profile, { recursive: true, force: true });
  clearTimeout(bound);
  app.exit(1);
});
