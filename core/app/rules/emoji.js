// Pure: the emoji picker's catalogue and search, and the composer's
// caret aware insertion. Nothing here touches the DOM, a clock or storage, so the
// same answers hold on every shell (core/app/engine.js bundles it for the phones).
//
// The catalogue is curated, not the whole Unicode table: each entry names its
// category and carries the words a person would search for. A character is one
// entry even when it is several code points (a flag, a skin tone, a zero width
// joiner sequence), so the picker inserts and the composer deletes it as one.

export const EMOJI_CATEGORIES = [
  { id: 'smileys', label: 'Smileys' },
  { id: 'people', label: 'People' },
  { id: 'animals', label: 'Animals' },
  { id: 'food', label: 'Food' },
  { id: 'activities', label: 'Activities' },
  { id: 'travel', label: 'Travel' },
  { id: 'objects', label: 'Objects' },
  { id: 'symbols', label: 'Symbols' },
  { id: 'flags', label: 'Flags' },
];

export const EMOJI = [
  { char: '\u{1F600}', name: 'grinning face', keywords: 'smile happy', category: 'smileys' },
  { char: '\u{1F603}', name: 'grinning face with big eyes', keywords: 'smile happy', category: 'smileys' },
  { char: '\u{1F604}', name: 'grinning face with smiling eyes', keywords: 'smile happy', category: 'smileys' },
  { char: '\u{1F601}', name: 'beaming face with smiling eyes', keywords: 'grin', category: 'smileys' },
  { char: '\u{1F606}', name: 'grinning squinting face', keywords: 'laugh', category: 'smileys' },
  { char: '\u{1F605}', name: 'grinning face with sweat', keywords: 'laugh nervous', category: 'smileys' },
  { char: '\u{1F602}', name: 'face with tears of joy', keywords: 'laugh cry', category: 'smileys' },
  { char: '\u{1F642}', name: 'slightly smiling face', keywords: 'smile', category: 'smileys' },
  { char: '\u{1F643}', name: 'upside down face', keywords: 'silly', category: 'smileys' },
  { char: '\u{1F609}', name: 'winking face', keywords: 'wink', category: 'smileys' },
  { char: '\u{1F60A}', name: 'smiling face with smiling eyes', keywords: 'blush', category: 'smileys' },
  { char: '\u{1F970}', name: 'smiling face with hearts', keywords: 'love adore', category: 'smileys' },
  { char: '\u{1F60D}', name: 'smiling face with heart eyes', keywords: 'love', category: 'smileys' },
  { char: '\u{1F929}', name: 'star struck', keywords: 'excited', category: 'smileys' },
  { char: '\u{1F618}', name: 'face blowing a kiss', keywords: 'kiss love', category: 'smileys' },
  { char: '\u{1F617}', name: 'kissing face', keywords: 'kiss', category: 'smileys' },
  { char: '\u{1F61C}', name: 'winking face with tongue', keywords: 'tongue silly', category: 'smileys' },
  { char: '\u{1F914}', name: 'thinking face', keywords: 'think hmm', category: 'smileys' },
  { char: '\u{1F928}', name: 'face with raised eyebrow', keywords: 'skeptical', category: 'smileys' },
  { char: '\u{1F610}', name: 'neutral face', keywords: 'meh', category: 'smileys' },
  { char: '\u{1F611}', name: 'expressionless face', keywords: 'blank', category: 'smileys' },
  { char: '\u{1F644}', name: 'face with rolling eyes', keywords: 'eyeroll', category: 'smileys' },
  { char: '\u{1F62C}', name: 'grimacing face', keywords: 'awkward', category: 'smileys' },
  { char: '\u{1F62E}', name: 'face with open mouth', keywords: 'surprise', category: 'smileys' },
  { char: '\u{1F631}', name: 'face screaming in fear', keywords: 'shock', category: 'smileys' },
  { char: '\u{1F621}', name: 'pouting face', keywords: 'angry mad', category: 'smileys' },
  { char: '\u{1F622}', name: 'crying face', keywords: 'sad cry', category: 'smileys' },
  { char: '\u{1F62D}', name: 'loudly crying face', keywords: 'sad sob', category: 'smileys' },
  { char: '\u{1F634}', name: 'sleeping face', keywords: 'sleep tired', category: 'smileys' },
  { char: '\u{1F637}', name: 'face with medical mask', keywords: 'sick', category: 'smileys' },
  { char: '\u{1F92F}', name: 'exploding head', keywords: 'mind blown', category: 'smileys' },
  { char: '\u{1F971}', name: 'yawning face', keywords: 'bored tired', category: 'smileys' },
  { char: '\u{1F973}', name: 'partying face', keywords: 'party celebrate', category: 'smileys' },
  { char: '\u{1F60E}', name: 'smiling face with sunglasses', keywords: 'cool', category: 'smileys' },
  { char: '\u{1F607}', name: 'smiling face with halo', keywords: 'innocent angel', category: 'smileys' },
  { char: '\u{1F921}', name: 'clown face', keywords: 'clown', category: 'smileys' },
  { char: '\u{1F480}', name: 'skull', keywords: 'dead', category: 'smileys' },
  { char: '\u{1F47B}', name: 'ghost', keywords: 'halloween', category: 'smileys' },
  { char: '\u{1F47D}', name: 'alien', keywords: 'space', category: 'smileys' },
  { char: '\u{1F916}', name: 'robot', keywords: 'bot', category: 'smileys' },

  { char: '\u{1F44B}', name: 'waving hand', keywords: 'hello bye hi', category: 'people' },
  { char: '\u{1F44D}', name: 'thumbs up', keywords: 'like yes ok', category: 'people' },
  { char: '\u{1F44E}', name: 'thumbs down', keywords: 'dislike no', category: 'people' },
  { char: '\u{1F44F}', name: 'clapping hands', keywords: 'applause', category: 'people' },
  { char: '\u{1F64C}', name: 'raising hands', keywords: 'yay celebrate', category: 'people' },
  { char: '\u{1F64F}', name: 'folded hands', keywords: 'please thanks pray', category: 'people' },
  { char: '\u{1F4AA}', name: 'flexed biceps', keywords: 'strong', category: 'people' },
  { char: '\u{1F440}', name: 'eyes', keywords: 'look watch', category: 'people' },
  { char: '\u{1F441}\u{FE0F}', name: 'eye', keywords: 'look', category: 'people' },
  { char: '\u{1F9E0}', name: 'brain', keywords: 'smart', category: 'people' },
  { char: '\u{1F464}', name: 'bust in silhouette', keywords: 'person', category: 'people' },
  { char: '\u{1F465}', name: 'busts in silhouette', keywords: 'people group', category: 'people' },
  { char: '\u{1F44C}', name: 'OK hand', keywords: 'ok perfect', category: 'people' },
  { char: '\u{1F91D}', name: 'handshake', keywords: 'deal agree', category: 'people' },
  { char: '\u{1F44F}\u{1F3FB}', name: 'clapping hands light skin tone', keywords: 'applause', category: 'people' },
  { char: '\u{1F937}', name: 'person shrugging', keywords: 'shrug dunno', category: 'people' },
  { char: '\u{1F926}', name: 'person facepalming', keywords: 'facepalm', category: 'people' },

  { char: '\u{1F436}', name: 'dog face', keywords: 'puppy', category: 'animals' },
  { char: '\u{1F431}', name: 'cat face', keywords: 'kitten', category: 'animals' },
  { char: '\u{1F42D}', name: 'mouse face', keywords: 'mouse', category: 'animals' },
  { char: '\u{1F439}', name: 'hamster', keywords: 'hamster', category: 'animals' },
  { char: '\u{1F430}', name: 'rabbit face', keywords: 'bunny', category: 'animals' },
  { char: '\u{1F98A}', name: 'fox', keywords: 'fox', category: 'animals' },
  { char: '\u{1F43B}', name: 'bear face', keywords: 'bear', category: 'animals' },
  { char: '\u{1F43C}', name: 'panda', keywords: 'panda', category: 'animals' },
  { char: '\u{1F42F}', name: 'tiger face', keywords: 'tiger', category: 'animals' },
  { char: '\u{1F981}', name: 'lion', keywords: 'lion', category: 'animals' },
  { char: '\u{1F42E}', name: 'cow face', keywords: 'cow', category: 'animals' },
  { char: '\u{1F437}', name: 'pig face', keywords: 'pig', category: 'animals' },
  { char: '\u{1F438}', name: 'frog', keywords: 'frog', category: 'animals' },
  { char: '\u{1F435}', name: 'monkey face', keywords: 'monkey', category: 'animals' },
  { char: '\u{1F414}', name: 'chicken', keywords: 'chicken bird', category: 'animals' },
  { char: '\u{1F427}', name: 'penguin', keywords: 'penguin', category: 'animals' },
  { char: '\u{1F426}', name: 'bird', keywords: 'bird', category: 'animals' },
  { char: '\u{1F984}', name: 'unicorn', keywords: 'unicorn', category: 'animals' },
  { char: '\u{1F422}', name: 'turtle', keywords: 'turtle', category: 'animals' },
  { char: '\u{1F41D}', name: 'honeybee', keywords: 'bee', category: 'animals' },
  { char: '\u{1F98B}', name: 'butterfly', keywords: 'butterfly', category: 'animals' },
  { char: '\u{1F332}', name: 'evergreen tree', keywords: 'tree plant', category: 'animals' },
  { char: '\u{1F338}', name: 'cherry blossom', keywords: 'flower', category: 'animals' },
  { char: '\u{1F33B}', name: 'sunflower', keywords: 'flower', category: 'animals' },
  { char: '\u{1F340}', name: 'four leaf clover', keywords: 'luck', category: 'animals' },

  { char: '\u{1F34E}', name: 'red apple', keywords: 'apple fruit', category: 'food' },
  { char: '\u{1F34C}', name: 'banana', keywords: 'banana fruit', category: 'food' },
  { char: '\u{1F347}', name: 'grapes', keywords: 'grapes fruit', category: 'food' },
  { char: '\u{1F353}', name: 'strawberry', keywords: 'strawberry fruit', category: 'food' },
  { char: '\u{1F355}', name: 'pizza', keywords: 'pizza food', category: 'food' },
  { char: '\u{1F354}', name: 'hamburger', keywords: 'burger food', category: 'food' },
  { char: '\u{1F32E}', name: 'taco', keywords: 'taco food', category: 'food' },
  { char: '\u{1F35C}', name: 'steaming bowl', keywords: 'ramen noodles', category: 'food' },
  { char: '\u{1F363}', name: 'sushi', keywords: 'sushi', category: 'food' },
  { char: '\u{1F369}', name: 'doughnut', keywords: 'donut', category: 'food' },
  { char: '\u{1F370}', name: 'shortcake', keywords: 'cake dessert', category: 'food' },
  { char: '\u{1F382}', name: 'birthday cake', keywords: 'cake birthday', category: 'food' },
  { char: '\u{1F36B}', name: 'chocolate bar', keywords: 'chocolate', category: 'food' },
  { char: '\u{1F37F}', name: 'popcorn', keywords: 'popcorn movie', category: 'food' },
  { char: '\u{2615}', name: 'hot beverage', keywords: 'coffee tea', category: 'food' },
  { char: '\u{1F37A}', name: 'beer mug', keywords: 'beer drink', category: 'food' },
  { char: '\u{1F377}', name: 'wine glass', keywords: 'wine drink', category: 'food' },
  { char: '\u{1F964}', name: 'cup with straw', keywords: 'drink soda', category: 'food' },

  { char: '\u{26BD}', name: 'soccer ball', keywords: 'football sport', category: 'activities' },
  { char: '\u{1F3C0}', name: 'basketball', keywords: 'sport', category: 'activities' },
  { char: '\u{1F3C8}', name: 'american football', keywords: 'sport', category: 'activities' },
  { char: '\u{1F3BE}', name: 'tennis', keywords: 'sport', category: 'activities' },
  { char: '\u{1F3AE}', name: 'video game', keywords: 'game controller', category: 'activities' },
  { char: '\u{1F3B2}', name: 'game die', keywords: 'dice game', category: 'activities' },
  { char: '\u{1F3B8}', name: 'guitar', keywords: 'music', category: 'activities' },
  { char: '\u{1F3B5}', name: 'musical note', keywords: 'music', category: 'activities' },
  { char: '\u{1F3AC}', name: 'clapper board', keywords: 'movie film', category: 'activities' },
  { char: '\u{1F3A8}', name: 'artist palette', keywords: 'art paint', category: 'activities' },
  { char: '\u{1F3C6}', name: 'trophy', keywords: 'win award', category: 'activities' },
  { char: '\u{1F3AF}', name: 'direct hit', keywords: 'target bullseye', category: 'activities' },
  { char: '\u{1F9E9}', name: 'puzzle piece', keywords: 'puzzle', category: 'activities' },
  { char: '\u{1F3B3}', name: 'bowling', keywords: 'sport', category: 'activities' },
  { char: '\u{26BE}', name: 'baseball', keywords: 'sport', category: 'activities' },

  { char: '\u{1F697}', name: 'automobile', keywords: 'car', category: 'travel' },
  { char: '\u{1F695}', name: 'taxi', keywords: 'car cab', category: 'travel' },
  { char: '\u{1F68C}', name: 'bus', keywords: 'bus', category: 'travel' },
  { char: '\u{1F682}', name: 'locomotive', keywords: 'train', category: 'travel' },
  { char: '\u{2708}\u{FE0F}', name: 'airplane', keywords: 'flight plane', category: 'travel' },
  { char: '\u{1F680}', name: 'rocket', keywords: 'launch space', category: 'travel' },
  { char: '\u{1F6B2}', name: 'bicycle', keywords: 'bike', category: 'travel' },
  { char: '\u{1F3E0}', name: 'house', keywords: 'home', category: 'travel' },
  { char: '\u{1F3E2}', name: 'office building', keywords: 'work', category: 'travel' },
  { char: '\u{1F5FC}', name: 'Tokyo tower', keywords: 'landmark', category: 'travel' },
  { char: '\u{1F5FD}', name: 'Statue of Liberty', keywords: 'landmark', category: 'travel' },
  { char: '\u{1F30D}', name: 'globe showing Europe-Africa', keywords: 'world earth', category: 'travel' },
  { char: '\u{1F30A}', name: 'water wave', keywords: 'ocean sea', category: 'travel' },
  { char: '\u{26F0}\u{FE0F}', name: 'mountain', keywords: 'nature', category: 'travel' },
  { char: '\u{1F3D6}\u{FE0F}', name: 'beach with umbrella', keywords: 'beach vacation', category: 'travel' },

  { char: '\u{1F4A1}', name: 'light bulb', keywords: 'idea', category: 'objects' },
  { char: '\u{1F4BB}', name: 'laptop', keywords: 'computer', category: 'objects' },
  { char: '\u{1F4F1}', name: 'mobile phone', keywords: 'phone', category: 'objects' },
  { char: '\u{1F4F7}', name: 'camera', keywords: 'photo', category: 'objects' },
  { char: '\u{1F4DA}', name: 'books', keywords: 'read study', category: 'objects' },
  { char: '\u{270F}\u{FE0F}', name: 'pencil', keywords: 'write', category: 'objects' },
  { char: '\u{1F4CC}', name: 'pushpin', keywords: 'pin', category: 'objects' },
  { char: '\u{1F4CE}', name: 'paperclip', keywords: 'attach', category: 'objects' },
  { char: '\u{1F4E6}', name: 'package', keywords: 'box ship', category: 'objects' },
  { char: '\u{1F4E7}', name: 'e-mail', keywords: 'email mail', category: 'objects' },
  { char: '\u{1F4E8}', name: 'incoming envelope', keywords: 'mail', category: 'objects' },
  { char: '\u{1F511}', name: 'key', keywords: 'lock', category: 'objects' },
  { char: '\u{1F512}', name: 'locked', keywords: 'lock secure', category: 'objects' },
  { char: '\u{1F4B0}', name: 'money bag', keywords: 'money cash', category: 'objects' },
  { char: '\u{1F4B3}', name: 'credit card', keywords: 'pay', category: 'objects' },
  { char: '\u{1F6D2}', name: 'shopping cart', keywords: 'shop grocery', category: 'objects' },
  { char: '\u{1F4C5}', name: 'calendar', keywords: 'date', category: 'objects' },
  { char: '\u{23F0}', name: 'alarm clock', keywords: 'time', category: 'objects' },

  { char: '\u{2764}\u{FE0F}', name: 'red heart', keywords: 'love', category: 'symbols' },
  { char: '\u{1F9E1}', name: 'orange heart', keywords: 'love', category: 'symbols' },
  { char: '\u{1F49B}', name: 'yellow heart', keywords: 'love', category: 'symbols' },
  { char: '\u{1F49A}', name: 'green heart', keywords: 'love', category: 'symbols' },
  { char: '\u{1F499}', name: 'blue heart', keywords: 'love', category: 'symbols' },
  { char: '\u{1F49C}', name: 'purple heart', keywords: 'love', category: 'symbols' },
  { char: '\u{1F5A4}', name: 'black heart', keywords: 'love', category: 'symbols' },
  { char: '\u{1F494}', name: 'broken heart', keywords: 'sad love', category: 'symbols' },
  { char: '\u{2728}', name: 'sparkles', keywords: 'shine magic', category: 'symbols' },
  { char: '\u{2B50}', name: 'star', keywords: 'favorite', category: 'symbols' },
  { char: '\u{1F525}', name: 'fire', keywords: 'hot lit', category: 'symbols' },
  { char: '\u{1F4AF}', name: 'hundred points', keywords: '100 perfect', category: 'symbols' },
  { char: '\u{2705}', name: 'check mark button', keywords: 'done yes', category: 'symbols' },
  { char: '\u{274C}', name: 'cross mark', keywords: 'no wrong', category: 'symbols' },
  { char: '\u{2757}', name: 'exclamation mark', keywords: 'important', category: 'symbols' },
  { char: '\u{2753}', name: 'question mark', keywords: 'ask', category: 'symbols' },
  { char: '\u{1F389}', name: 'party popper', keywords: 'celebrate', category: 'symbols' },
  { char: '\u{1F4A5}', name: 'collision', keywords: 'boom', category: 'symbols' },
  { char: '\u{26A0}\u{FE0F}', name: 'warning', keywords: 'caution', category: 'symbols' },
  { char: '\u{1F6A7}', name: 'construction', keywords: 'wip', category: 'symbols' },

  { char: '\u{1F1FA}\u{1F1F8}', name: 'flag United States', keywords: 'usa america', category: 'flags' },
  { char: '\u{1F1EC}\u{1F1E7}', name: 'flag United Kingdom', keywords: 'uk britain', category: 'flags' },
  { char: '\u{1F1E8}\u{1F1E6}', name: 'flag Canada', keywords: 'canada', category: 'flags' },
  { char: '\u{1F1E9}\u{1F1EA}', name: 'flag Germany', keywords: 'germany', category: 'flags' },
  { char: '\u{1F1EB}\u{1F1F7}', name: 'flag France', keywords: 'france', category: 'flags' },
  { char: '\u{1F1EA}\u{1F1F8}', name: 'flag Spain', keywords: 'spain', category: 'flags' },
  { char: '\u{1F1EF}\u{1F1F5}', name: 'flag Japan', keywords: 'japan', category: 'flags' },
  { char: '\u{1F1E6}\u{1F1FA}', name: 'flag Australia', keywords: 'australia', category: 'flags' },
];

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

// A character is only offered to the composer if the catalogue knows it, so the
// picker cannot push an arbitrary string into a message.
export function isEmoji(char) {
  return EMOJI.some((e) => e.char === char);
}

