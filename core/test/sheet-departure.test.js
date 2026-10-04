// The Settings sheet leaves on its own animationend, and also at a deadline, whichever comes first. A window that stops
// drawing frames (a macOS test window hidden to the tray and raised again) never delivers the animationend, and a
// departure that waits only for that event leaves the sheet up for good. The real component class is driven here, with
// the clock mocked, so no browser is needed.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const defined = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { defined[name] = cls; }, get() { return undefined; } };
globalThis.document = { createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
await import('../app/components/app-root.js');
const AppRoot = defined['app-root'];

const tokens = JSON.parse(readFileSync(new URL('../spec/tokens.json', import.meta.url), 'utf8'));
const sheetOut = Number.parseFloat(tokens.motion['sheet-out']);

// A host carrying the state the departure reads, with the token the stylesheet resolves.
function host() {
  const h = new AppRoot();
  Object.assign(h, { view: 'settings', sheetLeaving: false, pendingSheet: null, aboutFrom: 'settings' });
  globalThis.getComputedStyle = () => ({ getPropertyValue: (name) => (name === '--motion-sheet-out' ? tokens.motion['sheet-out'] : '') });
  return h;
}
const ended = (h) => { const sheet = {}; h.onSheetAnimationEnd({ target: sheet, currentTarget: sheet }); };

test('a leaving sheet finishes without its animationend once the token duration and a margin have passed', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = host();
  h.leaveSheet();
  assert.equal(h.sheetLeaving, true);
  t.mock.timers.tick(sheetOut);
  assert.equal(h.view, 'settings', 'the departure is not cut short before its own duration');
  assert.equal(h.sheetLeaving, true);
  t.mock.timers.tick(1000);
  assert.equal(h.sheetLeaving, false, 'no frame ever came, and the sheet still left');
  assert.equal(h.view, 'messages');
  assert.equal(h.aboutFrom, null);
});

test('the animationend finishes the departure first, and the deadline that follows changes nothing', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = host();
  h.leaveSheet();
  t.mock.timers.tick(sheetOut);
  ended(h);
  assert.equal(h.view, 'messages');
  // The reader opens Settings again before the old deadline would have fired: it must not close the new sheet.
  h.view = 'settings';
  t.mock.timers.tick(1000);
  assert.equal(h.view, 'settings', 'a finished departure leaves no timer behind to close the next sheet');
  assert.equal(h.sheetLeaving, false);
});

test('a second leave while one is under way arms no second deadline', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = host();
  h.pendingSheet = 'settings';
  h.leaveSheet();
  t.mock.timers.tick(sheetOut / 2);
  h.leaveSheet();
  t.mock.timers.tick(sheetOut / 2 + 1000);
  assert.equal(h.view, 'settings', 'the pending page arrives once');
  assert.equal(h.pendingSheet, null);
  h.view = 'messages';
  t.mock.timers.tick(5000);
  assert.equal(h.view, 'messages');
});

test('an animationend from inside the sheet is not the sheet leaving', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = host();
  h.leaveSheet();
  h.onSheetAnimationEnd({ target: {}, currentTarget: {} });
  assert.equal(h.sheetLeaving, true);
  mock.timers.reset();
});
