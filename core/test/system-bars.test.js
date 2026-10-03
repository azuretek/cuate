// The system bars (issue 175): on a phone the page paints behind the status bar and the home indicator or navigation
// bar, pads its edge surfaces by the insets, and tells its shell the scheme it drew so the bar icons contrast with it.
// The pixels are held by the native tests (SystemBarsTest.kt, SystemBarsTests.swift); this holds the contract each half
// of that rests on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { systemBars } from '../app/rules/theme.js';
import { surfaceColorset, androidSurfaceColors } from '../kit/rules/tokens.js';
import { createHandlers } from '../../desktop/src/bridge-handlers.js';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const json = (p) => JSON.parse(read(p));
const naming = json('core/spec/naming.json');
const tokens = json('core/spec/tokens.json');
const ios = 'ios/' + naming.product + '/';
const android = 'android/app/src/main/';
const packagePath = naming.ids.android.replaceAll('.', '/');
const kotlin = android + 'kotlin/' + packagePath + '/';

test('the page reports the scheme it drew, and whether it is the system\'s own', () => {
  assert.deepEqual(systemBars('light', 'light'), { scheme: 'light', followSystem: false });
  assert.deepEqual(systemBars('dark', 'dark'), { scheme: 'dark', followSystem: false });
  assert.deepEqual(systemBars('system', 'dark'), { scheme: 'dark', followSystem: true });
  assert.deepEqual(systemBars(undefined, 'light'), { scheme: 'light', followSystem: true }, 'a skin never chosen follows the system');
  assert.deepEqual(systemBars('sepia', 'nonsense'), { scheme: 'light', followSystem: true }, 'an unknown value is never sent on');
});

test('the page tells its shell the scheme every time it applies a theme, and only when it changed', () => {
  const root = read('core/app/components/app-root.js');
  const apply = /\n {2}applyTheme\(\) \{[\s\S]*?\n {2}\}\n/.exec(root)[0];
  assert.match(apply, /this\.applySystemBars\(scheme\)/, 'applyTheme hands the scheme it resolved to the bars');
  const bars = /\n {2}applySystemBars\(scheme\) \{[\s\S]*?\n {2}\}\n/.exec(root)[0];
  assert.match(bars, /this\.bridge\('system\.bars', bars\)/);
  assert.match(bars, /systemBars\(this\.settings\['appearance\.skin'\], scheme\)/);
  assert.match(bars, /if \(key === this\.systemBarsSent\) return;/, 'an unchanged scheme is not sent again');
});

test('every shell answers system.bars: the phones set the bar icons, the desktop has no bars', async () => {
  const spec = json('core/spec/host-bridge.json');
  assert.deepEqual(spec.commands['system.bars'].args, { scheme: 'string', followSystem: 'boolean' });
  const h = createHandlers({ secure: {}, notify: () => true, info: () => ({}), openExternal: () => true });
  assert.equal(await h['system.bars']({ scheme: 'dark', followSystem: false }), false);
  const swift = read(ios + 'HostBridge.swift');
  assert.match(swift, /case "system\.bars":/);
  assert.match(swift, /overrideUserInterfaceStyle = barsStyle/, 'iOS takes the status bar style from the window\'s');
  assert.match(swift, /followsSystem \? \.unspecified/, 'following the system leaves the window to follow it too');
  assert.match(read(kotlin + 'HostBridge.kt'), /"system\.bars" -> success\(systemBars\(args\)\)/);
  const activity = read(kotlin + 'MainActivity.kt');
  assert.match(activity, /APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController\.APPEARANCE_LIGHT_NAVIGATION_BARS/);
  assert.match(activity, /SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View\.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR/, 'and on releases before 11');
});

