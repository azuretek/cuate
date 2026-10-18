import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Issue 466: the late notice UI test pressed the notice while the system was still sliding it in, from its banner or
// from Notification Center, so the press had no point on screen ("Failed to compute hit point", a frame above the top
// of the screen) and the run failed for a reason that is not the app's. The press waits until the notice is hittable,
// on screen, and has held still, on both paths.
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const naming = JSON.parse(read('core/spec/naming.json'));

test('the late notice test presses the notice only once it is on screen and still, on both paths (issue 466)', () => {
  const ui = read('ios/' + naming.product + 'UITests/LateNoticeTests.swift');
  assert.match(ui, /func pressable\(/, 'one wait decides when the notice can be pressed');
  const helper = /func pressable\([\s\S]*?\n {4}\}/.exec(ui);
  assert.ok(helper, 'the wait is a function of its own');
  for (const part of ['isHittable', 'frame', 'contains']) assert.ok(helper[0].includes(part), 'it reads ' + part);
  assert.equal((ui.match(/waitForExistence/g) || []).length, 0, 'existence alone never decides the press');
  assert.ok((ui.match(/pressable\(/g) || []).length >= 3, 'the banner path and the Notification Center path both wait for it');
});
