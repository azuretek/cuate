// Pure: when a press on a sheet's backdrop is a second way back, the same leaving the page's top strip asks for.
//
// It is a return only when the press both STARTS and ENDS on the backdrop itself. A press that starts inside the
// card and is released over the backdrop (a selection dragged past the edge, a finger that slides off the panel) is
// not a return: the reader began a gesture on the page, so letting go outside it must not throw that page away.
export function backdropReturns(startsOnBackdrop, endsOnBackdrop) {
  return startsOnBackdrop === true && endsOnBackdrop === true;
}

// How long a leaving sheet may wait for its own animationend before it finishes anyway: the departure's token
// duration plus a margin. The event is what normally ends it, because finishing then keeps a half-drawn page off the
// screen; but a window that stops drawing frames (hidden to the tray, occluded, a test window raised without focus)
// never runs the animation, so it never sends the event, and a departure that waits only for that would leave the
// sheet up for good. The margin covers the render that starts the animation after the leave is asked for.
export const SHEET_LEAVE_MARGIN_MS = 250;

export function sheetLeaveDeadline(tokenMs) {
  return (Number.isFinite(tokenMs) && tokenMs > 0 ? tokenMs : 0) + SHEET_LEAVE_MARGIN_MS;
}
