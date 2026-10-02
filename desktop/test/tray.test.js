// The tray and the window's lifecycle (issue 115): closing hides the window to the tray, only a quit ends the app, and
// each tray item raises the window and routes to its screen in the app. Held with fakes, so no Electron is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createLifecycle, trayTemplate, trayIcon, trayLabels, appMenuTemplate, TRAY_ITEMS, SCREENS } from '../src/tray.js';
import { checkForUpdates } from '../src/updates.js';
import { screenFor, OPEN_SCREENS } from '../../core/app/rules/screens.js';

const spec = JSON.parse(readFileSync(new URL('../../core/spec/host-bridge.json', import.meta.url), 'utf8'));

// A window that records what was done to it, in the shape of a BrowserWindow.
function fakeWindow({ loading = false } = {}) {
  const w = { visible: true, minimized: false, focused: false, destroyed: false, calls: [] };
  return Object.assign(w, {
    isDestroyed: () => w.destroyed,
    isMinimized: () => w.minimized,
    isVisible: () => w.visible,
    hide() { w.visible = false; w.calls.push('hide'); },
    show() { w.visible = true; w.calls.push('show'); },
    restore() { w.minimized = false; w.calls.push('restore'); },
    focus() { w.focused = true; w.calls.push('focus'); },
    webContents: { isLoading: () => loading },
  });
}

function rig(opts = {}) {
  let win = opts.window === undefined ? fakeWindow() : opts.window;
  const sent = [];
  const counts = { created: 0, quit: 0, checks: 0 };
  const life = createLifecycle({
    getWindow: () => win,
    createWindow: () => { counts.created += 1; win = fakeWindow(opts); return win; },
    send: (w, name, payload) => sent.push({ name, payload }),
    quitApp: () => { counts.quit += 1; },
    checkUpdates: () => { counts.checks += 1; },
  });
  return { life, sent, counts, get win() { return win; } };
}

const closeEvent = () => { const e = { prevented: false, preventDefault() { e.prevented = true; } }; return e; };

test('closing the window hides it to the tray and the app keeps running', () => {
  const r = rig();
  const e = closeEvent();
  assert.equal(r.life.onClose(e), 'hide');
  assert.equal(e.prevented, true, 'the close is refused, so the window is not destroyed');
  assert.equal(r.win.visible, false, 'the window is hidden');
  assert.equal(r.counts.quit, 0, 'closing is not quitting');
  assert.equal(r.life.quitting, false);
});

test('quit is the only quit: after it, a close is a real close', () => {
  const r = rig();
  r.life.quit();
  assert.equal(r.counts.quit, 1, 'the tray Quit ends the app');
  const e = closeEvent();
  assert.equal(r.life.onClose(e), 'close');
  assert.equal(e.prevented, false, 'the quit closes the window rather than hiding it');
});

test('a quit the platform asks for (before-quit, an update restart) lets the window close', () => {
  const r = rig();
  r.life.markQuitting();
  const e = closeEvent();
  assert.equal(r.life.onClose(e), 'close');
  assert.equal(e.prevented, false);
});

test('Show raises a hidden window, and a minimised one is restored first', () => {
  const r = rig();
  r.win.visible = false;
  r.life.commands().show();
  assert.equal(r.win.visible, true);
  assert.equal(r.win.focused, true);
  r.win.minimized = true;
  r.win.calls.length = 0;
  r.life.commands().show();
  assert.deepEqual(r.win.calls, ['restore', 'show', 'focus'], 'restored, then shown, then focused');
  assert.equal(r.sent.length, 0, 'Show asks the page for no screen; it only raises the window');
});

test('Settings and About raise the window first, then route to their screen in the app', () => {
  for (const id of ['settings', 'about']) {
    const r = rig();
    r.win.visible = false;
    r.win.minimized = true;
    r.life.commands()[id]();
    assert.deepEqual(r.win.calls, ['restore', 'show', 'focus'], id + ' raises the window before the screen');
    assert.deepEqual(r.sent, [{ name: 'app.open', payload: { screen: id } }]);
  }
});

