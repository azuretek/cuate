// Issue 198: the android emulator lane runs instrumented tests that judge the screen by
// its pixels, so the screen it leaves for them must be the app's and not a system dialog's.
// A cold emulator's Pixel launcher misses an input deadline now and then and its "isn't
// responding" dialog then holds focus over the app for the whole run, failing every pixel
// test that blames the page. The lane must therefore hide system error dialogs on the
// device before any capture, read the settings it depends on back, clear a dialog already
// up, and name a system surface when a capture still cannot show the app. These hold the
// boot script and the instrumented guard to that, so a rewrite cannot quietly drop them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
// The instrumented source directory names the app by its slug, which lives only in the
// naming spec, so it is read from there rather than written here (the product-name guard).
const slug = JSON.parse(read('core/spec/naming.json')).slug;
const androidTests = new URL('android/app/src/androidTest/kotlin/com/azuretek/' + slug + '/', root);

test('the android boot script suppresses system error dialogs before any capture', () => {
  const boot = read('android/scripts/boot-proof.sh');
  assert.match(boot, /settings put global hide_error_dialogs 1/, 'the boot script must hide system error dialogs on the device');
  assert.match(boot, /settings get global hide_error_dialogs/, 'the boot script must read hide_error_dialogs back, so a silent no-op fails there');
  assert.match(boot, /android\.intent\.action\.CLOSE_SYSTEM_DIALOGS/, "the boot script must clear another app's ANR dialog with the system's close-dialogs broadcast");
  assert.match(boot, /mCurrentFocus/, 'the boot script must wait for the app to hold input focus rather than sleep a fixed time');
});

test('an android capture failure names a system dialog that is on screen', () => {
  const files = readdirSync(androidTests).filter((file) => file.endsWith('.kt'));
  assert.ok(files.length > 0, 'no androidTest sources were read');
  const sources = Object.fromEntries(files.map((file) => [file, readFileSync(new URL(file, androidTests), 'utf8')]));
  const surface = sources['SystemSurface.kt'];
  assert.ok(surface, 'the instrumented guard SystemSurface.kt is missing');
  assert.match(surface, /dumpsys window/, 'the guard must ask the window manager what holds focus');
  assert.match(surface, /mCurrentFocus/, 'the guard must read the focused window');
  assert.match(surface, /Application Not Responding/, "the guard must recognise another app's ANR dialog");
  assert.match(surface, /system surface is covering/, 'a capture failure must name the system surface covering the app');
  for (const file of ['AboutPageTest.kt', 'SettingsPageTest.kt', 'RotationTest.kt', 'SystemBarsTest.kt']) {
    assert.ok(sources[file], file + ' is missing');
    assert.match(sources[file], /SystemSurface\.(requireOurs|failureSuffix)/, file + ' never asks whether the surface is ours');
  }
});
