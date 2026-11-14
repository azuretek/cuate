import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Issue 466, three ways the late notice UI test failed for reasons that are not the app's:
// - the notice fell due a fixed ten seconds after posting, and on a busy simulator the app was still in front then, so
//   it was neither drawn as a banner nor kept in Notification Center ("neither shown as a banner nor kept");
// - the notice was pressed while the system was still sliding it in ("Failed to compute hit point", a frame above the
//   top of the screen);
// - a press in Notification Center did not open the app ("Pressing the notice brings the app back").
// The shell adds the fixture's notice only once the app has left, the press waits until the notice is hittable, on
// screen and still, and a notice still there after a press that did not open the app is pressed once more, by the one
// press rule (issue 519).
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const naming = JSON.parse(read('core/spec/naming.json'));

test('the late notice test presses the notice only once it is on screen and still, on both paths (issue 466)', () => {
  const ui = read('ios/' + naming.product + 'UITests/LateNoticeTests.swift');
  assert.match(ui, /func steadiness\(/, 'one reader decides when the notice can be pressed');
  const helper = /func steadiness\([\s\S]*?\n {4}\}/.exec(ui);
  assert.ok(helper, 'the reader is a function of its own');
  for (const part of ['isHittable', 'frame', 'contains']) assert.ok(helper[0].includes(part), 'it reads ' + part);
  assert.equal((ui.match(/waitForExistence/g) || []).length, 0, 'existence alone never decides the press');
  assert.match(ui, /func pressable\([\s\S]*?let steady = steadiness\(notice, in: springboard\)/, 'the wait for the notice reads it');
  assert.ok((ui.match(/pressable\(notice/g) || []).length >= 2, 'the banner path and the Notification Center path both wait for it');
  assert.match(ui, /let opened = pressUntil\("open-notice", rule: PressUntil\(window: 15, maxPresses: 2\), at: \{\n\s*if proven \{ proven = false; return \.element\(notice\) \}\n\s*return steady\(\) \? \.element\(notice\) : \.absent/, 'the press pressable() just proved goes at once, and a second press waits for the notice to hold still again');
});

test('the late notice fixture adds its notice only once the app has left, never on a fixed delay from posting (issue 466)', () => {
  const bridge = read('ios/' + naming.product + '/HostBridge.swift');
  const notify = /private func notify\([\s\S]*?\n {4}\}\n/.exec(bridge);
  assert.ok(notify, 'the notify command is found');
  assert.doesNotMatch(notify[0], /timeInterval: 10/, 'no fixed delay from posting');
  assert.match(bridge, /didEnterBackgroundNotification/, 'the notice waits for the app to leave');
  assert.match(bridge, /applicationState == \.background/, 'or is added at once when the app is already away');
});

// The notice pressable() has just proved still is pressed at once; only a repeat waits for it to hold still again, or a
// busy runner spends the window re-proving it and never presses (issue 519).
test('the first press on the late notice is not held behind a second steadiness proof', () => {
  const swift = readFileSync(new URL('../../ios/' + JSON.parse(readFileSync(new URL('../spec/naming.json', import.meta.url), 'utf8')).product + 'UITests/LateNoticeTests.swift', import.meta.url), 'utf8');
  const step = swift.slice(swift.indexOf('pressUntil("open-notice"'), swift.indexOf('reached: {', swift.indexOf('pressUntil("open-notice"')));
  assert.match(step, /if proven \{ proven = false; return \.element\(notice\) \}/);
});
