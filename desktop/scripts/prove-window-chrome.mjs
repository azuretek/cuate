// Prove the window chrome per platform (issue 109): no bar, no title and no icon, the app's surfaces running to the top
// edge, the top strip dragging, and the window controls placed as the platform asks (macOS keeps its traffic lights,
// Windows and Linux draw min, max, close at the right of the contact header).
//
// On Windows and Linux it also measures where the controls sit and how they hover (issue 131): the close button is set
// in from the window's top edge and from its right edge by the same small inset, and a hovered control draws a rounded
// box inside the header rather than a full-height block, close in its own tint. Every case is drawn in the light and
// the dark scheme, idle and hovered, and each capture is checked to be in the scheme its name says.
//
// The app is core's own page (core/app/components/app-root.js), drawn from the arrangement core/app/rules/bar-layout.js
// answers for a platform. This loads the real page over the app://bundle protocol with a stub shell bridge installed as
// the window's preload (scripts/lib/proof-bridge-preload.cjs), so the page boots with no server and no error, hands in
// the host and a fixture chat so the shell renders, then measures what the page drew. It runs
// headlessly (under xvfb-run on Linux) and never opens on a desktop a person is using.
//
//   xvfb-run -a node_modules/.bin/electron desktop/scripts/prove-window-chrome.mjs [--shots DIR]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { controlLayout } from '../../core/app/rules/bar-layout.js';
import { mimeFor } from '../src/bridge-handlers.js';
import { WINDOW_STRIP_HEIGHT, WINDOW_CONTROL_INSET } from '../src/window-chrome.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORE = path.resolve(HERE, '..', '..', 'core');
const naming = JSON.parse(fs.readFileSync(path.join(CORE, 'spec', 'naming.json'), 'utf8'));
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'window-chrome-proof-'));
const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : path.join(HERE, '..', '..', 'docs', 'proof', 'desktop');
const PRELOAD = path.join(HERE, 'lib', 'proof-bridge-preload.cjs');

const failures = [];
const pass = (label) => console.log('OK   ' + label);
const fail = (label) => { console.log('FAIL ' + label); failures.push(label); };

// The platforms the acceptance names. macOS keeps its own lights; Windows and Linux draw the controls in the header.
const CASES = [
  { name: 'macos', platform: 'darwin' },
  { name: 'windows', platform: 'win32' },
  { name: 'linux', platform: 'linux' },
];

const SCHEMES = ['light', 'dark'];
// The inset counts as small when it is no more than the header's own tightest spacing, as a platform's buttons sit.
const SMALL_INSET = 8;

const MEASURE = [
  "(() => {",
  "  const side = document.querySelector('.sidebar-head');",
  "  const head = document.querySelector('.conv-head');",
  "  const group = head.querySelector('.window-controls');",
  "  const controls = group ? [...group.querySelectorAll('.window-control')] : [];",
  "  const region = (el) => (el ? (getComputedStyle(el).getPropertyValue('-webkit-app-region') || getComputedStyle(el).getPropertyValue('app-region') || '').trim() : null);",
  "  const rect = (el) => { const b = el.getBoundingClientRect(); return { top: b.top, left: b.left, right: b.right, bottom: b.bottom, height: b.height }; };",
  "  const padTop = (el) => parseFloat(getComputedStyle(el).paddingTop) || 0;",
  "  return {",
  "    bar: Boolean(document.querySelector('.window-bar')), title: Boolean(document.querySelector('.window-title')), icon: Boolean(document.querySelector('.window-icon')),",
  "    sidebarTop: rect(side).top, headTop: rect(head).top, sidebarPad: padTop(side), headPad: padTop(head),",
  "    sideRegion: region(side), headRegion: region(head), groupRegion: region(group), searchRegion: region(side.querySelector('.chat-search')), gearRegion: region(side.querySelector('.gear-button')),",
  "    controls: Boolean(group), order: controls.map((el) => el.className.split(' ').find((k) => ['minimize', 'maximize', 'close'].includes(k))),",
  "    labelled: controls.every((el) => (el.getAttribute('aria-label') || '').length > 0),",
  "    head: rect(head), group: group ? rect(group) : null,",
  "    close: group && group.querySelector('.close') ? rect(group.querySelector('.close')) : null, width: window.innerWidth,",
  "    dark: matchMedia('(prefers-color-scheme: dark)').matches, overflows: document.documentElement.scrollHeight > document.documentElement.clientHeight || document.documentElement.scrollWidth > document.documentElement.clientWidth,",
  "    alerts: [...document.querySelectorAll('[role=\"alert\"], .problem')].map((el) => el.textContent.trim()),",
  "    banners: [...document.querySelectorAll('.sidebar .banner')].map((el) => el.textContent.trim()),",
  "  };",
  "})()",
].join('\n');

