import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ZOOM_FIT, ZOOM_STEP, ZOOM_DOUBLE_TAP, ZOOM_PAN_STEP, zoomFit, zoomMax, clampScale, panBounds, clampPan, zoomTo, zoomBy,
  panBy, toggleZoom, pinch, wheelFactor, isClick, isDoubleTap, zoomKey,
} from '../app/rules/zoom.js';
import * as engine from '../app/engine.js';

// A wide picture fitted to a 1000 by 700 stage: it fills the width and leaves room above and below.
const BOX = { width: 1000, height: 600, stageWidth: 1000, stageHeight: 700 };
const MAX = 8;
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, msg + ': ' + a + ' vs ' + b);

// Where a point on the stage falls on the picture, in the picture's own fitted pixels from its centre. Zooming about a
// point must leave the same spot of the picture under it.
const onPicture = (view, p) => ({ x: (p.x - view.x) / view.scale, y: (p.y - view.y) / view.scale });

test('zoom opens at fit, and the scale never leaves fit and the maximum', () => {
  assert.deepEqual(zoomFit(), { scale: 1, x: 0, y: 0 });
  assert.equal(clampScale(0.2, MAX), ZOOM_FIT, 'never smaller than fit');
  assert.equal(clampScale(-3, MAX), ZOOM_FIT);
  assert.equal(clampScale(40, MAX), MAX, 'never past the maximum');
  assert.equal(clampScale(3, MAX), 3);
  assert.equal(clampScale(NaN, MAX), ZOOM_FIT, 'a broken number falls back to fit');
  assert.equal(clampScale(3, 0.5), ZOOM_FIT, 'a maximum below fit is fit');
  assert.equal(zoomTo(zoomFit(), 99, null, BOX, MAX).scale, MAX, 'zooming straight to a scale is held to the maximum');
  assert.deepEqual(zoomTo({ scale: 3, x: 200, y: 100 }, 0.1, { x: 50, y: 50 }, BOX, MAX), zoomFit(), 'and to fit, centred, below it');
  let v = zoomFit();
  for (let i = 0; i < 20; i += 1) v = zoomBy(v, ZOOM_STEP, { x: 120, y: -40 }, BOX, MAX);
  assert.equal(v.scale, MAX, 'zooming in forever stops at the maximum');
  for (let i = 0; i < 20; i += 1) v = zoomBy(v, 1 / ZOOM_STEP, { x: 300, y: 200 }, BOX, MAX);
  assert.deepEqual(v, { scale: 1, x: 0, y: 0 }, 'zooming out forever stops at fit, centred');
});

test('a small fixture stays centred at 2x and pans only once it overflows the stage', () => {
  const box = { width: 480, height: 320, stageWidth: 1100, stageHeight: 720 };
  const twice = zoomBy(zoomFit(), ZOOM_STEP, { x: 0, y: 0 }, box, 4);
  assert.deepEqual(panBy(twice, 60, 60, box), twice);
  const four = zoomBy(twice, ZOOM_STEP, { x: 0, y: 0 }, box, 4);
  assert.deepEqual(panBy(four, 60, 60, box), { scale: 4, x: 60, y: 60 });
  assert.deepEqual(panBy(four, 9999, 9999, box), { scale: 4, x: 410, y: 280 });
});

test('the maximum is four times fit, more for a large picture, never past sixteen', () => {
  assert.equal(zoomMax(1), 4, 'a picture shown at its own size still zooms four times');
  assert.equal(zoomMax(0.5), 4, 'a small picture drawn larger than itself');
  assert.equal(zoomMax(3), 6, 'a large photo zooms to twice its own pixels');
  assert.equal(zoomMax(40), 16, 'never past sixteen');
  assert.equal(zoomMax(undefined), 4);
});

test('zoom in about a point keeps that point under the pointer', () => {
  const p = { x: 200, y: 150 };
  const before = onPicture(zoomFit(), p);
  const v = zoomBy(zoomFit(), ZOOM_STEP, p, BOX, MAX);
  assert.equal(v.scale, 2);
  const after = onPicture(v, p);
  close(after.x, before.x, 'the same spot of the picture stays under the pointer across');
  close(after.y, before.y, 'and down');
});

