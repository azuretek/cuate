// Pure: the phone drawer's drag rules. The drawer is the chat list, a panel that slides in over the conversation
// from the left. These functions decide whether a drag belongs to the drawer and where it sits while it moves; the
// component measures the panel in pixels and turns the progress into its transform. Nothing here reads the DOM, a
// clock or the network, so the whole gesture is asserted in a unit test.

// An edge drag is one whose pointerdown lands within this many pixels of the left edge. A finger's width in, the
// conversation keeps its scroll and its text selection: only the edge opens the list.
export const EDGE = 24;

// A drag is not the drawer until it has moved this far. Below it the gesture is a tap, which must keep working.
export const SLOP = 6;

// The drawer settles open once the finger has carried it more than this share of its own width, and settles back
// closed short of it. A fraction rather than a pixel count, because the panel is min(86vw, 320px) wide.
export const SETTLE = 0.5;

// Whether a pointerdown at x may open the list. Only the left edge does; the middle of the conversation does not.
export function isEdgeStart(x, edge = EDGE) {
  return x <= edge;
}

// Whether a drag is clearly horizontal. A mostly vertical move is the conversation's scroll, and a diagonal one is
// left alone: the drawer takes only what runs across the screen.
export function isHorizontal(dx, dy) {
  return Math.abs(dx) > Math.abs(dy);
}

// Where the panel sits for a finger at x, from 0 (the conversation) to 1 (the list fully across). A drag that opens
// starts at 0 and grows with the finger; one that closes starts at 1 and shrinks. The result never leaves 0..1, so a
// finger that runs past the far edge cannot pull the panel off it.
export function progressFor({ open, startX, x, width }) {
  const span = width > 0 ? width : 1;
  const raw = (open ? 1 : 0) + (x - startX) / span;
  return Math.min(1, Math.max(0, raw));
}

// Where the panel settles when the finger lifts: past the threshold it completes the move, short of it it returns to
// where it started.
export function settlesOpen(progress) {
  return progress >= SETTLE;
}