// What a hovered control looks like: whether the pointer is over it, its box, its corner radius, and its background
// against the colour the stylesheet's token resolves to, so the check is that the hover tint is the token's.
const HOVERED = (name, token) => [
  "(() => {",
  "  const el = document.querySelector('.conv-head .window-control.' + " + JSON.stringify(name) + ");",
  "  const probe = document.createElement('div'); probe.style.background = 'var(' + " + JSON.stringify(token) + " + ')'; document.body.append(probe);",
  "  const want = getComputedStyle(probe).backgroundColor; probe.remove();",
  "  const b = el.getBoundingClientRect(); const cs = getComputedStyle(el);",
  "  return { hovered: el.matches(':hover'), background: cs.backgroundColor, want, radius: parseFloat(cs.borderTopRightRadius) || 0, top: b.top, right: window.innerWidth - b.right, height: b.height, headHeight: document.querySelector('.conv-head').getBoundingClientRect().height };",
  "})()",
].join('\n');

// Settle on a state rather than a count of frames: poll until the pointer is over the control and its background has
// finished its transition to the token's colour, with a deadline so a hover that never lands fails the proof.
async function hover(wc, name, token) {
  const at = await wc.executeJavaScript("(() => { const b = document.querySelector('.conv-head .window-control." + name + "').getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()");
  wc.sendInputEvent({ type: 'mouseMove', x: at.x, y: at.y });
  const deadline = Date.now() + 3000;
  let seen = await wc.executeJavaScript(HOVERED(name, token));
  while (!(seen.hovered && seen.background === seen.want) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 30));
    wc.sendInputEvent({ type: 'mouseMove', x: at.x, y: at.y });
    seen = await wc.executeJavaScript(HOVERED(name, token));
  }
  await wc.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
  return seen;
}

function serve(request) {
  const url = new URL(request.url);
  const file = path.resolve(CORE, decodeURIComponent(url.pathname).replace(/^\/+/, ''));
  if (url.host !== 'bundle' || !file.startsWith(CORE + path.sep) || !fs.existsSync(file)) return new Response('not found', { status: 404 });
  return new Response(fs.readFileSync(file), { headers: { 'content-type': mimeFor(file) } });
}

