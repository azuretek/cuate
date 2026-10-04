// Pure: the emoji picker's catalogue and search, and the composer's
// caret aware insertion. Nothing here touches the DOM, a clock or storage, so the
// same answers hold on every shell (core/app/engine.js bundles it for the phones).
//
// The catalogue is GENERATED, never typed out. core/app/rules/emoji-data.js is derived from the pinned
// Unicode emoji data and CLDR annotations in core/spec/emoji/ by scripts/gen-emoji.mjs, in the group order
// the standard defines, covering every fully-qualified sequence including the skin-tone and ZWJ ones. To
// change it, change the generator or bump its pinned version; a hand edit fails pnpm run build.
//
// A character is one entry even when it is several code points (a flag, a skin tone, a zero width joiner
// sequence), so the picker inserts and the composer deletes it as one.

import { EMOJI } from './emoji-data.js';

const clampInt = (n, lo, hi) => {
  const i = Number.isFinite(n) ? Math.trunc(n) : lo;
  return Math.min(Math.max(i, lo), hi);
};

// Grapheme boundaries split text the way a person sees characters, so a skin
// tone, a flag or a joined sequence is one unit. Intl.Segmenter is everywhere the
// app runs (Node, every shell); the code point fallback keeps a bare engine honest.
const segmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;

export function graphemes(text) {
  const s = String(text ?? '');
  if (!s) return [];
  if (segmenter) return [...segmenter.segment(s)].map((part) => part.segment);
  return [...s];
}

export function countGraphemes(text) {
  return graphemes(text).length;
}

function boundaries(text) {
  const stops = [0];
  let at = 0;
  for (const g of graphemes(text)) {
    at += g.length;
    stops.push(at);
  }
  return stops;
}

// Insert at the caret, replacing any selection, and hand back where the caret
// lands: one character in, whatever the character is worth in code points.
export function insertEmoji(text, start, end, emoji) {
  const value = String(text ?? '');
  const glyph = String(emoji ?? '');
  const from = clampInt(start, 0, value.length);
  const to = clampInt(end, from, value.length);
  return { text: value.slice(0, from) + glyph + value.slice(to), caret: from + glyph.length };
}

// Remove one whole character before the caret (dir -1, a backspace) or after it
// (dir +1, a delete). A live selection is removed exactly as selected.
export function deleteGrapheme(text, start, end, dir) {
  const value = String(text ?? '');
  const from = clampInt(start, 0, value.length);
  const to = clampInt(end, from, value.length);
  if (to > from) return { text: value.slice(0, from) + value.slice(to), caret: from };
  const stops = boundaries(value);
  if (dir < 0) {
    const i = stops.indexOf(from);
    if (i <= 0) return { text: value, caret: from };
    return { text: value.slice(0, stops[i - 1]) + value.slice(from), caret: stops[i - 1] };
  }
  const i = stops.indexOf(to);
  if (i < 0 || i >= stops.length - 1) return { text: value, caret: to };
  return { text: value.slice(0, to) + value.slice(stops[i + 1]), caret: to };
}

// Search by name or keyword; a blank query returns the whole catalogue in its
// declared order, and limit caps the list the picker draws.
export function searchEmoji(query, { limit = 0 } = {}) {
  const q = String(query ?? '').trim().toLowerCase();
  const all = q
    ? EMOJI.filter((e) => (e.name + ' ' + (e.keywords || '')).toLowerCase().includes(q))
    : EMOJI;
  return limit > 0 ? all.slice(0, limit) : all;
}

export function emojiInCategory(id) {
  return EMOJI.filter((e) => e.category === id);
}

// The frequently used row: the characters used most, ties going to the one used
// most recently, capped so the row stays one line.
export function frequentEmoji(uses, { limit = 8 } = {}) {
  const counts = new Map();
  const seen = new Map();
  const list = Array.isArray(uses) ? uses : [];
  list.forEach((char, i) => {
    if (typeof char !== 'string' || !char || !isEmoji(char)) return;
    counts.set(char, (counts.get(char) || 0) + 1);
    seen.set(char, i);
  });
  return [...counts.keys()]
    .sort((a, b) => counts.get(b) - counts.get(a) || seen.get(b) - seen.get(a))
    .slice(0, limit);
}

// Which side of the emoji button the picker opened on, read from where each one was drawn: 'below' when the
// panel's middle sits lower than the button's, 'above' otherwise. The panel opens upward from the composer today;
// a rect that cannot be read keeps that answer rather than guessing.
export function pickerSide(panel, anchor) {
  const middle = (r) => (Number(r?.top) + Number(r?.bottom)) / 2;
  const p = middle(panel);
  const a = middle(anchor);
  if (!Number.isFinite(p) || !Number.isFinite(a)) return 'above';
  return p > a ? 'below' : 'above';
}

// The picker's sections in the order they draw, top to bottom, which is also the order the keyboard walks. The
// grid, the search field and the categories keep their order whichever way the panel opens. The recently used row
// sits on the edge facing the emoji button, so the characters reached for most are the shortest move away: last
// (the bottom edge) when the panel opens above the button, first (the top edge) when it opens below. With nothing
// used yet the row, and the divider that goes with it, is not drawn.
export function emojiPickerSections({ side = 'above', recents = false } = {}) {
  const body = ['grid', 'search', 'tabs'];
  if (!recents) return body;
  return side === 'below' ? ['recents', ...body] : [...body, 'recents'];
}

// A character is only offered to the composer if the catalogue knows it, so the
// picker cannot push an arbitrary string into a message.
export function isEmoji(char) {
  return EMOJI.some((e) => e.char === char);
}

