// The desktop boot smoke: a real server over the fake engine, the real desktop app against it, and captures of what
// it drew. It proves boot, the chat list, a conversation with a photo, a live incoming message over the event stream,
// a send, the settings page reading, writing and streaming a change, the about page, the phone layout with its
// edge drag (the settle threshold and the reduced-motion path included), and onboarding.
// Run it under a display (xvfb-run on Linux).
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = process.env.SHOTS || path.join(root, 'desktop', 'out', 'smoke');
mkdirSync(out, { recursive: true });
rmSync(path.join(out, 'report.json'), { force: true });
const packed = process.env.SMOKE_APP;
if (packed && !process.env.BUILD_VERSION) throw new Error('Packaged smoke requires BUILD_VERSION');
const data = mkdtempSync(path.join(os.tmpdir(), 'smoke-server-'));
const cli = path.join(root, 'server/src/main.js');
const run = (...args) => execFileSync(process.execPath, [cli, ...args, '--data', data], { encoding: 'utf8' });
const LIVE = 'A live message from the fake engine';
const SENT = 'Sent from the desktop smoke';

run('init', '--engine', 'fake', '--port', '0');
const token = run('token', 'create', '--scope', 'device', '--name', 'smoke').trim().split('\n').pop().trim();
run('sending', 'on');
const server = spawn(process.execPath, [cli, 'run', '--data', data], { env: { ...process.env, FAKE_LIVE: LIVE }, stdio: ['ignore', 'pipe', 'inherit'] });
const port = await new Promise((resolve, reject) => {
  let buf = '';
  const fail = (error) => { clearTimeout(t); server.kill('SIGTERM'); rmSync(data, { recursive: true, force: true }); reject(error); };
  const t = setTimeout(() => fail(new Error('the server did not become ready')), 20000);
  server.once('error', fail);
  server.stdout.on('data', (d) => {
    buf += d;
    for (const line of buf.split('\n')) {
      try {
        const j = JSON.parse(line);
        if (j.event === 'server.ready') { clearTimeout(t); resolve(j.port); }
      } catch { /* a partial line */ }
    }
  });
  server.on('exit', (code) => { clearTimeout(t); reject(new Error('the server exited with ' + code)); });
});

const electron = packed || createRequire(path.join(root, 'desktop', 'package.json'))('electron');
const env = { ...process.env, SMOKE_OUT: out, SMOKE_SERVER_URL: 'http://127.0.0.1:' + port, SMOKE_TOKEN: token, SMOKE_LIVE_TEXT: LIVE, SMOKE_SEND_TEXT: SENT };
const appProc = spawn(electron, packed ? [] : [path.join(root, 'desktop')], { env, stdio: ['ignore', 'pipe', 'inherit'] });
let report = null;
let output = '';
appProc.stdout.on('data', (d) => {
  output += String(d);
  const m = /SMOKE (\{.*\})/.exec(output);
  if (m) report = JSON.parse(m[1]);
  process.stdout.write(d);
});
const killer = setTimeout(() => appProc.kill('SIGKILL'), 120000);
const code = await new Promise((resolve) => { appProc.on('exit', resolve); appProc.on('error', (error) => { console.error(error.message); resolve(-1); }); });
try { report = JSON.parse(readFileSync(path.join(out, 'report.json'), 'utf8')); } catch { /* absence fails below */ }
clearTimeout(killer);
await new Promise((resolve) => {
  server.once('close', resolve);
  server.kill('SIGTERM');
});
rmSync(data, { recursive: true, force: true });
rmSync(path.join(out, 'user-data'), { recursive: true, force: true });
const ok = code === 0 && report && (!packed || (report.packaged && report.info.version === process.env.BUILD_VERSION)) && report.chats >= 3 && report.bubbles > 0 && report.images > 0 && report.header && report.live && report.sent && report.settings && report.theme && report.about && report.phone && report.phoneDrawer && report.phoneFits && report.phoneComposer && report.phoneEdgeOnly && report.phoneSettle && report.phoneTracks && report.phoneEdgeDrag && report.phoneReduced && report.onboarding;
if (!ok) {
  console.error('smoke failed: exit ' + code + ', report ' + JSON.stringify(report));
  process.exit(1);
}
console.log('smoke ok: ' + JSON.stringify(report) + '; captures in ' + out);
