import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { observeLiveMotion } from './live-photo-observation.js';
const source = readFileSync(new URL('./live-photo-fixture.js', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('  // The motion takes'), source.indexOf('})().catch'));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

for (const scenario of ['delayed startup then progress', 'startup never completes', 'playing but time never advances']) {
  test('separate bounded startup and progress: ' + scenario, async () => {
    let now = 0;
    let frame = 0;
    let current = { currentTime: 0, paused: false };
    const still = { w: 402, h: 536 };
    const observation = observeLiveMotion(still);
    let verdict = '';
    const trace = { has: (name) => name === 'media:playing' && scenario !== 'startup never completes' && now >= 40000, note() {} };
    const run = new AsyncFunction('video', 'img', 'control', 'box', 'stillBox', 'until', 'say', 'why', 'state', 'requestAnimationFrame', 'performance', 'observation', 'trace', 'flushTrace', body);
    await run(() => current, () => still, () => ({ getAttribute: () => 'Show the photo' }), () => still, still,
      async (check) => { current = null; assert.ok(check()); }, (s) => { verdict = s; }, async () => '', () => JSON.stringify({ video: current }),
      (callback) => {
        frame += 1;
        if (frame > 5) throw new Error('fixture did not honor its phase bounds');
        if (scenario === 'startup never completes') now = 61000;
        else if (scenario === 'playing but time never advances') now = frame === 1 ? 40000 : 56000;
        else { now = frame === 1 ? 40000 : 40000 + (frame - 1) * 500; current.currentTime = frame === 1 ? 0 : (frame - 1) * 0.4; }
        queueMicrotask(callback);
      }, { now: () => now }, observation, trace, () => {});
    assert.match(verdict, scenario === 'delayed startup then progress' ? /^live:pass/ : /^live:fail/, verdict);
  });
}
