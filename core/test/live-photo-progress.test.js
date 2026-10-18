import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { observeLiveMotion } from './live-photo-observation.js';

// Issue 462: on a busy simulator the motion played to its end, its own timeupdate events every quarter second for two
// seconds and then ended, but the animation-frame loop that sampled it ran once, at time 0, before it advanced, and not
// again until the motion had been removed. The proof read "the motion never played" with the motion's own clock saying
// it had. The media's own progress events now feed the observation; layout is still read only by the loop.
const still = { w: 402, h: 536 };
const box = () => still;

test('the motion\'s own progress events prove it played when animation frames starve (issue 462)', () => {
  const observation = observeLiveMotion(still);
  const video = { currentTime: 0, paused: false, readyState: 4 };
  observation.sample(video, box);
  assert.equal(typeof observation.progress, 'function', 'the observation takes the media\'s own progress');
  for (let t = 0.25; t <= 2; t += 0.25) observation.progress({ currentTime: t, paused: false });
  observation.progress({ currentTime: 2, paused: true, ended: true });
  observation.sample(null, box);
  assert.equal(observation.passed, true);
  assert.ok(observation.played >= 1.9, 'played to ' + observation.played);
});

test('progress events alone never pass a motion that was not seen mounted in its box (issue 462)', () => {
  const observation = observeLiveMotion(still);
  for (let t = 0.25; t <= 2; t += 0.25) observation.progress({ currentTime: t, paused: false });
  assert.equal(observation.passed, false);
});

test('paused progress is not progress (issue 462)', () => {
  const observation = observeLiveMotion(still);
  observation.sample({ currentTime: 0, paused: false }, box);
  for (let t = 0.25; t <= 2; t += 0.25) observation.progress({ currentTime: t, paused: true });
  assert.equal(observation.passed, false);
});

test('the fixture feeds the motion\'s timeupdate events to the observation, without reading layout (issue 462)', () => {
  const source = readFileSync(new URL('./live-photo-fixture.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf("  for (const type of ['loadeddata'"), source.indexOf('  const state ='));
  assert.match(body, /observation\.progress\(/, 'timeupdate reaches the observation');
});