test('zoom out about a point keeps that point under the pointer', () => {
  // From well inside the zoom, so neither step reaches an edge.
  const start = { scale: 6, x: -300, y: 200 };
  const p = { x: -100, y: 80 };
  const before = onPicture(start, p);
  const v = zoomBy(start, 1 / ZOOM_STEP, p, BOX, MAX);
  assert.equal(v.scale, 3);
  const after = onPicture(v, p);
  close(after.x, before.x, 'across');
  close(after.y, before.y, 'down');
});

test('in then out about the same point comes back to where it was', () => {
  const start = { scale: 2, x: 100, y: -50 };
  const p = { x: 60, y: -20 };
  const v = zoomBy(zoomBy(start, ZOOM_STEP, p, BOX, MAX), 1 / ZOOM_STEP, p, BOX, MAX);
  close(v.scale, start.scale, 'scale');
  close(v.x, start.x, 'x');
  close(v.y, start.y, 'y');
});

test('pan never loses the picture: at fit it stays centred, zoomed it stops at the edges', () => {
  assert.deepEqual(panBy(zoomFit(), 500, -400, BOX), { scale: 1, x: 0, y: 0 }, 'a fitted picture does not move');
  const v = { scale: 2, x: 0, y: 0 };
  const reach = panBounds(v, BOX);
  assert.deepEqual(reach, { x: 500, y: 250 }, 'the zoomed picture may move until an edge meets the stage edge');
  const far = panBy(v, 10000, -10000, BOX);
  assert.deepEqual(far, { scale: 2, x: 500, y: -250 }, 'and no further');
  // The picture covers the stage whatever the drag: its edges are never inside the stage edges.
  for (const [dx, dy] of [[9999, 9999], [-9999, 9999], [9999, -9999], [-9999, -9999], [37, -12]]) {
    const w = panBy(v, dx, dy, BOX);
    const left = w.x - (BOX.width * w.scale) / 2;
    const right = w.x + (BOX.width * w.scale) / 2;
    assert.ok(left <= -BOX.stageWidth / 2 + 1e-9 && right >= BOX.stageWidth / 2 - 1e-9, 'covers the stage across after ' + dx + ',' + dy);
    const top = w.y - (BOX.height * w.scale) / 2;
    const bottom = w.y + (BOX.height * w.scale) / 2;
    assert.ok(top <= -BOX.stageHeight / 2 + 1e-9 && bottom >= BOX.stageHeight / 2 - 1e-9, 'covers the stage down after ' + dx + ',' + dy);
  }
  // Zoomed only enough to overflow one way: the other axis stays centred.
  const tall = clampPan({ scale: 1.1, x: 400, y: 400 }, BOX);
  close(tall.x, 50, 'across, the overflow is half of the extra width');
  assert.equal(tall.y, 0, 'down, it still fits and stays centred');
});

test('zooming about a point near an edge is held to the pan bounds', () => {
  // A point in the empty band above a wide picture: zooming there must not leave a gap between the picture and the edge.
  const v = zoomBy(zoomFit(), ZOOM_STEP, { x: 0, y: -340 }, BOX, MAX);
  const reach = panBounds(v, BOX);
  assert.ok(Math.abs(v.y) <= reach.y + 1e-9 && Math.abs(v.x) <= reach.x + 1e-9);
});

test('pan moves by what the pointer moved, inside the bounds', () => {
  const v = panBy({ scale: 3, x: 0, y: 0 }, 40, -25, BOX);
  assert.deepEqual(v, { scale: 3, x: 40, y: -25 });
});

test('a double tap toggles between fit and a closer look about the tap', () => {
  const p = { x: 100, y: 50 };
  const v = toggleZoom(zoomFit(), p, BOX, MAX);
  assert.equal(v.scale, ZOOM_DOUBLE_TAP);
  const a = onPicture(zoomFit(), p);
  const b = onPicture(v, p);
  close(a.x, b.x, 'the tapped spot stays under the finger');
  close(a.y, b.y, 'down too');
  assert.deepEqual(toggleZoom(v, p, BOX, MAX), zoomFit(), 'a second double tap goes back to fit');
});

