import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Issue 439: a group renamed is a quiet centred line in the conversation, and the list preview says the same. The proof
// is one fixture (core/test/group-rename-fixture.js) every shell runs: the desktop smoke drives the real app through
// a rename, and the iOS UI test and the Android instrumented test read the fixture's verdict in their own web view.
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const naming = JSON.parse(read('core/spec/naming.json'));

test('the rename fixture checks every line, the list title and the preview, and leaves its verdict (issue 439)', () => {
  const fixture = read('core/test/group-rename-fixture.js');
  for (const part of ['named the conversation ', 'removed the name from the conversation', 'You named the conversation ', 'rename:pass', 'window.groupRenameProof = { ok: !problems.length']) assert.ok(fixture.includes(part), 'the fixture holds ' + part);
  assert.match(fixture, /kind: 'rename', name: ''/, 'and a removed name');
});

test('the rename proof is a Debug seam on iOS, copied into test builds only (issue 439)', () => {
  const shell = read('ios/' + naming.product + '/ShellView.swift');
  assert.match(shell, /#if DEBUG[\s\S]*--group-rename-fixture[\s\S]*#endif/, 'the fixture is a Debug seam');
  assert.match(read('ios/project.yml'), /CONFIGURATION.*Debug[\s\S]*core\/test\/group-rename-fixture\.js/, 'copied into test builds only');
  const uiTest = read('ios/' + naming.product + 'UITests/GroupRenameTests.swift');
  for (const part of ['--group-rename-fixture', 'hasPrefix("rename:pass")', 'Sam Example removed the name from the conversation']) assert.ok(uiTest.includes(part), 'the UI test reads the verdict: ' + part);
  assert.doesNotMatch(read('core/app/main.js'), /group-rename-fixture/);
});

test('the same fixture is the Android proof, run by the instrumented tests and kept by the leg (issue 439)', () => {
  const pkg = 'com/azuretek/' + naming.product.toLowerCase();
  const uiTest = read('android/app/src/androidTest/kotlin/' + pkg + '/GroupRenameTest.kt');
  assert.match(uiTest, /PageFixture\.run\(scenario, "group-rename-fixture\.js", "groupRenameProof"\)/, 'the Android test runs the shared fixture');
  assert.match(uiTest, /proof\.optBoolean\("ok"\)/, 'and fails on its verdict');
  assert.match(read('.github/workflows/android.yml'), /group-rename\.png/, 'the leg requires the capture');
  assert.doesNotMatch(read('android/app/src/main/kotlin/' + pkg + '/MainActivity.kt'), /group-rename-fixture|groupRenameProof/);
});

test('the desktop smoke renames a group through the app and checks the line, the title and the preview (issue 439)', () => {
  assert.match(read('desktop/scripts/smoke.mjs'), /key: 'groupRename'/, 'the smoke checks the step');
  const main = read('desktop/src/main.js');
  assert.match(main, /smokeStep\('group rename'\)/, 'and runSmoke drives it');
  assert.match(main, /report\.groupRename = /);
});
