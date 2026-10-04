// Pure: where each conversation was left, so switching back returns to it (issue 200). A conversation that was at
// its newest message remembers the end, so a message that arrived while you were away is still the one you land on;
// one scrolled up remembers the message at the top of the view and how far above the view's top edge it sat, so the
// same message comes back to the same place. A conversation never opened, or one whose stored place has gone, opens
// at its newest message: a following conversation starts at its end.
//
// The store is keyed by the chat's id, stringified, so a numeric id from one source and a string from another name
// the same conversation. It holds one anchor per chat, shaped as core/kit/rules/scroll.js gives them.

export function rememberPlace(places, id, anchor) {
  const key = id == null ? null : String(id);
  const next = new Map(places || []);
  if (key != null && anchor) next.set(key, anchor);
  return next;
}

export function placeFor(places, id, { follow = false } = {}) {
  const key = id == null ? null : String(id);
  const saved = key != null && places ? places.get(key) : null;
  if (saved) return saved;
  return follow ? { end: true } : { top: 0 };
}
