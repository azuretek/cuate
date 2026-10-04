// The image viewer's close control belongs to the viewer (issue 245).
//
// Maximised, the viewer's X sat at the right edge level with the contact header and read as sitting on the blurred
// name/group banner rather than belonging to the picture. It is placed from the viewer's own top-right corner and the
// platform's top chrome, never from the contact header or the banner the backdrop blurs, and it stays clear of macOS's
// traffic-light strip and the window controls Windows and Linux draw in that corner. It carries no window drag, and
// the backdrop under it is no-drag too, so the whole circle answers (issue 213).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = () => readFileSync(new URL('../app/styles/app.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = (src) => [...src.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({ sel: sel.trim(), body }));
const rule = (src, selector) => { const hit = rules(src).find((r) => r.sel === selector); return hit ? hit.body : null; };

test('the viewer X is placed from the viewer and the platform chrome, never the contact header', () => {
  const src = css();
  const viewer = rule(src, '.viewer > .close-button');
  assert.ok(viewer, 'the viewer places its close control');
  assert.match(viewer, /position:\s*absolute/, 'it floats over the viewer surface');
  assert.doesNotMatch(viewer, /--size-header/, 'the viewer X is measured from the contact header');
  assert.match(viewer, /top:\s*calc\([^;]*--size-window-control-inset[^;]*--size-window-control-h[^;]*\);/, 'its top clears the window controls from the true window edge');
  assert.match(viewer, /right:\s*calc\([^;]*--inset-right[^;]*\);/, 'its right sits a margin in from the true window edge');
  const darwin = rule(src, '.app-window[data-platform="darwin"] .viewer > .close-button');
  assert.ok(darwin, 'macOS places the viewer X itself');
  assert.match(darwin, /top:\s*calc\([^;]*--size-window-strip[^;]*\);/, 'the macOS rule clears the traffic-light strip');
  assert.doesNotMatch(darwin, /--size-header/, 'the macOS rule is not measured from the contact header');
});

test('no viewer close rule is laid out from the contact header or the name banner', () => {
  const src = css();
  const found = rules(src).filter((r) => /\.viewer[^{}]*close-button/.test(r.sel));
  assert.ok(found.length >= 2, 'the viewer close rules are found');
  for (const r of found) assert.doesNotMatch(r.body, /--size-header/, r.sel + ' is measured from the contact header');
});

test('the viewer X carries no drag, and the backdrop under it is no-drag', () => {
  const src = css();
  assert.match(rule(src, '.close-button'), /-webkit-app-region:\s*no-drag/, 'the shared close control takes no window drag');
  assert.match(src, /\.sheet-scrim,\s*\.app-notice\s*\{\s*-webkit-app-region:\s*no-drag;\s*\}/, 'the viewer backdrop takes no window drag');
  assert.doesNotMatch(rule(src, '.viewer > .close-button'), /-webkit-app-region:\s*drag/, 'the viewer X never sits in a drag region');
});

test('the headers give up their window drag while the viewer is open', () => {
  const src = css();
  const dropped = rules(src).filter((r) => /app-image-viewer/.test(r.sel) && /(?:sidebar|conv)-head/.test(r.sel));
  assert.ok(dropped.length >= 1, 'the viewer makes the headers drop their drag');
  for (const r of dropped) assert.match(r.body, /-webkit-app-region:\s*no-drag/, r.sel + ' keeps a window drag under the viewer');
});
