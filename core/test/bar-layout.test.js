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
  assert.match(styles, /\.window-controls \{ display: flex; align-self: stretch; margin-inline-start: auto; -webkit-app-region: no-drag; \}/, 'the controls pin to the right of the contact header');
});

test('macOS leaves the lights room without drawing anything of its own', () => {
  const styles = css().replace(/\/\*[\s\S]*?\*\//g, '');
  const reserve = /\.app-window\[data-platform="darwin"\] \.sidebar-head,\n\.app-window\[data-platform="darwin"\] \.conv-head \{ height: calc\(var\(--size-header\) \+ var\(--size-window-strip\)\); padding-block-start: var\(--size-window-strip\); \}/;
  assert.match(styles, reserve, 'the content is pushed below the lights');
  assert.match(styles, /\.window-control\.close \{ width: var\(--size-window-control-close\); \}/, 'close is the widest control');
});

test('the contact header draws the controls and the page answers their clicks', () => {
  const conversation = read('../app/components/app-conversation.js');
  assert.match(conversation, /windowControlsHtml\(\{ order: this\.windowControls\.order, maximized: this\.maximized,/, 'the header draws the controls from the model');
  assert.match(conversation, /this\.fire\('window-action', name\)/, 'a click goes back to the page');
  const root = read('../app/components/app-root.js');
  assert.match(root, /\.windowControls=\$\{this\.windowControls\(\)\}/, 'the page hands the arrangement down');
  assert.match(root, /@window-action=\$\{\(e\) => this\.windowAction\(e\.detail\)\}/, 'the page owns the window actions');
});
