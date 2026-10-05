// Issue 190: a standalone action button is CENTRED in its row, shows its OWN state in place (idle, working, done,
// failed) through the one kit press rather than delegating it to a separate line or notice, never changes size
// between its states, and is debounced while its work runs. Failing-first: before this change the kit rule module,
// the one-box labels and the centring did not exist, so these read the kit, the stylesheet and the components as
// text the way press.test.js does, and a double press is driven through the real kit press.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTION_STATES, actionLabel, actionLabels, actionStateOf } from '../kit/rules/button.js';
import { runPress, configurePress } from '../kit/press.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const css = read('core/app/styles/app.css').replace(/\/\*[\s\S]*?\*\//g, '');

test('a state names itself on the button, and falls back to the button\u2019s own words', () => {
  assert.deepEqual(ACTION_STATES, ['idle', 'pending', 'success', 'failure']);
  const labels = { idle: 'Check for updates', pending: 'Checking\u2026', success: 'Checked', failure: 'Could not check' };
  assert.deepEqual(actionLabels(labels), [
    { state: 'idle', text: 'Check for updates' },
    { state: 'pending', text: 'Checking\u2026' },
    { state: 'success', text: 'Checked' },
    { state: 'failure', text: 'Could not check' },
  ]);
  assert.equal(actionLabel(labels, 'success'), 'Checked');
  assert.equal(actionLabel({ idle: 'Copy' }, 'failure'), 'Copy', 'a state with no words of its own keeps the idle words');
  assert.equal(actionStateOf('pending'), 'pending');
  assert.equal(actionStateOf(undefined), 'idle');
  assert.equal(actionStateOf('nonsense'), 'idle', 'only a declared state is drawn');
});

test('every state\u2019s label is drawn through the kit, not hand-written per component', async () => {
  globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} };
  globalThis.document = { createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
  const { actionButtonLabels } = await import('../kit/button.js');
  const spans = actionButtonLabels({ idle: 'Save', pending: 'Saving', success: 'Saved', failure: 'Could not save' });
  assert.ok(spans, 'the kit returns the label markup');
  const about = read('core/app/components/app-about.js');
  assert.match(about, /import \{ actionButtonLabels \} from '\.\.\/\.\.\/kit\/button\.js'/, 'About uses the one kit button');
  assert.match(about, /actionButtonLabels\(\{[\s\S]*?pending:[\s\S]*?success:[\s\S]*?failure:/, 'the check names its working, done and failed words');
  assert.match(about, /class="button primary action-button about-check"/, 'Check for updates wears the shared action-button class');
  assert.match(about, /@click=\$\{press\(/, 'the button goes through the one kit press, so it is debounced');
  const notices = read('core/app/components/app-notices.js');
  assert.match(notices, /actionButtonLabels\(/, 'the notice action uses the one kit button');
});

test('a standalone action button is centred in its card or page', () => {
  assert.match(css, /\.action-button\s*\{[^}]*align-self:\s*center/, '.action-button is centred');
  assert.match(css, /\.about-check\s*\{[^}]*align-self:\s*center/, 'Check for updates is centred');
  assert.match(css, /\.about-copy\s*\{[^}]*align-self:\s*center/, 'the bug-report Copy is centred');
});

test('every state\u2019s label sits in one box, so the button never resizes between states', () => {
  assert.match(css, /\.action-labels\s*\{[^}]*display:\s*grid/, 'the labels share one grid');
  assert.match(css, /\.action-label\s*\{[^}]*grid-area:\s*1\s*\/\s*1/, 'every label shares the one cell');
  assert.match(css, /\.action-button\[data-press="pending"\]\s+\.action-label\[data-when="pending"\]/, 'the working label shows');
  assert.match(css, /\.action-button\[data-press="success"\]\s+\.action-label\[data-when="success"\]/, 'the done label shows');
  assert.match(css, /\.action-button\[data-press="failure"\]\s+\.action-label\[data-when="failure"\]/, 'the failed label shows');
  assert.match(css, /\.action-button:not\(\[data-press\]\)\s+\.action-label\[data-when="idle"\]/, 'idle shows its own words');
});

test('a double press on an action button runs its work once (debounced while pending)', async () => {
  const timers = { setTimeout: () => 1, clearTimeout: () => {} };
  configurePress({ timers, style: () => '' });
  const attrs = new Map();
  const el = { dataset: {}, setAttribute: (k, v) => attrs.set(k, String(v)), removeAttribute: (k) => attrs.delete(k) };
  let runs = 0;
  let release;
  const work = new Promise((r) => { release = r; });
  runPress(el, () => { runs += 1; return work; });
  const dropped = runPress(el, () => { runs += 1; return work; }, { event: { detail: 1, preventDefault() {} } });
  assert.equal(dropped, undefined, 'the second press is dropped');
  assert.equal(runs, 1, 'the work ran once');
  assert.equal(el.dataset.press, 'pending');
  release(true);
  configurePress(null);
});