test('Check for updates raises the window, shows the surface the banner reports on, and runs the existing check', () => {
  const r = rig();
  r.win.visible = false;
  r.life.commands().checkUpdates();
  assert.equal(r.win.visible, true);
  assert.deepEqual(r.sent, [{ name: 'app.open', payload: { screen: 'updates' } }]);
  assert.equal(r.counts.checks, 1, 'the check runs once');
});

test('a window that was gone is made again, and a screen asked for while it loads is handed over once it has', () => {
  const r = rig({ window: null, loading: true });
  r.life.commands().about();
  assert.equal(r.counts.created, 1);
  assert.equal(r.sent.length, 0, 'nothing is sent to a page still loading');
  assert.equal(r.life.loaded(), 'about');
  assert.deepEqual(r.sent, [{ name: 'app.open', payload: { screen: 'about' } }]);
  assert.equal(r.life.loaded(), null, 'handed over once');
});

test('the tray menu carries Open, Settings, About, Check for updates and Quit, each running its own command', () => {
  const clicked = [];
  const commands = Object.fromEntries(TRAY_ITEMS.map((id) => [id, () => clicked.push(id)]));
  const t = trayTemplate({ appName: 'App', commands });
  const items = t.filter((i) => i.type !== 'separator');
  const labels = trayLabels('App');
  assert.deepEqual(items.map((i) => i.id), TRAY_ITEMS);
  assert.deepEqual(items.map((i) => i.label), ['Open App', 'Settings\u2026', 'About App', 'Check for updates\u2026', 'Quit App']);
  assert.deepEqual(items.map((i) => i.label), TRAY_ITEMS.map((id) => labels[id]));
  for (const i of items) i.click();
  assert.deepEqual(clicked, TRAY_ITEMS);
  assert.equal(t.at(-1).id, 'quit', 'Quit is last, below a separator');
  assert.equal(t.at(-2).type, 'separator');
  assert.throws(() => trayTemplate({ appName: 'App', commands: {} }), /no tray command/);
});

test('macOS has a minimal application menu, and Windows and Linux have none', () => {
  const commands = Object.fromEntries(TRAY_ITEMS.map((id) => [id, () => {}]));
  assert.equal(appMenuTemplate({ platform: 'win32', appName: 'App', commands }), null);
  assert.equal(appMenuTemplate({ platform: 'linux', appName: 'App', commands }), null);
  const t = appMenuTemplate({ platform: 'darwin', appName: 'App', commands });
  assert.equal(t.length, 2, 'the app menu and Edit, nothing else');
  const [appItems, edit] = t;
  assert.equal(appItems.label, 'App');
  const items = appItems.submenu.filter((i) => i.type !== 'separator');
  assert.deepEqual(items.map((i) => i.id), ['about', 'settings', 'quit']);
  assert.deepEqual(items.map((i) => i.label), ['About App', 'Settings\u2026', 'Quit App'], 'worded as the tray words them');
  assert.equal(items.find((i) => i.id === 'quit').accelerator, 'Command+Q');
  assert.equal(items.find((i) => i.id === 'settings').accelerator, 'Command+,');
  assert.equal(edit.role, 'editMenu', 'the standard Edit menu, so copy and paste keep working');
  assert.throws(() => appMenuTemplate({ platform: 'darwin', appName: 'App', commands: {} }), /no app menu command/);
});

test("the macOS menu's Quit and the tray's Quit call the same function", () => {
  const calls = [];
  const quit = () => calls.push('quit');
  const commands = Object.fromEntries(TRAY_ITEMS.map((id) => [id, id === 'quit' ? quit : () => calls.push(id)]));
  const trayQuit = trayTemplate({ appName: 'App', commands }).find((i) => i.id === 'quit');
  const menuQuit = appMenuTemplate({ platform: 'darwin', appName: 'App', commands })[0].submenu.find((i) => i.id === 'quit');
  trayQuit.click();
  menuQuit.click();
  assert.deepEqual(calls, ['quit', 'quit'], 'both reach the one quit command and nothing else');
  // Built from the lifecycle, as main.js builds both: each Quit marks the app quitting and asks it to quit, once.
  for (const pick of [(c) => trayTemplate({ appName: 'App', commands: c }), (c) => appMenuTemplate({ platform: 'darwin', appName: 'App', commands: c })[0].submenu]) {
    const r = rig();
    const commandsOf = r.life.commands();
    assert.equal(commandsOf.quit, r.life.quit, 'the command is the lifecycle quit itself');
    pick(commandsOf).find((i) => i.id === 'quit').click();
    assert.equal(r.counts.quit, 1);
    assert.equal(r.life.quitting, true);
  }
});

