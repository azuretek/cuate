// The desktop's half of the window chrome, held to core's half: the BrowserWindow options each platform needs, the
// macOS traffic-light geometry, and the tokens the stylesheet uses, so the two cannot drift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { windowOptions, WINDOW_STRIP_HEIGHT, WINDOW_CONTROL_INSET, MAC_LIGHTS_X, MAC_LIGHTS_PX } from '../src/window-chrome.js';

const tokens = JSON.parse(readFileSync(new URL('../../core/spec/tokens.json', import.meta.url), 'utf8'));

test('macOS keeps its traffic lights and the app leaves them room', () => {
  const options = windowOptions('darwin');
  assert.equal(options.titleBarStyle, 'hiddenInset');
  assert.deepEqual(options.trafficLightPosition, { x: MAC_LIGHTS_X, y: (WINDOW_STRIP_HEIGHT - MAC_LIGHTS_PX) / 2 });
  assert.equal(options.frame, undefined, 'the frame stays on so the lights are drawn');
});

test('Windows and Linux draw no platform frame', () => {
  assert.deepEqual(windowOptions('win32'), { frame: false });
  assert.deepEqual(windowOptions('linux'), { frame: false });
});

test('the strip height is the token the stylesheet uses', () => {
  assert.equal(tokens.size['window-strip'], WINDOW_STRIP_HEIGHT + 'px');
});

test('the window-control inset is the token the stylesheet uses', () => {
  assert.equal(tokens.size['window-control-inset'], WINDOW_CONTROL_INSET + 'px');
});

test('the shell creates the window with the platform chrome', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /\.\.\.windowOptions\(process\.platform\)/, 'the window takes the platform chrome');
});
