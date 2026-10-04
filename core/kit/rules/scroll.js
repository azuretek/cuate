// Pure: where a scrolled view is, said in a way that survives a re-render and a resize, and where to put it back
// (issue 142). core/kit/scroll.js measures the view and applies the answer; this decides, so it is tested directly.
//
// A place is one of three things:
// - the end, for a view that follows its newest item (a conversation at its latest message) and is near its bottom;
// - an item and how far its top sits from the view's top, so the same message or row stays where it was however the
//   items above it or the view's own size change;
// - a plain offset, when the view holds no item to hold on to.
export const END_SLACK = 80;

// rects: the items in order, each { key, top, bottom } relative to the view's top edge.
export function anchorFrom({ scrollTop = 0, scrollHeight = 0, clientHeight = 0, items = [], follow = false, slack = END_SLACK } = {}) {
  if (follow && scrollHeight - scrollTop - clientHeight < slack) return { end: true };
  const first = items.find((it) => it.bottom > 0 && it.key != null);
  if (first) return { key: String(first.key), offset: first.top };
  return { top: scrollTop };
}

// The scrollTop that puts the view back at anchor. An item that has gone keeps the offset the view last had.
export function scrollFor(anchor, { scrollTop = 0, scrollHeight = 0, clientHeight = 0, items = [] } = {}) {
  const max = Math.max(0, scrollHeight - clientHeight);
  const clamp = (v) => Math.min(max, Math.max(0, v));
  if (!anchor) return clamp(scrollTop);
  if (anchor.end) return max;
  if (anchor.key != null) {
    const it = items.find((x) => String(x.key) === anchor.key);
    if (it) return clamp(scrollTop + (it.top - anchor.offset));
    return clamp(scrollTop);
  }
  return clamp(Number.isFinite(anchor.top) ? anchor.top : scrollTop);
}

// How far a view must scroll so a focused field inside it is in sight, given both boxes as measured on the screen
// ({ top, bottom }): 0 when it already is. A field taller than the view keeps its top in sight. An on-screen keyboard
// that shrinks the view is the case this serves (issue 180): the field being typed in is the person's place.
export function revealDelta(view, field) {
  let delta = 0;
  if (field.bottom > view.bottom) delta = field.bottom - view.bottom;
  if (field.top - delta < view.top) delta = field.top - view.top;
  // A scroll position lands on whole pixels, so a field a fraction of a pixel past the edge stays past it unless the
  // move is rounded away from zero: a full-screen page with no margin below it left a field 0.56px under the keyboard.
  if (Math.abs(delta) < 0.5) return 0;
  return delta > 0 ? Math.ceil(delta) : Math.floor(delta);
}
