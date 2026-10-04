// Issues 167 and 168: Settings offers every setting on every width, one tab per section, with the app icon chosen
// there and applied by each shell that can; and on a phone the way back to the chats list is the chats icon from the
// shared set, labelled with where it goes, never a back arrow. The real rules and component sources are read here
// with no browser; the desktop smoke and the phone legs drive the same page at a phone's width.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const defined = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { defined[name] = cls; }, get() { return undefined; } };
globalThis.document = { createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
await import('../app/components/app-root.js');
const AppRoot = defined['app-root'];
const { settingsFields, settingsGroups, settingsTabs } = await import('../app/rules/settings.js');
const { appIconFor, appIconChoices, iconToApply, fixedPalette, FOLLOW_THEME } = await import('../app/rules/app-icons.js');
const { ICON_TOKENS, cssColour, iconPalette, contrast } = await import('../app/rules/icon.js');

const read = (rel) => readFileSync(new URL('../../' + rel, import.meta.url), 'utf8');
const json = (rel) => JSON.parse(read(rel));
const exists = (rel) => existsSync(new URL('../../' + rel, import.meta.url));
const naming = json('core/spec/naming.json');
const icons = json('core/spec/app-icons.json');
const css = read('core/app/styles/app.css').replace(/\/\*[\s\S]*?\*\//g, '');

// The phone's rules of the stylesheet: every rule inside each @media (max-width: 640px) block, braces balanced. A phone
// block placed after the rules it overrides is how it wins over them, so there may be more than one.
function phoneBlock() {
  const blocks = [];
  for (let start = css.indexOf('@media (max-width: 640px)'); start >= 0; start = css.indexOf('@media (max-width: 640px)', start + 1)) {
    let depth = 0;
    for (let i = css.indexOf('{', start); i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      if (css[i] === '}') { depth -= 1; if (depth === 0) { blocks.push(css.slice(start, i + 1)); break; } }
    }
  }
  assert.ok(blocks.length > 0, 'the stylesheet has a phone block');
  return blocks.join('\n');
}

test('inventory: every setting the desktop page offers is reached from a tab, and the phone hides none of them', () => {
  const tabs = settingsTabs();
  assert.deepEqual(tabs.map((t) => t.id), settingsGroups().map((g) => g.id), 'one tab per section, in the schema\'s order');
  assert.equal(tabs.at(-1).id, 'about', 'About is the last tab, so it stays reachable under Settings (issue 171)');
  const seen = new Map();
  for (const tab of tabs) for (const key of tab.keys) { assert.ok(!seen.has(key), key + ' is in two tabs'); seen.set(key, tab.id); }
  for (const field of settingsFields()) assert.ok(seen.has(field.key), field.key + ' is reached from no tab');
  assert.equal(seen.size, settingsFields().length, 'no tab offers a key the schema does not declare');
  // The page is one component on every width, so the only way a phone could lose a setting is the stylesheet hiding it.
  const phone = phoneBlock();
  for (const m of phone.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/display:\s*none|visibility:\s*hidden/.test(m[2])) continue;
    assert.equal(/setting|sheet-section|sheet-nav|settings-tab|theme|app-icon/.test(m[1]), false, 'the phone hides ' + m[1].trim());
  }
});

test('the settings page draws its sections as tabs: a tablist, one tab and one panel per section', () => {
  const src = read('core/app/components/app-settings.js');
  for (const part of ['role="tablist"', 'role="tab"', 'role="tabpanel"', 'aria-selected=', 'aria-controls=', 'aria-labelledby=']) assert.ok(src.includes(part), 'the page draws ' + part);
  assert.match(src, /settingsTabs\(\)/, 'the tabs come from the schema, never a second list');
  assert.match(src, /press\(\(\) => this\.selectTab\(/, 'a tab is a kit press');
  assert.match(read('core/app/components/app-sheet.js'), /sheet-nav/, 'the sheet draws the tabs above its scrolled body');
});

test('on a phone Settings and About are pages that fill the screen, not a card over the app', () => {
  const phone = phoneBlock();
  assert.match(phone, /\.sheet\s*\{[^}]*width:\s*100%[^}]*height:\s*100%/, 'the sheet fills the phone');
  assert.match(phone, /\.sheet-scrim\s*\{[^}]*padding:\s*var\(--inset-top\) var\(--inset-right\) var\(--inset-bottom\) var\(--inset-left\)/, 'no backdrop margin around it, only the system bars');
  assert.match(phone, /\.sheet-scrim\s*\{[^}]*background:\s*var\(--color-bg-raised\)/, 'the bars wear the page\'s own surface');
});

test('the app icon is a setting the server holds, offered from the one spec: Follow theme first and the default', () => {
  const field = settingsFields().find((f) => f.key === 'appearance.appIcon');
  assert.ok(field, 'Settings offers the app icon');
  assert.equal(field.group, 'appearance');
  assert.equal(field.type, 'icon');
  assert.deepEqual(field.options, icons.icons.map((i) => i.id));
  assert.equal(icons.default, FOLLOW_THEME, 'the icon follows the theme unless a fixed palette is chosen (issue 189)');
  assert.equal(icons.icons[0].id, FOLLOW_THEME, 'Follow theme is the first choice');
  assert.equal(icons.icons[0].label, 'Follow theme');
  assert.equal(field.default, FOLLOW_THEME);
  const [fixed, other] = icons.icons.filter((i) => i.id !== FOLLOW_THEME).map((i) => i.id);
  assert.equal(appIconFor({}), FOLLOW_THEME);
  assert.equal(appIconFor({ 'appearance.appIcon': fixed }), fixed);
  assert.equal(appIconFor({ 'appearance.appIcon': 'nope' }), FOLLOW_THEME, 'an id the spec does not hold follows the theme');
  const choices = appIconChoices({ 'appearance.appIcon': other });
  assert.deepEqual(choices.map((c) => c.id), icons.icons.map((i) => i.id));
  assert.deepEqual(choices.filter((c) => c.selected).map((c) => c.id), [other]);
  for (const c of choices) assert.equal(c.src, c.id === FOLLOW_THEME ? 'assets/app-icon.png' : 'assets/app-icons/' + c.id + '.png');
  // Follow theme's picture is the icon in the theme in force, drawn by the page; until it is, the default theme's.
  assert.equal(appIconChoices({}, { themePicture: 'data:image/png;base64,AAAA' })[0].src, 'data:image/png;base64,AAAA');
  assert.equal(iconToApply(null, {}), FOLLOW_THEME, 'the first settings read applies the icon');
  assert.equal(iconToApply(fixed, { 'appearance.appIcon': fixed }), null, 'an icon already applied is not asked for again');
  assert.equal(iconToApply(fixed, { 'appearance.appIcon': other }), other);
  assert.equal(fixedPalette(FOLLOW_THEME), null, 'Follow theme has no palette of its own');
  assert.deepEqual(fixedPalette(fixed), { scheme: icons.icons.find((i) => i.id === fixed).scheme, colors: icons.icons.find((i) => i.id === fixed).colors });
});

test('every fixed palette is the Flor de muerto masters coloured through the one palette, and ships on every platform', () => {
  assert.equal(exists('desktop/build/icon.svg'), false, 'the chat bubble drawing is gone (issue 189), so no choice recolours it');
  const pipeline = read('desktop/scripts/icons.mjs');
  assert.match(pipeline, /core\/spec\/app-icons\.json/, 'the icon pipeline draws every choice from the spec');
  assert.doesNotMatch(pipeline, /recolou?r\(|icon\.svg/, 'never by recolouring a drawing');
  const ios = 'ios/' + naming.product;
  const res = 'android/app/src/main/res/';
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  const aliases = [...manifest.matchAll(/<activity-alias\b([\s\S]*?)<\/activity-alias>/g)].map((m) => m[1]);
  assert.equal(aliases.length, icons.icons.length, 'one launcher alias per choice');
  const activity = manifest.slice(manifest.indexOf('android:name=".MainActivity"'), manifest.indexOf('<activity-alias'));
  assert.ok(activity.length > 0, 'the activity is declared before its aliases');
  assert.equal(activity.includes('category.LAUNCHER'), false, 'only the aliases are launchers, so the icon is the alias in force');
  const alternates = /ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES:\s*"([^"]*)"/.exec(read('ios/project.yml'));
  assert.ok(alternates, 'the iOS project ships the alternate icons');
  assert.match(read('ios/project.yml'), /ASSETCATALOG_COMPILER_INCLUDE_ALL_APPICON_ASSETS:\s*YES/);
  const named = alternates[1].split(/\s+/).filter(Boolean).sort();
  assert.deepEqual(named, icons.icons.filter((i) => i.id !== FOLLOW_THEME).map((i) => 'AppIcon-' + i.id).sort());
  const launcherColours = read(res + 'values/app_icons.xml');
  for (const icon of icons.icons) {
    const alias = aliases.find((a) => a.includes('android:name=".AppIcon_' + icon.id + '"'));
    assert.ok(alias, icon.id + ' has its Android launcher alias');
    assert.match(alias, /android:targetActivity="\.MainActivity"/);
    assert.match(alias, /category\.LAUNCHER/);
    assert.ok(alias.includes('android:enabled="' + (icon.id === FOLLOW_THEME) + '"'), icon.id + ': only Follow theme launches a fresh install');
    if (icon.id === FOLLOW_THEME) {
      // A phone cannot recolour an installed icon, so Follow theme there is the store icon, drawn in the default theme.
      assert.equal(icon.colors, undefined, 'Follow theme carries no colours of its own');
      assert.ok(alias.includes('@mipmap/ic_launcher"'), 'Follow theme is the primary launcher icon');
      continue;
    }
    assert.ok(['light', 'dark'].includes(icon.scheme), icon.id + ' names the scheme its palette is drawn in');
    for (const key of ICON_TOKENS) assert.ok(cssColour(icon.colors[key]), icon.id + ' gives ' + key + ' as a colour');
    const palette = iconPalette(icon.colors, icon.scheme);
    assert.ok(contrast(palette.glyph, palette.tile.behind) >= 2.6, icon.id + ': the glyph reads on its tile');
    assert.ok(exists('core/app/assets/app-icons/' + icon.id + '.png'), icon.id + ' has its picture for the page');
    assert.ok(alias.includes('@mipmap/ic_launcher_' + icon.id + '"'), icon.id + ' alias wears its own icon');
    assert.ok(exists(ios + '/Assets.xcassets/AppIcon-' + icon.id + '.appiconset/AppIcon.png'), icon.id + ' ships as an iOS alternate icon');
    const adaptive = read(res + 'mipmap-anydpi-v26/ic_launcher_' + icon.id + '.xml');
    assert.match(adaptive, new RegExp('@color/ic_launcher_background_' + icon.id + '"'));
    assert.match(adaptive, new RegExp('@mipmap/ic_launcher_foreground_' + icon.id + '"'));
    assert.match(adaptive, /@mipmap\/ic_launcher_monochrome"/, 'a themed launcher tints the one glyph whatever the palette');
    for (const d of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) assert.ok(exists(res + 'mipmap-' + d + '/ic_launcher_foreground_' + icon.id + '.png'), icon.id + ' foreground at ' + d);
    assert.equal(exists(res + 'drawable/ic_launcher_foreground_' + icon.id + '.xml'), false, 'no vector foreground of the old drawing');
    assert.match(launcherColours, new RegExp('<color name="ic_launcher_background_' + icon.id + '">' + palette.tile.behind + '</color>', 'i'), icon.id + ': the launcher tile is the palette\'s');
  }
  assert.match(read('package.json'), /icons\.mjs --check/, 'pnpm run build holds every generated icon to the spec');
});

test('every shell answers app.icon', () => {
  const spec = json('core/spec/host-bridge.json');
  assert.ok(spec.commands['app.icon'], 'the bridge declares app.icon');
  assert.deepEqual(spec.commands['app.icon'].args, { icon: 'string' });
  assert.match(read('ios/' + naming.product + '/HostBridge.swift'), /case "app\.icon":/);
  const pkg = naming.ids.android.replaceAll('.', '/');
  assert.match(read('android/app/src/main/kotlin/' + pkg + '/HostBridge.kt'), /"app\.icon" ->/);
  assert.match(read('desktop/src/bridge-handlers.js'), /'app\.icon':/);
  assert.match(read('ios/' + naming.product + 'Tests/NamingTests.swift'), /"app\.icon"/);
  assert.match(read('android/app/src/androidTest/kotlin/' + pkg + '/ShellParityTest.kt'), /"app\.icon"/);
});

test('the phone Settings fixture cannot be activated in a release build, and both phones keep their captures', () => {
  const pkg = naming.ids.android.replaceAll('.', '/');
  assert.match(read('ios/' + naming.product + '/ShellView.swift'), /#if DEBUG[\s\S]*--settings-fixture[\s\S]*#endif/);
  assert.match(read('ios/project.yml'), /CONFIGURATION.*Debug[\s\S]*core\/test\/settings-fixture/);
  assert.doesNotMatch(read('android/app/src/main/kotlin/' + pkg + '/MainActivity.kt'), /settings-fixture|settingsProof/);
  assert.doesNotMatch(read('core/app/main.js'), /settings-fixture|settingsProof/);
  assert.match(read('android/app/src/androidTest/kotlin/' + pkg + '/SettingsPageTest.kt'), /settings-fixture\.js/);
  assert.match(read('ios/' + naming.product + 'UITests/SettingsPageTests.swift'), /--settings-fixture/);
  assert.match(read('.github/workflows/android.yml'), /settings-light\.png[\s\S]*settings-dark\.png/);
});

test('the page asks its shell for the chosen icon once the settings are read, and only when it changes', async () => {
  const h = new AppRoot();
  const calls = [];
  h.bridge = async (name, args) => { calls.push([name, args]); return { applied: true, icon: args.icon }; };
  h.settings = { 'appearance.appIcon': 'night' };
  h.settingsRead = false;
  await h.applyAppIcon();
  assert.deepEqual(calls, [], 'nothing is applied before the server\'s settings are read');
  h.settingsRead = true;
  await h.applyAppIcon();
  await h.applyAppIcon();
  assert.deepEqual(calls, [['app.icon', { icon: 'night' }]], 'one change, one ask');
  h.settings = { 'appearance.appIcon': 'paper' };
  await h.applyAppIcon();
  assert.deepEqual(calls.at(-1), ['app.icon', { icon: 'paper' }]);
});

test('Follow theme draws its picture from the theme in force, and a fixed palette is drawn from the spec', () => {
  const root = read('core/app/components/app-root.js');
  assert.match(root, /\.themePicture=\$\{this\.themePicture\}/, 'the page hands Settings the icon in the theme in force');
  assert.match(root, /renderIcon\(/, 'drawn by the one renderer every platform shares');
  assert.match(read('core/app/components/app-settings.js'), /appIconChoices\(this\.values, \{ themePicture: this\.themePicture \}\)/);
  const mirror = read('core/app/rules/app-icons-spec.js');
  assert.match(mirror, /export const ICON_MASTERS/, 'the page reads the masters from the generated mirror');
  assert.ok(mirror.includes(JSON.stringify(read('core/spec/icon/flor-de-muerto.svg'))), 'the mirror holds the master verbatim');
});

test('issue 168: the way back to the chats list is the chats icon, labelled with where it goes', () => {
  const glyphs = json('core/spec/tokens.json').icons.glyphs;
  assert.ok(glyphs['messages-square'] && glyphs['messages-square']['sf-symbol'], 'the chats icon is in the shared set');
  const conv = read('core/app/components/app-conversation.js');
  const back = /<button class="conv-back"[^>]*>[\s\S]*?<\/button>/.exec(conv);
  assert.ok(back, 'the conversation draws its way back');
  assert.match(back[0], /aria-label="Back to chats"/);
  assert.match(back[0], /data-icon="messages-square"/);
  assert.equal(/\u2190|←|arrow-left/.test(back[0]), false, 'no back arrow on the way to the chats list');
  // Settings is reached from the chats list on a phone, so its way back there is the same control.
  const settings = read('core/app/components/app-settings.js');
  assert.match(settings, /\.narrowLabel=\$\{'Back to chats'\}/);
  assert.match(settings, /\.narrowIcon=\$\{'messages-square'\}/);
  const sheet = read('core/app/components/app-sheet.js');
  assert.match(sheet, /sheet-back-narrow/);
  const phone = phoneBlock();
  assert.match(phone, /\.sheet-back-wide\s*\{[^}]*display:\s*none/, 'the phone hides the desktop\'s arrow and label');
  assert.match(css, /\.sheet-back-narrow\s*\{[^}]*display:\s*none/, 'the desktop hides the phone\'s chats control');
});
