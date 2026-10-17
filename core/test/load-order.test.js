// Media loads in the order the person sees it (issue 425): what is on screen first, then what is a screen away, and
// nothing further out; a fetch scrolled out of reach is cancelled and asked for again when it comes back. The real
// attachment element runs against an observer that answers from a page laid out in this file, so the test reads which
// picture the server was asked for, and when, rather than trusting what the element meant to do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const defined = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { defined[name] = cls; }, get() { return undefined; } };
globalThis.document = { createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
let urls = 0;
URL.createObjectURL = () => 'blob:' + ++urls;
URL.revokeObjectURL = () => {};

// The page: a window 800 high scrolled to view.top, and each element's box in page coordinates. An element inside a
// scrolled view (its parentElement marked scrolls, as the conversation's .messages is) is clipped to that view's box
// before anything else, as a browser clips it: the screen's observer reports it on screen only where it shows through
// the view, and that observer's margin never reaches past the clip. An observer rooted at the scrolled view measures
// against the view's own box grown by its margin. Every observer reports as a browser's does: each target once when it
// is observed, then only those whose crossing changed, in one batch per observer in the order its targets were
// observed, after the current task.
const view = { top: 0, height: 800 };
const observers = new Set();
const marginOf = (rootMargin, height) => {
  const first = String(rootMargin || '0px').trim().split(/\s+/)[0];
  return first.endsWith('%') ? (parseFloat(first) / 100) * height : parseFloat(first) || 0;
};
// A box on the window: a scrolled view's box is fixed on the window (it scrolls its content, not itself); anything else
// moves with the page.
const onWindow = (el) => (el.scrolls ? el.box : { top: el.box.top - view.top, bottom: el.box.bottom - view.top });
const overlap = (a, b) => a.top < b.bottom && a.bottom > b.top;
const crosses = (el, observer) => {
  const box = onWindow(el);
  if (observer.root) {
    const r = onWindow(observer.root);
    const m = marginOf(observer.rootMargin, r.bottom - r.top);
    return overlap(box, { top: r.top - m, bottom: r.bottom + m });
  }
  const scroller = el.parentElement?.scrolls ? onWindow(el.parentElement) : null;
  if (scroller && !overlap(box, scroller)) return false;
  const m = scroller ? 0 : marginOf(observer.rootMargin, view.height);
  return overlap(box, { top: -m, bottom: view.height + m });
};
globalThis.getComputedStyle = (n) => ({ overflowY: n.scrolls ? 'auto' : 'visible' });
class FakeObserver {
  constructor(callback, options = {}) {
    this.callback = callback;
    this.root = options.root || null;
    this.rootMargin = options.rootMargin;
    this.targets = new Map();
    this.queued = new Set();
    observers.add(this);
  }
  observe(el) {
    if (this.targets.has(el)) return;
    this.targets.set(el, null);
    this.queue(el);
  }
  unobserve(el) {
    this.targets.delete(el);
    this.queued.delete(el);
  }
  disconnect() {
    this.targets.clear();
    this.queued.clear();
  }
  queue(el) {
    if (!this.queued.size) setTimeout(() => this.flush(), 0);
    this.queued.add(el);
  }
  flush() {
    const entries = [];
    for (const el of this.queued) {
      if (!this.targets.has(el)) continue;
      const now = crosses(el, this);
      if (this.targets.get(el) === now) continue;
      this.targets.set(el, now);
      entries.push({ target: el, isIntersecting: now });
    }
    this.queued.clear();
    if (entries.length) this.callback(entries, this);
  }
  moved() {
    for (const el of this.targets.keys()) if (this.targets.get(el) !== crosses(el, this)) this.queue(el);
  }
}
globalThis.IntersectionObserver = FakeObserver;
const scrollTo = (top) => {
  view.top = top;
  for (const o of observers) o.moved();
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

await import('../app/components/app-attachment.js');
const AppAttachment = defined['app-attachment'];

// Every request the elements make, in order, held open until the test answers it.
let requests = [];
const client = { attachment: (id, options = {}) => new Promise((resolve, reject) => { requests.push({ id, options, resolve, reject }); }) };
const photo = (id) => ({ id, name: id + '.png', mime: 'image/png', missing: false });
// One attachment element in a row whose box is 300 high from its top, drawn the way a render draws it.
let drawn = [];
const row = (id, top, height = 300, parent = null) => {
  const el = Object.create(AppAttachment.prototype);
  drawn.push(el);
  el.parentElement = parent;
  el.src = '';
  el.poster = '';
  el.failed = false;
  el.linkUrl = '';
  el.isConnected = true;
  el.hasUpdated = true;
  el.client = client;
  el.box = { top, bottom: top + height };
  el.attachment = photo(id);
  el.updated(new Map([['attachment', undefined]]));
  return el;
};
const asked = () => requests.map((r) => r.id);
const answer = async (id) => {
  const r = requests.find((x) => x.id === id && !x.answered);
  assert.ok(r, 'a request for ' + id + ' is open');
  r.answered = true;
  r.resolve(new Blob([id]));
  await settle();
};
// Each test starts on an empty page: whatever the last one drew is taken off it, as leaving a conversation does.
const reset = () => {
  for (const el of drawn) {
    el.isConnected = false;
    el.disconnectedCallback();
  }
  drawn = [];
  requests = [];
  view.top = 0;
};

// A conversation opens at its newest message, so the rows above the view come first in the page. The two at the foot
// are on screen; the three above them are within a screen; the two at the top are further out than that.
const conversation = (tag) => {
  view.top = 2000;
  return {
    far: [row(tag + '-far1', 0), row(tag + '-far2', 400)],
    near: [row(tag + '-near1', 1300), row(tag + '-near2', 1500), row(tag + '-near3', 1700)],
    seen: [row(tag + '-seen1', 2100), row(tag + '-seen2', 2400)],
  };
};

test('media on screen is fetched before media a screen away, and nothing further out is fetched (issue 425)', async () => {
  reset();
  const page = conversation('order');
  await settle();
  assert.deepEqual(asked().sort(), page.seen.map((e) => e.attachment.id).sort(), 'only what is on screen is asked for first');
  await answer('order-seen1');
  assert.ok(!asked().some((id) => id.includes('near')), 'nothing a screen away is asked for while something on screen is loading');
  await answer('order-seen2');
  assert.ok(page.seen.every((e) => e.src), 'the pictures on screen are drawn');
  assert.deepEqual(asked().filter((id) => id.includes('near')).sort(), page.near.map((e) => e.attachment.id).sort(), 'once the screen is drawn, what is a screen away is fetched');
  assert.ok(!asked().some((id) => id.includes('far')), 'nothing further than a screen away is fetched');
});

test('a fetch scrolled out of reach is cancelled, is not a failure, and is asked for again when it comes back (issue 425)', async () => {
  reset();
  const page = conversation('away');
  await settle();
  const first = requests.find((r) => r.id === 'away-seen1');
  assert.ok(first, 'the picture on screen is asked for');
  scrollTo(6000);
  await settle();
  assert.equal(first.options.signal?.aborted, true, 'scrolling it out of reach cancels its fetch');
  first.answered = true;
  first.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  await settle();
  assert.equal(page.seen[0].failed, false, 'a cancelled fetch is not a failed picture');
  assert.equal(page.seen[0].src, '');
  const before = requests.length;
  scrollTo(2000);
  await settle();
  const again = requests.slice(before).find((r) => r.id === 'away-seen1');
  assert.ok(again, 'it is asked for again when it comes back into view');
  await answer('away-seen1');
  assert.ok(page.seen[0].src, 'and drawn');
});

test('media never takes every connection: at most four fetches are in flight however much is on screen (issue 425)', async () => {
  reset();
  for (let i = 0; i < 8; i += 1) row('busy-' + i, i * 90, 80);
  await settle();
  assert.equal(requests.length, 4, 'four fetches in flight, the rest waiting');
  await answer('busy-0');
  assert.equal(requests.length, 5, 'a finished fetch lets the next one start');
});

test('an element taken off the page leaves the queue, and its fetch is cancelled (issue 425)', async () => {
  reset();
  const el = row('gone-1', 100);
  await settle();
  const r = requests.find((x) => x.id === 'gone-1');
  assert.ok(r, 'the element on screen is asked for');
  el.isConnected = false;
  el.disconnectedCallback();
  assert.equal(r.options.signal?.aborted, true, 'taking it off the page cancels its fetch');
});

test('a load a screen away waits for the page to say what a landed picture moved on screen (issue 425)', async () => {
  reset();
  row('shift-a', 100);
  row('shift-c', 900);
  row('shift-d', 1250);
  await settle();
  assert.deepEqual(asked(), ['shift-a'], 'only the picture on screen is asked for first');
  const landed = requests.find((x) => x.id === 'shift-a');
  landed.answered = true;
  landed.resolve(new Blob(['shift-a']));
  // The picture landing moves the page before the queue hears of it: shift-c comes on screen, shift-d stays a screen
  // away, and the observers report it only after the current task, as a browser's do.
  scrollTo(300);
  await settle();
  assert.deepEqual(asked(), ['shift-a', 'shift-c'], 'the picture the landing brought on screen is asked for, and nothing a screen away while it loads');
  await answer('shift-c');
  assert.deepEqual(asked(), ['shift-a', 'shift-c', 'shift-d'], 'then the one a screen away');
});

test('the order itself: on screen first as it came into view, a screen away only when the screen is done, away never (issue 425)', async () => {
  const { planLoads, LOAD_LIMIT } = await import('../kit/rules/load-order.js');
  const ids = (plan) => plan.start.map((l) => l.id);
  const load = (id, place, order, running = false) => ({ id, place, order, running });
  assert.deepEqual(ids(planLoads([load('n', 'near', 1), load('s2', 'seen', 3), load('s1', 'seen', 2), load('a', 'away', 0)])), ['s1', 's2'], 'what is on screen, in the order it was seen');
  assert.deepEqual(ids(planLoads([load('n', 'near', 1), load('s', 'seen', 2, true)])), [], 'nothing a screen away while something on screen is loading');
  assert.deepEqual(ids(planLoads([load('n2', 'near', 5), load('n1', 'near', 4)])), ['n1', 'n2'], 'a screen away, once the screen is done');
  assert.deepEqual(ids(planLoads([load('n', 'near', 1), load('u', 'unknown', 0)])), [], 'nothing a screen away until the screen has said what is on it');
  assert.deepEqual(planLoads([load('gone', 'away', 1, true), load('s', 'seen', 2)]).cancel.map((l) => l.id), ['gone'], 'a load scrolled out of reach is cancelled');
  assert.deepEqual(planLoads([load('ahead', 'near', 1, true), load('s', 'seen', 2)]).cancel.map((l) => l.id), ['ahead'], 'a load a screen away gives way to one on screen');
  assert.deepEqual(planLoads([load('ahead', 'near', 1, true)]).cancel, [], 'and keeps going when nothing on screen waits');
  const many = Array.from({ length: 9 }, (_, i) => load('s' + i, 'seen', i));
  assert.equal(planLoads(many).start.length, LOAD_LIMIT, 'never more than the limit at once');
  assert.ok(LOAD_LIMIT < 6, 'the limit leaves a connection of the six a web view holds to one server for the conversation itself');
});

// The proof in the shell's own web view (issue 425): a Debug-only fixture signs the real page in to a stand-in server
// over an emulated slow link, and the iOS UI test reads what it measured.
test('the load order fixture is a Debug seam the iOS UI test reads its measurement from (issue 425)', () => {
  const file = (f) => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
  const naming = JSON.parse(file('core/spec/naming.json'));
  const shell = file('ios/' + naming.product + '/ShellView.swift');
  assert.match(shell, /#if DEBUG[\s\S]*--load-order-fixture[\s\S]*#endif/, 'the fixture is a Debug seam');
  assert.match(file('ios/project.yml'), /CONFIGURATION.*Debug[\s\S]*core\/test\/load-order-fixture\.js/, 'copied into test builds only');
  const uiTest = file('ios/' + naming.product + 'UITests/LoadOrderTests.swift');
  for (const part of ['--load-order-fixture', 'offscreenBeforeOnscreen', 'staleAtStop', 'order:ready']) assert.ok(uiTest.includes(part), 'the UI test reads the measurement: ' + part);
  const fixture = file('core/test/load-order-fixture.js');
  for (const part of ['firstMessage', 'firstMedia', 'offscreenBeforeOnscreen', 'staleAtStop', 'screenWaiting']) assert.ok(fixture.includes(part), 'the fixture measures ' + part);
  assert.doesNotMatch(file('core/app/main.js'), /load-order-fixture/);
});

// The conversation's rows sit in a scrolled view (.messages) that fills the window, so the screen's own observer sees
// them only through that view: a margin on it never reaches a row above the view, and nothing was fetched ahead of a
// scroll at all. The rows here are laid out in the view's content, scrolled to its foot.
const scrolledView = (top = 0, bottom = 800) => ({ scrolls: true, box: { top, bottom }, parentElement: null });
const inView = (tag, scroller) => ({
  far: [row(tag + '-far1', 0, 300, scroller), row(tag + '-far2', 400, 300, scroller)],
  near: [row(tag + '-near1', 1300, 300, scroller), row(tag + '-near2', 1500, 300, scroller), row(tag + '-near3', 1700, 300, scroller)],
  seen: [row(tag + '-seen1', 2100, 300, scroller), row(tag + '-seen2', 2400, 300, scroller)],
});

test('rows a screen above a scrolled view are fetched ahead of a scroll, once the screen is drawn (issue 425)', async () => {
  reset();
  view.top = 2000;
  const page = inView('ahead', scrolledView());
  await settle();
  assert.deepEqual(asked().sort(), page.seen.map((e) => e.attachment.id).sort(), 'what shows through the view first');
  await answer('ahead-seen1');
  await answer('ahead-seen2');
  assert.deepEqual(asked().filter((id) => id.includes('near')).sort(), page.near.map((e) => e.attachment.id).sort(), 'then the rows within a screen above the view, before the person scrolls to them');
  assert.ok(!asked().some((id) => id.includes('far')), 'and nothing further up');
});

test('a scrolled view off screen holds nothing within reach, as the chat list behind an open conversation (issue 425)', async () => {
  reset();
  view.top = 2000;
  inView('hidden', scrolledView(5000, 5800));
  await settle();
  assert.deepEqual(asked(), [], 'nothing in a view that is off screen is fetched');
});