// Draw the shell for one case in the real page: the preload installs the stub shell bridge before any page script runs,
// so the page boots with no server and no error; once its boot has settled, hand in the host, a fixture chat and an open
// connection so the sidebar and the conversation header render as a connected app would, then read the geometry back
// and capture the top strip.
async function draw(BrowserWindow, nativeTheme, testCase, scheme) {
  nativeTheme.themeSource = scheme;
  const host = { product: naming.product, platform: testCase.platform };
  // The window is the app's own minimum size (desktop/src/main.js): a shorter one overflows the page, and the page's
  // scrollbar then stands between the controls and the window's right edge, which no real window shows.
  const window = new BrowserWindow({ width: 900, height: 480, show: true, frame: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: PRELOAD, additionalArguments: ['--proof-host=' + encodeURIComponent(JSON.stringify(host))] } });
  await window.loadURL('app://bundle/app/index.html');
  const wc = window.webContents;
  // The page's boot reads the saved server through the bridge; with none saved it settles on onboarding. Wait for that
  // first, with a deadline, so the fixture state handed in next is not overwritten by a boot still in flight.
  const booted = await wc.executeJavaScript('new Promise((resolve) => { const el = document.querySelector("app-root"); const t0 = Date.now(); const tick = () => { if (el && el.phase !== "boot") return resolve(el.phase); if (Date.now() - t0 > 5000) return resolve(null); setTimeout(tick, 20); }; tick(); })');
  if (!booted) throw new Error('the page did not finish booting for ' + testCase.name);
  const state = '(() => { const el = document.querySelector("app-root"); el.host = ' + JSON.stringify(host) + '; el.phase = "ready"; el.chats = [{ id: "1", name: "Avery Quinn", participants: [], isGroup: false, unread: 0, lastMessageAt: null, lastMessage: null }]; el.openChatId = "1"; el.messages = []; el.conn = "open"; el.sending = true; return true; })()';
  await wc.executeJavaScript(state);
  // Wait for the shell to render, with a deadline so a page that never draws fails the proof instead of hanging it.
  const ready = await wc.executeJavaScript('new Promise((resolve) => { const done = () => Boolean(document.querySelector(".conv-head") && document.querySelector(".sidebar-head")); const t0 = Date.now(); const tick = () => { if (done()) return resolve(true); if (Date.now() - t0 > 5000) return resolve(false); setTimeout(tick, 20); }; tick(); })');
  if (!ready) throw new Error('the shell did not render the sidebar and contact header for ' + testCase.name);
  const measured = await wc.executeJavaScript(MEASURE);
  // Capture the measured frame, not a stale paint: capturePage returns what was last painted, and the shell renders a
  // moment before it is composited, so wait for two animation frames first.
  await wc.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
  const shots = [{ suffix: '', png: (await wc.capturePage()).toPNG() }];
  // Hovered: a neutral control and close, each captured in its hover state.
  const hovers = {};
  if (measured.controls) {
    for (const [name, token, suffix] of [['maximize', '--color-bg-sunken', '-hover'], ['close', '--color-danger', '-hover-close']]) {
      hovers[name] = await hover(wc, name, token);
      shots.push({ suffix, png: (await wc.capturePage()).toPNG() });
    }
  }
  window.destroy();
  return { measured: { ...measured, hovers }, shots };
}

function check(testCase, scheme, measured) {
  const expected = controlLayout({ platform: testCase.platform });
  const tag = testCase.name + ' ' + scheme + ': ';
  if (measured.dark === (scheme === 'dark')) pass(tag + 'the page draws in the ' + scheme + ' scheme');
  else fail(tag + 'the page is not in the ' + scheme + ' scheme, so its capture would be mislabelled');
  if (!measured.overflows) pass(tag + 'the page fits the window, with no page scrollbar');
  else fail(tag + 'the page overflows the window, so a page scrollbar is drawn');
  if (measured.alerts.length === 0) pass(tag + 'no error banner is drawn');
  else fail(tag + 'the page draws an error: ' + measured.alerts.join(' | '));
  if (measured.banners.length === 0) pass(tag + 'the list draws no banner, the page reads as connected');
  else fail(tag + 'the list draws a banner: ' + measured.banners.join(' | '));
  for (const [what, present] of [['a bar of its own', measured.bar], ['a title', measured.title], ['an icon', measured.icon]]) {
    if (present) fail(tag + 'the page still draws ' + what);
    else pass(tag + 'no ' + what);
  }
  if (measured.sidebarTop === 0 && measured.headTop === 0) pass(tag + 'the app surfaces reach the top edge');
  else fail(tag + 'a surface does not reach the top: sidebar ' + measured.sidebarTop + ', header ' + measured.headTop);
  if (measured.sideRegion === 'drag' && measured.headRegion === 'drag') pass(tag + 'the top strip drags the window');
  else fail(tag + 'the top strip is not a drag region: ' + JSON.stringify({ side: measured.sideRegion, head: measured.headRegion }));
  if (measured.searchRegion === 'no-drag' && measured.gearRegion === 'no-drag') pass(tag + 'the sidebar controls are out of the drag region');
  else fail(tag + 'a sidebar control is in the drag region');
  const wanted = expected.drawn ? expected.order : [];
  if (JSON.stringify(measured.order) === JSON.stringify(wanted)) pass(tag + 'the controls read ' + (wanted.join(', ') || 'none, the platform draws its own'));
  else fail(tag + 'the controls read ' + measured.order.join(', ') + ', expected ' + (wanted.join(', ') || 'none'));
  if (expected.drawn) {
    if (measured.controls && measured.labelled && measured.groupRegion === 'no-drag' && measured.group.right <= measured.head.right + 0.5) pass(tag + 'the controls sit at the right of the contact header, out of the drag region');
    else fail(tag + 'the controls are not inside the contact header at its right');
    if (measured.group.left > 0 && measured.group.left > measured.head.left) pass(tag + 'the controls do not reach back over the contact name');
    else fail(tag + 'the controls overlap the contact name');
    // Issue 131: close in the corner, set in from the top and from the right by the same small inset.
    const top = measured.close.top;
    const right = measured.width - measured.close.right;
    const offsets = 'top ' + top + 'px, right ' + right + 'px';
    if (measured.order[measured.order.length - 1] === 'close') pass(tag + 'close is the control nearest the corner');
    else fail(tag + 'close is not nearest the corner');
    if (Math.abs(top - right) <= 0.5 && Math.abs(top - WINDOW_CONTROL_INSET) <= 0.5 && top > 0 && top <= SMALL_INSET) pass(tag + 'close sits in the corner, ' + offsets + ', equal and small');
    else fail(tag + 'close is not square in the corner: ' + offsets + ', expected both ' + WINDOW_CONTROL_INSET + 'px');
    for (const [name, hovered] of Object.entries(measured.hovers)) {
      const what = tag + name + ' hovered: ';
      if (hovered.hovered && hovered.background === hovered.want) pass(what + 'the pointer is over it and it draws its hover tint ' + hovered.background);
      else fail(what + 'no hover tint: ' + JSON.stringify({ hovered: hovered.hovered, background: hovered.background, want: hovered.want }));
      if (hovered.radius > 0 && hovered.top > 0 && hovered.right > 0 && hovered.height < hovered.headHeight) pass(what + 'a rounded box (' + hovered.radius + 'px corners, ' + hovered.height + 'px of a ' + hovered.headHeight + 'px header) inset from the edges');
      else fail(what + 'not a rounded inset box: ' + JSON.stringify(hovered));
    }
  } else {
    if (!measured.controls) pass(tag + 'the app draws no controls, the platform keeps its own');
    else fail(tag + 'the app drew controls where the platform keeps its own');
    if (measured.sidebarPad >= WINDOW_STRIP_HEIGHT && measured.headPad >= WINDOW_STRIP_HEIGHT) pass(tag + 'the content is pushed below the traffic lights (' + WINDOW_STRIP_HEIGHT + 'px)');
    else fail(tag + 'the content is not pushed below the lights: sidebar ' + measured.sidebarPad + ', header ' + measured.headPad);
  }
}

