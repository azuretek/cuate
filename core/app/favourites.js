// The favourites cache as the page keeps it: the shell's storage when there is one, and the browser's own storage on
// the web, where no bridge exists. Every shell stores text only (core/spec/host-bridge.json), so the cache goes as
// JSON; a missing or refused store leaves the page running from memory rather than failing.
import { favouriteCache, encodeFavouriteCache, favouriteList } from './rules/emoji-favourites.js';

export const FAVOURITES_KEY = 'emoji.favourites';
// The key the list lived under before the server held it (issue 302). Read once so a person's row survives the
// change, then removed.
export const LEGACY_KEY = 'emoji.frequent';

function bridge() {
  const b = globalThis.window && globalThis.window.bridge;
  return b && typeof b.call === 'function' ? b : null;
}

async function readText(key) {
  try {
    const b = bridge();
    if (b) {
      const value = await b.call('storage.get', { key });
      if (typeof value === 'string') return value;
    }
  } catch { /* the page's own storage */ }
  try {
    return globalThis.localStorage ? globalThis.localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

async function writeText(key, text) {
  try {
    const b = bridge();
    if (b) {
      await b.call('storage.set', { key, value: text });
      return;
    }
  } catch { /* the page's own storage */ }
  try { globalThis.localStorage?.setItem(key, text); } catch { /* page only */ }
}

async function removeText(key) {
  try {
    const b = bridge();
    if (b) {
      await b.call('storage.delete', { key });
      return;
    }
  } catch { /* the page's own storage */ }
  try { globalThis.localStorage?.removeItem(key); } catch { /* page only */ }
}

export async function readFavouriteCache() {
  const text = await readText(FAVOURITES_KEY);
  if (typeof text !== 'string') return favouriteCache(null);
  try {
    return favouriteCache(JSON.parse(text));
  } catch {
    return favouriteCache(null);
  }
}

export async function writeFavouriteCache(cache) {
  await writeText(FAVOURITES_KEY, encodeFavouriteCache(cache));
}

export async function forgetFavouriteCache() {
  await removeText(FAVOURITES_KEY);
}

// The list a shell kept before the server held it, newest last, as the old code wrote it.
export async function readLegacyFavourites() {
  const text = await readText(LEGACY_KEY);
  if (typeof text !== 'string') return [];
  try {
    return favouriteList(JSON.parse(text));
  } catch {
    return [];
  }
}

export async function forgetLegacyFavourites() {
  await removeText(LEGACY_KEY);
}
