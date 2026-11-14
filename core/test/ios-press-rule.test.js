// Issue 519: every iOS UI test that presses something and then waits for the page or the system goes through the one
// press rule (ios/TestSupport/PressUntil.swift, issue 517) by its driver, pressUntil in PressUntilStep.swift. A step that
// taps on its own counts XCTest's work around the press against the page and reports a press the page never saw as the
// defect under test, which failed four times (issues 384, 411, 471, 517). The only taps outside the driver are named
// below, each with why the rule does not apply to it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const naming = JSON.parse(read('core/spec/naming.json'));
const dir = 'ios/' + naming.product + 'UITests/';

// Each entry is a file and the text of the one line that taps there.
const allowed = [
  { file: 'PressUntilStep.swift', line: 'press: { element.tap() }', why: 'the driver itself: the rule decides when this press is made' },
  { file: 'PressUntilStep.swift', line: 'press: { point.tap() }', why: 'the driver itself, for a control the page reports by its point' },
  { file: 'ContactEditorTests.swift', line: 'alert.buttons[label].tap()', why: 'the Contacts permission alert is SpringBoard\'s and may never come; it is answered wherever it lands while the step waits for the card, and no state follows from it for a step to wait on' },
  { file: 'ContactEditorTests.swift', line: 'if full.exists && full.isHittable { full.tap() }', why: 'the system\'s full access choice that follows that alert on newer iOS, answered the same way' },
  { file: 'LateNoticeTests.swift', line: 'alert.buttons[name].tap()', why: 'the notification permission and icon change alerts are SpringBoard\'s or the system\'s, may never come, and are answered wherever they land while the test waits for other state' },
];

// A tap, double tap or long press made by XCTest, on an element or a coordinate. A drag (press then drag to) is a
// gesture with no page answer to wait on, and comments are not code.
const pressLines = (source) => source.split('\n')
  .map((text, i) => ({ number: i + 1, text: text.replace(/\/\/.*$/, '').trim() }))
  .filter(({ text }) => /\.(?:tap|doubleTap|twoFingerTap)\(/.test(text) || (/\.press\(forDuration:/.test(text) && !/thenDragTo/.test(text)));

test('the press finder sees every kind of tap and nothing else', () => {
  const found = pressLines([
    'button.tap()',
    'clip.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3)).tap()',
    'cell.doubleTap()',
    'row.press(forDuration: 1)',
    'top.press(forDuration: 0.1, thenDragTo: bottom)',
    '// a comment that says control.tap() is not a press',
    'let tapped = true',
  ].join('\n')).map(({ number }) => number);
  assert.deepEqual(found, [1, 2, 3, 4]);
});

test('every iOS UI test presses through the one press rule, but for the system alerts named with their reasons (issue 519)', () => {
  const files = readdirSync(new URL('../../' + dir, import.meta.url)).filter((f) => f.endsWith('.swift'));
  const stray = [];
  const used = new Set();
  for (const file of files) {
    for (const { number, text } of pressLines(read(dir + file))) {
      const entry = allowed.find((a) => a.file === file && text.includes(a.line));
      if (entry) used.add(entry);
      else stray.push(file + ':' + number + ' ' + text);
    }
  }
  assert.deepEqual(stray, [], 'a step that presses and waits goes through pressUntil(name, target:, reached:), or is named here with why it cannot');
  for (const entry of allowed) assert.ok(entry.why.length > 0 && used.has(entry), entry.file + ' no longer taps ' + entry.line + ', so its allowance goes');
});

test('the steps moved onto the rule read the page or system state they wait for (issue 519)', () => {
  const steps = {
    'BubbleColoursTests.swift': ['"dark-bubbles"'],
    'AudioPlaybackTests.swift': ['"play-memo"', '"pause-memo"', '"play-voice"'],
    'VideoControlsTests.swift': ['"release-clip"', '"show-player-controls"'],
    'LivePhotoTests.swift': ['"press-live"'],
    'LateNoticeTests.swift': ['"open-notice"'],
  };
  for (const [file, names] of Object.entries(steps)) {
    const swift = read(dir + file);
    for (const name of names) assert.ok(swift.includes('pressUntil(' + name), file + ' presses ' + name + ' through pressUntil');
  }
  const audio = read(dir + 'AudioPlaybackTests.swift');
  assert.match(audio, /reached: \{\n\s*page\.buttons\["Pause memo\.m4a"\]\.exists/, 'play is done once the control turns to pause, so a press that arrived is not pressed again');
  assert.match(read(dir + 'LateNoticeTests.swift'), /reached: \{\n\s*app\.state == \.runningForeground/, 'the notice is done once the app is in front');
  assert.match(read(dir + 'LivePhotoTests.swift'), /reached: \{ marker\.exists && marker\.label != "live:ready" \}/, 'LIVE is done once the page saw a click');
});

test('the driver presses an element or a point by the same rule, and times the window from when the press returns', () => {
  const driver = read(dir + 'PressUntilStep.swift');
  assert.match(driver, /func pressUntil\(_ name: String, rule: PressUntil = PressUntil\(\), target: \(\) -> XCUIElement, reached: \(\) -> Bool\)[^{]*\{\n\s*pressUntil\(name, rule: rule, at: \{ \.element\(target\(\)\) \}, reached: reached\)/, 'the element form is the point form with an element');
  assert.match(driver, /let state = reached\(\)\n\s*let target = at\(\)/, 'the state is read before every decision');
  assert.match(driver, /target\.press\(\)\n\s*lastReturned = Date\(\)/);
});