// The scratch profile is Electron's own userData folder, and on Windows the running app still holds files in it, so
// removing it before exit fails with EPERM after every check has passed. The verdict is the checks', not the cleanup's:
// a profile left in the runner's temp folder is logged and the exit code is unchanged.
function removeProfile() {
  try {
    fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch (error) {
    console.warn('left the scratch profile at ' + PROFILE + ' (' + (error && error.code) + ')');
  }
}

async function main(app, BrowserWindow, protocol, nativeTheme) {
  try {
    app.setPath('userData', PROFILE);
    app.disableHardwareAcceleration();
    await app.whenReady();
    // Each case closes its window before the next one opens; without this, destroying the last window quits the app on
    // Windows and Linux (macOS keeps running), so only the first case would ever be drawn.
    app.on('window-all-closed', () => {});
    protocol.handle('app', serve);
    fs.mkdirSync(SHOTS, { recursive: true });
    for (const testCase of CASES) {
      for (const scheme of SCHEMES) {
        const { measured, shots } = await draw(BrowserWindow, nativeTheme, testCase, scheme);
        check(testCase, scheme, measured);
        for (const shot of shots) fs.writeFileSync(path.join(SHOTS, 'window-chrome-' + testCase.name + '-' + scheme + shot.suffix + '.png'), shot.png);
      }
    }
    console.log('');
    console.log(failures.length ? 'PROOF FAILED (' + failures.length + ')' : 'PROOF OK');
    console.log('shots in ' + SHOTS);
    removeProfile();
    app.exit(failures.length ? 1 : 0);
  } catch (error) {
    console.error(error);
    failures.push('the harness threw: ' + (error && error.message));
    app.exit(1);
  }
}

// A module-level await would suspend Electron's own bootstrap, so the entry point returns and the work runs behind a
// dynamic import of electron.
import('electron').then((electron) => {
  electron.protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
  return main(electron.app, electron.BrowserWindow, electron.protocol, electron.nativeTheme);
}).catch((error) => { console.error(error); process.exit(1); });