test('the page paints behind the system bars and every edge surface pads by one set of insets', () => {
  assert.match(read('core/app/index.html'), /<meta name="viewport" content="[^"]*\bviewport-fit=cover\b/, 'iOS lays the page out under the bars only with viewport-fit=cover');
  const css = read('core/app/styles/app.css');
  for (const side of ['top', 'right', 'bottom', 'left']) {
    const decl = new RegExp('--inset-' + side + ': max\\(env\\(safe-area-inset-' + side + ', [^;]*\\), var\\(--shell-inset-' + side + ', [^;]*\\)\\);');
    assert.match(css, decl, '--inset-' + side + ' takes the platform\'s safe area or the shell\'s inset');
  }
  const outside = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/:root \{\n {2}--inset-top[\s\S]*?\n\}/, '');
  assert.doesNotMatch(outside, /env\(safe-area/, 'surfaces read --inset-*, never env() themselves, so the Android shell\'s insets reach them too');
  const rule = (selector) => {
    const at = css.indexOf('\n' + selector + ' {');
    assert.ok(at >= 0, selector + ' has a rule');
    return css.slice(at, css.indexOf('}', at));
  };
  for (const head of ['.sidebar-head', '.conv-head']) assert.match(rule(head), /height: calc\(var\(--size-header\) \+ var\(--inset-top\)\); padding: var\(--inset-top\) var\(--space-4\) 0;/, head + ' runs up behind the status bar');
  assert.doesNotMatch(css.slice(css.indexOf('\n.conv-head {') + 1), /\n\.conv-head \{|\n\.sidebar-head \{/, 'no later base rule takes the header\'s inset back');
  assert.match(rule('app-composer'), /padding-block-end: var\(--inset-bottom\)/, 'the composer runs down behind the home indicator');
  assert.match(rule('.sidebar'), /padding-block-end: var\(--inset-bottom\); padding-inline-start: var\(--inset-left\)/, 'the list and the drawer do too');
  assert.match(rule('.main'), /padding-inline-end: var\(--inset-right\)/);
  assert.match(rule('.onboarding-wrap'), /var\(--inset-top\)[\s\S]*var\(--inset-bottom\)/);
  assert.match(css, /\.sheet-scrim \{[^}]*padding: calc\(var\(--space-4\) \+ var\(--inset-top\)\)/);
});

test('the Android shell draws edge to edge and hands the page its insets', () => {
  const activity = read(kotlin + 'MainActivity.kt');
  assert.match(activity, /window\.setDecorFitsSystemWindows\(false\)/);
  assert.match(activity, /isNavigationBarContrastEnforced = false/, 'no system scrim over the navigation bar');
  assert.match(activity, /LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS/, 'no black bar beside a cutout');
  for (const side of ['top', 'right', 'bottom', 'left']) assert.ok(activity.includes("'--shell-inset-" + side + "'"), side + ' inset reaches the page');
  assert.match(activity, /WindowInsets\.Type\.systemBars\(\) or WindowInsets\.Type\.displayCutout\(\)/);
  assert.match(activity, /WindowInsets\.Type\.ime\(\)/, 'the keyboard ends the web view rather than covering the composer');
  assert.ok(existsSync(new URL('../../' + android + 'res/values-night/themes.xml', import.meta.url)), 'a night theme, so the web view reports the system\'s dark scheme');
  for (const dir of ['values', 'values-night']) assert.match(read(android + 'res/' + dir + '/themes.xml'), /android:windowBackground">@color\/surface</);
  assert.doesNotMatch(activity, /Color\.WHITE/, 'the cover is the tokens\' surface, not a system white');
});

test('the shells\' own surface before the page paints is the tokens\' page colour', () => {
  assert.deepEqual(json(ios + 'Assets.xcassets/Surface.colorset/Contents.json'), surfaceColorset(tokens), 'pnpm run tokens');
  assert.equal(read(android + 'res/values/surface.xml'), androidSurfaceColors(tokens, 'light'), 'pnpm run tokens');
  assert.equal(read(android + 'res/values-night/surface.xml'), androidSurfaceColors(tokens, 'dark'), 'pnpm run tokens');
  assert.match(read(android + 'res/values-night/surface.xml'), new RegExp(tokens.color.dark.bg, 'i'));
  const shell = read(ios + 'ShellView.swift');
  assert.match(shell, /UIColor\(named: "Surface"\)/);
  assert.match(shell, /Color\("Surface"\)/);
});

test('the system bars fixture is a test build seam only', () => {
  assert.match(read(ios + 'ShellView.swift'), /#if DEBUG[\s\S]*--system-bars-fixture[\s\S]*#endif/);
  assert.match(read('ios/project.yml'), /CONFIGURATION.*Debug[\s\S]*core\/test\/system-bars-fixture/);
  assert.doesNotMatch(read(kotlin + 'MainActivity.kt'), /system-bars-fixture|systemBarsProof/);
  assert.doesNotMatch(read('core/app/main.js'), /system-bars-fixture|systemBarsProof/);
  assert.match(read('ios/' + naming.product + 'UITests/SystemBarsTests.swift'), /XCUIScreen\.main\.screenshot\(\)/);
  assert.match(read('android/app/src/androidTest/kotlin/' + packagePath + '/SystemBarsTest.kt'), /uiAutomation\.takeScreenshot\(\)/);
});
