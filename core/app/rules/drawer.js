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

// A flick is the finger's own movement, not where it happened to stop. The panel is flung open (or back) when the
// finger is moving faster than this many panel-widths a second AND has carried the panel at least FLING_TRAVEL of its
// width, so a quick tap that barely moves the panel still settles by where it ended rather than being read as a flick.
export const FLING = 1.5;
// The share of the panel a drag must cross before a flick may decide it.
export const FLING_TRAVEL = 1 / 3;

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

// How fast the finger is moving across the panel, in pixels a second, from its last two samples ({ x, time }) where
// time is the pointer event's own timestamp. Fewer than two samples, or an interval of no length, is no measurable
// movement: zero. Nothing here reads a clock, so the whole rule is asserted from one array.
export function velocityFor(samples) {
  if (!Array.isArray(samples) || samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  const prev = samples[samples.length - 2];
  const dt = (Number(last.time) - Number(prev.time)) / 1000;
  const dx = Number(last.x) - Number(prev.x);
  if (!(dt > 0) || !Number.isFinite(dx) || !Number.isFinite(dt)) return 0;
  return dx / dt;
}

// Whether the finger's lift settles the panel open. A fast flick decides in the direction it moved, once the drag has
// crossed FLING_TRAVEL of the panel; short of that, and for any drag too slow to be a flick, it is by where the finger
// ended, past SETTLE. velocity is in pixels a second across a panel `width` wide.
export function settlesOpenAt({ progress, travel = 0, velocity = 0, width = 0 }) {
  const perSecond = width > 0 ? velocity / width : 0;
  if (travel >= FLING_TRAVEL && Math.abs(perSecond) >= FLING) return perSecond > 0;
  return settlesOpen(progress);
}