test('the lifecycle supplies every tray command', () => {
  const r = rig();
  assert.deepEqual(Object.keys(r.life.commands()).sort(), [...TRAY_ITEMS].sort());
});

test('the screens the shell asks for are the ones the bridge spec declares and the page routes', () => {
  assert.deepEqual(spec.events['app.open'].screens, SCREENS);
  assert.deepEqual(OPEN_SCREENS, SCREENS);
  assert.throws(() => rig().life.open('nowhere'), /no screen/);
});

test('the page routes each screen once it is ready, holds one asked for while it loads, and ignores the unknown', () => {
  assert.equal(screenFor('settings', { phase: 'ready' }), 'settings');
  assert.equal(screenFor('about', { phase: 'ready' }), 'about');
  assert.equal(screenFor('updates', { phase: 'ready' }), 'main', 'the banner shows on the main surface, with no sheet over it');
  assert.equal(screenFor('settings', { phase: 'boot' }), 'hold');
  assert.equal(screenFor('about', { phase: 'loading' }), 'hold');
  assert.equal(screenFor('settings', { phase: 'onboarding' }), null, 'the sign-in page has no sheet to show');
  assert.equal(screenFor('nowhere', { phase: 'ready' }), null);
});

test('each platform has its tray icon, and macOS takes a template image', () => {
  assert.deepEqual(trayIcon('darwin'), { file: 'trayTemplate.png', template: true });
  assert.match(trayIcon('darwin').file, /Template\.png$/, 'Electron reads a name ending in Template as a template image');
  assert.equal(trayIcon('win32').file, 'tray.ico');
  assert.equal(trayIcon('linux').file, 'tray.png');
  for (const platform of ['darwin', 'win32', 'linux']) {
    assert.ok(existsSync(new URL('../src/assets/tray/' + trayIcon(platform).file, import.meta.url)), platform + ' icon exists');
  }
  assert.ok(existsSync(new URL('../src/assets/tray/trayTemplate@2x.png', import.meta.url)), 'the Retina template sits beside it');
});

test('the tray Check for updates with no updater (a run from source) answers in the app, saying why', () => {
  const states = [];
  assert.equal(checkForUpdates(null, { platform: 'linux', packaged: false }, (s) => states.push(s)), false);
  assert.deepEqual(states, [{ state: 'unsupported', version: null, canInstall: false, detail: 'running from source' }]);
  checkForUpdates(null, { platform: 'darwin', packaged: true }, (s) => states.push(s));
  assert.equal(states.at(-1).detail, 'no updater is running in this session', 'a build that could update is not told it cannot by the platform');
  let checked = 0;
  assert.equal(checkForUpdates({ check: () => { checked += 1; return true; } }, { platform: 'linux', packaged: true }, () => assert.fail()), true);
  assert.equal(checked, 1, 'a running updater does the check itself');
});

test('the shell wires close to the lifecycle, the tray to its template, and no other path quits', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /win\.on\('close', \(e\) => lifecycle\.onClose\(e\)\)/, 'the window close goes through the lifecycle');
  assert.match(main, /trayTemplate\(\{ appName: naming\.product, commands: lifecycle\.commands\(\) \}\)/, 'the tray menu is the lifecycle commands');
  assert.match(main, /app\.on\('before-quit', \(\) => lifecycle\.markQuitting\(\)\)/);
  assert.match(main, /appMenuTemplate\(\{ platform: process\.platform, appName: naming\.product, commands: lifecycle\.commands\(\) \}\)/, 'the macOS application menu is the lifecycle commands too');
  const quits = main.split('\n').filter((l) => /app\.quit\(\)/.test(l)).map((l) => l.trim());
  assert.deepEqual(quits, [
    "if (!SMOKE && !app.requestSingleInstanceLock()) app.quit();",
    'quitApp: () => app.quit(),',
    "app.on('window-all-closed', () => { if (SMOKE) app.quit(); });",
  ], 'a second instance, the lifecycle quit and the smoke are the only callers of app.quit');
});
