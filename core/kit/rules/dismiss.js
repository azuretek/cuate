// Pure: the rules of the one outside-dismiss behaviour every popover, menu and modal panel uses (core/kit/dismiss.js).
//
// A press dismisses a panel only when it both STARTS and ENDS outside it. A press that starts inside and is released
// outside (a selection dragged past the edge, a finger that slides off the panel, the delete slider carried too far) is
// the panel's own gesture, so letting go outside must not throw the panel away.
export function pressOutside(startsOutside, endsOutside) {
  return startsOutside === true && endsOutside === true;
}

// The open panels a press closes, given the open panels topmost first and whether the press is inside each. It closes
// from the top down and stops at the first panel the press is inside, so a press inside a modal never closes the
// sheet under it. A panel that owns the whole surface (`outside: false`, the image viewer, whose backdrop is its own
// gesture) is never closed by a press and stops the walk too.
export function closedByPress(stack, isInside) {
  const out = [];
  for (const entry of stack || []) {
    if (entry.outside === false || isInside(entry)) break;
    out.push(entry);
  }
  return out;
}

// Escape closes the topmost open panel only, one layer per key.
export function closedByEscape(stack) {
  return stack && stack.length ? stack[0] : null;
}

// The open panels, topmost first: the one opened last is on top.
export function stackOf(entries) {
  return [...(entries || [])].sort((a, b) => b.openedAt - a.openedAt);
}

// The press that dismissed a panel is consumed: the click (or context menu) the same press would deliver to the
// control underneath is stopped. It is the press's own click only, so it must arrive within this many milliseconds of
// the release, from the user (a script's own click is never stopped), and before any new press or key.
export const SWALLOW_MS = 1000;

export function swallows(armed, event) {
  if (!armed || !event || event.isTrusted !== true) return false;
  const dt = event.timeStamp - armed.at;
  return Number.isFinite(dt) && Math.abs(dt) <= SWALLOW_MS;
}
