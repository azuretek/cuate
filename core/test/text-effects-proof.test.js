// Issue 461: the iOS proof of the text effects failed on a busy simulator with "big grew only 1.07x": it sampled the Big
// stretch frame by frame while it played, and every frame it saw fell after the peak. The fixture measures the stretch at
// the top of its own animation instead, so the proof does not depend on the device's pace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fixture = readFileSync(new URL('./text-effects-fixture.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/styles/app.css', import.meta.url), 'utf8');

test('the text effects proof measures Big at the peak its keyframes name, not by sampling as it runs (issue 461)', () => {
  const peak = /@keyframes text-big \{[\s\S]*?(\d+)% \{ transform: scale\(1\.8\); \}/.exec(css);
  assert.ok(peak, 'the Big keyframes name a largest step');
  assert.match(fixture, /animationName === 'text-big'/, 'the fixture finds the Big animation');
  assert.match(fixture, /grow\.pause\(\);/, 'holds it');
  assert.ok(fixture.includes('grow.currentTime = duration * ' + Number(peak[1]) / 100 + ';'), 'at the step the keyframes name as largest');
  assert.doesNotMatch(fixture, /sampleUntil/, 'and no longer samples frames against a clock');
});
