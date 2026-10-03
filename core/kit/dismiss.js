// The one outside-dismiss behaviour every popover, menu and modal panel in the app goes through (issue 170).
//
// A component registers each panel it can open, by name, with the state that says whether it is open and the step
// that closes it:
//
//   this.attach = dismissable(this, { name: 'attach', open: () => this.attachOpen, close: () => { this.attachOpen = false; } });
//
// and marks the panel's root in its template with data-dismiss="attach", and the control that opens it with
// data-dismiss-keep="attach", so a press on the trigger is left to the trigger's own toggle. Then, on every surface
// and every pointer (mouse, finger, pen):
// - a press that starts and ends outside the open panel closes it, and the press is CONSUMED: the click, the context
//   menu, a long press or a drag it would have started on the control underneath does not happen;
// - Escape closes the topmost open panel, before a focused field's own Escape handling sees the key;
// - panels stack: the one opened last is on top, a press closes from the top down, and a press inside an upper panel
//   never closes the one beneath it.
// The decisions are pure and live in rules/dismiss.js; this only reads the events and the DOM.
import { pressOutside, closedByPress, closedByEscape, stackOf, swallows } from './rules/dismiss.js';

const entries = new Set();
let order = 0;
let installedOn = null;
// The press under way that began outside one or more open panels, and the release that closed them, whose own click
// is still to come.
let gesture = null;
let armed = null;

const defaults = { doc: () => (typeof document === 'undefined' ? null : document) };
let env = { ...defaults };

// The page's own document by default; a test hands in its own.
export function configureDismiss(next) {
  if (installedOn) uninstall(installedOn);
  entries.clear();
  gesture = null;
  armed = null;
  env = next ? { ...defaults, ...next } : { ...defaults };
}

function isOpen(entry) {
  try { return Boolean(entry.open()); } catch { return false; }
}

// The open panels, topmost first. A panel seen open for the first time takes the next place on top.
function openStack() {
  const open = [];
  for (const entry of entries) {
    if (!isOpen(entry)) { entry.openedAt = 0; continue; }
    if (!entry.openedAt) entry.openedAt = ++order;
    open.push(entry);
  }
  return stackOf(open);
}

// Inside a panel is inside its marked root, or on its marked trigger, within the component that registered it.
function inside(entry, node) {
  const el = node && typeof node.closest === 'function' ? node : node && node.parentElement;
  if (!el) return false;
  const sel = '[data-dismiss~="' + entry.name + '"], [data-dismiss-keep~="' + entry.name + '"]';
  const hit = el.closest(sel);
  return Boolean(hit) && (entry.host === hit || (typeof entry.host.contains === 'function' && entry.host.contains(hit)));
}

function consume(e) {
  e.stopPropagation();
  if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
}

function onDown(e) {
  armed = null;
  gesture = null;
  const stack = openStack();
  if (!stack.length) return;
  const closing = closedByPress(stack, (entry) => inside(entry, e.target));
  if (!closing.length) return;
  gesture = { pointerId: e.pointerId, closing };
  consume(e);
}

// Where the press ends is read from the point, not the event's target: a finger's pointer is captured by the element
// it went down on, so its pointerup names that element wherever the finger was lifted.
function endTarget(e) {
  const doc = env.doc();
  const at = doc && typeof doc.elementFromPoint === 'function' && Number.isFinite(e.clientX) ? doc.elementFromPoint(e.clientX, e.clientY) : null;
  return at || e.target;
}

function onUp(e) {
  const g = gesture;
  if (!g || e.pointerId !== g.pointerId) return;
  gesture = null;
  consume(e);
  const end = endTarget(e);
  const closing = [];
  for (const entry of g.closing) {
    if (!pressOutside(true, !inside(entry, end))) break;
    closing.push(entry);
  }
  if (!closing.length) return;
  armed = { at: e.timeStamp };
  for (const entry of closing) entry.close();
}

function onCancel(e) {
  if (gesture && e.pointerId === gesture.pointerId) gesture = null;
}

// The press's own click, context menu or middle click never reaches what is underneath. A context menu can arrive
// while the press is still down (macOS and Linux open it on the press), so a press under way consumes it too.
function onClick(e) {
  if (gesture && e.type === 'contextmenu') { e.preventDefault(); consume(e); return; }
  if (!swallows(armed, e)) return;
  armed = null;
  e.preventDefault();
  consume(e);
}

function onKey(e) {
  armed = null;
  if (e.key !== 'Escape' || e.isComposing) return;
  const top = closedByEscape(openStack());
  if (!top) return;
  e.preventDefault();
  consume(e);
  top.close();
}

const LISTENERS = [['pointerdown', onDown], ['pointerup', onUp], ['pointercancel', onCancel], ['click', onClick], ['auxclick', onClick], ['contextmenu', onClick], ['keydown', onKey]];

function install() {
  const doc = env.doc();
  if (!doc || installedOn === doc) return;
  if (installedOn) uninstall(installedOn);
  for (const [type, fn] of LISTENERS) doc.addEventListener(type, fn, true);
  installedOn = doc;
}

function uninstall(doc) {
  for (const [type, fn] of LISTENERS) doc.removeEventListener(type, fn, true);
  installedOn = null;
}

// Registers one panel of a component. `outside: false` is a panel that covers the whole surface and owns every press
// on it (the image viewer): Escape still closes it, in its place in the stack, and a press never does.
export function dismissable(host, { name, open, close, outside = true }) {
  if (!name || /[\s"\\]/.test(name)) throw new Error('dismissable: a panel needs a plain name');
  const entry = { host, name, open, close, outside, openedAt: 0 };
  const controller = {
    hostConnected() { entries.add(entry); install(); },
    hostDisconnected() { entries.delete(entry); entry.openedAt = 0; },
    // Read after every render, so the panel opened last is the one on top even when nothing has been pressed since.
    hostUpdated() { openStack(); },
  };
  if (typeof host.addController === 'function') host.addController(controller);
  else controller.hostConnected();
  return entry;
}
