// The grab affordance on the two draggable edges (issue 217, section D): a pill the pointer reveals on hover, grows on
// press, and leaves nothing at rest, drawn only from the theme's roles so an imported theme restyles it. The drawn pill
// is only what the eye sees; the hit strip straddles the whole seam with the resize cursor, so the edge is grabbable
// anywhere along it, and the pill itself takes no pointer events so a touch drag is never blocked by it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const spec = () => JSON.parse(read('../spec/tokens.json'));
// Comments carry prose that could name a rule, so the rules are read with them stripped.
const css = () => read('../app/styles/app.css').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (src, selector) => {
  const m = new RegExp('(?:^|[},\\n])\\s*' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}').exec(src);
  assert.ok(m, 'the rule ' + selector + ' exists');
  return m[1];
};

test('the grip is invisible at rest and only the pointer draws it (issue 217)', () => {
  const src = css();
  assert.match(rule(src, '.conv-divider::before'), /opacity:\s*0(?:[;\s]|$)/, 'the divider pill is not drawn at rest');
  assert.match(src, /\.conv-divider:hover::before\b[^{]*\{[^}]*opacity:\s*1/, 'hover draws the divider pill');
});

test('the grip grows on press (issue 217)', () => {
  assert.match(rule(css(), '.conv-divider:active::before'), /scale\(var\(--size-grip-press-scale\)\)/, 'a press grows the divider pill');
});

test('the hit strip is at least 10px across the whole seam, with the resize cursor throughout (issue 217)', () => {
  const width = parseFloat(spec().size['grip-hit']);
  assert.ok(Number.isFinite(width) && width >= 10, 'the strip is at least 10px: ' + spec().size['grip-hit']);
  const strip = rule(css(), '.conv-divider');
  assert.match(strip, /top:\s*0/, 'the strip starts at the top');
  assert.match(strip, /bottom:\s*0/, 'the strip runs to the bottom');
  assert.match(strip, /cursor:\s*col-resize/, 'the strip carries the resize cursor');
  assert.match(strip, /width:\s*var\(--size-grip-hit\)/, 'the width is the grip token');
});

test('every grip colour is a theme role, so an imported theme restyles it (issue 217)', () => {
  const body = rule(css(), '.conv-divider::before');
  assert.match(body, /border:\s*var\(--size-border\) solid var\(--color-border\)/, 'the outline is the border token');
  assert.match(body, /var\(--color-fg\)/, 'the dots are the foreground role');
  assert.equal(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(body), false, 'no literal colour');
});

test('the pill takes no pointer events, so a drag is never blocked (issue 217)', () => {
  assert.match(rule(css(), '.conv-divider::before'), /pointer-events:\s*none/, 'the divider pill takes no pointer events');
});

test('keyboard focus gets a visible ring (issue 217)', () => {
  assert.match(rule(css(), '.conv-divider:focus-visible'), /outline:\s*var\(--size-border\) solid var\(--color-accent\)/, 'the focus ring is drawn');
});

test('the phone drawer edge carries the same pill, nothing at rest and no finger capture (issue 217)', () => {
  const src = css();
  assert.match(src, /@media \(max-width: 640px\)/, 'the phone rules exist');
  assert.match(src, /\.conv-divider \{ display: none; \}/, 'the desktop strip is gone on the phone');
  const pill = rule(src, '.sidebar::after');
  assert.match(pill, /opacity:\s*0/, 'the drawer pill is not drawn at rest');
  assert.match(pill, /pointer-events:\s*none/, 'the drawer pill never takes the finger');
  assert.match(pill, /width:\s*var\(--size-grip-w\)/, 'the drawer pill is the divider pill');
  assert.match(src, /\.sidebar:hover::after\b[^{]*\{[^}]*opacity:\s*1/, 'hover draws the drawer pill');
});
