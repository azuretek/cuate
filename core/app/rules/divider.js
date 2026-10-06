// Pure: the divider between the chats list and the conversation on the desktop (issue 215). These rules own the width
// the divider may take: a minimum for each pane it moves, the default it resets to, and the step one key takes. The
// component measures the window in pixels, writes the chosen width onto the shell and holds the choice on the server so
// it survives a reopen. Nothing here reads the DOM, a clock or the network, so the whole rule is asserted in a unit
// test (core/test/divider.test.js); the desktop smoke holds the drag, the anchors and the reopen against the app.

// The narrowest the chats list may be dragged to. Below this the header (the search box and its mode, the filter, the
// sort and the gear) stops fitting on one line.
export const CHATS_MIN = 220;
// The width the divider resets to, and the width the list draws at before anyone drags it. It is the size-sidebar
// token's own value, so the default is one number: core/test/divider.test.js fails if the token and this drift apart.
export const CHATS_DEFAULT = 320;
// The narrowest the conversation may be left. No drag and no key can take the conversation below this, and the widest
// the chats list may be is the window less this.
export const CONVERSATION_MIN = 320;
// How far one Arrow key moves the divider.
export const KEY_STEP = 24;

// The bounds the chats list may take in a window of this width: its own minimum, and the most that still leaves the
// conversation its minimum. In a window too narrow to hold both the floor stays the chats minimum and the conversation
// keeps what is left, so the list is never dragged to nothing and a pane never goes negative.
export function dividerBounds(viewport, { chatsMin = CHATS_MIN, conversationMin = CONVERSATION_MIN } = {}) {
  const view = Number(viewport);
  const width = Number.isFinite(view) ? view : chatsMin + conversationMin;
  return { min: chatsMin, max: Math.max(chatsMin, Math.round(width) - conversationMin) };
}

// The width the chats list takes for a pointer at the seam: the one asked for, held between the two minimums. A width
// that is not a number (nothing stored yet, a value a theme could not make) falls to the chats minimum.
export function clampChatsWidth(width, viewport, options) {
  const { min, max } = dividerBounds(viewport, options);
  const n = Math.round(Number(width));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

// The width the chats list takes for a pointer that has moved to `x` mid-drag: the width the drag started at plus the
// pointer's OWN travel from where it went down, held between the two minimums. The base and the origin are passed in
// unchanged on every move, so each step is exactly the distance the pointer moved and nothing accumulates; the bounds
// clamp only what is drawn, so a drag past a minimum and back resumes one to one rather than being left short.
export function dragChatsWidth({ baseWidth, startX, x, viewport }, options) {
  const base = Number(baseWidth);
  const from = Number(startX);
  const to = Number(x);
  const travel = Number.isFinite(from) && Number.isFinite(to) ? to - from : 0;
  return clampChatsWidth((Number.isFinite(base) ? base : CHATS_DEFAULT) + travel, viewport, options);
}

// The width a stored setting means: null when there is no choice, so the token default stands, else the stored width
// clamped into the window the app is opening in.
export function chatsWidthFrom(stored, viewport, options) {
  if (stored === null || stored === undefined || stored === '') return null;
  const n = Number(stored);
  if (!Number.isFinite(n)) return null;
  return clampChatsWidth(n, viewport, options);
}

// One key's step from the width on screen.
export function resizeChatsWidth(width, delta, viewport, options) {
  const base = Number.isFinite(Number(width)) ? Number(width) : CHATS_DEFAULT;
  const step = Number.isFinite(Number(delta)) ? Number(delta) : 0;
  return clampChatsWidth(base + step, viewport, options);
}

// What a key does to the divider: the two arrows step it, Home and Enter reset it to the default, and any other key
// belongs to the page. reset is true for the keys that clear the choice rather than set a new one.
export function dividerKey(key, width, viewport, options) {
  if (key === 'ArrowLeft') return { width: resizeChatsWidth(width, -KEY_STEP, viewport, options), reset: false };
  if (key === 'ArrowRight') return { width: resizeChatsWidth(width, KEY_STEP, viewport, options), reset: false };
  if (key === 'Home' || key === 'Enter') return { width: clampChatsWidth(CHATS_DEFAULT, viewport, options), reset: true };
  return null;
}
