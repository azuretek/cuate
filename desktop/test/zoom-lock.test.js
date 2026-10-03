import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blocksZoomKey, lockZoom } from '../src/zoom-lock.js';

test('the zoom keys are refused with ctrl or cmd, and nothing else is', () => {
  for (const key of ['+', '=', '-', '_', '0']) {
    assert.equal(blocksZoomKey({ type: 'keyDown', key, control: true }), true, 'ctrl ' + key);
    assert.equal(blocksZoomKey({ type: 'keyDown', key, meta: true }), true, 'cmd ' + key);
    assert.equal(blocksZoomKey({ type: 'keyDown', key }), false, key + ' alone is typing');
  }
  assert.equal(blocksZoomKey({ type: 'keyUp', key: '=', control: true }), false);
  assert.equal(blocksZoomKey({ type: 'keyDown', key: 'c', control: true }), false, 'copy still works');
  assert.equal(blocksZoomKey({ type: 'keyDown', key: 'q', meta: true }), false, 'quit still works');
});

test('a window is locked at zoom 1: pinch limits, the keys, and any zoom that lands is put back', () => {
  const calls = [];
  const on = {};
  let factor = 1.5;
  const wc = {
    setVisualZoomLevelLimits: (a, b) => calls.push(['limits', a, b]),
    on: (name, fn) => { on[name] = fn; },
    getZoomFactor: () => factor,
    setZoomFactor: (f) => { factor = f; },
  };
  lockZoom(wc);
  assert.deepEqual(calls, [['limits', 1, 1]]);
  let prevented = false;
  on['before-input-event']({ preventDefault: () => { prevented = true; } }, { type: 'keyDown', key: '=', control: true });
  assert.equal(prevented, true);
  on['zoom-changed']({}, 'in');
  assert.equal(factor, 1);
});

test('the main window takes the lock', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /import \{ lockZoom \} from '\.\/zoom-lock\.js';/);
  assert.match(main, /lockZoom\(win\.webContents\);/);
});
