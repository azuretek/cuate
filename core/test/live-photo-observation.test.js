import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { observeLiveMotion } from './live-photo-observation.js';

const source = readFileSync(new URL('./live-photo-fixture.js', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('  // The motion takes'), source.indexOf('})().catch'));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

test('a completed motion is not lost when the next animation frame arrives after video removal (issue 402)', async () => {
  let now = 0;
  let current = { currentTime: 0.4, paused: false };
  const still = { w: 402, h: 536 };
  let verdict = '';
  const observation = observeLiveMotion(still);
  const run = new AsyncFunction('video', 'img', 'control', 'box', 'stillBox', 'until', 'say', 'why', 'state', 'requestAnimationFrame', 'performance', 'observation', body);
  await run(() => current, () => still, () => ({ getAttribute: () => 'Play the Live Photo' }), () => still, still,
    async (check) => { assert.ok(check()); }, (s) => { verdict = s; }, async () => 'no refusal', () => JSON.stringify({ video: current }),
    (callback) => {
      // The media clock and its events advance while animation-frame observation is delayed.
      observation.sample(current, () => still);
      current.currentTime = 0.8;
      observation.sample(current, () => still);
      current.currentTime = 2; current.ended = true; current.paused = true;
      observation.sample(current, () => still);
      current = null; now = 16000; queueMicrotask(callback);
    }, { now: () => now }, observation);
  assert.match(verdict, /^live:pass/, 'playback completed before the delayed observer resumed: ' + verdict);
});

for (const scenario of ['never mounted', 'paused only', 'no progress']) {
  test('retained observations refuse ' + scenario + ' (issue 402)', () => {
    const observation = observeLiveMotion({ w: 402, h: 536 });
    if (scenario !== 'never mounted') {
      const video = { currentTime: 0.4, paused: scenario === 'paused only' };
      observation.sample(video, () => ({ w: 402, h: 536 }));
      observation.sample(video, () => ({ w: 402, h: 536 }));
    }
    assert.equal(observation.passed, false);
  });
}

test('progress does not erase an earlier wrong-sized frame (issue 402)', () => {
  const observation = observeLiveMotion({ w: 402, h: 536 });
  observation.sample({ currentTime: 0.4, paused: false }, () => ({ w: 20, h: 20 }));
  observation.sample({ currentTime: 0.8, paused: false }, () => ({ w: 402, h: 536 }));
  assert.equal(observation.passed, true);
  assert.deepEqual(observation.wrongBox, { w: 20, h: 20 });
});
