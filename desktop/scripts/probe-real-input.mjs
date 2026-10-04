// Run the real-input region probe (issue 251): a real server over the fake engine, the real desktop app against it,
// and a real pointer driven through webContents.sendInputEvent. A scripted click cannot see a drag region, so a menu
// drawn inside the drag header opens on a click but is dead to a person; this proves which one it is. Run it under a
// display (xvfb-run on Linux):
//   node desktop/scripts/probe-real-input.mjs
// It prints one PROBE line with each control's trigger, menu and option region, and exits nonzero if any is
// unreachable by a real press.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = process.env.SHOTS || path.join(root, 'desktop', 'out', 'probe');
mkdirSync(out, { recursive: true });
rmSync(path.join(out, 'probe.json'), { force: true });
const data = mkdtempSync(path.join(os.tmpdir(), 'probe-server-'));
const cli = path.join(root, 'server/src/main.js');
const run = (...args) => execFileSync(process.execPath, [cli, ...args, '--data', data], { encoding: 'utf8' });
run('init', '--engine', 'fake', '--port', '0');
const token = run('token', 'create', '--scope', 'device', '--name', 'probe').trim().split('\n').pop().trim();
run('sending', 'on');
const server = spawn(process.execPath, [cli, 'run', '--data', data], { stdio: ['ignore', 'pipe', 'inherit'] });
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

const electron = createRequire(path.join(root, 'desktop', 'package.json'))('electron');
const env = { ...process.env, SMOKE_OUT: out, SMOKE_PROBE: '1', SMOKE_SERVER_URL: 'http://127.0.0.1:' + port, SMOKE_TOKEN: token };
const appProc = spawn(electron, [path.join(root, 'desktop')], { env, stdio: ['ignore', 'pipe', 'inherit'] });
let report = null;
let output = '';
appProc.stdout.on('data', (d) => {
  output += String(d);
  const m = /PROBE (\{.*\})/.exec(output);
  if (m) report = JSON.parse(m[1]);
  process.stdout.write(d);
});
const killer = setTimeout(() => appProc.kill('SIGKILL'), 120000);
const code = await new Promise((resolve) => { appProc.on('exit', resolve); appProc.on('error', (error) => { console.error(error.message); resolve(-1); }); });
clearTimeout(killer);
await new Promise((resolve) => { server.once('close', resolve); server.kill('SIGTERM'); });
rmSync(data, { recursive: true, force: true });
rmSync(path.join(out, 'user-data'), { recursive: true, force: true });
const ok = code === 0 && report && report.clean === true;
if (!ok) {
  console.error('probe failed: exit ' + code + ', report ' + JSON.stringify(report));
  process.exit(1);
}
console.log('probe: every header control answers a real press');
