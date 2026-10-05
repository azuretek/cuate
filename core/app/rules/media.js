// Pure: the conversation's media, and moving through it in the viewer (issue 181).
//
// The media viewer shows one item at a time and moves between the conversation's own media in conversation order. A
// media item is a picture or a video that is really there: an attachment that is not local (still being sent), not
// missing from the Mac and not a sticker (a sticker is drawn as itself, never opened). A document is saved, never
// shown (issue 219), so it is not one of these.

// Whether an attachment is media the viewer shows: a picture or a video, real and not a sticker.
export function isMediaAttachment(a) {
  return Boolean(a) && !a.local && !a.missing && !a.sticker && /^(?:image|video)\//i.test(String(a.mime || ''));
}

// What kind of media an attachment is, 'video' or 'image', or null when it is not media.
export function mediaKind(a) {
  if (!isMediaAttachment(a)) return null;
  return /^video\//i.test(String(a.mime || '')) ? 'video' : 'image';
}

// Every media item in a conversation, in conversation order: the order of the messages, and each message's own
// attachments in the order it carries them. Each item names the attachment (its id, which is what the viewer loads and
// what a preview hands over when it opens the viewer), the message it sits in and its kind, so the viewer steps
// through media without knowing how a conversation is stored.
export function mediaItems(messages) {
  const items = [];
  for (const m of messages || []) {
    if (!m) continue;
    for (const a of m.attachments || []) {
      const kind = mediaKind(a);
      if (!kind) continue;
      items.push({ id: String(a.id), messageId: String(m.id), attachmentId: String(a.id), kind, name: String(a.name || ''), mime: String(a.mime || '') });
    }
  }
  return items;
}

// Where an item sits in the list by its id, or -1 when it is not there.
export function mediaIndex(items, id) {
  const list = items || [];
  const key = String(id);
  for (let i = 0; i < list.length; i += 1) if (String(list[i].id) === key) return i;
  return -1;
}

// The item one step from `id` in `dir` ('prev' or 'next'), staying at the ends rather than wrapping: the first item
// has no previous and the last has no next, and an id that is not in the list has neither. Returns the item or null.
export function mediaStep(items, id, dir) {
  const list = items || [];
  const at = mediaIndex(list, id);
  if (at < 0) return null;
  const to = dir === 'prev' ? at - 1 : dir === 'next' ? at + 1 : at;
  if (to < 0 || to >= list.length) return null;
  return list[to];
}

// What the viewer's controls need for the item it is on: its position, how many items there are, and whether there is
// one each way (an item with none disables that control).
export function mediaNeighbours(items, id) {
  const list = items || [];
  const at = mediaIndex(list, id);
  const last = list.length - 1;
  return {
    index: at,
    count: list.length,
    canPrev: at > 0,
    canNext: at >= 0 && at < last,
    prev: at > 0 ? list[at - 1] : null,
    next: at >= 0 && at < last ? list[at + 1] : null,
  };
}

// How far, in CSS pixels, a finger must travel sideways before the swipe counts as moving between items rather than a
// tap or a small wobble.
export const SWIPE_MIN_PX = 56;

// A finger's swipe, as the step it asks for: a mostly-horizontal move past the threshold. Swiping right (the finger
// moves right, the item moves away to the right) goes to the previous item, swiping left to the next, as a photo
// viewer pages. A move shorter than the threshold, or one that is more vertical than horizontal (a scroll), steps
// nowhere and returns null.
export function swipeStep(dx, dy, { min = SWIPE_MIN_PX } = {}) {
  const x = Number(dx) || 0;
  const y = Number(dy) || 0;
  if (Math.abs(x) < min) return null;
  if (Math.abs(x) <= Math.abs(y)) return null;
  return x > 0 ? 'prev' : 'next';
}