test('a pinch follows the spread and the midpoint of the fingers, inside the bounds', () => {
  const from = [{ x: -50, y: 0 }, { x: 50, y: 0 }];
  const to = [{ x: -100, y: 0 }, { x: 100, y: 0 }];
  const v = pinch(zoomFit(), from, to, BOX, MAX);
  assert.equal(v.scale, 2, 'twice the spread, twice the scale');
  // The spot between the fingers stays between them.
  const mid = pinch({ scale: 3, x: 100, y: 0 }, [{ x: 0, y: 0 }, { x: 100, y: 0 }], [{ x: -20, y: 10 }, { x: 180, y: 10 }], BOX, MAX);
  const was = onPicture({ scale: 3, x: 100, y: 0 }, { x: 50, y: 0 });
  const now = onPicture(mid, { x: 80, y: 10 });
  close(now.x, was.x, 'across');
  close(now.y, was.y, 'down');
  assert.equal(pinch(zoomFit(), from, [{ x: -1, y: 0 }, { x: 1, y: 0 }], BOX, MAX).scale, ZOOM_FIT, 'pinching in past fit stops at fit');
  assert.equal(pinch(zoomFit(), from, [{ x: -5000, y: 0 }, { x: 5000, y: 0 }], BOX, MAX).scale, MAX, 'and out past the maximum stops there');
  assert.deepEqual(pinch(zoomFit(), [{ x: 0, y: 0 }, { x: 0, y: 0 }], to, BOX, MAX), zoomFit(), 'two fingers on one spot is no pinch');
});

test('the wheel zooms in on a turn toward the reader and out away from them', () => {
  assert.ok(wheelFactor(-100) > 1, 'up zooms in');
  assert.ok(wheelFactor(100) < 1, 'down zooms out');
  assert.equal(wheelFactor(0), 1);
  close(wheelFactor(100) * wheelFactor(-100), 1, 'a turn and its reverse cancel');
  assert.ok(wheelFactor(-3, 1) > wheelFactor(-3, 0), 'lines count for more than pixels');
  assert.ok(wheelFactor(-10, 0, true) > wheelFactor(-10, 0, false), 'a trackpad pinch is more sensitive than a wheel');
  assert.equal(wheelFactor(-1e9), wheelFactor(-400), 'one wild event cannot jump the whole range');
});

test('a click is a press that barely moved, and a double tap is two taps close in time and space', () => {
  assert.equal(isClick({ x: 10, y: 10 }, { x: 13, y: 12 }), true);
  assert.equal(isClick({ x: 10, y: 10 }, { x: 30, y: 10 }), false, 'a drag is not a click');
  assert.equal(isClick(null, { x: 0, y: 0 }), false);
  assert.equal(isDoubleTap({ x: 0, y: 0, at: 1000 }, { x: 5, y: 5, at: 1200 }), true);
  assert.equal(isDoubleTap({ x: 0, y: 0, at: 1000 }, { x: 5, y: 5, at: 1400 }), false, 'too slow');
  assert.equal(isDoubleTap({ x: 0, y: 0, at: 1000 }, { x: 80, y: 0, at: 1100 }), false, 'too far apart');
  assert.equal(isDoubleTap({ x: 0, y: 0, at: 1000 }, { x: 0, y: 0, at: 900 }), false, 'out of order');
  assert.equal(isDoubleTap(null, { x: 0, y: 0, at: 0 }), false);
});

test('the keys: + and - zoom, 0 resets, the arrows pan, Escape closes', () => {
  assert.deepEqual(zoomKey('+'), { kind: 'zoom', factor: ZOOM_STEP });
  assert.deepEqual(zoomKey('='), { kind: 'zoom', factor: ZOOM_STEP });
  assert.deepEqual(zoomKey('-'), { kind: 'zoom', factor: 1 / ZOOM_STEP });
  assert.deepEqual(zoomKey('0'), { kind: 'reset' });
  assert.deepEqual(zoomKey('Escape'), { kind: 'close' });
  assert.deepEqual(zoomKey('ArrowLeft'), { kind: 'pan', dx: ZOOM_PAN_STEP, dy: 0 });
  assert.deepEqual(zoomKey('ArrowDown'), { kind: 'pan', dx: 0, dy: -ZOOM_PAN_STEP });
  assert.equal(zoomKey('a'), null);
  assert.equal(zoomKey('toString'), null, 'nothing inherited counts as a key');
});

test('the shells reach the zoom rules through the engine', () => {
  for (const name of ['zoomTo', 'zoomBy', 'panBy', 'clampPan', 'pinch', 'toggleZoom', 'wheelFactor', 'zoomKey', 'zoomMax']) {
    assert.equal(typeof engine[name], 'function', name);
  }
});
