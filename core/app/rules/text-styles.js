// Pure: the styles a sender laid over stretches of a message's words (issue 433). The Mac's message store records a
// text effect (Big, Small, Shake, Nod, Explode, Ripple, Bloom, Jitter) as a number on a stretch of the words; the
// server reads those stretches from the store and the model carries them as styles, each a start and a length in
// UTF-16 code units of the message's text, with the effect named. links.js cuts a bubble's words by link and by style.

// The store's numbers for each text effect, as it records them on a stretch of words.
export const TEXT_EFFECT_IDS = Object.freeze({ 4: 'ripple', 5: 'big', 6: 'bloom', 8: 'nod', 9: 'shake', 10: 'jitter', 11: 'small', 12: 'explode' });
export const TEXT_EFFECTS = Object.freeze(Object.values(TEXT_EFFECT_IDS));
// The effects that move each letter on its own rather than the stretch as one.
export const LETTER_EFFECTS = Object.freeze(['ripple', 'jitter', 'explode']);
// The formatting a sender can lay on a stretch (issue 447), by the key the server marks each run with and the model
// carries each style with. Any number of them can share a stretch, and they compose with an effect.
export const TEXT_FORMATS = Object.freeze(['bold', 'italic', 'underline', 'strikethrough']);

const INLINE_OBJECT = '\uFFFC';

/**
 * The styles a raw row's runs make, against the text the model carries. The row's text still holds the inline object
 * placeholders the model strips, so each offset is moved back by the placeholders before it, and a stretch that was
 * only placeholders is dropped. An effect the store names by a number we do not know is left out rather than guessed,
 * and a stretch left with neither an effect nor a format is dropped.
 * @param {string} rawText the words as the engine read them
 * @param {{ start: number, length: number, effect?: number, bold?: number, italic?: number, underline?: number, strikethrough?: number }[]} runs
 * @returns {{ start: number, length: number, effect?: string, bold?: true, italic?: true, underline?: true, strikethrough?: true }[]}
 */
export function stylesFromRuns(rawText, runs) {
  const text = String(rawText || '');
  if (!Array.isArray(runs) || !runs.length || !text) return [];
  // removedBefore[i] is how many placeholders sit before raw offset i.
  const removedBefore = new Array(text.length + 1);
  let removed = 0;
  for (let i = 0; i <= text.length; i += 1) {
    removedBefore[i] = removed;
    if (text[i] === INLINE_OBJECT) removed += 1;
  }
  const out = [];
  for (const r of runs) {
    const start = Math.trunc(Number(r && r.start));
    const length = Math.trunc(Number(r && r.length));
    if (!Number.isFinite(start) || !Number.isFinite(length) || start < 0 || length <= 0 || start + length > text.length) continue;
    const marks = {};
    const effect = TEXT_EFFECT_IDS[r.effect] || null;
    if (effect) marks.effect = effect;
    for (const f of TEXT_FORMATS) if (r[f]) marks[f] = true;
    if (!Object.keys(marks).length) continue;
    const from = start - removedBefore[start];
    const to = start + length - removedBefore[start + length];
    if (to <= from) continue;
    const prev = out[out.length - 1];
    if (prev && sameMarks(prev, marks) && prev.start + prev.length === from) prev.length += to - from;
    else out.push({ start: from, length: to - from, ...marks });
  }
  return out;
}

// Whether a style carries exactly these marks: the same effect (or none) and the same formats.
function sameMarks(style, marks) {
  return (style.effect || null) === (marks.effect || null) && TEXT_FORMATS.every((f) => Boolean(style[f]) === Boolean(marks[f]));
}

// A stretch's letters, one per user-perceived character, so a letter effect moves each as it reads rather than splitting
// an emoji or an accented letter in two.
export function letters(text) {
  const s = String(text || '');
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].map((g) => g.segment);
  return Array.from(s);
}
