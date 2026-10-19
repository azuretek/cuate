// The emoji favourites the person has used, held on the server so every device draws the same row. The list is one
// value keyed to the person, beside the settings in the same store, and each change is one small operation: add or
// remove a character, with an id that makes a retry harmless. Two devices adding different emoji therefore both land,
// and both read the same order back.
import { isEmoji } from '../../core/app/rules/emoji.js';

// This server belongs to one person, so every token that can reach it is that person's. The key is explicit so a
// server that later serves more than one person adds a key rather than migrating the table.
export const PERSON = 'owner';
const MAX_CHANGE = 200;
const OP = /^[A-Za-z0-9._:-]{1,64}$/;

const refuse = (code, message, status = 400) => Object.assign(new Error(message), { status, code });

function characters(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw refuse('bad_' + field, field + ' must be an array of emoji');
  if (value.length > MAX_CHANGE) throw refuse('too_many', 'Too many emoji in one change', 413);
  const out = [];
  for (const char of value) {
    if (typeof char !== 'string' || !isEmoji(char)) throw refuse('bad_' + field, 'Not an emoji: ' + String(char));
    if (!out.includes(char)) out.push(char);
  }
  return out;
}

export function createEmojiFavourites({ store }) {
  return {
    all(person = PERSON) {
      return store.getEmojiFavourites(person).map((row) => row.char);
    },
    // Applies one queued change and answers the whole list as it stands now.
    apply(person = PERSON, change = {}) {
      const op = change.op;
      if (typeof op !== 'string' || !OP.test(op)) throw refuse('bad_op', 'A change needs an operation id.');
      const add = characters(change.add, 'add');
      const remove = characters(change.remove, 'remove');
      if (!add.length && !remove.length) throw refuse('bad_change', 'A change adds or removes at least one emoji.');
      return store.applyEmojiFavourites(person, { op, add, remove }).map((row) => row.char);
    },
  };
}
