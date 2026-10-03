// The macOS packaging leg failed on run 37050019814 (2026-10-02) with dmgbuild's
// "Unable to detach device cleanly: hdiutil: couldn't eject ... Resource busy".
// Spotlight's mds reads the files dmgbuild has just copied into the mounted image
// (sampled with lsof on both macOS legs, on every build), and dmgbuild answers a
// busy volume by retrying the detach with a growing pause. Its library defaults
// to twelve attempts, about six minutes; its command line defaults to five,
// about twenty seconds; and electron-builder calls the command line without the
// flag. So a volume that mds held for twenty seconds failed the leg. The patch
// under patches/ passes the library's own twelve, and this test fails if an
// upgrade or a reinstall leaves electron-builder calling dmgbuild without it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const desktop = createRequire(new URL('../package.json', import.meta.url));
const builder = createRequire(desktop.resolve('electron-builder/package.json'));
const appBuilder = createRequire(builder.resolve('app-builder-lib/package.json'));

test('electron-builder asks dmgbuild for the twelve detach attempts its library intends', () => {
  // app-builder-lib is what loads the DMG target, so read the copy it resolves.
  const source = readFileSync(appBuilder.resolve('dmg-builder/out/dmgUtil.js'), 'utf8');
  const call = source.match(/exec\)\(dmgbuild, \[([^\]]*)\]/);
  assert.ok(call, 'the dmgbuild call was not found in dmg-builder; re-read how this version invokes it');
  assert.match(call[1], /"--detach-retries", "12"/, 'dmgbuild is called without --detach-retries 12: ' + call[1]);
});
