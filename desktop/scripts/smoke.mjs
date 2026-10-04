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
import { evaluateChecks, formatFailures } from '../src/smoke-checks.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const smokeStartedAt = Date.now();
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
// schemes, and the close-control proof (issue 213) clicks every close control at four sizes, so the bound has room
// for both beside every earlier check.
const killer = setTimeout(() => appProc.kill('SIGKILL'), 240000);
const code = await new Promise((resolve) => { appProc.on('exit', resolve); appProc.on('error', (error) => { console.error(error.message); resolve(-1); }); });
try { report = JSON.parse(readFileSync(path.join(out, 'report.json'), 'utf8')); } catch { /* absence fails below */ }
// The required checks, each naming the bound it enforces, so a failure says the value it read and the
// bound it had to meet rather than only that the run failed. Each entry reads the report key it names, so
// the conventions catalogue can tie a rule to the smoke check that holds it (core/test/guards.test.js).
const checks = [
  { key: 'exit', bound: 'the app exited 0', value: () => code, test: (v) => v === 0 },
  { key: 'report', bound: 'the app wrote a report', value: (report) => Boolean(report), test: (v) => v === true },
  { key: 'version', bound: packed ? 'the app version equals the build version' : 'not a packaged run', value: (report) => (packed ? (report.info && report.info.version) : 'not packaged'), test: (v) => (packed ? v === process.env.BUILD_VERSION : true) },
  { key: 'packaged', bound: packed ? 'the run reports itself packaged' : 'not a packaged run', value: (report) => (packed ? report.packaged : true), test: (v) => (packed ? v === true : true) },
  { key: 'chats', bound: 'at least 3 chats listed', value: (report) => report.chats, test: (v) => v >= 3 },
  { key: 'bubbles', bound: 'more than 0 message bubbles drawn', value: (report) => report.bubbles, test: (v) => v > 0 },
  { key: 'images', bound: 'more than 0 attachment images drawn', value: (report) => report.images, test: (v) => v > 0 },
  { key: 'resyncKeeps', bound: 'true', value: (report) => report.resyncKeeps, test: (v) => v === true },
  { key: 'header', bound: 'true', value: (report) => report.header, test: (v) => v === true },
  { key: 'windowBar', bound: 'true', value: (report) => report.windowBar, test: (v) => v === true },
  { key: 'appMenu', bound: 'true', value: (report) => report.appMenu, test: (v) => v === true },
  { key: 'live', bound: 'true', value: (report) => report.live, test: (v) => v === true },
  { key: 'sent', bound: 'true', value: (report) => report.sent, test: (v) => v === true },
  { key: 'composerGrows', bound: 'true', value: (report) => report.composerGrows, test: (v) => v === true },
  { key: 'closeToTray', bound: 'true', value: (report) => report.closeToTray, test: (v) => v === true },
  { key: 'tray', bound: 'true', value: (report) => report.tray, test: (v) => v === true },
  { key: 'settings', bound: 'true', value: (report) => report.settings, test: (v) => v === true },
  { key: 'theme', bound: 'true', value: (report) => report.theme, test: (v) => v === true },
  { key: 'themeImport', bound: 'true', value: (report) => report.themeImport, test: (v) => v === true },
  { key: 'themeUrl', bound: 'true', value: (report) => report.themeUrl, test: (v) => v === true },
  { key: 'themePage', bound: 'true', value: (report) => report.themePage, test: (v) => v === true },
  { key: 'themePicker', bound: 'true', value: (report) => report.themePicker, test: (v) => v === true },
  { key: 'choiceContrast', bound: 'true', value: (report) => report.choiceContrast, test: (v) => v === true },
  { key: 'notices', bound: 'true', value: (report) => report.notices, test: (v) => v === true },
  { key: 'updates', bound: 'true', value: (report) => report.updates, test: (v) => v === true },
  { key: 'about', bound: 'true', value: (report) => report.about, test: (v) => v === true },
  { key: 'sheet', bound: 'true', value: (report) => report.sheet, test: (v) => v === true },
  { key: 'phone', bound: 'true', value: (report) => report.phone, test: (v) => v === true },
  { key: 'phoneDrawer', bound: 'true', value: (report) => report.phoneDrawer, test: (v) => v === true },
  { key: 'phoneFits', bound: 'true', value: (report) => report.phoneFits, test: (v) => v === true },
  { key: 'phoneComposer', bound: 'true', value: (report) => report.phoneComposer, test: (v) => v === true },
  { key: 'phoneSend', bound: 'true', value: (report) => report.phoneSend, test: (v) => v === true },
  { key: 'phoneEdgeOnly', bound: 'true', value: (report) => report.phoneEdgeOnly, test: (v) => v === true },
  { key: 'phoneSettle', bound: 'true', value: (report) => report.phoneSettle, test: (v) => v === true },
  { key: 'phoneTracks', bound: 'true', value: (report) => report.phoneTracks, test: (v) => v === true },
  { key: 'phoneEdgeDrag', bound: 'true', value: (report) => report.phoneEdgeDrag, test: (v) => v === true },
  { key: 'phoneReduced', bound: 'true', value: (report) => report.phoneReduced, test: (v) => v === true },
  { key: 'phoneMessageMenu', bound: 'true', value: (report) => report.phoneMessageMenu, test: (v) => v === true },
  { key: 'onboarding', bound: 'true', value: (report) => report.onboarding, test: (v) => v === true },
  { key: 'surface', bound: 'true', value: (report) => report.surface, test: (v) => v === true },
  { key: 'emojiPanel', bound: 'true', value: (report) => report.emojiPanel, test: (v) => v === true },
  { key: 'attachMenu', bound: 'true', value: (report) => report.attachMenu, test: (v) => v === true },
  { key: 'imagePreview', bound: 'true', value: (report) => report.imagePreview, test: (v) => v === true },
  { key: 'imageViewer', bound: 'true', value: (report) => report.imageViewer, test: (v) => v === true },
  { key: 'sendOnce', bound: 'true', value: (report) => report.sendOnce, test: (v) => v === true },
  { key: 'importOnce', bound: 'true', value: (report) => report.importOnce, test: (v) => v === true },
  { key: 'pressStates', bound: 'true', value: (report) => report.pressStates, test: (v) => v === true },
  { key: 'resizeKeeps', bound: 'true', value: (report) => report.resizeKeeps, test: (v) => v === true },
  { key: 'switchPlace', bound: 'true', value: (report) => report.switchPlace, test: (v) => v === true },
  { key: 'switchInstant', bound: 'true', value: (report) => report.switchInstant, test: (v) => v === true },
  { key: 'headerPinned', bound: 'true', value: (report) => report.headerPinned, test: (v) => v === true },
  { key: 'noPageZoom', bound: 'true', value: (report) => report.noPageZoom, test: (v) => v === true },
  { key: 'noBlank', bound: 'true', value: (report) => report.noBlank, test: (v) => v === true },
  { key: 'searchTerms', bound: 'true', value: (report) => report.searchTerms, test: (v) => v === true },
  { key: 'sort', bound: 'true', value: (report) => report.sort, test: (v) => v === true },
  { key: 'icons', bound: 'true', value: (report) => report.icons, test: (v) => v === true },
  { key: 'overlayIcon', bound: 'true', value: (report) => report.overlayIcon, test: (v) => v === true },
  { key: 'editMode', bound: 'true', value: (report) => report.editMode, test: (v) => v === true },
  { key: 'editLine', bound: 'true', value: (report) => report.editLine, test: (v) => v === true },
  { key: 'react', bound: 'true', value: (report) => report.react, test: (v) => v === true },
  { key: 'reply', bound: 'true', value: (report) => report.reply, test: (v) => v === true },
  { key: 'document', bound: 'true', value: (report) => report.document, test: (v) => v === true },
  { key: 'dismiss', bound: 'true', value: (report) => report.dismiss, test: (v) => v === true },
  { key: 'placeholder', bound: 'true', value: (report) => report.placeholder, test: (v) => v === true },
  { key: 'trayIcon', bound: 'true', value: (report) => report.trayIcon, test: (v) => v === true },
  { key: 'closeControls', bound: 'true', value: (report) => report.closeControls, test: (v) => v === true },
  { key: 'settingsTabs', bound: 'true', value: (report) => report.settingsTabs, test: (v) => v === true },
  { key: 'phoneSettings', bound: 'true', value: (report) => report.phoneSettings, test: (v) => v === true },
  { key: 'aboutEverywhere', bound: 'true', value: (report) => report.aboutEverywhere, test: (v) => v === true },
  { key: 'appIcon', bound: 'true', value: (report) => report.appIcon, test: (v) => v === true },
  { key: 'chatsBack', bound: 'true', value: (report) => report.chatsBack, test: (v) => v === true },
  { key: 'headerMenus', bound: 'true', value: (report) => report.headerMenus, test: (v) => v === true },
  { key: 'carets', bound: 'true', value: (report) => report.carets, test: (v) => v === true },
];
const verdict = evaluateChecks(checks, report);
clearTimeout(killer);
await new Promise((resolve) => {
  server.once('close', resolve);
  server.kill('SIGTERM');
});
rmSync(data, { recursive: true, force: true });
rmSync(path.join(out, 'user-data'), { recursive: true, force: true });
const ok = verdict.ok;
if (!ok) {
  console.error('smoke failed: exit ' + code + ', report ' + JSON.stringify(report));
  for (const line of formatFailures(verdict.results)) console.error('  ' + line);
  writeFailureNote(code, output);
  process.exit(1);
}
// The numbers a passing run measured, kept beside its captures, so a run leaves the values it read and not
// only the verdict.
try {
  writeFileSync(path.join(out, 'checks.json'), JSON.stringify({ at: new Date().toISOString(), durationMs: Date.now() - smokeStartedAt, checks: verdict.results }, null, 1));
} catch { /* the run's verdict stands without the record */ }
console.log('smoke ok: ' + JSON.stringify(report) + '; ' + verdict.results.length + ' checks measured; captures in ' + out);
