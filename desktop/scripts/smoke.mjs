// The desktop boot smoke: a real server over the fake engine, the real desktop app against it, and captures of what
// it drew. It proves boot, the chat list, a conversation with a photo, a live incoming message over the event stream,
// a send, and onboarding. Run it under a display (xvfb-run on Linux).
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = process.env.SHOTS || path.join(root, 'desktop', 'out', 'smoke');
mkdirSync(out, { recursive: true });
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
  const t = setTimeout(() => reject(new Error('the server did not become ready')), 20000);
  server.stdout.on('data', (d) => {
    buf += d;
    for (const line of buf.split('\n')) {
      try {
        const j = JSON.parse(line);
        if (j.event === 'server.ready') { clearTimeout(t); resolve(j.port); }
      } catch { /* a partial line */ }
    }
  });
  server.on('exit', (code) => reject(new Error('the server exited with ' + code)));
});

const electron = createRequire(path.join(root, 'desktop', 'package.json'))('electron');
const env = { ...process.env, SMOKE_OUT: out, SMOKE_SERVER_URL: 'http://127.0.0.1:' + port, SMOKE_TOKEN: token, SMOKE_LIVE_TEXT: LIVE, SMOKE_SEND_TEXT: SENT };
const appProc = spawn(electron, [path.join(root, 'desktop')], { env, stdio: ['ignore', 'pipe', 'inherit'] });
let report = null;
appProc.stdout.on('data', (d) => {
  const m = /SMOKE (\{.*\})/.exec(String(d));
  if (m) report = JSON.parse(m[1]);
  process.stdout.write(d);
});
const killer = setTimeout(() => appProc.kill('SIGKILL'), 120000);
const code = await new Promise((resolve) => appProc.on('exit', resolve));
clearTimeout(killer);
server.kill('SIGTERM');
rmSync(data, { recursive: true, force: true });
const ok = code === 0 && report && report.chats >= 3 && report.bubbles > 0 && report.images > 0 && report.live && report.sent && report.onboarding;
if (!ok) {
  console.error('smoke failed: exit ' + code + ', report ' + JSON.stringify(report));
  process.exit(1);
}
console.log('smoke ok: ' + JSON.stringify(report) + '; captures in ' + out);
