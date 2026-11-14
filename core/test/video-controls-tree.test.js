// The read over the empty video (issue 509): the Android web view can hold a tree that lags the page, the viewer drawn
// and every control of ours answering a press while the tree holds only the web view's empty document. The pixels and the
// tree are the instrumented test's (VideoControlsTest.kt); this holds the shape of its wait: it starts from the page's
// own report that it drew the controls, its bound runs from that report, every reading is fresh, a reading that lacks a
// control is followed by a republish until the bound passes, and a failure says whether the page or the web view lost them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const naming = JSON.parse(read('core/spec/naming.json'));
const fixture = read('core/test/video-controls-fixture.js');
const android = read('android/app/src/androidTest/kotlin/' + naming.ids.android.replaceAll('.', '/') + '/VideoControlsTest.kt');
const between = (source, from, to) => {
  const start = source.indexOf(from);
  assert.ok(start >= 0, from + ' is there');
  const end = source.indexOf(to, start + from.length);
  assert.ok(end > start, to + ' follows ' + from);
  return source.slice(start, end);
};

test('the page reports which of the viewer\'s controls it drew, where a press reaches each, with the empty video', () => {
  const drawn = between(fixture, 'const drawn = () => {', 'window.videoControlsDrawn = drawn;');
  for (const selector of ['.close-button', '.viewer-prev', '.viewer-next', '.viewer-bar']) assert.ok(drawn.includes("'" + selector + "'"), selector + ' is reported');
  assert.match(drawn, /document\.elementFromPoint\(r\.left \+ r\.width \/ 2, r\.top \+ r\.height \/ 2\)/, 'drawn means a press at its middle reaches it');
  assert.match(drawn, /node\.contains\(hit\)/);
  assert.match(fixture, /say\('vc:empty ' \+ JSON\.stringify\(\{[^}]*drawn: drawn\(\) \}\)\);/, 'the report is part of the empty video\'s marker');
});

test('the page republishes its viewer only while the clip is held, and says when the viewer is back', () => {
  const republish = between(fixture, 'window.videoControlsRepublish = () => {', '  };');
  assert.match(republish, /if \(!releaseButton\.isConnected\) return 0;/, 'never after the clip, where a node rebuilt from scratch would hide issue 446');
  assert.match(republish, /el\.setAttribute\('aria-hidden', 'true'\);/);
  assert.match(republish, /requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => \{ el\.removeAttribute\('aria-hidden'\); window\.videoControlsRepublished = round; \}\)\)/, 'two frames hidden, then shown and reported');
});

test('Android reads the viewer from the page\'s report, bounded from it, republishing after every reading that lacks a control', () => {
  const check = between(android, 'private fun check(', 'window.videoControlsRelease()');
  assert.match(check, /val empty = awaitState\(scenario, "vc:empty "\)\n\s*val drawnAt = System\.nanoTime\(\)/, 'the bound is anchored on the page\'s report');
  assert.ok(check.indexOf('the page never drew the viewer\'s own controls before its clip') < check.indexOf('awaitViewer(scenario, shape, drawnAt'), 'a control the page never drew fails as the app\'s, before the tree is read');
  assert.doesNotMatch(check, /awaitControls\(/, 'the read over the empty video is not the single-rebuild wait');
  const wait = between(android, 'private fun awaitViewer(', 'private fun republish(');
  assert.match(wait, /val deadline = drawnAt \+ TimeUnit\.SECONDS\.toNanos\(VIEWER_TREE_SECONDS\)/);
  assert.doesNotMatch(wait, /REBUILD_AFTER_SECONDS|val started = System\.nanoTime\(\)/, 'no bound measured from the step\'s own start');
  assert.match(wait, /while \(true\) \{[\s\S]*val found = collect\(\)[\s\S]*return Viewer\(found, republishes, millis\)[\s\S]*republishes \+= 1\n\s*republish\(scenario\)/, 'a republish after every reading that lacks a control, not one');
  assert.doesNotMatch(wait, /Thread\.sleep|SystemClock\.sleep/);
  const republish = between(android, 'private fun republish(', 'private fun viewerCause(');
  assert.match(republish, /evaluate\(scenario, "window\.videoControlsRepublish\(\)"\)/, 'the page republishes its viewer');
  assert.match(republish, /IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS\n\s*\}\n\s*instrumentation\.waitForIdleSync\(\)\n\s*scenario\.onActivity[\s\S]*IMPORTANT_FOR_ACCESSIBILITY_YES/, 'the web view\'s node is hidden and shown across a frame, not within one');
  assert.match(republish, /if \(Build\.VERSION\.SDK_INT >= Build\.VERSION_CODES\.UPSIDE_DOWN_CAKE\) instrumentation\.uiAutomation\.clearCache\(\)/);
  assert.match(republish, /window\.videoControlsRepublished >= \$round/, 'the next reading waits for the viewer to be shown again');
  assert.match(between(android, 'private fun collect(', 'private fun walk('), /walk\(root, fresh = true\)/, 'every node read fresh, not from the automation\'s cache');
  assert.match(between(android, 'private fun walk(', 'private fun describeTree('), /if \(fresh && !node\.refresh\(\)\) return/);
});

test('a viewer missing from the tree says whether the web view or the app lost it, and the read after the clip never republishes', () => {
  const cause = between(android, 'private fun viewerCause(', 'private fun awaitControls(');
  assert.match(cause, /window\.videoControlsDrawn\(\)/, 'the page is asked again once the bound passes');
  assert.match(cause, /Android's web view did not expose the page, an Android accessibility tree defect, not the app's/);
  assert.match(cause, /: the app lost them/);
  const check = android.slice(android.indexOf('private fun check('));
  assert.match(check, /"the viewer was not in the accessibility tree before its clip: missing " \+ missing\.joinToString\(", "\) \+ cause/, 'the original assertion carries the cause');
  const after = check.slice(check.indexOf('window.videoControlsRelease()'), check.indexOf('private fun awaitState('));
  assert.doesNotMatch(after, /republish|awaitViewer/, 'after the clip the player\'s node is never rebuilt from scratch');
  assert.match(after, /awaitControls\(scenario, PLAYER \+ OURS\)/);
});

test('a contract run waits only for the controls it reads, so it never republishes to the bound (issue 509)', () => {
  const body = android.slice(android.indexOf('private fun awaitViewer('), android.indexOf('private fun republish('));
  assert.match(body, /val wanted = if \(omitCloseObservation\) OURS - "close" else OURS/);
  assert.match(body, /if \(wanted\.all \{ it in found \}/);
  assert.doesNotMatch(body, /if \(OURS\.all \{ it in found \}/, 'waiting on a control the reading removed never completes');
});
