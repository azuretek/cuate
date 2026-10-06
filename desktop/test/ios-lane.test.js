// Issue 285: the ios simulator lane runs UI tests that judge the screen by its pixels, so
// the screen it leaves for them must be the app's and not a system surface's. The simulator
// can raise a system surface (a permission alert, the home screen) over the app, and the
// XCTest screenshot request then times out, failing a page that never failed. The lane must
// therefore clear a system surface before any capture, bound every simulator call, retry the
// boot capture until it is a real PNG, and name a system surface when a capture cannot show
// the app. These hold the boot script and the UI-test guard to that, so a rewrite cannot
// quietly drop them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
// The UI-test directory names the product, which lives only in the naming spec, so it is
// read from there rather than written here (the product-name guard).
const product = JSON.parse(read('core/spec/naming.json')).product;
const uiTests = new URL('ios/' + product + 'UITests/', root);

test('the ios boot script clears a system surface before any capture and bounds every simulator call', () => {
  const boot = read('ios/scripts/boot-proof.sh');
  assert.match(boot, /privacy\s+"\$SIM"\s+grant\s+all/, 'the boot script must grant the app its permissions before any capture, so a system alert is not raised');
  assert.match(boot, /timeout\s+"\$SIM_TIMEOUT"/, 'the boot script must bound every simulator call');
  assert.match(boot, /wait_for/, 'the boot script must end a wait on a state rather than sleep a fixed time');
  assert.match(boot, /PNG image data/, 'the boot script must retry the capture until it is a real PNG');
});

test('an ios capture failure names a system surface that is on screen', () => {
  const files = readdirSync(uiTests).filter((file) => file.endsWith('.swift'));
  assert.ok(files.length > 0, 'no UI-test sources were read');
  const sources = Object.fromEntries(files.map((file) => [file, readFileSync(new URL(file, uiTests), 'utf8')]));
  const surface = sources['SystemSurface.swift'];
  assert.ok(surface, 'the UI-test guard SystemSurface.swift is missing');
  assert.match(surface, /com\.apple\.springboard/, 'the guard must ask SpringBoard which surface is in front');
  assert.match(surface, /system surface is covering/, 'a capture failure must name the system surface covering the app');
  for (const file of ['AboutPageTests.swift', 'SettingsPageTests.swift', 'RotationTests.swift', 'SystemBarsTests.swift']) {
    assert.ok(sources[file], file + ' is missing');
    assert.match(sources[file], /SystemSurface\.(requireOurs|failureSuffix)/, file + ' never asks whether the surface is ours');
  }
});
