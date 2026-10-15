import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SMOKE_TIMEOUT_MS_DEFAULT,
  SMOKE_TIMEOUT_MS_FLOOR,
  resolveSmokeTimeoutMs,
  formatDuration,
  summarizeSmokeProgress,
  describeSmokeTimeout,
} from '../src/smoke-timeout.js';

test('the smoke bound is at least the documented ten minutes and still a bound', () => {
  // docs/CONVENTIONS.md records the figure. If the ceiling shrinks below it, or grows so far it stops
  // being a bound at all, this fails rather than the number drifting quietly.
  assert.ok(SMOKE_TIMEOUT_MS_DEFAULT >= SMOKE_TIMEOUT_MS_FLOOR, 'default ' + SMOKE_TIMEOUT_MS_DEFAULT);
  assert.ok(SMOKE_TIMEOUT_MS_DEFAULT >= 10 * 60 * 1000, 'the documented floor is ten minutes: ' + SMOKE_TIMEOUT_MS_DEFAULT);
  assert.ok(SMOKE_TIMEOUT_MS_DEFAULT <= 30 * 60 * 1000, 'still a ceiling, not an absence of one: ' + SMOKE_TIMEOUT_MS_DEFAULT);
});

test('SMOKE_TIMEOUT_MS overrides the default, and a bad value falls back to it', () => {
  assert.equal(resolveSmokeTimeoutMs({ SMOKE_TIMEOUT_MS: '120000' }), 120000);
  assert.equal(resolveSmokeTimeoutMs({ SMOKE_TIMEOUT_MS: ' 90000 ' }), 90000);
  for (const bad of [undefined, null, '', 'nope', '0', '-5', 'Infinity', 'NaN']) {
    assert.equal(resolveSmokeTimeoutMs({ SMOKE_TIMEOUT_MS: bad }), SMOKE_TIMEOUT_MS_DEFAULT, 'value ' + bad);
  }
  assert.equal(resolveSmokeTimeoutMs({}), SMOKE_TIMEOUT_MS_DEFAULT);
});

test('formatDuration reads as minutes and seconds', () => {
  assert.equal(formatDuration(45000), '45s');
  assert.equal(formatDuration(600000), '10m 0s');
  assert.equal(formatDuration(123000), '2m 3s');
});

test('progress is read from the app trace: the last step and every completed one', () => {
  const output = 'search terms: {"a":1}\nsort: {"b":2}\nimage viewer: {"c":3}\npart';
  const progress = summarizeSmokeProgress(output);
  assert.deepEqual(progress.completed, ['search terms', 'sort', 'image viewer']);
  assert.equal(progress.step, 'image viewer');
  assert.deepEqual(summarizeSmokeProgress(''), { step: null, completed: [] });
  // A half-written marker, and noise that is not a step, are ignored.
  assert.deepEqual(summarizeSmokeProgress('page: Uncaught TypeError\nno colon here\nbroken: {"x"').completed, []);
});

test('the timeout text names the elapsed time, the bound and the step', () => {
  const text = describeSmokeTimeout({ elapsedMs: 601000, timeoutMs: 600000, step: 'image viewer', completed: ['sort', 'image viewer'] });
  assert.match(text, /10m 1s/, 'the elapsed time is in the text: ' + text);
  assert.match(text, /image viewer/, 'the step is in the text: ' + text);
  assert.match(text, /SMOKE_TIMEOUT_MS=600000/, 'the bound and its value are in the text: ' + text);
  const bare = describeSmokeTimeout({ elapsedMs: 5000, timeoutMs: 600000, step: null, completed: [] });
  assert.match(bare, /5s/);
  assert.match(bare, /no step yet/);
});
