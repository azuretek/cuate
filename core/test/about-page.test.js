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

test('About opened from Settings slides up over it, and its back returns to Settings sliding down', () => {
  const h = host();
  h.openSettings();
  assert.equal(h.view, 'settings');
  h.openAbout();
  assert.equal(h.view, 'about', 'About is a page of its own, not a section of Settings');
  assert.equal(h.aboutFrom, 'settings');
  assert.equal(h.sheetLeaving, false, 'the sheet stays up: the page slides over it, not a second sheet');
  assert.equal(h.pageMotion, 'up', 'About slides up into its place (issue 244)');
  h.pageBack();
  assert.equal(h.view, 'settings', 'back from About returns to Settings');
  assert.equal(h.pageMotion, 'down', 'Settings slides down into place (issue 244)');
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

// Issue 192: a phone's check reads the release feed through its shell and the page decides, so a newer build is
// offered the way the platform installs it, and the same build is answered as the latest.
const feedOf = (...tags) => '<feed xmlns="http://www.w3.org/2005/Atom">' + tags.map((t) => '<entry><id>tag:github.com,2008:Repository/1/' + t + '</id></entry>').join('') + '</feed>';

test('a phone reads the release feed through its shell and offers a newer build the way it installs', async () => {
  for (const [platform, label, command] of [['ios', 'Open TestFlight', 'updates.install'], ['android', 'Download', 'updates.download']]) {
    const h = host();
    h.host = { platform, version: '0.0.1-dev.97.370d8cc7a0' };
    const calls = [];
    h.bridge = async (name, args) => { calls.push([name, args]); return feedOf('v0.0.1-dev.98.7699911abc', 'v0.0.1-dev.97.370d8cc7a0'); };
    assert.equal(await h.checkUpdates(), true);
    assert.deepEqual(calls, [['updates.releases', {}]], platform + ' asks its shell for the feed, never the network');
    // The card shows the check for the min-visible floor first, so the answer is read from the state it will draw.
    const card = appUpdateNotice(h.updateStatus);
    assert.match(card.message, /0\.0\.1-dev\.98\.7699911abc/, platform);
    assert.equal(card.action.label, label, platform);
    assert.equal(card.action.command, command, platform);
    assert.equal(h.updateStatus.via, capability({ platform, packaged: true }).via);
  }
});

test('a phone on the newest build is told so, and a feed it cannot read fails the press with the reason', async () => {
  const h = host();
  h.host = { platform: 'ios', version: '0.0.1-dev.98.7699911abc' };
  h.bridge = async () => feedOf('v0.0.1-dev.98.7699911abc');
  assert.equal(await h.checkUpdates(), true);
  assert.match(appUpdateNotice(h.updateStatus).message, /latest version/);
  h.bridge = async () => { throw new Error('offline'); };
  assert.equal(await h.checkUpdates(), false);
  const card = appUpdateNotice(h.updateStatus);
  assert.equal(card.tone, 'error');
  assert.match(card.detail, /release list could not be read/);
  assert.equal(card.action, null, 'a failed check offers no download');
});

test('the check at launch speaks only when a newer build exists, and the Android download names its release', async () => {
  const h = host();
  h.host = { platform: 'android', version: '0.0.1-dev.98.7699911abc' };
  h.bridge = async () => feedOf('v0.0.1-dev.98.7699911abc');
  await h.phoneCheck({ asked: false });
  assert.equal(h.appNotices.some((n) => n.id === 'app-update'), false, 'nothing newer, nothing said');
  h.bridge = async () => { throw new Error('offline'); };
  await h.phoneCheck({ asked: false });
  assert.equal(h.appNotices.some((n) => n.id === 'app-update'), false, 'an unreachable feed at launch is not news');
  const calls = [];
  h.bridge = async (name, args) => { calls.push([name, args]); return name === 'updates.releases' ? feedOf('v0.0.1-dev.99.abcdef0123') : true; };
  await h.phoneCheck({ asked: false });
  assert.equal(h.updateStatus.state, 'available');
  assert.equal(await h.aboutPress({ command: 'updates.download' }), true, 'About\'s button is the notice\'s step');
  assert.deepEqual(calls.at(-1), ['updates.download', { version: '0.0.1-dev.99.abcdef0123' }]);
  h.onUpdate({ state: 'downloading', version: '0.0.1-dev.99.abcdef0123', percent: 0.5, transferred: 5 * 1024 * 1024, total: 10 * 1024 * 1024, canInstall: true });
  assert.equal(h.updateStatus.detail, '5.0 MB of 10 MB', 'the shell\'s byte counts are put into words by the page');
  assert.equal(h.updateStatus.via, 'apk');
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

test('About takes the update state under a name that is not LitElement\'s own update()', () => {
  // A reactive property called update shadows the element's render step, and the page throws "this.update is not a
  // function" the moment About draws; it reached an emulator once (issue 192), so it is held here.
  const about = read('core/app/components/app-about.js');
  assert.doesNotMatch(about, /static properties = \{[^}]*\bupdate:/);
  assert.match(about, /release: \{ attribute: false \}/);
  assert.match(read('core/app/components/app-root.js'), /<app-about [^>]*\.release=\$\{this\.updateStatus\}/);
});

test('the phones name how they are updated, and both check', () => {
  assert.match(capability({ platform: 'ios', packaged: true }).reason, /TestFlight/);
  assert.match(capability({ platform: 'android', packaged: true }).reason, /APK/);
  assert.equal(capability({ platform: 'ios', packaged: true }).check, true);
  assert.equal(capability({ platform: 'android', packaged: true }).check, true);
});

test('forgetRead drops only a dismissed card, so a fresh answer is shown', () => {
  const card = appUpdateNotice({ state: 'current', version: '1.0.0' });
  const shown = putNotice([], card);
  assert.equal(forgetRead(shown, 'app-update'), shown, 'an unread card is left alone');
  const read = dismissNotice(shown, 'app-update');
  assert.deepEqual(forgetRead(read, 'app-update'), []);
  assert.equal(putNotice(forgetRead(read, 'app-update'), card)[0].read, false);
});

test('Settings draws an About row on every page that opens the page, and About is drawn by its own component in the sheet chrome', () => {
  const groups = settingsGroups();
  assert.equal(groups.some((g) => g.kind === 'about'), false, 'About is not a section of Settings (issue 244)');
  const settings = read('core/app/components/app-settings.js');
  assert.match(settings, /settings-about-row/, 'the About row is drawn on the page');
  assert.match(settings, /this\.aboutRow\(\)/, 'the About row is part of the body, so it sits under every tab');
  assert.match(settings, /data-action="about"/, 'Settings links to the About page');
  assert.equal(settings.includes('<app-about'), false, 'Settings no longer draws About inline');
  assert.equal(/reveal/.test(settings), false, 'the reveal that scrolled to the About section is gone');
  const about = read('core/app/components/app-about.js');
  assert.match(about, /<app-sheet \.title=\$\{'About'\}/, 'About draws the same sheet chrome as Settings: a title and a back strip');
  assert.match(about, /data-action="check-updates"/, 'About carries Check for updates');
  assert.match(about, /press\(\(\) => this\.fire\('check-updates', \{ command: update\.command \}\)\)/, 'the button goes through the kit press and raises the check, or the step the notice offers');
  assert.match(about, /class="about-icon"/, 'the app icon sits at the top of About');
  const root = read('core/app/components/app-root.js');
  assert.match(root, /<app-about [^>]*@check-updates=\$\{\(e\) => respond\(e, this\.aboutPress\(e\.detail\)\)\}/, 'the press shows the check, or the step, until the shell answers');
});

test('the app icon on About is generated from the Flor de muerto masters by the shared icon pipeline', () => {
  const about = read('core/app/components/app-about.js');
  const src = /APP_ICON = '([^']+)'/.exec(about);
  assert.ok(src, 'About names its icon once');
  assert.ok(existsSync(new URL('../app/' + src[1], import.meta.url)), 'the icon is in core/app, so every shell bundles it');
  const pipeline = read('desktop/scripts/icons.mjs');
  assert.match(pipeline, /core\/app\/assets\/app-icon\.png/, 'the pipeline writes it');
  assert.match(pipeline, /core\/spec\/icon\/flor-de-muerto\.svg/, 'from the one drawing source, the master glyph');
  assert.ok(tokens.size['app-icon'], 'its size is a token');
  assert.match(read('core/app/styles/app.css'), /\.about-icon \{[^}]*var\(--size-app-icon\)/);
});

test('About shows the icon in force, live for Follow theme, and follows a change without a reload (issue 246)', () => {
  const about = read('core/app/components/app-about.js');
  assert.match(about, /import \{ appIconChoices \} from '..\/rules\/app-icons.js'/);
  assert.match(about, /currentIcon\(\)/);
  assert.match(about, /appIconChoices\(this\.values \|\| \{\}, \{ themePicture: this\.themePicture \}\)/);
  assert.match(about, /<img class="about-icon" src=\$\{this\.currentIcon\(\)\} alt="">/);
  const root = read('core/app/components/app-root.js');
  assert.match(root, /<app-about [^>]*\.values=\$\{this\.settings\} \.themePicture=\$\{this\.themePicture\}/, 'app-root hands About the settings and the live theme picture');
  // The picture is not one fixed drawing any more.
  assert.equal(about.includes('src=${APP_ICON}'), false, 'About no longer draws one fixed icon');
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

// Issue 244: Settings and About are distinct pages that arrive on their own edge, and reduced motion is a straight cut.
test('Settings and About arrive on their own edge, and reduced motion drops the travel', () => {
  const css = read('core/app/styles/app.css');
  assert.match(css, /@keyframes page-down \{ from \{ transform: translateY\(-100%\); \}/, 'Settings slides down into place');
  assert.match(css, /@keyframes page-up \{ from \{ transform: translateY\(100%\); \}/, 'About slides up into its place');
  assert.match(css, /app-settings\[data-motion="down"\], app-about\[data-motion="down"\] \{ animation: page-down/, 'Settings uses the down motion');
  assert.match(css, /app-settings\[data-motion="up"\], app-about\[data-motion="up"\] \{ animation: page-up/, 'About uses the up motion');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ app-settings\[data-motion\], app-about\[data-motion\] \{ animation: none; \} \}/, 'reduced motion is a straight cut');
  assert.match(css, /\.sheet\[data-arrive="down"\]/, 'the Settings sheet arrives from the top');
  assert.match(css, /\.sheet\[data-arrive="up"\]/, 'the About sheet arrives from the bottom');
  assert.match(css, /app-settings\[data-motion="up"\], app-about\[data-motion="up"\] \{ animation: page-up var\(--motion-sheet-in\) var\(--motion-sheet-ease\)/, 'a page move runs on the sheet arrival duration and curve (issue 253)');
  // The two are distinct surfaces: About has its own header and its own way back to Settings.
  assert.match(read('core/app/components/app-about.js'), /app-sheet \.title=\$\{'About'\}/, 'About draws its own header, not Settings');
  assert.match(read('core/app/components/app-root.js'), /\.backLabel=\$\{this\.aboutFrom === 'settings' \? 'Back to settings' : 'Back to app'\}/, 'About keeps its own way back to Settings');
  const h = host();
  h.openSettings();
  assert.equal(h.sheetMotion, 'up', 'a fresh Settings sheet rises from the bottom edge (issue 253)');
  h.openAbout();
  assert.equal(h.sheetMotion, null, 'the page switch does not re-slide the sheet');
  assert.equal(h.pageMotion, 'up');
});

test('the copy action is the real button with the kit press, and no update line sits under the check (PR 257)', () => {
  const about = read('core/app/components/app-about.js');
  assert.match(about, /class="button about-copy"/, 'Copy for a bug report is the app real button, not a text link');
  assert.match(about, /[?]disabled=[$][{]this[.]copying[}]/, 'the button is disabled while a copy is in flight and for the beat after');
  assert.match(about, /if [(]this[.]copying[)] return false;/, 'a second press during the beat copies nothing twice');
  assert.match(about, /@click=[$][{]press[(][(][)] => this[.]copy[(][)][)][}]/, 'the press goes through the kit, so it shows the pending state and the confirmation');
  assert.match(about, /this[.]copied === .copied. [?] .Copied./, 'a readable confirmation, the button own label, not a notice');
  assert.equal(/about-update-line|about-update-progress/.test(about), false, 'the outcome is the notice banner, never a line beside the button');
  const css = read('core/app/styles/app.css');
  assert.equal(/about-update-line|about-update-progress/.test(css), false, 'the stylesheet carries no rule for a line that is gone');
});
