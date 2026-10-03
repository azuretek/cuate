// Issue 171: About is its own page on every platform, reached from the last row of Settings and from the tray, with
// a check for updates that reports through the app notice and the app's own icon at its top. The real component
// classes are driven here with no browser, the way sheet-departure.test.js drives the sheet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const defined = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { defined[name] = cls; }, get() { return undefined; } };
globalThis.document = { createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
await import('../app/components/app-root.js');
const AppRoot = defined['app-root'];
const { pageAfterBack } = await import('../app/rules/screens.js');
const { checkAnswer, capability } = await import('../app/rules/updates.js');
const { putNotice, dismissNotice, forgetRead, appUpdateNotice } = await import('../app/rules/app-notices.js');
const { settingsGroups } = await import('../app/rules/settings.js');

const read = (rel) => readFileSync(new URL('../../' + rel, import.meta.url), 'utf8');
const tokens = JSON.parse(read('core/spec/tokens.json'));

function host() {
  const h = new AppRoot();
  Object.assign(h, { phase: 'ready', view: 'messages', sheetLeaving: false, pendingSheet: null });
  globalThis.getComputedStyle = () => ({ getPropertyValue: (name) => tokens.motion[name.replace('--motion-', '')] || '' });
  return h;
}

test('About opened from Settings is pushed over it, and its back returns to Settings', () => {
  const h = host();
  h.openSettings();
  assert.equal(h.view, 'settings');
  h.openAbout();
  assert.equal(h.view, 'about', 'About is a page of its own, not a section of Settings');
  assert.equal(h.aboutFrom, 'settings');
  assert.equal(h.sheetLeaving, false, 'the sheet stays up: the page is pushed inside it, not a second sheet');
  assert.equal(h.pageMotion, 'push');
  h.pageBack();
  assert.equal(h.view, 'settings', 'back from About returns to Settings');
  assert.equal(h.pageMotion, 'pop');
  assert.equal(h.sheetLeaving, false);
});

test('About opened on its own (the tray, the app menu) closes the sheet on back', () => {
  const h = host();
  h.openScreen('about');
  assert.equal(h.view, 'about');
  assert.equal(h.aboutFrom, null);
  h.pageBack();
  assert.equal(h.sheetLeaving, true, 'nothing is under it, so back runs the sheet down');
  h.finishSheetLeave();
  assert.equal(h.view, 'messages');
  assert.equal(h.aboutFrom, null);
});

test('asking for About again while it is up changes nothing, and Settings from About goes back to Settings', () => {
  const h = host();
  h.openSettings();
  h.openAbout();
  h.openAbout();
  assert.equal(h.view, 'about');
  assert.equal(h.aboutFrom, 'settings');
  h.openSettings();
  assert.equal(h.view, 'settings');
  assert.equal(h.sheetLeaving, false);
});

test('pageAfterBack: only About pushed from Settings has a page under it', () => {
  assert.equal(pageAfterBack('about', 'settings'), 'settings');
  assert.equal(pageAfterBack('about', null), null);
  assert.equal(pageAfterBack('settings', null), null);
  assert.equal(pageAfterBack('settings', 'settings'), null);
});

test('Check for updates asks the shell for the same check the tray runs and shows its answer as the app notice', async () => {
  const h = host();
  h.host = { platform: 'linux' };
  const calls = [];
  h.bridge = async (name, args) => { calls.push([name, args]); return { state: 'unsupported', version: null, canInstall: false, detail: 'running from source' }; };
  const ok = await h.checkUpdates();
  assert.equal(ok, true);
  assert.deepEqual(calls, [['updates.check', {}]]);
  const card = h.appNotices.find((n) => n.id === 'app-update');
  assert.ok(card, 'the answer is drawn as the app notice');
  assert.equal(card.read, false);
  assert.match(card.message, /does not update itself/);
  assert.match(card.detail, /Running from source/);
});

test('a phone shell answers with no updater, and the notice says why in the platform\'s words', async () => {
  for (const platform of ['ios', 'android']) {
    const h = host();
    h.host = { platform };
    h.bridge = async () => ({ state: 'unsupported', canInstall: false });
    assert.equal(await h.checkUpdates(), true);
    const card = h.appNotices.find((n) => n.id === 'app-update');
    assert.match(card.message, /does not update itself/, platform);
    assert.equal(card.detail, capability({ platform, packaged: true }).reason.replace(/^./, (c) => c.toUpperCase()) + '.', platform);
  }
});

test('a second check after the notice was dismissed shows the notice again', async () => {
  const h = host();
  h.host = { platform: 'linux' };
  h.bridge = async () => ({ state: 'unsupported', canInstall: false, detail: 'running from source' });
  await h.checkUpdates();
  h.appNotices = dismissNotice(h.appNotices, 'app-update');
  assert.equal(h.appNotices.find((n) => n.id === 'app-update').read, true);
  await h.checkUpdates();
  assert.equal(h.appNotices.find((n) => n.id === 'app-update').read, false, 'asking again is a new question, so its answer is shown');
});

test('a shell that refuses the check fails the press and draws no notice', async () => {
  const h = host();
  h.host = { platform: 'linux' };
  h.bridge = async () => { throw new Error('undeclared bridge command: updates.check'); };
  assert.equal(await h.checkUpdates(), false);
  assert.equal(h.appNotices.some((n) => n.id === 'app-update'), false);
});

test('checkAnswer: a shell\'s answer becomes the update state the notice draws', () => {
  assert.deepEqual(checkAnswer({ state: 'checking', canInstall: true }, 'darwin'), { state: 'checking', version: null, percent: null, detail: null, canInstall: true });
  assert.equal(checkAnswer({ state: 'unsupported' }, 'ios').detail, capability({ platform: 'ios', packaged: true }).reason);
  assert.equal(checkAnswer({ state: 'unsupported', detail: 'no updater is running in this session' }, 'linux').detail, 'no updater is running in this session', 'the shell\'s own reason wins');
  assert.equal(checkAnswer(null, 'linux'), null, 'no answer, no state');
  assert.equal(checkAnswer({ state: 'bogus' }, 'linux'), null, 'only a declared state is drawn');
  const states = JSON.parse(read('core/spec/host-bridge.json')).events['update.state'].states;
  for (const s of states) assert.equal(checkAnswer({ state: s }, 'linux').state, s);
});

test('the phones name how they are updated, and neither checks', () => {
  assert.match(capability({ platform: 'ios', packaged: true }).reason, /TestFlight/);
  assert.match(capability({ platform: 'android', packaged: true }).reason, /APK/);
  assert.equal(capability({ platform: 'ios', packaged: true }).check, false);
  assert.equal(capability({ platform: 'android', packaged: true }).check, false);
});

test('forgetRead drops only a dismissed card, so a fresh answer is shown', () => {
  const card = appUpdateNotice({ state: 'current', version: '1.0.0' });
  const shown = putNotice([], card);
  assert.equal(forgetRead(shown, 'app-update'), shown, 'an unread card is left alone');
  const read = dismissNotice(shown, 'app-update');
  assert.deepEqual(forgetRead(read, 'app-update'), []);
  assert.equal(putNotice(forgetRead(read, 'app-update'), card)[0].read, false);
});

test('Settings ends with an About row that opens the page, and About is drawn by its own component in the sheet chrome', () => {
  const groups = settingsGroups();
  assert.equal(groups.at(-1).id, 'about', 'About is still the last thing in Settings');
  const settings = read('core/app/components/app-settings.js');
  assert.match(settings, /data-action="about"/, 'Settings links to the About page');
  assert.equal(settings.includes('<app-about'), false, 'Settings no longer draws About inline');
  assert.equal(/reveal/.test(settings), false, 'the reveal that scrolled to the About section is gone');
  const about = read('core/app/components/app-about.js');
  assert.match(about, /<app-sheet \.title=\$\{'About'\}/, 'About draws the same sheet chrome as Settings: a title and a back strip');
  assert.match(about, /data-action="check-updates"/, 'About carries Check for updates');
  assert.match(about, /press\(\(\) => this\.fire\('check-updates'\)\)/, 'the button goes through the kit press and raises the check');
  assert.match(about, /class="about-icon"/, 'the app icon sits at the top of About');
  const root = read('core/app/components/app-root.js');
  assert.match(root, /<app-about [^>]*@check-updates=\$\{\(e\) => respond\(e, this\.checkUpdates\(\)\)\}/, 'the press shows the check until the shell answers');
});

test('the app icon on About is generated from desktop/build/icon.svg by the shared icon pipeline', () => {
  const about = read('core/app/components/app-about.js');
  const src = /APP_ICON = '([^']+)'/.exec(about);
  assert.ok(src, 'About names its icon once');
  assert.ok(existsSync(new URL('../app/' + src[1], import.meta.url)), 'the icon is in core/app, so every shell bundles it');
  const pipeline = read('desktop/scripts/icons.mjs');
  assert.match(pipeline, /core\/app\/assets\/app-icon\.png/, 'the pipeline writes it from the one drawing source');
  assert.ok(tokens.size['app-icon'], 'its size is a token');
  assert.match(read('core/app/styles/app.css'), /\.about-icon \{[^}]*var\(--size-app-icon\)/);
});

