// The kit's place-keeping for scrolled views (issue 142): a view anchored to its end stays there, one scrolled back
// stays on the same item through items arriving above or below and through a resize, and nothing jumps when the item
// it held has gone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchorFrom, scrollFor, END_SLACK, revealDelta } from '../kit/rules/scroll.js';

test('a focused field the view shrank over is brought into sight, and one in sight is left alone (issue 180)', () => {
  const view = { top: 40, bottom: 380 };
  assert.equal(revealDelta(view, { top: 100, bottom: 140 }), 0, 'in sight: no scroll');
  assert.equal(revealDelta(view, { top: 485, bottom: 600 }), 220, 'under the keyboard: scrolled up until its bottom shows');
  assert.equal(revealDelta(view, { top: 10, bottom: 30 }), -30, 'above the view: scrolled down until its top shows');
  assert.equal(revealDelta(view, { top: 300, bottom: 800 }), 260, 'taller than the view: its top stays in sight');
});

// A column of items of the given heights, as the view measures them at a scrollTop.
function view(heights, scrollTop, clientHeight, keys = heights.map((_, i) => 'm' + i)) {
  let y = -scrollTop;
  const items = heights.map((h, i) => { const it = { key: keys[i], top: y, bottom: y + h }; y += h; return it; });
  return { scrollTop, scrollHeight: heights.reduce((a, b) => a + b, 0), clientHeight, items };
}

test('a following view near its end is anchored to the end', () => {
  const v = view([100, 100, 100, 100], 400 - 200 - (END_SLACK - 1), 200);
  assert.deepEqual(anchorFrom({ ...v, follow: true }), { end: true });
  assert.notDeepEqual(anchorFrom({ ...v, follow: false }), { end: true }, 'a list that does not follow never pins itself to its end');
});

test('a new message keeps an anchored conversation at its newest one', () => {
  const before = view([100, 100, 100, 100], 200, 200);
  const anchor = anchorFrom({ ...before, follow: true });
  const after = view([100, 100, 100, 100, 100], 200, 200);
  assert.equal(scrollFor(anchor, after), 300);
});

test('a view scrolled back stays on the same item when items arrive above it', () => {
  const before = view([100, 100, 100, 100, 100], 150, 200);
  const anchor = anchorFrom({ ...before, follow: true });
  assert.deepEqual(anchor, { key: 'm1', offset: -50 });
  // Two older messages load above: the same message must sit where it sat.
  const keys = ['o1', 'o2', 'm0', 'm1', 'm2', 'm3', 'm4'];
  const after = view([80, 80, 100, 100, 100, 100, 100], 150, 200, keys);
  const top = scrollFor(anchor, after);
  const again = view([80, 80, 100, 100, 100, 100, 100], top, 200, keys);
  assert.equal(again.items.find((it) => it.key === 'm1').top, -50);
});

test('a resize that rewraps every item keeps the item at the top of the view', () => {
  const before = view([60, 60, 60, 60, 60, 60, 60, 60], 130, 200);
  const anchor = anchorFrom(before);
  assert.equal(anchor.key, 'm2');
  // Narrower: every item wraps to twice its height, and the view is shorter too.
  const after = view([120, 120, 120, 120, 120, 120, 120, 120], 130, 150);
  const top = scrollFor(anchor, after);
  const again = view([120, 120, 120, 120, 120, 120, 120, 120], top, 150);
  assert.equal(again.items.find((it) => it.top <= 0 && it.bottom > 0).key, 'm2');
  assert.equal(again.items.find((it) => it.key === 'm2').top, anchor.offset);
});

test('an item that has gone leaves the view where it is, and never past its ends', () => {
  const anchor = { key: 'gone', offset: 0 };
  assert.equal(scrollFor(anchor, view([100, 100, 100], 80, 200)), 80);
  assert.equal(scrollFor({ top: 900 }, view([100, 100, 100], 0, 200)), 100);
  assert.equal(scrollFor({ top: -5 }, view([100, 100, 100], 0, 200)), 0);
  assert.equal(scrollFor(null, view([100], 0, 200)), 0);
});

test('a view with no items keeps its offset', () => {
  assert.deepEqual(anchorFrom({ scrollTop: 40, scrollHeight: 500, clientHeight: 100, items: [] }), { top: 40 });
});
