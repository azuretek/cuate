// The media viewer's controls (issue 325): every press reaches its control, the picture sits in the middle, and the
// controls are one designed family on the shared tokens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const viewer = readFileSync(new URL('../app/components/app-image-viewer.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/styles/app.css', import.meta.url), 'utf8');
const rule = (sel) => { const m = css.match(new RegExp('(^|\\n)' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([^}]*)\\}')); return m ? m[2] : ''; };

test('a press on any viewer control is the control\'s, never captured by the stage for a pan', () => {
  assert.match(viewer, /e\.target\.closest\('button, video, \.viewer-bar'\)\) return;/, 'every button, the bar and a video are left out of the pan');
  const down = viewer.slice(viewer.indexOf('onDown = (e) => {'), viewer.indexOf('onMove = (e) => {'));
  assert.ok(down.indexOf("closest('button, video, .viewer-bar')") < down.indexOf('setPointerCapture'), 'and that is decided before the stage takes the pointer');
});

test('the picture sits in the middle of the stage', () => {
  assert.match(viewer, /anchor: 'center' \}/);
});

test('the controls are one family: the close control\'s height, one frosted pill, one bar centred at the foot', () => {
  assert.match(css, /\.viewer \{ --viewer-control: var\(--size-close-lg\);/, 'the close control sets the height');
  assert.match(rule('.viewer-nav, .viewer-control'), /height: var\(--viewer-control\)/);
  assert.match(rule('.viewer > .close-button, .viewer-nav, .viewer-bar'), /background: var\(--viewer-glass\)/, 'one surface for every control');
  assert.match(rule('.viewer-bar'), /left: 50%; translate: -50% 0;/, 'the bar is centred');
  assert.match(viewer, /<div class="viewer-bar" role="toolbar" aria-label="Media controls">\$\{play\}\$\{count\}/, 'the play control and the position live in the bar');
  assert.match(viewer, /class="viewer-control viewer-play"[^>]*>.*<span class="viewer-play-label">Live<\/span>/, 'the play control is labelled');
  assert.match(rule('.viewer-play'), /background: var\(--color-accent\)/, 'and drawn in the accent so it is not missed');
  for (const sel of ['.viewer-nav, .viewer-control', '.viewer-bar', '.viewer-play', '.viewer-count, .viewer-zoom']) {
    assert.doesNotMatch(rule(sel), /\d+px(?!\))/, sel + ' takes its sizes from tokens');
  }
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.viewer > \.close-button, \.viewer-nav, \.viewer-bar \{ animation: none; \}/);
});