test('every shell declares and answers updates.check', () => {
  const spec = JSON.parse(read('core/spec/host-bridge.json'));
  assert.ok(spec.commands['updates.check'], 'the bridge spec declares the check');
  const naming = JSON.parse(read('core/spec/naming.json'));
  assert.match(read('ios/' + naming.product + '/HostBridge.swift'), /case "updates\.check":/);
  assert.match(read('android/app/src/main/kotlin/' + naming.ids.android.replaceAll('.', '/') + '/HostBridge.kt'), /"updates\.check" ->/);
});

test('the phone About fixture cannot be activated in a release build, and both phones keep their captures', () => {
  const naming = JSON.parse(read('core/spec/naming.json'));
  const shell = read('ios/' + naming.product + '/ShellView.swift');
  assert.match(shell, /#if DEBUG[\s\S]*--about-fixture[\s\S]*#endif/);
  assert.match(read('ios/project.yml'), /CONFIGURATION.*Debug[\s\S]*core\/test\/about-fixture/);
  const android = 'android/app/src/';
  const pkg = naming.ids.android.replaceAll('.', '/');
  assert.doesNotMatch(read(android + 'main/kotlin/' + pkg + '/MainActivity.kt'), /about-fixture|aboutProof/);
  assert.doesNotMatch(read('core/app/main.js'), /about-fixture|aboutProof/);
  assert.match(read(android + 'androidTest/kotlin/' + pkg + '/AboutPageTest.kt'), /about-fixture\.js/);
  assert.match(read('ios/' + naming.product + 'UITests/AboutPageTests.swift'), /--about-fixture/);
  assert.match(read('.github/workflows/android.yml'), /about-light\.png[\s\S]*about-dark\.png/);
});

test('Escape and a press outside the sheet go back the way the strip does, so About returns to Settings', () => {
  const root = read('core/app/components/app-root.js');
  assert.match(root, /dismissable\(this, \{ name: 'sheet', open: \(\) => this\.sheetShowing && !this\.sheetLeaving, close: \(\) => this\.pageBack\(\) \}\)/);
  const h = host();
  h.openSettings();
  h.openAbout();
  h.pageBack();
  assert.equal(h.view, 'settings');
});
