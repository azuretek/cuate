// The caret's one placement rule (issue 217): a popover's caret is aimed at the control that opened it, and an
// untargeted placement, a control that is not over the popover, is refused, which is what the guard fails on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caretX } from '../kit/rules/popover.js';

const box = (left, width) => ({ left, right: left + width, width });
const anchor = (left, width) => ({ left, right: left + width, width });

test('the caret is aimed at the middle of the control that opened the popover', () => {
  assert.equal(caretX(anchor(100, 40), box(80, 240)), 40);
});

test('a control wider than the popover, or off one side, still puts the caret on the popover', () => {
  // The message menu: a wide row under a narrow pill, so the caret points at the control's near edge.
  assert.equal(caretX(anchor(0, 600), box(0, 160), 'start'), 6);
  assert.equal(caretX(anchor(0, 600), box(0, 160), 'end'), 154);
});

test('an untargeted placement is refused: a control that is not over the popover answers null', () => {
  assert.equal(caretX(anchor(0, 40), box(200, 160)), null, 'the control is left of the popover');
  assert.equal(caretX(anchor(400, 40), box(0, 160)), null, 'the control is right of the popover');
  assert.equal(caretX(null, box(0, 160)), null, 'no control');
  assert.equal(caretX(anchor(0, 40), box(0, 0)), null, 'no popover');
});

test('the caret never overhangs the popover, however the control sits', () => {
  for (const [al, aw, bl, bw] of [[0, 10, 0, 160], [150, 4, 0, 160], [80, 20, 0, 40], [0, 400, 300, 120]]) {
    const x = caretX(anchor(al, aw), box(bl, bw), 'center');
    if (x !== null) assert.ok(x >= 0 && x <= bw, al + ',' + aw + ' in ' + bl + ',' + bw + ' -> ' + x);
  }
});

test('the caret is kept whole by half its drawn width, so a corner or a screen edge never overhangs it', () => {
  // The caret is 12px (tokens size.caret), so its clamp is exactly half of it: 6.
  assert.equal(caretX(anchor(0, 4), box(0, 160), 'center'), 6, 'a control at the popover left edge');
  assert.equal(caretX(anchor(156, 4), box(0, 160), 'center'), 154, 'a control at the popover right edge');
});
