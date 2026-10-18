import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Issue 459: the other person's bubble wears the theme's accent and ours is the quiet tint, in every theme and scheme,
// each with its text at 4.5:1. The surface roles test holds the colours; these hold that every platform proves them: the
// packaged smoke on each desktop, and one shared fixture run in each phone shell's own web view.
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const naming = JSON.parse(read('core/spec/naming.json'));

test('the packaged smoke\'s choice contrast reads both bubbles: the received one is the accent bubble and each keeps its text (issue 459)', () => {
  const main = read('desktop/src/main.js');
  for (const part of ["what: 'received bubble'", "what: 'sent bubble'", 'receivedIsAccent', 'sentIsQuiet', 'receivedStandsOut']) {
    assert.ok(main.includes(part), 'the choice contrast check reads ' + part);
  }
  assert.match(main, /var\(--color-bubble-me\)/, 'the accent bubble it compares with is the token itself, resolved by the page');
  for (const scheme of ['light', 'dark']) assert.ok(main.includes("'02c-bubbles-' + scheme + '.png'") || main.includes('02c-bubbles-' + scheme + '.png'), 'a capture of the bubbles in ' + scheme);
  assert.match(read('desktop/scripts/smoke.mjs'), /key: 'choiceContrast', bound: '[^']*received bubble[^']*'/, 'the smoke names what choiceContrast now holds');
});

test('the bubble colours proof is a Debug seam on iOS, copied into test builds only (issue 459)', () => {
  const shell = read('ios/' + naming.product + '/ShellView.swift');
  assert.match(shell, /#if DEBUG[\s\S]*--bubble-colours-fixture[\s\S]*#endif/, 'the fixture is a Debug seam');
  assert.match(read('ios/project.yml'), /CONFIGURATION.*Debug[\s\S]*core\/test\/bubble-colours-fixture\.js/, 'copied into test builds only');
  const uiTest = read('ios/' + naming.product + 'UITests/BubbleColoursTests.swift');
  for (const part of ['--bubble-colours-fixture', 'hasPrefix("bubbles:pass")', 'bubble-colours-light', 'bubble-colours-dark', 'Show dark bubbles']) assert.ok(uiTest.includes(part), 'the UI test reads the verdict and keeps both captures: ' + part);
  assert.doesNotMatch(read('core/app/main.js'), /bubble-colours-fixture/);
});

test('the same fixture is the Android proof, run by the instrumented tests and kept by the leg (issue 459)', () => {
  const pkg = 'com/azuretek/' + naming.product.toLowerCase();
  const uiTest = read('android/app/src/androidTest/kotlin/' + pkg + '/BubbleColoursTest.kt');
  assert.match(uiTest, /PageFixture\.run\(scenario, "bubble-colours-fixture\.js", "bubbleColoursProof"\)/, 'the Android test runs the shared fixture');
  assert.match(uiTest, /proof\.optBoolean\("ok"\)/, 'and fails on its verdict');
  const leg = read('.github/workflows/android.yml');
  for (const scheme of ['light', 'dark']) assert.match(leg, new RegExp('bubble-colours-' + scheme + '\\.png'), 'the leg requires the ' + scheme + ' capture');
  assert.doesNotMatch(read('android/app/src/main/kotlin/' + pkg + '/MainActivity.kt'), /bubble-colours-fixture|bubbleColoursProof/);
});

test('the fixture checks every theme and scheme it draws, and the conversation and the conventions say the received bubble wears the accent (issue 459)', () => {
  const fixture = read('core/test/bubble-colours-fixture.js');
  for (const part of ["'.bubble.them'", "'.bubble.me'", 'var(--color-bubble-me)', "'light', 'dark'", 'bubbleColoursProof']) assert.ok(fixture.includes(part), 'the fixture reads ' + part);
  const conv = read('core/app/components/app-conversation.js');
  assert.doesNotMatch(conv, /Every message we send wears the theme's own colour/, 'the superseded comment is gone');
  assert.match(conv, /issue 459/, 'the conversation cites the decision that replaced it');
  const conventions = read('docs/CONVENTIONS.md');
  assert.match(conventions, /The other person's bubble wears the theme's accent[^\n]*#459/, 'the convention names the new rule and its issue');
  assert.doesNotMatch(conventions, /notices and received bubbles take a chart-2 tint/, 'and the roles convention no longer gives the received bubble the tint');
});
