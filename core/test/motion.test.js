// Motion comes from where a thing came from (issue 316, docs/CONVENTIONS.md "Motion").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { flipDelta, newArrivals } from '../kit/rules/motion.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, msg + ': ' + a + ' vs ' + b);

test('a thing that grows out of another starts exactly over it', () => {
  const to = { left: 100, top: 200, width: 400, height: 300 };
  const from = { left: 10, top: 20, width: 100, height: 75 };
  const d = flipDelta(from, to);
  close(d.sx, 0.25, 'scaled to the preview width');
  close(d.sy, 0.25, 'and its height');
  // Scaled about its own centre and then moved, the element's centre lands on the preview's centre.
  close(300 + d.dx, 60, 'x');
  close(350 + d.dy, 57.5, 'y');
  // A transform that already moves it (the viewer's pan and top lift) moves the layout centre the scale is about.
  const lifted = flipDelta(from, to, { x: 300, y: 450 });
  close(300 + lifted.sx * (300 - 300) + lifted.dx, 60, 'x with an origin');
  close(450 + lifted.sy * (350 - 450) + lifted.dy, 57.5, 'y with an origin below the drawn centre');
  assert.deepEqual(flipDelta(from, { left: 0, top: 0, width: 0, height: 0 }), { dx: 0, dy: 0, sx: 1, sy: 1 }, 'nothing laid out yet: no motion');
});

test('only messages that arrive animate: not a first draw, another conversation or a page of older history', () => {
  const m = (id, o = {}) => ({ id, fromMe: false, ...o });
  const shown = [m('a'), m('b')];
  assert.deepEqual(newArrivals([], shown), [], 'a first draw is a place');
  assert.deepEqual(newArrivals(shown, [...shown, m('c')], { sameChat: false }), [], 'another conversation is a place');
  assert.deepEqual(newArrivals(shown, [m('y'), m('z'), ...shown]), [], 'older history above is a place');
  assert.deepEqual(newArrivals(shown, [...shown, m('c')]), [{ id: 'c', sent: false }], 'a received message arrives');
  const sending = [...shown, m('local:1', { fromMe: true })];
  assert.deepEqual(newArrivals(shown, sending), [{ id: 'local:1', sent: true }], 'our own rises from the composer');
  assert.deepEqual(newArrivals(sending, [...shown, m('G1', { fromMe: true })]), [], 'its real copy replacing it does not rise again');
  assert.deepEqual(newArrivals(shown, [...shown, m('G2', { fromMe: true })]), [{ id: 'G2', sent: false }], 'one we sent from another device arrives like any other');
});

test('every motion runs on the shared tokens and stops for reduced motion', () => {
  const css = read('../app/styles/app.css');
  for (const decl of css.match(/(?:animation|transition)(?:-duration)?\s*:[^;}]*/g) || []) {
    assert.ok(!/(?:^|[\s,(])\d*\.?\d+m?s\b/.test(decl.split(':').slice(1).join(':')), 'a literal duration: ' + decl);
  }
  for (const name of ['pop-grow']) assert.ok(css.includes('@keyframes ' + name), name + ' is drawn');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.message-pop \{ animation: none; \} \}/, 'a menu stops growing for reduced motion');
  const tokens = JSON.parse(read('../spec/tokens.json'));
  for (const t of ['grow', 'drawer', 'drawer-out', 'screen', 'spring']) assert.ok(/^\d+ms$/.test(tokens.motion[t]), t + ' is a token');
  const kit = read('../kit/motion.js');
  assert.match(kit, /prefers-reduced-motion: reduce/, 'the kit plays nothing for reduced motion');
  const files = readdirSync(new URL('../app/components/', import.meta.url)).filter((f) => f.endsWith('.js'));
  for (const f of files) assert.ok(!/\.animate\(/.test(read('../app/components/' + f)), f + ' animates through core/kit/motion.js, not on its own');
});

test('a line typed in grows the field smoothly, revealed upward on the grow token, and nothing else animates it', () => {
  const composer = read('../app/components/app-composer.js');
  assert.match(composer, /if \(e\.type === 'input' && before > 0 && grew > 0\)/, 'only typing that grows the field animates it');
  assert.match(composer, /play\(t, \[\{ clipPath: 'inset\(' \+ \(grew - 2\) \+ 'px/, 'it is revealed from its old height, so its layout height is exact at once');
  assert.match(composer, /duration: 'grow'/, 'on the shared grow token');
});

test('a sent message rises from the composer, a received one slides up, and another conversation slides in', () => {
  const conv = read('../app/components/app-conversation.js');
  assert.match(conv, /growFrom\(bubble, \{ left: r\.left, top:/, 'our message grows out of the field it was typed in');
  assert.match(conv, /play\(bubble, \[\{ opacity: 0, translate:/, 'a received message slides up into place');
  assert.match(conv, /play\(list, \[\{ opacity: 0, translate: step \+ 'px 0px' \}/, 'another conversation slides in from the side');
  const viewer = read('../app/components/app-image-viewer.js');
  assert.match(viewer, /growFrom\(img, from, \{ origin: this\.layoutCentre\(img\) \}\)/, 'the viewer grows out of the preview it was opened from');
  assert.match(viewer, /back: true/, 'and shrinks back into it');
  assert.match(read('../app/components/app-attachment.js'), /detail: \{ from, src:/, 'the preview goes with the press');
});
