import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OVERLAYS, unexpectedOverlays } from '../src/design-capture-guard.js';

test('a capture that asked for every overlay on the page is clean', () => {
  assert.deepEqual(unexpectedOverlays([], []), []);
  assert.deepEqual(unexpectedOverlays(['sort menu'], ['sort menu']), []);
  assert.deepEqual(unexpectedOverlays(['sort menu', 'notice'], ['sort menu', 'notice']), []);
});

test('an overlay the screen did not ask for is reported by name', () => {
  assert.deepEqual(unexpectedOverlays(['emoji panel'], []), ['emoji panel']);
  assert.deepEqual(unexpectedOverlays(['sort menu', 'emoji panel'], ['sort menu']), ['emoji panel']);
  assert.deepEqual(unexpectedOverlays(['emoji panel', 'message menu'], ['message menu']), ['emoji panel']);
});

test('the registry names every panel the harness can leave open', () => {
  const names = OVERLAYS.map(([name]) => name);
  for (const want of ['sort menu', 'filter menu', 'search menu', 'message menu', 'thread view', 'emoji panel', 'attach menu', 'notice']) {
    assert.ok(names.includes(want), 'the guard is missing ' + want);
  }
  for (const [, selector] of OVERLAYS) assert.match(selector, /^\.[a-z-]+$/);
});
