import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as diagnostics from './live-photo-observation.js';

test('the fixture media callback never reads layout or changes playback (issue 402)', () => {
  const source = readFileSync(new URL('./live-photo-fixture.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf("  for (const type of ['loadeddata'"), source.indexOf('  const state ='));
  const listeners = new Map();
  const el = { addEventListener(type, fn) { listeners.set(type, fn); } };
  const observation = diagnostics.observeLiveMotion({ w: 402, h: 536 });
  const trace = { note() {} };
  const box = () => { throw new Error('layout read in a media callback'); };
  new Function('el', 'observation', 'box', 'trace', 'recordMediaEvent', body)(el, observation, box, trace, diagnostics.recordMediaEvent);
  const video = Object.freeze({ matches: () => true, currentTime: 0.5, paused: false });
  for (const [type, fn] of listeners) assert.doesNotThrow(() => fn({ type, target: video }));
});
