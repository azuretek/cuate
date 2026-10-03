// The one outside-dismiss behaviour (issue 170): a press that starts and ends outside an open panel closes it and is
// consumed, a press on the panel or its trigger is left alone, Escape closes the topmost panel only, and stacked panels
// close from the top down. The kit is driven here through a document of its own, with nodes that answer closest() and
// contains() the way the page's elements do for the two attributes the kit reads.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { dismissable, configureDismiss } from '../kit/dismiss.js';
import { pressOutside, closedByPress, closedByEscape, stackOf, swallows, SWALLOW_MS } from '../kit/rules/dismiss.js';

class Node {
  constructor(attrs = {}, parent = null) {
    this.attrs = attrs;
    this.parentElement = parent;
    this.controllers = [];
  }
  child(attrs = {}) { return new Node(attrs, this); }
  words(name) { return String(this.attrs[name] || '').split(/\s+/).filter(Boolean); }
  // Only the selector the kit writes: [data-dismiss~="x"], [data-dismiss-keep~="x"].
  closest(sel) {
    const want = [...sel.matchAll(/\[([\w-]+)~="([^"]+)"\]/g)].map((m) => [m[1], m[2]]);
    for (let n = this; n; n = n.parentElement) if (want.some(([a, v]) => n.words(a).includes(v))) return n;
    return null;
  }
  contains(other) {
    for (let n = other; n; n = n.parentElement) if (n === this) return true;
    return false;
  }
  addController(c) { this.controllers.push(c); }
  connect() { for (const c of this.controllers) c.hostConnected?.(); }
  disconnect() { for (const c of this.controllers) c.hostDisconnected?.(); }
  rendered() { for (const c of this.controllers) c.hostUpdated?.(); }
}

// A document that dispatches to its capture listeners and records what the page underneath would still have seen.
function makeDoc() {
  const listeners = {};
  let pointAt = null;
  return {
    addEventListener(type, fn, capture) { assert.equal(capture, true, 'the kit listens in the capture phase, ahead of every control'); (listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
    elementFromPoint() { return pointAt; },
    pointAt(node) { pointAt = node; },
    fire(type, init = {}) {
      const e = { type, isTrusted: true, timeStamp: 0, pointerId: 1, clientX: 1, clientY: 1, stopped: false, prevented: false, ...init,
        stopPropagation() { this.stopped = true; }, stopImmediatePropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; } };
      for (const fn of listeners[type] || []) fn(e);
      return e;
    },
  };
}

let doc;
beforeEach(() => {
  doc = makeDoc();
  configureDismiss({ doc: () => doc });
});

// One component with a menu, its trigger, and a control beside them; the menu opens when asked.
function setup({ name = 'menu', outside = true } = {}) {
  const page = new Node();
  const host = page.child();
  const trigger = host.child({ 'data-dismiss-keep': name });
  const panel = host.child({ 'data-dismiss': name });
  const item = panel.child();
  const underneath = page.child();
  const state = { open: false, closes: 0 };
  dismissable(host, { name, outside, open: () => state.open, close: () => { state.open = false; state.closes += 1; } });
  host.connect();
  return { page, host, trigger, panel, item, underneath, state };
}

// A whole press: down on one node, up over another, then the click the browser sends after the release.
function pressAt(down, up = down, { pointerType = 'mouse', t = 100 } = {}) {
  doc.pointAt(up);
  const d = doc.fire('pointerdown', { target: down, pointerType, timeStamp: t });
  const u = doc.fire('pointerup', { target: pointerType === 'touch' ? down : up, pointerType, timeStamp: t + 50 });
  const c = doc.fire('click', { target: up, timeStamp: t + 60 });
  return { d, u, c };
}

test('a press outside an open panel closes it, and the control underneath never sees that press or its click', () => {
  const s = setup();
  s.state.open = true;
  const { d, u, c } = pressAt(s.underneath);
  assert.equal(s.state.open, false);
  assert.equal(d.stopped, true, 'the press does not reach the control underneath');
  assert.equal(u.stopped, true);
  assert.equal(c.stopped && c.prevented, true, 'the click the same press delivers is consumed');
});

test('a tap outside closes it on touch, where the finger\'s pointerup names the element it went down on', () => {
  const s = setup();
  s.state.open = true;
  const { c } = pressAt(s.underneath, s.underneath, { pointerType: 'touch' });
  assert.equal(s.state.open, false);
  assert.equal(c.stopped, true);
});

test('a press inside the panel, or on its trigger, is left to them', () => {
  const s = setup();
  s.state.open = true;
  const inPanel = pressAt(s.item);
  assert.equal(s.state.open, true);
  assert.equal(inPanel.c.stopped, false, 'a menu item is clicked as usual');
  const onTrigger = pressAt(s.trigger);
  assert.equal(s.state.open, true, 'the trigger toggles its own panel');
  assert.equal(onTrigger.c.stopped, false);
});

test('a press that starts inside and ends outside, or starts outside and ends inside, closes nothing', () => {
  const s = setup();
  s.state.open = true;
  pressAt(s.item, s.underneath);
  assert.equal(s.state.open, true, 'a drag out of the panel is the panel\'s own gesture');
  pressAt(s.underneath, s.item);
  assert.equal(s.state.open, true);
});

test('with nothing open, presses and clicks pass straight through', () => {
  const s = setup();
  const { d, c } = pressAt(s.underneath);
  assert.equal(d.stopped, false);
  assert.equal(c.stopped, false);
});

test('only the dismissing press\'s own click is consumed: a script\'s click, a late click and the next press pass', () => {
  const s = setup();
  s.state.open = true;
  doc.pointAt(s.underneath);
  doc.fire('pointerdown', { target: s.underneath, timeStamp: 100 });
  doc.fire('pointerup', { target: s.underneath, timeStamp: 150 });
  assert.equal(doc.fire('click', { target: s.underneath, isTrusted: false, timeStamp: 160 }).stopped, false, 'a script\'s own click');
  assert.equal(doc.fire('click', { target: s.underneath, timeStamp: 150 + SWALLOW_MS + 1 }).stopped, false, 'too late to be that press');
  s.state.open = true;
  doc.fire('pointerdown', { target: s.underneath, timeStamp: 3000 });
  doc.fire('pointerup', { target: s.underneath, timeStamp: 3050 });
  doc.fire('keydown', { key: 'Enter', timeStamp: 3055 });
  assert.equal(doc.fire('click', { target: s.underneath, timeStamp: 3060 }).stopped, false, 'a key pressed since is a new action');
});

test('a context menu raised by the dismissing press is consumed, while the press is down and after it', () => {
  const s = setup();
  s.state.open = true;
  doc.pointAt(s.underneath);
  doc.fire('pointerdown', { target: s.underneath, button: 2, timeStamp: 100 });
  assert.equal(doc.fire('contextmenu', { target: s.underneath, timeStamp: 110 }).prevented, true);
  doc.fire('pointerup', { target: s.underneath, button: 2, timeStamp: 150 });
  assert.equal(s.state.open, false);
  s.state.open = true;
  pressAt(s.underneath, s.underneath, { t: 400 });
  assert.equal(s.state.open, false);
});

test('a cancelled press (a scroll took it over) closes nothing', () => {
  const s = setup();
  s.state.open = true;
  doc.fire('pointerdown', { target: s.underneath, pointerType: 'touch' });
  doc.fire('pointercancel', { target: s.underneath, pointerType: 'touch' });
  doc.fire('pointerup', { target: s.underneath, pointerType: 'touch' });
  assert.equal(s.state.open, true);
});

test('Escape closes the open panel before a focused field sees the key, and passes when nothing is open', () => {
  const s = setup();
  s.state.open = true;
  const e = doc.fire('keydown', { key: 'Escape', target: s.underneath });
  assert.equal(s.state.open, false);
  assert.equal(e.stopped && e.prevented, true, 'the field under the panel does not also act on it');
  const again = doc.fire('keydown', { key: 'Escape', target: s.underneath });
  assert.equal(again.stopped, false, 'with nothing open, Escape is the page\'s own');
  s.state.open = true;
  doc.fire('keydown', { key: 'Escape', isComposing: true });
  assert.equal(s.state.open, true, 'Escape inside an input method composition is the composition\'s');
});

test('stacked panels: Escape closes the top one only, and a press inside the top one closes nothing beneath it', () => {
  const page = new Node();
  const host = page.child();
  const sheet = host.child({ 'data-dismiss': 'sheet' });
  const modal = host.child({ 'data-dismiss': 'modal' });
  const outside = page.child();
  const st = { sheet: false, modal: false };
  dismissable(host, { name: 'sheet', open: () => st.sheet, close: () => { st.sheet = false; } });
  dismissable(host, { name: 'modal', open: () => st.modal, close: () => { st.modal = false; } });
  host.connect();
  st.sheet = true;
  host.rendered();
  st.modal = true;
  host.rendered();
  doc.fire('keydown', { key: 'Escape' });
  assert.deepEqual(st, { sheet: true, modal: false }, 'one layer per key');
  st.modal = true;
  host.rendered();
  pressAt(modal);
  assert.deepEqual(st, { sheet: true, modal: true });
  pressAt(sheet, sheet, { t: 2000 });
  assert.deepEqual(st, { sheet: true, modal: false }, 'a press outside the modal closes the modal and stops at the sheet it landed in');
  pressAt(outside, outside, { t: 4000 });
  assert.deepEqual(st, { sheet: false, modal: false });
});

test('a whole-surface panel (outside: false) is closed by Escape but never by a press', () => {
  const s = setup({ name: 'viewer', outside: false });
  s.state.open = true;
  const { c } = pressAt(s.underneath);
  assert.equal(s.state.open, true);
  assert.equal(c.stopped, false, 'its own gestures own every press');
  doc.fire('keydown', { key: 'Escape' });
  assert.equal(s.state.open, false);
});

test('a panel of the same name in another component is not inside this one', () => {
  const page = new Node();
  const a = page.child();
  const b = page.child();
  const panelB = b.child({ 'data-dismiss': 'emoji' });
  const st = { a: true };
  dismissable(a, { name: 'emoji', open: () => st.a, close: () => { st.a = false; } });
  a.connect();
  pressAt(panelB);
  assert.equal(st.a, false);
});

test('a disconnected component\'s panel is no longer dismissed', () => {
  const s = setup();
  s.state.open = true;
  s.host.disconnect();
  pressAt(s.underneath);
  doc.fire('keydown', { key: 'Escape' });
  assert.equal(s.state.closes, 0);
});

test('the rules: a press both starts and ends outside, panels close top down, Escape takes one layer', () => {
  assert.equal(pressOutside(true, true), true);
  assert.equal(pressOutside(true, false), false);
  assert.equal(pressOutside(false, true), false);
  assert.equal(pressOutside(undefined, undefined), false);
  const a = { name: 'a', openedAt: 1 };
  const b = { name: 'b', openedAt: 2 };
  const v = { name: 'v', openedAt: 3, outside: false };
  assert.deepEqual(stackOf([a, b]).map((e) => e.name), ['b', 'a']);
  assert.deepEqual(closedByPress(stackOf([a, b]), () => false).map((e) => e.name), ['b', 'a']);
  assert.deepEqual(closedByPress(stackOf([a, b]), (e) => e === a).map((e) => e.name), ['b']);
  assert.deepEqual(closedByPress(stackOf([a, b, v]), () => false), []);
  assert.equal(closedByEscape(stackOf([a, b])), b);
  assert.equal(closedByEscape([]), null);
  assert.equal(swallows({ at: 10 }, { isTrusted: true, timeStamp: 20 }), true);
  assert.equal(swallows({ at: 10 }, { isTrusted: false, timeStamp: 20 }), false);
  assert.equal(swallows(null, { isTrusted: true, timeStamp: 20 }), false);
});
