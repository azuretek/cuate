// The desktop boot smoke: a real server over the fake engine, the real desktop app against it, and captures of what
// it drew. It proves boot, the chat list, a conversation with a photo, a live incoming message over the event stream,
// a send, closing to the tray with a send in flight and the tray's menu opening screens in the app, the settings page reading, writing and streaming a change, a theme imported by URL, a notice firing and a notice suppressed, the about
// page, image previews and the image viewer's zoom by click, wheel, key and touch, the phone layout with its edge drag (the settle threshold and the reduced-motion path included), and onboarding.
// The sidebar's search terms each refine the list in their own mode, the sort icon matches the filter icon and orders
// the list by name both ways, and Edit groups chats unnamed and deletes one only through the slider. The Edit control
// holds one line at the smallest window and every text size.
// A message opens one menu (its time, Reply in thread on someone else's, React) by a right click, a long click and,
// at phone width, a long press; React takes the reaction from the composer's emoji panel and comes off again, an emoji
// the engine cannot send is refused, a reaction floats at the bubble's top outer corner without moving any message, and
// Reply in thread opens the thread over the blurred conversation, where a reply sent lands. Every field's placeholder
// is dimmed from its token in both schemes, at desktop and phone width.
// Run it under a display (xvfb-run on Linux).
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeText } from '../src/smoke-failure.js';

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

// When the app is killed before it can retain its own state (the deadline below), or exits without a
// report, keep a bounded, sanitized note of how it ended. The app's own failure.json is authoritative and
// is never overwritten: this only fills the gap when the renderer never got the chance to answer.
function writeFailureNote(exitCode, applicationOutput) {
  try {
    const file = path.join(out, 'failure.json');
    if (existsSync(file)) return;
    const tail = sanitizeText(String(applicationOutput || '').slice(-4000), [process.env.SMOKE_TOKEN, process.env.SMOKE_SERVER_URL].filter(Boolean));
    writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), killedBeforeRetention: true, exitCode, outputTail: tail }, null, 1));
  } catch { /* the smoke failure stands without the note */ }
}

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
const env = { ...process.env, SMOKE_OUT: out, SMOKE_SERVER_URL: 'http://127.0.0.1:' + port, SMOKE_TOKEN: token, SMOKE_LIVE_TEXT: LIVE, SMOKE_SEND_TEXT: SENT, SMOKE_THEME_FIXTURE: path.join(root, 'core/fixtures/themes/elegant-luxury.json') };
const appProc = spawn(electron, packed ? [] : [path.join(root, 'desktop')], { env, stdio: ['ignore', 'pipe', 'inherit'] });
let report = null;
let output = '';
appProc.stdout.on('data', (d) => {
  output += String(d);
  const m = /SMOKE (\{.*\})/.exec(output);
  if (m) report = JSON.parse(m[1]);
  process.stdout.write(d);
});
// The bound on the whole run. The outside-dismiss proof (issue 170) opens and closes nine panels at two widths in two
// schemes, so the bound has room for it beside every earlier check.
const killer = setTimeout(() => appProc.kill('SIGKILL'), 240000);
const code = await new Promise((resolve) => { appProc.on('exit', resolve); appProc.on('error', (error) => { console.error(error.message); resolve(-1); }); });
try { report = JSON.parse(readFileSync(path.join(out, 'report.json'), 'utf8')); } catch { /* absence fails below */ }
clearTimeout(killer);
await new Promise((resolve) => {
  server.once('close', resolve);
  server.kill('SIGTERM');
});
rmSync(data, { recursive: true, force: true });
rmSync(path.join(out, 'user-data'), { recursive: true, force: true });
const ok = code === 0 && report && (!packed || (report.packaged && report.info.version === process.env.BUILD_VERSION)) && report.chats >= 3 && report.bubbles > 0 && report.images > 0 && report.resyncKeeps && report.header && report.windowBar && report.appMenu && report.live && report.sent && report.composerGrows && report.closeToTray && report.tray && report.settings && report.theme && report.themeImport && report.themeUrl && report.themePage && report.themePicker && report.choiceContrast && report.notices && report.updates && report.about && report.sheet && report.phone && report.phoneDrawer && report.phoneFits && report.phoneComposer && report.phoneSend && report.phoneEdgeOnly && report.phoneSettle && report.phoneTracks && report.phoneEdgeDrag && report.phoneReduced && report.phoneMessageMenu && report.onboarding && report.surface && report.emojiPanel && report.attachMenu && report.imagePreview && report.imageViewer && report.sendOnce && report.importOnce && report.pressStates && report.resizeKeeps && report.headerPinned && report.noPageZoom && report.noBlank && report.searchTerms && report.sort && report.icons && report.editMode && report.editLine && report.react && report.reply && report.dismiss && report.placeholder && report.trayIcon;
if (!ok) {
  console.error('smoke failed: exit ' + code + ', report ' + JSON.stringify(report));
  writeFailureNote(code, output);
  process.exit(1);
}
console.log('smoke ok: ' + JSON.stringify(report) + '; captures in ' + out);
