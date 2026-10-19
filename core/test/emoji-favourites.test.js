// The emoji favourites cache (issue 494). The server owns the list; this is the copy that makes the row readable before
// the first round trip and while offline, with the changes that have not reached the server yet. The tests here hold
// the two promises the cache makes: a favourite added offline is not lost when the connection returns, and two devices
// adding different favourites converge on the one value the server answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  favouriteList, favouriteCache, queueFavourite, settleFavourite, adoptFavourites,
  encodeFavouriteCache, FAVOURITES_BYTES, FAVOURITES_MAX,
} from '../app/rules/emoji-favourites.js';
import { EMOJI } from '../app/rules/emoji-data.js';

const SMILE = '\u{1F600}';
const PARTY = '\u{1F389}';
const HEART = '\u2764\uFE0F';
const bytes = (text) => new TextEncoder().encode(text).length;

test('the list keeps known emoji once each in the order it was given', () => {
  assert.deepEqual(favouriteList([PARTY, SMILE, PARTY, 'nope', '', null, HEART]), [PARTY, SMILE, HEART]);
  assert.deepEqual(favouriteList('not a list'), []);
  assert.equal(favouriteList(EMOJI.slice(0, FAVOURITES_MAX + 20).map((e) => e.char)).length, FAVOURITES_MAX, 'the row is capped at 200');
});

test('a favourite added offline survives the connection returning, and its change is sent once', () => {
  // Offline: the change is queued in the cache and the row shows it at once.
  let cache = queueFavourite(favouriteCache(null), { add: [SMILE] }, 'op-1');
  assert.deepEqual(cache.list, [SMILE]);
  assert.equal(cache.pending.length, 1);
  // A restart reads the same cache back from the shell's text-only storage.
  cache = favouriteCache(JSON.parse(encodeFavouriteCache(cache)));
  assert.deepEqual(cache.list, [SMILE], 'the row is there after a restart, before any server read');
  assert.equal(cache.pending.length, 1, 'the unsent change is still queued');
  // The connection returns and the server, which never heard the change, answers with an empty list. The queued change
  // stays on top rather than being wiped by that answer.
  cache = adoptFavourites(cache, []);
  assert.deepEqual(cache.list, [SMILE], 'the favourite added offline is not lost');
  assert.equal(cache.pending.length, 1);
  // The change lands, and the server's answer is the value.
  cache = settleFavourite(cache, 'op-1', [SMILE]);
  assert.deepEqual(cache, { list: [SMILE], pending: [] });
});

test('a change made on another device arrives, and a local change still queued stays on top of it', () => {
  let cache = queueFavourite(favouriteCache({ list: [HEART] }), { add: [SMILE] }, 'local-1');
  cache = adoptFavourites(cache, [PARTY]);
  assert.deepEqual(cache.list, [SMILE, PARTY], 'the other device\'s list plus this device\'s unsent favourite');
  assert.deepEqual(cache.pending, [{ id: 'local-1', add: [SMILE], remove: [] }]);
  cache = settleFavourite(cache, 'local-1', [SMILE, PARTY]);
  assert.deepEqual(cache, { list: [SMILE, PARTY], pending: [] });
});

test('a removal made on another device leaves the row', () => {
  const cache = adoptFavourites(favouriteCache({ list: [SMILE, PARTY] }), [SMILE]);
  assert.deepEqual(cache.list, [SMILE]);
});

test('two devices adding at once converge on the one list the server answers', () => {
  // Both devices read an empty list and each queues its own favourite while the other is in flight.
  let a = queueFavourite(favouriteCache(null), { add: [SMILE] }, 'a-1');
  let b = queueFavourite(favouriteCache(null), { add: [PARTY] }, 'b-1');
  // The server applies both operations, one character each, and answers each with the whole list.
  const value = [PARTY, SMILE];
  a = settleFavourite(a, 'a-1', value);
  b = settleFavourite(b, 'b-1', value);
  assert.deepEqual(a, b, 'the two devices hold one value');
  assert.deepEqual(a, { list: value, pending: [] });
  assert.deepEqual([...a.list].sort(), [SMILE, PARTY].sort(), 'neither favourite was dropped');
});

test('the cache written for the shell fits the smallest shell limit and reads back whole', () => {
  const pending = Array.from({ length: 200 }, (_, i) => ({ id: 'op-' + i, add: [SMILE, PARTY], remove: [] }));
  const text = encodeFavouriteCache({ list: [HEART], pending });
  assert.ok(bytes(text) <= FAVOURITES_BYTES, 'fits the 8 KB every shell stores');
  const back = favouriteCache(JSON.parse(text));
  assert.deepEqual(back.list, [HEART]);
  assert.ok(back.pending.length > 0, 'the newest queued changes are kept');
  assert.equal(back.pending.at(-1).id, 'op-199');
});

test('the cache survives a restart through a shell store that takes text only', async () => {
  const saved = new Map();
  globalThis.window = { bridge: { call: async (name, args) => (name === 'storage.get' ? (saved.get(args.key) ?? null) : (saved.set(args.key, args.value), true)) } };
  try {
    const { writeFavouriteCache, readFavouriteCache } = await import('../app/favourites.js');
    await writeFavouriteCache(queueFavourite(favouriteCache(null), { add: [SMILE] }, 'op-1'));
    assert.equal(typeof saved.get('emoji.favourites'), 'string', 'the shell is handed text');
    const back = await readFavouriteCache();
    assert.deepEqual(back.list, [SMILE]);
    assert.equal(back.pending.length, 1);
  } finally {
    delete globalThis.window;
  }
});

test('a plain browser keeps the cache in its own storage, where no bridge exists', async () => {
  const saved = new Map();
  globalThis.localStorage = { getItem: (k) => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v), removeItem: (k) => saved.delete(k) };
  try {
    const { writeFavouriteCache, readFavouriteCache } = await import('../app/favourites.js');
    await writeFavouriteCache(queueFavourite(favouriteCache(null), { add: [PARTY] }, 'op-web'));
    const back = await readFavouriteCache();
    assert.deepEqual(back.list, [PARTY]);
    assert.equal(back.pending.length, 1);
  } finally {
    delete globalThis.localStorage;
  }
});
