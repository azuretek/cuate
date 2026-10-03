// Pure: the Settings sheet's departure. Whether a press on its backdrop is a way back is the kit's one dismiss rule
// (core/kit/rules/dismiss.js), which every popover and modal panel uses.
//
// How long a leaving sheet may wait for its own animationend before it finishes anyway: the departure's token
// duration plus a margin. The event is what normally ends it, because finishing then keeps a half-drawn page off the
// screen; but a window that stops drawing frames (hidden to the tray, occluded, a test window raised without focus)
// never runs the animation, so it never sends the event, and a departure that waits only for that would leave the
// sheet up for good. The margin covers the render that starts the animation after the leave is asked for.
export const SHEET_LEAVE_MARGIN_MS = 250;

export function sheetLeaveDeadline(tokenMs) {
  return (Number.isFinite(tokenMs) && tokenMs > 0 ? tokenMs : 0) + SHEET_LEAVE_MARGIN_MS;
}
