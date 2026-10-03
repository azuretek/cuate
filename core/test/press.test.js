// The kit's press behaviour (issue 140): a double press runs the work once, the pending, success and failure states
// appear and clear, instant actions coalesce their repeats, and reduced motion draws no animation.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { press, runPress, emit, respond, configurePress, pressState } from '../kit/press.js';
import { admitPress, outcomeOf, holdsAfter, durationMs, isWork } from '../kit/rules/press.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// A control as the kit sees one: its dataset and its attributes.
function control() {
  const attrs = new Map();
  return {
    dataset: {},
    setAttribute: (k, v) => attrs.set(k, String(v)),
    removeAttribute: (k) => attrs.delete(k),
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
  };
}

// Timers the test moves by hand.
function clock() {
  let now = 0;
  let next = 1;
  const due = new Map();
  return {
    setTimeout(fn, ms) { const id = next++; due.set(id, { at: now + ms, fn }); return id; },
    clearTimeout(id) { due.delete(id); },
    tick(ms) {
      now += ms;
      for (const [id, t] of [...due].sort((a, b) => a[1].at - b[1].at)) if (t.at <= now) { due.delete(id); t.fn(); }
    },
  };
}

const deferred = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tokens = { '--motion-press-hold': '40ms', '--motion-press-coalesce': '25ms' };
let timers;
beforeEach(() => { timers = clock(); configurePress({ timers, style: (el, name) => tokens[name] || '' }); });
after(() => configurePress(null));

test('a double press runs the work once', async () => {
  const el = control();
  const work = deferred();
  let runs = 0;
  const handler = press(() => { runs += 1; return work.promise; });
  const first = handler({ currentTarget: el, detail: 1 });
  const second = handler({ currentTarget: el, detail: 2, preventDefault() { this.prevented = true; } });
  handler({ currentTarget: el, detail: 0 });
  assert.equal(runs, 1);
  assert.equal(second, undefined);
  work.resolve('done');
  assert.equal(await first, 'done');
  handler({ currentTarget: el, detail: 0 });
  assert.equal(runs, 2, 'a press after the work settled runs again');
});

test('a dropped press is prevented, so a dropped submit never navigates', () => {
  const el = control();
  runPress(el, () => new Promise(() => {}));
  const event = { detail: 0, prevented: false, preventDefault() { this.prevented = true; } };
  assert.equal(runPress(el, () => assert.fail('ran twice'), { event }), undefined);
  assert.equal(event.prevented, true);
});

test('pending shows busy, then success shows and clears after the hold token', async () => {
  const el = control();
  const work = deferred();
  const done = runPress(el, () => work.promise);
  assert.equal(el.dataset.press, 'pending');
  assert.equal(el.getAttribute('aria-busy'), 'true');
  assert.equal(el.getAttribute('aria-disabled'), 'true');
  assert.equal(pressState(el), 'pending');
  work.resolve(1);
  await done;
  assert.equal(el.dataset.press, 'success');
  assert.equal(el.getAttribute('aria-busy'), null);
  assert.equal(el.getAttribute('aria-disabled'), null);
  timers.tick(39);
  assert.equal(el.dataset.press, 'success', 'the hold is the token, not a literal');
  timers.tick(1);
  assert.equal(el.dataset.press, undefined);
  assert.equal(pressState(el), 'idle');
});

test('a rejection, and an answer of false, show failure and then clear', async () => {
  for (const settle of [(d) => d.reject(new Error('refused')), (d) => d.resolve(false)]) {
    const el = control();
    const work = deferred();
    const done = runPress(el, () => work.promise);
    settle(work);
    assert.equal(await done, false, 'a failed press never rejects to its caller');
    assert.equal(el.dataset.press, 'failure');
    assert.equal(el.getAttribute('aria-busy'), null);
    timers.tick(40);
    assert.equal(el.dataset.press, undefined);
  }
});

test('an action that throws shows failure and the error still surfaces', () => {
  const el = control();
  assert.throws(() => runPress(el, () => { throw new Error('boom'); }), /boom/);
  assert.equal(el.dataset.press, 'failure');
});

