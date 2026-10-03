// The one press behaviour every button in the app goes through (issue 140). A press that starts work marks its control
// pending until the work settles, so a double press never starts it twice; the control says so (aria-busy, and
// data-press, which the stylesheet draws as a spinner in place of the label), then shows success or failure for a
// moment, then goes back to idle. A press on an instant action is coalesced instead (rules/press.js says when).
//
// The state lives on the element itself, in data-press and the aria attributes, which no template binds, so a
// re-render never clears a state the kit set, and two handlers bound to one control (a form's submit and the Enter key)
// share one state. The timings are the motion tokens --motion-press-hold and --motion-press-coalesce, read from the
// control's own computed style, so a theme can change them and reduced motion is the stylesheet's business.
//
// Work reaches a control in two ways:
// - the handler returns it: press(() => this.save());
// - the handler raises an event another component answers: press(() => emit(this, 'save', detail)), with the
//   listener answering respond(e, this.save(e.detail)). Unanswered, the press is an instant action.
import { idleEntry, admitPress, isWork, outcomeOf, holdsAfter, durationMs } from './rules/press.js';

const HOLD_MS = 900;
const COALESCE_MS = 250;
const WORK = Symbol('press.work');
const entries = new WeakMap();

const defaults = {
  timers: globalThis,
  style: (el, name) => (typeof getComputedStyle === 'function' ? getComputedStyle(el).getPropertyValue(name) : ''),
};
let env = { ...defaults };

// The page's own timers and stylesheet by default; a test hands in its own.
export function configurePress(next) {
  env = next ? { ...defaults, ...next } : { ...defaults };
}

export function pressState(el) {
  return (el && entries.get(el)?.state) || 'idle';
}

function entryOf(el) {
  let e = entries.get(el);
  if (!e) { e = { ...idleEntry(), timer: null }; entries.set(el, e); }
  return e;
}

function clearTimer(e) {
  if (e.timer) env.timers.clearTimeout(e.timer);
  e.timer = null;
}

function draw(el, state) {
  if (state === 'idle') delete el.dataset.press;
  else el.dataset.press = state;
  if (state === 'pending') {
    el.setAttribute('aria-busy', 'true');
    el.setAttribute('aria-disabled', 'true');
  } else {
    el.removeAttribute('aria-busy');
    el.removeAttribute('aria-disabled');
  }
}

function begin(el, e) {
  clearTimer(e);
  e.held = false;
  e.state = 'pending';
  draw(el, 'pending');
}

function settle(el, e, outcome) {
  clearTimer(e);
  e.state = outcome;
  draw(el, outcome);
  e.timer = env.timers.setTimeout(() => {
    e.timer = null;
    if (e.state !== outcome) return;
    e.state = 'idle';
    draw(el, 'idle');
  }, durationMs(env.style(el, '--motion-press-hold'), HOLD_MS));
}

function hold(el, e) {
  clearTimer(e);
  e.held = true;
  e.timer = env.timers.setTimeout(() => { e.timer = null; e.held = false; }, durationMs(env.style(el, '--motion-press-coalesce'), COALESCE_MS));
}

// Runs one press of el. Returns what the action returned, or, for work, a promise of it that never rejects (the work's
// owner reports its own error; the control shows that it failed). A dropped press returns undefined.
export function runPress(el, action, { repeat = false, event = null } = {}) {
  if (!el || !el.dataset) return action(event);
  const e = entryOf(el);
  const detail = event && typeof event.detail === 'number' ? event.detail : 0;
  if (!admitPress(e, { repeat, multi: detail > 1 })) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    return undefined;
  }
  let result;
  try {
    result = action(event);
  } catch (error) {
    settle(el, e, 'failure');
    throw error;
  }
  if (!isWork(result)) {
    if (holdsAfter({ repeat, detail })) hold(el, e);
    return result;
  }
  begin(el, e);
  return Promise.resolve(result).then(
    (value) => { settle(el, e, outcomeOf({ value })); return value; },
    () => { settle(el, e, outcomeOf({ rejected: true })); return false; },
  );
}

// The handler a template binds: @click=${press(() => this.save())}. on picks the control that shows the state when it
// is not the element the listener is on (a form's submit shows it on its send button).
export function press(action, { repeat = false, on = null } = {}) {
  return (event) => runPress(on ? on(event) : event && event.currentTarget, () => action(event), { repeat, event });
}

// Raises an event whose listener may answer with the work it started, and returns that work.
export function emit(host, name, detail, init = {}) {
  const event = new CustomEvent(name, { detail, ...init });
  host.dispatchEvent(event);
  return event[WORK];
}

// The listener's answer to emit(): the work this event started, so the control that raised it can show it.
export function respond(event, work) {
  if (event && typeof event === 'object') event[WORK] = work;
  return work;
}
