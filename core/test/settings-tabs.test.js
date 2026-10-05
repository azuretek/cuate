// Issues 167 and 168: Settings offers every setting on every width, one tab per section, with the app icon chosen
// there and applied by each shell that can; and on a phone the way back to the chats list is the chats icon from the
// shared set, labelled with where it goes, never a back arrow. The real rules and component sources are read here
// with no browser; the desktop smoke and the phone legs drive the same page at a phone's width.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const defined = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { defined[name] = cls; }, get() { return undefined; } };
globalThis.document = { createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
await import('../app/components/app-root.js');
const AppRoot = defined['app-root'];
const { settingsFields, settingsGroups, settingsTabs } = await import('../app/rules/settings.js');
const { appIconFor, appIconChoices, iconToApply, fixedPalette, FOLLOW_THEME } = await import('../app/rules/app-icons.js');
const { TEXT_SCALES } = await import('../app/rules/theme.js');
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
  assert.deepEqual(tabs.map((t) => t.id), ['appearance', 'behavior', 'device'], 'with the notices and updates tabs merged into Behavior and no About tab (issue 244)');
  assert.equal(tabs.some((t) => t.id === 'notifications' || t.id === 'updates' || t.id === 'about'), false, 'the Notifications, Updates and About tabs are gone (issue 244)');
  const settings = read('core/app/components/app-settings.js');
  assert.match(settings, /settings-about-row/, 'the About row is drawn on the page');
  assert.match(settings, /data-action="about"/, 'the About row opens the About page');
  assert.match(settings, /this\.aboutRow\(\)/, 'the About row is part of the body, so it sits under every tab');
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

test('the app icon is a setting the server holds, offered from the one spec: each colour a Light/Dark family, Barro Dark the default (issue 246)', () => {
  const field = settingsFields().find((f) => f.key === 'appearance.appIcon');
  assert.ok(field, 'Settings offers the app icon');
  assert.equal(field.group, 'appearance');
  assert.equal(field.type, 'icon');
  const variants = icons.families.flatMap((f) => ['light', 'dark'].map((k) => ({ family: f.id, familyLabel: f.label, ...f.variants[k] })));
  assert.deepEqual(field.options, [...variants.map((v) => v.id), FOLLOW_THEME]);
  // Every colour is one family with a paper Light variant and a bright Dark one, in the spec's order (issue 246).
  assert.deepEqual(icons.families.map((f) => f.id), ['naranja', 'azul', 'rosa', 'jade', 'morado']);
  for (const f of icons.families) {
    assert.equal(f.variants.light.label, 'Light', f.id + ' names its paper variant Light');
    assert.equal(f.variants.dark.label, 'Dark', f.id + ' names its bright variant Dark');
    assert.notEqual(f.variants.light.id, f.variants.dark.id, f.id + ' gives each variant its own id');
  }
  assert.equal(icons.default, 'naranja_dark', 'the original terracotta is the default (issue 246)');
  assert.equal(icons.families[0].id, 'naranja', 'the terracotta family is first (issue 246)');
  assert.equal(field.default, 'naranja_dark');
  // Every colour's name is Spanish, with no extra text: the tile's label is the colour alone, and which variant it is
  // lives in the tile's accessible name and in the swatch (issue 254).
  const names = ['Barro', 'Azul', 'Rosa', 'Nopal', 'Morado'];
  for (const name of names) assert.ok(variants.some((v) => v.familyLabel === name), 'the colour ' + name + ' is offered');
  for (const v of variants) assert.equal(/light|dark|mexicano/i.test(v.familyLabel), false, v.familyLabel + ' carries no extra text beside the name');
  const allChoices = appIconChoices({});
  for (const c of allChoices) assert.equal(/light|dark/i.test(c.label), false, 'the tile label ' + c.label + ' is the name alone');
  assert.deepEqual(allChoices.filter((c) => c.variantLabel).map((c) => c.label), variants.map((v) => v.familyLabel), 'each variant tile carries the colour name alone');
  assert.equal(/mexicano/i.test(JSON.stringify(icons)), false, 'the word Mexicano is gone (issue 254)');
  assert.equal(/cempas/i.test(JSON.stringify(icons)), false, 'the Cempasuchil choice is gone (issue 254)');
  const familyIds = icons.families.flatMap((f) => [f.id, ...['light', 'dark'].map((k) => f.variants[k].id)]);
  for (const gone of ['night', 'teal', 'orange', 'paper', 'rosa mexicano']) assert.equal(familyIds.includes(gone), false, 'the dropped choice ' + gone + ' is gone');
  assert.equal(icons.followTheme.id, FOLLOW_THEME, 'Follow theme is still a choice');
  assert.equal(appIconFor({}), icons.default);
  assert.equal(appIconFor({ 'appearance.appIcon': 'azul_light' }), 'azul_light');
  assert.equal(appIconFor({ 'appearance.appIcon': 'nope' }), icons.default, 'an id the spec does not hold draws the default');
  const choices = appIconChoices({ 'appearance.appIcon': 'jade_dark' });
  assert.deepEqual(choices.map((c) => c.id), [...variants.map((v) => v.id), FOLLOW_THEME]);
  assert.deepEqual(choices.filter((c) => c.selected).map((c) => c.id), ['jade_dark']);
  for (const c of choices) assert.equal(c.src, c.id === FOLLOW_THEME ? 'assets/app-icon.png' : 'assets/app-icons/' + c.id + '.png');
  // Follow theme's picture is the icon in the theme in force, drawn by the page; until it is, the default theme's.
  assert.equal(appIconChoices({}, { themePicture: 'data:image/png;base64,AAAA' }).find((c) => c.id === FOLLOW_THEME).src, 'data:image/png;base64,AAAA');
  assert.equal(iconToApply(null, {}), icons.default, 'the first settings read applies the icon');
  assert.equal(iconToApply('naranja_dark', { 'appearance.appIcon': 'naranja_dark' }), null, 'an icon already applied is not asked for again');
  assert.equal(iconToApply('naranja_dark', { 'appearance.appIcon': 'azul_light' }), 'azul_light');
  assert.equal(fixedPalette(FOLLOW_THEME), null, 'Follow theme has no palette of its own');
  const one = variants.find((v) => v.id === 'azul_light');
  assert.deepEqual(fixedPalette('azul_light'), { scheme: one.scheme, colors: one.colors });
});

test('every variant is the Flor de muerto masters coloured through the one palette, and ships on every platform', () => {
  assert.equal(exists('desktop/build/icon.svg'), false, 'the chat bubble drawing is gone (issue 189), so no choice recolours it');
  const pipeline = read('desktop/scripts/icons.mjs');
  assert.match(pipeline, /core\/spec\/app-icons\.json/, 'the icon pipeline draws every choice from the spec');
  assert.doesNotMatch(pipeline, /recolou?r\(|icon\.svg/, 'never by recolouring a drawing');
  const variants = icons.families.flatMap((f) => ['light', 'dark'].map((k) => ({ family: f.id, ...f.variants[k] })));
  const ios = 'ios/' + naming.product;
  const res = 'android/app/src/main/res/';
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  const aliases = [...manifest.matchAll(/<activity-alias\b([\s\S]*?)<\/activity-alias>/g)].map((m) => m[1]);
  assert.equal(aliases.length, variants.length + 1, 'one launcher alias per variant, plus Follow theme');
  const activity = manifest.slice(manifest.indexOf('android:name=".MainActivity"'), manifest.indexOf('<activity-alias'));
  assert.ok(activity.length > 0, 'the activity is declared before its aliases');
  assert.equal(activity.includes('category.LAUNCHER'), false, 'only the aliases are launchers, so the icon is the alias in force');
  const alternates = /ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES:\s*"([^"]*)"/.exec(read('ios/project.yml'));
  assert.ok(alternates, 'the iOS project ships the alternate icons');
  assert.match(read('ios/project.yml'), /ASSETCATALOG_COMPILER_INCLUDE_ALL_APPICON_ASSETS:\s*YES/);
  const named = alternates[1].split(/\s+/).filter(Boolean).sort();
  assert.deepEqual(named, variants.map((v) => 'AppIcon-' + v.id).sort(), 'every variant ships an iOS alternate set');
  const launcherColours = read(res + 'values/app_icons.xml');
  for (const icon of variants) {
    const alias = aliases.find((a) => a.includes('android:name=".AppIcon_' + icon.id + '"'));
    assert.ok(alias, icon.id + ' has its Android launcher alias');
    assert.match(alias, /android:targetActivity="\.MainActivity"/);
    assert.match(alias, /category\.LAUNCHER/);
    assert.ok(alias.includes('android:enabled="' + (icon.id === icons.default) + '"'), icon.id + ': only the default choice launches a fresh install');
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
  // Follow theme is the store icon on Android, drawn in the default theme (the phones cannot recolour).
  const themeAlias = aliases.find((a) => a.includes('android:name=".AppIcon_theme"'));
  assert.ok(themeAlias && themeAlias.includes('@mipmap/ic_launcher"'), 'Follow theme is the primary launcher icon');
  // Cempasuchil is gone with no orphan left behind: no reference survives, and no file carries its name (issue 254).
  assert.equal(/cempas/i.test(manifest + launcherColours + named.join(' ')), false, 'nothing names the dropped Cempasuchil choice');
  for (const dir of ['core/app/assets/app-icons', 'android/app/src/main/res', 'ios/' + naming.product + '/Assets.xcassets']) {
    const leftover = readdirSync(new URL('../../' + dir, import.meta.url), { recursive: true }).filter((f) => /cempas/i.test(String(f)));
    assert.deepEqual(leftover, [], dir + ' carries no orphaned Cempasuchil asset');
  }
  assert.match(read('package.json'), /icons\.mjs --check/, 'pnpm run build holds every generated icon to the spec');
  const palette = json('core/spec/tokens.json').color.light;
  const orange = icons.families.find((f) => f.id === 'naranja').variants.dark;
  assert.equal(orange.scheme, 'light');
  assert.deepEqual(orange.colors, Object.fromEntries(ICON_TOKENS.map((k) => [k, palette[k]])), 'Barro Dark is the original orange: the default theme light palette, so the picker, About and every generated asset share the one colour (PR 257)');
  const drawn = iconPalette(orange.colors, orange.scheme);
  assert.equal(drawn.glyph, '#ffffff', 'the original orange draws the About icon: a white glyph on the terracotta tile (PR 257)');
  assert.equal(drawn.tile.behind, palette.accent, 'the tile is the terracotta accent, not a near-black picker tile');
  assert.ok(drawn.tile.top !== drawn.tile.bottom, 'the terracotta tile keeps its gradient, lighter at the top');
});

test('the icon choices read as one grid with the themes, grouped per colour, with Follow theme marked (issue 246)', () => {
  const sheetCss = read('core/app/styles/app.css').replace(/\/\*[\s\S]*?\*\//g, '');
  // The two grids take one set of columns and gaps, and the tiles one name treatment.
  assert.match(sheetCss, /\.app-icon-choices \{[^}]*grid-template-columns: repeat\(auto-fill, minmax\(calc\(var\(--size-avatar\) \* 3\), 1fr\)\)/);
  assert.match(sheetCss, /\.app-icon-choices \{[^}]*gap: var\(--space-2\)/);
  assert.match(sheetCss, /\.theme-grid \{[^}]*grid-template-columns: repeat\(auto-fill, minmax\(calc\(var\(--size-avatar\) \* 3\), 1fr\)\)/);
  assert.match(sheetCss, /\.theme-card-name \{/);
  assert.match(sheetCss, /\.app-icon-name \{/);
  // The picker draws every choice from the one spec and marks Follow theme only.
  const settings = read('core/app/components/app-settings.js');
  assert.match(settings, /appIconChoices\(this\.values, \{ themePicture: this\.themePicture \}\)/);
  assert.match(settings, /data-icon-id=\$\{c\.id\}/);
  assert.ok(settings.includes("aria-label=${c.variantLabel ? c.label + ' ' + c.variantLabel : c.label}"), 'the variant is in the tile\'s accessible name');
  assert.ok(settings.includes('app-icon-follow'), 'the follow marker is drawn');
  assert.ok(settings.includes("c.id === 'theme'"), 'only Follow theme carries the marker');
  assert.match(sheetCss, /\.app-icon-choice\[data-icon-id="theme"\] \.app-icon-follow/);
});

test('every consumer reads the families the icon spec holds, never the old flat icons array (issue 254)', () => {
  assert.equal(Object.prototype.hasOwnProperty.call(icons, 'icons'), false, 'the spec holds families and followTheme, not a flat icons array');
  assert.ok(Array.isArray(icons.families) && icons.followTheme && icons.followTheme.id);
  const android = naming.ids.android.replaceAll('.', '/');
  const readers = [
    ['desktop/src/main.js', /appIconSpec\.families/, /appIconSpec\.icons/],
    ['android/app/src/main/kotlin/' + android + '/HostBridge.kt', /getJSONArray\("families"\)/, /getJSONArray\("icons"\)/],
    ['android/app/src/androidTest/kotlin/' + android + '/AppIconTest.kt', /getJSONArray\("families"\)/, /getJSONArray\("icons"\)/],
    ['android/app/src/androidTest/kotlin/' + android + '/SettingsPageTest.kt', /getJSONArray\("families"\)/, /getJSONArray\("icons"\)/],
    ['ios/' + naming.product + '/HostBridge.swift', /object\["families"\]/, /object\["icons"\]/],
  ];
  for (const [file, want, old] of readers) {
    const src = read(file);
    assert.match(src, want, file + ' reads the spec through families');
    assert.equal(old.test(src), false, file + ' reads no old flat icons array');
  }
});

test('the shell clears the fixed palette when Follow theme is chosen, through the one rule (issues 246 and 254)', () => {
  // The tray (and the window icon) follows the theme while the choice is Follow theme: the shell must ask the shared
  // rule for the choice's palette, which answers null for Follow theme, rather than keeping the last colour picked.
  // A fixed variant keeps its own palette, so the rule still colours it whatever the theme.
  assert.equal(fixedPalette(FOLLOW_THEME), null, 'Follow theme has no palette of its own');
  const fixed = fixedPalette(icons.families[0].variants.dark.id);
  assert.ok(fixed && fixed.colors, 'a fixed variant keeps its palette');
  assert.match(read('desktop/src/main.js'), /appIconFixed\s*=\s*fixedPalette\(/, "the shell reads the choice's palette from the shared rule, so Follow theme clears it and the tray follows the theme");
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
  h.settings = { 'appearance.appIcon': 'rosa_dark' };
  h.settingsRead = false;
  await h.applyAppIcon();
  assert.deepEqual(calls, [], 'nothing is applied before the server\'s settings are read');
  h.settingsRead = true;
  await h.applyAppIcon();
  await h.applyAppIcon();
  assert.deepEqual(calls, [['app.icon', { icon: 'rosa_dark' }]], 'one change, one ask');
  h.settings = { 'appearance.appIcon': 'naranja_light' };
  await h.applyAppIcon();
  assert.deepEqual(calls.at(-1), ['app.icon', { icon: 'naranja_light' }]);
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

// Issue 244: the text size is a slider whose positions are the schema's stops, so a key or a drag lands only on an
// offered percentage; it is keyboard-operable (a range is), names itself, announces the percentage rather than the
// index, writes the value as it moves (the live preview), and shows the value in force beside it. The stops are the
// schema's own, so the slider and the schema cannot drift.
test('text size is a slider that lands only on the schema stops and announces the percentage', () => {
  const settings = read('core/app/components/app-settings.js');
  const slider = /<div class="scale-slider[\s\S]*?<\/div>`/.exec(settings);
  assert.ok(slider, 'the page draws the text size slider');
  assert.match(slider[0], /type="range"/, 'it is a range control, so it is keyboard-operable');
  assert.match(slider[0], /min="0" max=\$\{[^}]+\} step="1"/, 'its positions are the stops, so a move lands only on one');
  assert.match(slider[0], /aria-label=\$\{field\.label\}/, 'it is named for its setting');
  assert.match(slider[0], /aria-valuetext=\$\{[^}]*percent[^}]*\}/, 'a screen reader hears the percentage, not the index');
  assert.match(slider[0], /<output class="scale-value"/, 'the percentage in force is written beside it');
  assert.match(slider[0], /@input=\$\{\(e\) => this\.onSlide\(e, field, stops\)\}/, 'a move writes the setting as it is made, the live preview');
  const size = settingsFields().find((f) => f.key === 'appearance.textScale');
  assert.deepEqual(size.options, TEXT_SCALES, 'the stops are the schema\'s percentages');
  assert.match(read('core/app/styles/app.css'), /\.scale-range \{[^}]*accent-color: var\(--color-accent\)/, 'the track takes the theme accent');
});

// Issue 244: the tabs read as a strip on the body they open, not loose pills floating above it.
test('Settings tabs read as a strip on the panel they open', () => {
  const css = read('core/app/styles/app.css');
  const nav = /\.sheet-nav \{[^}]*\}/.exec(css);
  assert.ok(nav, 'the strip is styled');
  assert.match(nav[0], /border-bottom: var\(--size-border\) solid var\(--color-border\)/, 'the strip sits on a baseline');
  assert.match(nav[0], /background: var\(--color-bg-sunken\)/, 'the strip wears the sunken surface');
  const tab = /\.settings-tab \{[^}]*\}/.exec(css);
  assert.ok(tab, 'the tab is styled');
  assert.match(tab[0], /margin-bottom: calc\(-1 \* var\(--size-border\)\)/, 'the tab overlaps the baseline');
  assert.match(tab[0], /border-bottom: 0/, 'the tab has no bottom edge of its own');
  const on = /\.settings-tab\[aria-selected="true"\] \{[^}]*\}/.exec(css);
  assert.ok(on, 'the tab in force is styled');
  assert.match(on[0], /background: var\(--color-bg-raised\)/, 'the tab in force is filled with the panel surface, so it joins the body');
});