test('instant actions coalesce a pointer repeat and never queue it', () => {
  const el = control();
  let runs = 0;
  const toggle = press(() => { runs += 1; });
  toggle({ currentTarget: el, detail: 1 });
  toggle({ currentTarget: el, detail: 1 });
  toggle({ currentTarget: el, detail: 2 });
  assert.equal(runs, 1, 'the repeat inside the window and the double click are dropped');
  assert.equal(el.dataset.press, undefined, 'an instant action draws no state');
  timers.tick(25);
  assert.equal(runs, 1, 'nothing was queued to run later');
  toggle({ currentTarget: el, detail: 1 });
  assert.equal(runs, 2, 'after the coalesce window a press runs');
});

test('a script click or a key is never held, and a key-like control repeats', () => {
  const el = control();
  let runs = 0;
  const toggle = press(() => { runs += 1; });
  toggle({ currentTarget: el, detail: 0 });
  toggle({ currentTarget: el, detail: 0 });
  assert.equal(runs, 2);
  const key = control();
  let typed = 0;
  const cell = press(() => { typed += 1; }, { repeat: true });
  cell({ currentTarget: key, detail: 1 });
  cell({ currentTarget: key, detail: 2 });
  assert.equal(typed, 2, 'an emoji pressed twice is two emoji');
});

test('on picks the control that shows the state, so Enter and the button share it', async () => {
  const button = control();
  const work = deferred();
  let runs = 0;
  const submit = press(() => { runs += 1; return work.promise; }, { on: () => button });
  submit({ currentTarget: {}, detail: 0, preventDefault() {} });
  submit({ currentTarget: {}, detail: 0, preventDefault() {} });
  assert.equal(runs, 1);
  assert.equal(button.dataset.press, 'pending');
  work.resolve(true);
});

test('emit hands back the work a listener answered, and nothing when none did', async () => {
  const host = new EventTarget();
  host.addEventListener('save', (e) => respond(e, Promise.resolve(e.detail.n * 2)));
  assert.equal(await emit(host, 'save', { n: 21 }), 42);
  assert.equal(emit(host, 'other', {}), undefined);
});

test('the press rules', () => {
  assert.equal(admitPress({ state: 'pending' }, { repeat: true }), false);
  assert.equal(admitPress({ state: 'success', held: false }), true);
  assert.equal(admitPress({ state: 'idle', held: true }), false);
  assert.equal(admitPress({ state: 'idle', held: true }, { repeat: true }), true);
  assert.equal(outcomeOf({ value: 0 }), 'success');
  assert.equal(outcomeOf({ value: false }), 'failure');
  assert.equal(outcomeOf({ rejected: true }), 'failure');
  assert.equal(holdsAfter({ detail: 0 }), false);
  assert.equal(holdsAfter({ detail: 1, repeat: true }), false);
  assert.equal(durationMs('900ms', 1), 900);
  assert.equal(durationMs(' 0.25s ', 1), 250);
  assert.equal(durationMs('fast', 7), 7);
  assert.equal(isWork(Promise.resolve()), true);
  assert.equal(isWork(false), false);
});

test('the states are drawn from tokens, and reduced motion animates none of them', () => {
  const css = readFileSync(path.join(ROOT, 'core/app/styles/app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const state of ['pending', 'success', 'failure']) assert.match(css, new RegExp('\\[data-press="' + state + '"\\]'), state + ' is drawn');
  const animated = [...css.matchAll(/([^{}]*\[data-press[^{}]*)\{([^}]*)\}/g)].filter((m) => /animation\s*:/.test(m[2]) && !/animation\s*:\s*none/.test(m[2]));
  assert.ok(animated.length > 0, 'the states animate when motion is allowed');
  const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([^@]*?\}\s*)\}/g)].map((m) => m[1]).join('\n');
  assert.match(reduced, /\[data-press\]::after\s*\{\s*animation:\s*none;?\s*\}/, 'reduced motion stops every press animation');
  for (const m of animated) assert.match(m[1], /::after/, 'every press animation is on the ::after the reduced-motion rule stops: ' + m[1].trim());
  const tokens = JSON.parse(readFileSync(path.join(ROOT, 'core/spec/tokens.json'), 'utf8'));
  assert.ok(tokens.motion['press-hold'] && tokens.motion['press-coalesce'], 'the timings are motion tokens');
});
