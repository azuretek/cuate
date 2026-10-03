// Pure: what a press on a control may do, given what the control is already doing. core/kit/press.js drives it with
// the element, the timers and the stylesheet; this decides, so it is tested directly and answers the same everywhere.
//
// A control is idle, pending (a press started work that has not settled), or showing how that work ended (success or
// failure) for a moment before it goes back to idle. A press while pending is dropped, so a double press never starts
// the work twice. An instant action (a toggle, a menu item, a tab) has no pending state, so its repeats are coalesced
// instead: the second click of a double click, and a pointer press inside the coalesce window, are dropped rather
// than queued. A control that is a key, such as an emoji cell, opts out with repeat, because pressing it twice means
// two.
export const PRESS_STATES = ['idle', 'pending', 'success', 'failure'];

export function idleEntry() {
  return { state: 'idle', held: false };
}

// Whether a press is admitted. multi is a click whose detail says it is the second or later of a multi-click.
export function admitPress(entry, { repeat = false, multi = false } = {}) {
  const e = entry || idleEntry();
  if (e.state === 'pending') return false;
  if (repeat) return true;
  if (multi || e.held) return false;
  return true;
}

// Work is anything with a then: a promise, or a value a listener answered through respond().
export function isWork(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function') && typeof value.then === 'function';
}

// How work ended. A rejection, and a resolved false, are a failure: an owner that already reports its own error (the
// banner, a note on the page) answers false rather than throwing a second time.
export function outcomeOf({ rejected = false, value } = {}) {
  return rejected || value === false ? 'failure' : 'success';
}

// Whether a press should hold the control for the coalesce window: only a pointer's press (a click with a detail of
// one or more), never a script's click() or a key, so a keyboard user and a test are never slowed down.
export function holdsAfter({ repeat = false, detail = 0 } = {}) {
  return !repeat && Number(detail) >= 1;
}

// A duration token as milliseconds: "900ms", "0.9s" or a bare number. Anything unreadable is the fallback.
export function durationMs(value, fallback) {
  const s = String(value == null ? '' : value).trim();
  const m = /^(-?\d*\.?\d+)(ms|s)?$/.exec(s);
  if (!m) return fallback;
  const n = Number(m[1]) * (m[2] === 's' ? 1000 : 1);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
