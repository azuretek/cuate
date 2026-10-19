// Pure: the emoji favourites a person has used, as one ordered list. The server owns the list, keyed to the person,
// so every device shows the same row; this module is the copy that makes the row readable before the first round
// trip and while offline. A change is one small operation, add or remove one emoji, with an id of its own, so
// replaying it after a lost answer is harmless and two devices adding different emoji never overwrite each other.
import { isEmoji } from './emoji.js';

export const FAVOURITES_MAX = 200;
// The smallest shell's storage is iOS's 8 KB (core/spec/host-bridge.json); the cache is trimmed to fit it.
export const FAVOURITES_BYTES = 8000;
const PENDING_MAX = 200;

const bytes = (text) => new TextEncoder().encode(text).length;

// One list: known characters, once each, in the order given (the server's most used first).
export function favouriteList(value) {
  const out = [];
  for (const char of Array.isArray(value) ? value : []) {
    if (typeof char !== 'string' || !isEmoji(char) || out.includes(char)) continue;
    out.push(char);
    if (out.length === FAVOURITES_MAX) break;
  }
  return out;
}

// The queued changes, each one add or remove of known characters. A malformed operation is dropped rather than
// replayed, so a cache from a broken write cannot make the page send nonsense.
export function favouriteOps(value) {
  const out = [];
  for (const op of Array.isArray(value) ? value : []) {
    if (!op || typeof op.id !== 'string' || !op.id) continue;
    const add = favouriteList(op.add);
    const remove = favouriteList(op.remove);
    if (!add.length && !remove.length) continue;
    if (out.some((x) => x.id === op.id)) continue;
    out.push({ id: op.id, add, remove });
  }
  return out.slice(-PENDING_MAX);
}

// The cache the page stores: the list it last had, and the changes that have not reached the server yet.
export function favouriteCache(value) {
  const o = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return { list: favouriteList(o.list), pending: favouriteOps(o.pending) };
}

// What the row shows: the list with the queued changes applied in order. An added emoji moves to the front, which is
// where the server's answer will put it, and a removed one leaves.
export function applyFavourites(list, pending) {
  let out = favouriteList(list);
  for (const op of favouriteOps(pending)) {
    for (const char of op.add) out = favouriteList([char, ...out]);
    if (op.remove.length) out = out.filter((c) => !op.remove.includes(c));
  }
  return out;
}

// A change made now: queued with the id the caller made for it, and shown at once.
export function queueFavourite(cache, change = {}, id) {
  const before = favouriteCache(cache);
  const op = { id: String(id || ''), add: favouriteList(change.add), remove: favouriteList(change.remove) };
  if (!op.id || (!op.add.length && !op.remove.length)) return before;
  return { list: applyFavourites(before.list, [op]), pending: [...before.pending, op].slice(-PENDING_MAX) };
}

// The server's answer to one queued change: that change is done, and the rest still apply on top of the answer.
export function settleFavourite(cache, id, serverList) {
  const before = favouriteCache(cache);
  const pending = id === null ? before.pending : before.pending.filter((op) => op.id !== id);
  return { list: applyFavourites(serverList, pending), pending };
}

// The server's list arrived on its own (another device changed it): it is the value, with this device's queued
// changes still on top so nothing added offline disappears.
export function adoptFavourites(cache, serverList) {
  return settleFavourite(cache, null, serverList);
}

// The cache as the JSON text every shell stores, trimmed from its oldest queued change and then its oldest
// favourite until it fits.
export function encodeFavouriteCache(cache) {
  let c = favouriteCache(cache);
  let text = JSON.stringify(c);
  while (c.pending.length && bytes(text) > FAVOURITES_BYTES) {
    c = { ...c, pending: c.pending.slice(Math.max(1, Math.ceil(c.pending.length / 10))) };
    text = JSON.stringify(c);
  }
  while (c.list.length && bytes(text) > FAVOURITES_BYTES) {
    c = { ...c, list: c.list.slice(0, Math.floor(c.list.length * 0.9)) };
    text = JSON.stringify(c);
  }
  return text;
}
