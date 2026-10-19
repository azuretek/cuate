// The emoji favourites cache survives a restart on the desktop's real store (issues 301 and 494). Every shell's storage
// holds text only: the desktop encrypts the value as a string, iOS refuses anything that is not a string under 8 KB,
// and Android stores it as a string and hands a string back. The stand-in here is the desktop's own createSecureStore
// over a real file, so a fresh open is the app starting again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSecureStore, createHandlers } from '../../desktop/src/bridge-handlers.js';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { favouriteCache, queueFavourite, encodeFavouriteCache } from '../app/rules/emoji-favourites.js';

const SMILE = '\u{1F600}';
const PARTY = '\u{1F389}';
const HEART = '\u2764\uFE0F';

// The desktop shell's storage, from its real handlers, with a stand-in keychain that encrypts as the real one does.
function desktopStore(file) {
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('k:' + s, 'utf8'), decryptString: (b) => b.toString('utf8').slice(2) };
  const handlers = createHandlers({ secure: createSecureStore({ file, safeStorage, fs }), notify() {}, info: () => ({}), openExternal() {} });
  return { call: (name, args) => handlers[name](args) };
}

async function withStore(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emoji-favourites-'));
  const file = () => path.join(dir, 'secure-store.json');
  globalThis.window = { bridge: desktopStore(file) };
  try {
    await run(file);
  } finally {
    delete globalThis.window;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('the favourites, with a change that has not been sent, are read back from the store file after a restart', async () => {
  await withStore(async (file) => {
    const { writeFavouriteCache, readFavouriteCache } = await import('../app/favourites.js');
    const cache = queueFavourite(favouriteCache({ list: [HEART] }), { add: [SMILE] }, 'offline-1');
    await writeFavouriteCache(cache);
    // The app starts again: nothing held in memory, only what the shell kept.
    globalThis.window = { bridge: desktopStore(file) };
    const after = await readFavouriteCache();
    assert.deepEqual(after.list, [SMILE, HEART]);
    assert.deepEqual(after.pending, [{ id: 'offline-1', add: [SMILE], remove: [] }], 'the unsent change is still queued');
  });
});

test('a long history of wide emoji still fits what every shell will store', async () => {
  await withStore(async (_file) => {
    const { writeFavouriteCache, readFavouriteCache } = await import('../app/favourites.js');
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}';
    const list = Array.from({ length: 400 }, (_, i) => (i % 2 ? family : PARTY));
    // The server would answer one entry per character; the cache writes that list and a queue of changes.
    const pending = Array.from({ length: 60 }, (_, i) => ({ id: 'op-' + i, add: [family], remove: [] }));
    await writeFavouriteCache({ list, pending });
    const stored = await globalThis.window.bridge.call('storage.get', { key: 'emoji.favourites' });
    assert.ok(new TextEncoder().encode(stored).length <= 8192, 'fits the smallest shell limit');
    const after = await readFavouriteCache();
    assert.ok(after.list.length > 0 && after.pending.length > 0);
    assert.equal(after.pending.at(-1).id, 'op-59', 'the newest queued change is kept');
  });
});

test('a stored value that is not the cache reads as empty rather than failing', async () => {
  await withStore(async (_file) => {
    const { readFavouriteCache } = await import('../app/favourites.js');
    globalThis.window.bridge.call('storage.set', { key: 'emoji.favourites', value: '["😀"]' });
    assert.deepEqual(await readFavouriteCache(), favouriteCache(null), 'a list written before the cache shape is not read wrong');
    globalThis.window.bridge.call('storage.set', { key: 'emoji.favourites', value: '{"a":1}' });
    assert.deepEqual(await readFavouriteCache(), favouriteCache(null));
  });
});

test('the encoded cache is the shape the store takes, so the shell is handed text', async () => {
  const text = encodeFavouriteCache(queueFavourite(favouriteCache(null), { add: [PARTY] }, 'op-1'));
  assert.equal(typeof text, 'string');
  assert.deepEqual(favouriteCache(JSON.parse(text)).list, [PARTY]);
});
