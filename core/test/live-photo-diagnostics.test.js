import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveTrace, traceCall, recordMediaEvent, livePhase, recordMounts } from './live-photo-observation.js';

test('captured clicks are not admitted presses; only the invoked app handler records admission', () => {
  const trace = createLiveTrace(() => 123);
  trace.note('click-captured');
  assert.equal(trace.has('press-admitted'), false);
  const host = { playMotion(value) { assert.equal(this, host); return value; } };
  traceCall(host, 'playMotion', trace, 'press-admitted');
  assert.equal(host.playMotion(42), 42);
  assert.equal(trace.has('press-admitted'), true);
});

test('diagnostics preserve promise identity and rejection, arguments, receiver and synchronous errors', async () => {
  const trace = createLiveTrace(() => 124);
  let reject;
  const promise = new Promise((resolve, no) => { reject = no; });
  const host = { play(arg) { assert.equal(this, host); assert.equal(arg, 7); return promise; } };
  const restore = traceCall(host, 'play', trace, 'play-called');
  assert.equal(host.play(7), promise);
  reject(new Error('refused'));
  await assert.rejects(promise, /refused/);
  assert.equal(trace.has('play-called:rejected'), true);
  restore();
  const error = new Error('sync');
  host.play = () => { throw error; };
  traceCall(host, 'play', trace, 'play-called');
  assert.throws(() => host.play(), (e) => e === error);
});

test('media event callbacks record timestamps only, with no media or layout reads', () => {
  const trace = createLiveTrace(() => 125);
  const event = { type: 'ended', get target() { throw new Error('must not inspect media in recorder'); } };
  recordMediaEvent(trace, event);
  assert.deepEqual(trace.entries, [{ event: 'media:ended', at: 125 }]);
});

for (const [events, expected] of [
  [['click-captured'], 'press-not-admitted'],
  [['press-admitted', 'fetch-start'], 'motion-fetch-pending'],
  [['press-admitted', 'fetch-complete'], 'motion-not-mounted'],
  [['press-admitted', 'fetch-complete', 'mounted', 'play-called:rejected'], 'play-rejected'],
  [['press-admitted', 'fetch-complete', 'mounted'], 'motion-no-progress'],
]) {
  test('phase diagnostics distinguish ' + expected, () => {
    const trace = createLiveTrace(() => 126);
    events.forEach((e) => trace.note(e));
    assert.equal(livePhase(trace), expected);
  });
}

test('a delayed fetch remains distinct from a missing mount after bytes arrive', async () => {
  const trace = createLiveTrace(() => 127);
  let release;
  const bytes = new Promise((resolve) => { release = resolve; });
  const host = { async playMotion() {
    trace.note('fetch-start');
    await bytes;
    trace.note('fetch-complete');
  } };
  traceCall(host, 'playMotion', trace, 'press-admitted');
  const work = host.playMotion();
  assert.equal(livePhase(trace), 'motion-fetch-pending');
  release();
  await work;
  assert.equal(livePhase(trace), 'motion-not-mounted');
});

test('mount tracing records insertion/removal timestamps without reading media or layout', () => {
  const trace = createLiveTrace(() => 128);
  const video = { matches: () => true, get currentTime() { throw new Error('media read'); }, getBoundingClientRect() { throw new Error('layout read'); } };
  recordMounts(trace, [{ addedNodes: [video], removedNodes: [] }, { addedNodes: [], removedNodes: [video] }]);
  assert.deepEqual(trace.entries, [{ event: 'mounted', at: 128 }, { event: 'removed', at: 128 }]);
});
