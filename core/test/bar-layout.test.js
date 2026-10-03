// The window chrome: which platform draws the window controls and in what order, that there is no bar of our own and
// no window title, that the app's surfaces reach the top edge, and that the top strip is a drag region with the
// controls and interactives out of it. The rules are pure, so every platform is checked from one run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WINDOW_CONTROLS, controlLayout } from '../app/rules/bar-layout.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const css = () => read('../app/styles/app.css');

test('Windows and Linux draw minimize, maximize, close on the right; macOS draws none', () => {
  assert.deepEqual(WINDOW_CONTROLS, ['minimize', 'maximize', 'close']);
  assert.deepEqual(controlLayout({ platform: 'win32' }), { side: 'right', order: ['minimize', 'maximize', 'close'], drawn: true });
  assert.deepEqual(controlLayout({ platform: 'linux' }), { side: 'right', order: ['minimize', 'maximize', 'close'], drawn: true });
  // macOS keeps its own traffic lights, so the app draws no controls there.
  assert.deepEqual(controlLayout({ platform: 'darwin' }), { side: 'left', order: [], drawn: false });
  assert.equal(controlLayout({ platform: 'ios' }).drawn, false);
  assert.equal(controlLayout({}).drawn, false);
});

test('there is no bar of our own and no window title', () => {
  const root = read('../app/components/app-root.js');
  assert.equal(/window-bar|window-title|window-icon/.test(root), false, 'the app draws no bar, no title and no icon');
  assert.equal(/window-bar|window-title|window-icon/.test(css()), false, 'no rule draws a bar, a title or an icon');
  // The product name is never printed as a title in the shell; the app surfaces run to the top edge instead.
  assert.equal(/host\.product/.test(root), false, 'the shell does not print the product name');
});

test('the top strip drags, with the controls and interactives out of it', () => {
  const styles = css().replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(styles, /\.sidebar-head, \.conv-head \{ -webkit-app-region: drag; \}/, 'the two headers are the drag strip');
  const noDrag = /\.chat-search, \.filter-button, \.gear-button, \.conv-back, \.window-controls, \.window-control \{ -webkit-app-region: no-drag; \}/;
  assert.match(styles, noDrag, 'the search, the header buttons and the window controls opt out');
  assert.match(styles, /\.window-controls \{ display: flex; align-self: flex-start; gap: var\(--size-window-control-gap\); margin-block-start: var\(--size-window-control-inset\); margin-inline: auto calc\(var\(--size-window-control-inset\) - var\(--space-4\)\); -webkit-app-region: no-drag; \}/, 'the controls sit in the top-right corner, one inset from the top and from the right');
});

test('macOS leaves the lights room without drawing anything of its own', () => {
  const styles = css().replace(/\/\*[\s\S]*?\*\//g, '');
  const reserve = /\.app-window\[data-platform="darwin"\] \.sidebar-head,\n\.app-window\[data-platform="darwin"\] \.conv-head \{ height: calc\(var\(--size-header\) \+ var\(--size-window-strip\)\); padding-block-start: var\(--size-window-strip\); \}/;
  assert.match(styles, reserve, 'the content is pushed below the lights');
});

test('the window controls hover as a rounded box sized from tokens (issue 131)', () => {
  const styles = css().replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = /^\.window-control \{([^}]*)\}/m.exec(styles);
  assert.ok(rule, 'the .window-control rule exists');
  assert.match(rule[1], /width: var\(--size-window-control\);/, 'the width is a token');
  assert.match(rule[1], /height: var\(--size-window-control-h\);/, 'the height is a token, not the header\'s full height');
  assert.match(rule[1], /border-radius: var\(--radius-sm\);/, 'the hover box is rounded by the radius token');
  assert.match(styles, /\.window-control\.close:hover, \.window-control\.close:active \{ background: var\(--color-danger\); color: var\(--color-danger-fg\); \}/, 'close keeps its own tint');
  assert.match(styles, /\.window-control svg \{ display: block; width: var\(--size-window-glyph\); height: var\(--size-window-glyph\); stroke-width: var\(--size-window-glyph-stroke\); \}/, 'the glyph size and weight are tokens');
  // Every control is the same size now that the hover is a box rather than a full-height block.
  assert.equal(/window-control-close/.test(styles), false, 'no control carries a width of its own');
  const glyphs = read('../app/components/window-controls.js');
  assert.equal(/stroke-width|<svg[^>]*\s(?:width|height)=/.test(glyphs), false, 'the glyphs carry no size or weight in the markup');
});

test('the contact header draws the controls and the page answers their clicks', () => {
  const conversation = read('../app/components/app-conversation.js');
  assert.match(conversation, /windowControlsHtml\(\{ order: this\.windowControls\.order, maximized: this\.maximized,/, 'the header draws the controls from the model');
  assert.match(conversation, /this\.fire\('window-action', name\)/, 'a click goes back to the page');
  const root = read('../app/components/app-root.js');
  assert.match(root, /\.windowControls=\$\{this\.windowControls\(\)\}/, 'the page hands the arrangement down');
  assert.match(root, /@window-action=\$\{\(e\) => this\.windowAction\(e\.detail\)\}/, 'the page owns the window actions');
});
