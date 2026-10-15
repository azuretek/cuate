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


// Skin tones (issue 392). The catalogue carries every toned sequence as its own entry, so a panel drawn straight from
// it showed six hands where a person sees one. A toned sequence holds a Fitzpatrick modifier (U+1F3FB to U+1F3FF) and
// is named after the emoji it tones, the name before the colon ('waving hand: medium skin tone'), which is how the
// standard names every one of them; the sequence stripped of its modifiers is the fallback for a name that does not
// match. Grouping is worked out once, from the generated catalogue, so nothing here is a hand-kept list.
const TONE_MODIFIER = /[\u{1F3FB}-\u{1F3FF}]/u;

export function hasTone(char) {
  return TONE_MODIFIER.test(String(char ?? ''));
}

let toneIndex = null;
function tones() {
  if (toneIndex) return toneIndex;
  const byName = new Map();
  const byBare = new Map();
  for (const e of EMOJI) {
    if (hasTone(e.char)) continue;
    byName.set(e.name, e);
    byBare.set(e.char.replace(/\uFE0F/g, ''), e);
  }
  const baseOf = new Map();
  const variants = new Map();
  for (const e of EMOJI) {
    if (!hasTone(e.char)) continue;
    const colon = e.name.indexOf(':');
    const base = (colon > 0 && byName.get(e.name.slice(0, colon)))
      || byBare.get(e.char.replace(/\uFE0F|[\u{1F3FB}-\u{1F3FF}]/gu, ''));
    if (!base) continue;
    baseOf.set(e.char, base.char);
    if (!variants.has(base.char)) variants.set(base.char, [base]);
    variants.get(base.char).push(e);
  }
  toneIndex = { baseOf, variants };
  return toneIndex;
}

// The emoji a toned sequence tones (the standard yellow one), or the character itself when it has no tones.
export function toneBase(char) {
  return tones().baseOf.get(char) || char;
}

// Every choice of tone for an emoji, the standard yellow first and then the catalogue's own order; an emoji with no
// tones has none.
export function toneChoices(char) {
  return tones().variants.get(toneBase(char)) || [];
}

export function hasTones(char) {
  return toneChoices(char).length > 0;
}

// The remembered tone for each emoji: a map from the yellow emoji to the sequence last chosen for it. Choosing the
// yellow one again forgets the choice, so the map only ever holds a real choice, and anything that is not a tone of
// the emoji it is filed under is dropped. The map keeps the order the choices were made in, oldest first.
export function chooseTone(chosen, char) {
  const next = { ...(chosen && typeof chosen === 'object' ? chosen : {}) };
  const base = toneBase(char);
  if (!hasTones(base)) return next;
  // The newest choice goes last, so a store that has to trim drops the oldest first.
  delete next[base];
  if (char !== base) next[base] = char;
  return next;
}

export function cleanTones(chosen) {
  const out = {};
  if (!chosen || typeof chosen !== 'object' || Array.isArray(chosen)) return out;
  for (const [base, char] of Object.entries(chosen)) {
    if (typeof char === 'string' && char !== base && toneBase(char) === base) out[base] = char;
  }
  return out;
}

// The character a panel slot draws and inserts for an emoji: the tone chosen for it, or the yellow one.
export function tonedChar(chosen, char) {
  const base = toneBase(char);
  const pick = chosen && typeof chosen === 'object' ? chosen[base] : undefined;
  return typeof pick === 'string' && toneBase(pick) === base ? pick : base;
}

// A list for the panel: each emoji once, however many tones it has. A toned entry folds onto its yellow one, in the
// place the first of them held, so a search for 'medium skin tone' still finds the hand, once. Each slot carries the
// yellow emoji as base, the character to draw (the remembered tone), and whether a long press offers tones.
export function panelEmoji(list, { chosen = {}, drawable = () => true } = {}) {
  const out = [];
  const seen = new Set();
  const byChar = new Map(EMOJI.map((e) => [e.char, e]));
  for (const e of Array.isArray(list) ? list : []) {
    const base = toneBase(e.char);
    if (seen.has(base)) continue;
    seen.add(base);
    const entry = byChar.get(base) || e;
    const toned = hasTones(base);
    let char = toned ? tonedChar(chosen, base) : base;
    if (!drawable(char)) {
      if (!drawable(base)) continue;
      char = base;
    }
    out.push({ char, base, name: entry.name, toned });
  }
  return out;
}

// Emoji the device cannot draw (issue 392). Whether a glyph was drawn is MEASURED in the page (core/app/emoji-support.js
// draws it on a canvas), never read from a list of versions, since which emoji a device has depends on its fonts, not
// on its age. This is the decision over what was measured: nothing drawn, the box a font draws for a character it
// lacks, or a sequence the font could not join (drawn as its parts side by side, so wider than one emoji) is not
// drawable. A measurement that could not be taken says drawable, so a missing canvas never empties the panel.
export function glyphDrawn({ width, reference, blank = false, signature = null, missing = [] } = {}) {
  if (blank) return false;
  if (signature !== null && missing.includes(signature)) return false;
  const w = Number(width);
  const r = Number(reference);
  if (Number.isFinite(w) && Number.isFinite(r) && r > 0 && w > r * 1.5) return false;
  return true;
}

// A message's text split into what the device draws and the emoji it cannot: each catalogue emoji the device cannot
// draw becomes { emoji, name }, so the bubble shows its name rather than an empty box, and everything else stays text,
// joined back into the longest runs. Text with nothing that could be an emoji is returned whole without segmenting.
const MAYBE_EMOJI = /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|[\u{1F3FB}-\u{1F3FF}]|\u200D|\u20E3/u;
let names = null;
export function emojiFallbackParts(text, drawable = () => true) {
  const s = String(text ?? '');
  if (!s) return [];
  if (!MAYBE_EMOJI.test(s)) return [{ text: s }];
  if (!names) names = new Map(EMOJI.map((e) => [e.char, e.name]));
  const parts = [];
  let run = '';
  for (const g of graphemes(s)) {
    const name = names.get(g);
    if (name && !drawable(g)) {
      if (run) parts.push({ text: run });
      run = '';
      parts.push({ emoji: g, name });
    } else {
      run += g;
    }
  }
  if (run) parts.push({ text: run });
  return parts;
}
