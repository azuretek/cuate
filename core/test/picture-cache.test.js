// What a launch draws besides messages, kept on the device's store (issue 441): a conversation's own pictures (its
// avatar or group photo, a person's face, its backdrop), a theme's font files, and the settings that choose the theme,
// scheme and text size. A warm launch draws each of them from the store before the server answers, and asks the
// server for none of the pictures or fonts again. Synthetic records only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeIdb } from './fake-idb.js';
import { holdsMedia, PICTURE_ITEM_MAX_BYTES, MEDIA_ITEM_MAX_BYTES } from '../app/rules/message-store.js';
import { openMessageCache, STORE_NAME } from '../app/message-cache.js';

const defined = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { defined[name] = cls; }, get() { return undefined; } };
globalThis.document = { hidden: false, visibilityState: 'visible', createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
const { fetchPicture, canFetchPicture, useMediaStore } = await import('../app/components/app-attachment.js');
await import('../app/components/app-root.js');
const proto = defined['app-root'].prototype;

const URL_ = 'http://fixture.invalid';
const rows = (idb) => [...idb.dump(STORE_NAME).stores.values()].reduce((n, s) => n + s.rows.size, 0);

test('a conversation\'s own picture and a theme\'s font are held under their own item cap, and a tile\'s rule is unchanged', () => {
  assert.equal(holdsMedia({ mime: 'image/jpeg' }, { kind: 'picture', size: 2 * 1024 * 1024 }), true, 'a backdrop larger than a tile is held');
  assert.equal(holdsMedia({}, { kind: 'picture', type: 'image/png', size: 5000 }), true, 'a group photo named only by the bytes it came as');
  assert.equal(holdsMedia({ mime: 'image/jpeg' }, { kind: 'picture', size: PICTURE_ITEM_MAX_BYTES + 1 }), false, 'nor anything over its cap');
  assert.equal(holdsMedia({ mime: 'video/mp4' }, { kind: 'picture', size: 5000 }), false, 'and never a video');
  assert.equal(holdsMedia({ id: 'f1' }, { kind: 'font', size: 300 * 1024 }), true, 'a theme\'s font file is held');
  assert.equal(holdsMedia({ mime: 'image/jpeg' }, { size: MEDIA_ITEM_MAX_BYTES + 1 }), false, 'a tile\'s picture keeps its own cap');
});

test('the settings are held across a reopen, belong to one server, and go on a sign-out', async () => {
  const idb = createFakeIdb();
  const values = { 'appearance.skin': 'dark', 'appearance.textScale': 125 };
  const c = await openMessageCache(URL_, { idb, saveMs: 1 });
  assert.equal(c.settings, null, 'an empty store holds none');
  c.saveSettings(values);
  await c.flush();
  c.close();
  const again = await openMessageCache(URL_, { idb });
  assert.deepEqual(again.settings, values);
  const text = JSON.stringify([...idb.dump(STORE_NAME).stores.values()].map((s) => [...s.rows.values()]));
  assert.doesNotMatch(text, /fixture\.invalid|token|secret|authorization/i, 'the settings hold no credential and no address');
  again.close();
  const other = await openMessageCache('https://other.invalid', { idb });
  assert.equal(other.settings, null, 'another server\'s store holds none of them');
  other.saveSettings(values);
  await other.flush();
  await other.clear();
  assert.equal(rows(idb), 0, 'signing out leaves nothing');
});

test('an avatar, a group photo or a backdrop is drawn from the store on the next launch, with no server read and no server yet', async () => {
  const idb = createFakeIdb();
  const reads = [];
  const client = { attachment: async (id) => { reads.push(id); return new Blob([new Uint8Array(id === 'backdrop' ? 2 * 1024 * 1024 : 4096)], { type: 'image/jpeg' }); } };
  const first = await openMessageCache(URL_, { idb });
  useMediaStore(first);
  for (const id of ['avatar', 'group-photo', 'backdrop']) await fetchPicture(client, { id, mime: 'image/jpeg' });
  await first.flush();
  assert.deepEqual(reads, ['avatar', 'group-photo', 'backdrop'], 'the first launch reads each once');
  first.close();
  useMediaStore(null);
  assert.equal(canFetchPicture(null), false, 'with no store and no server there is nothing to draw from');

  const warm = await openMessageCache(URL_, { idb });
  useMediaStore(warm);
  assert.equal(canFetchPicture(null), true, 'a store is enough to draw before the server answers');
  const back = await Promise.all(['avatar', 'group-photo', 'backdrop'].map((id) => fetchPicture(null, { id, mime: 'image/jpeg' })));
  assert.deepEqual(back.map((b) => b.size), [4096, 4096, 2 * 1024 * 1024]);
  assert.deepEqual(reads, ['avatar', 'group-photo', 'backdrop'], 'and the warm launch reads none of them again');
  await assert.rejects(fetchPicture(null, { id: 'never-seen', mime: 'image/jpeg' }), /No server yet/, 'one it never held waits for the server');
  warm.close();
  useMediaStore(null);
});

// The stand-in server for a launch: the settings it holds, a gate on the info read so the page can be looked at before
// the server answers anything, and every request recorded.
function server(values) {
  const s = { asked: [], gate: null };
  globalThis.fetch = async (url, { method = 'GET' } = {}) => {
    const u = new URL(url);
    s.asked.push(method + ' ' + u.pathname);
    const answer = (body) => ({ ok: true, status: 200, json: async () => body, arrayBuffer: async () => new Uint8Array(2048).buffer });
    if (u.pathname === '/api/v1/info') { if (s.gate) await s.gate; return answer({ apiVersion: 1, sending: true }); }
    if (u.pathname === '/api/v1/chats') return answer({ chats: [{ id: '1', name: 'Fixture One', isGroup: false, participants: [], unread: 0, lastMessageAt: '2026-01-01T00:00:00.000Z' }] });
    if (u.pathname === '/api/v1/settings') return answer({ values });
    if (u.pathname === '/api/v1/changes') return answer({ cursor: 'c1', reset: true, more: false, messages: [], reactions: [], unsent: [], reads: [] });
    return answer({});
  };
  globalThis.WebSocket = class { send() {} close() {} };
  return s;
}

function page(themes) {
  const host = {
    phase: 'loading', chats: [], messages: [], openChatId: null, listOpen: true, view: 'messages', dataset: {}, pending: new Map(),
    bridge: async () => null,
    applyTheme() { themes.push(this.settings['appearance.skin'] || 'default'); },
    applyNoticeQuiet() {}, applyUpdateSetting() {}, registerPush() {}, releaseHeldUpdate() {}, launchCheck() {}, noticeServerUpdate() {}, releaseHeldScreen() {},
    onEvent() {}, onConnState() {}, closeView() {}, querySelector() { return null; }, takeNotice() {}, takeLink() {}, stopNoticeWait() {}, resetTyping() {}, clearTyping() {},
  };
  for (const name of ['loadCachedFavourites', 'syncFavourites', 'flushFavourites', 'migrateFavourites', 'resetFavourites', 'queueFavouriteChange', 'favouriteEmoji', 'forgetEmoji', 'adoptFavouriteList', 'start', 'readSettings', 'describe', 'openStore', 'catchUp', 'showChanges', 'keepShown', 'signOut', 'themeFontBytes']) {
    if (typeof proto[name] === 'function') host[name] = proto[name];
  }
  return host;
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
const until = async (check, what) => {
  for (let i = 0; i < 400; i += 1) { if (check()) return; await tick(); }
  throw new Error('timed out waiting for ' + what);
};

test('a warm launch draws the held theme with the held list, before the server answers, and a theme\'s font comes from the store', async () => {
  const idb = createFakeIdb();
  globalThis.indexedDB = idb;
  try {
    const s = server({ 'appearance.skin': 'dark' });
    const coldThemes = [];
    const cold = page(coldThemes);
    await cold.start(URL_, 'fixture-token');
    cold.keepShown();
    assert.equal(new Uint8Array(await cold.themeFontBytes('font-1')).length, 2048);
    await cold.cache.flush();
    assert.deepEqual(coldThemes, ['dark'], 'a cold launch draws the theme once the server answers');
    assert.ok(s.asked.includes('GET /api/v1/themes/fonts/font-1'));
    cold.client.close();
    cold.cache.close();

    s.asked.length = 0;
    let release;
    s.gate = new Promise((resolve) => { release = resolve; });
    const warmThemes = [];
    const warm = page(warmThemes);
    const started = warm.start(URL_, 'fixture-token');
    await until(() => warm.phase === 'ready', 'the list from the store');
    assert.deepEqual(warmThemes, ['dark'], 'the held theme is drawn with the held list');
    assert.deepEqual(s.asked, ['GET /api/v1/info'], 'before the server has answered anything');
    assert.equal(new Uint8Array(await warm.themeFontBytes('font-1')).length, 2048, 'the theme\'s font is drawn from the store');
    assert.equal(s.asked.filter((a) => a.includes('/themes/fonts/')).length, 0, 'and is not read again');
    release();
    await started;
    await warm.signOut('');
    assert.equal(rows(idb), 0, 'signing out leaves nothing');
  } finally {
    delete globalThis.indexedDB;
  }
});
