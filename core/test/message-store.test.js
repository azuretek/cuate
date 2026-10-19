// The message store on the device (issue 441): its merge rules, its eviction rule, the server it belongs to, and the
// store itself over an IndexedDB stand-in that keeps a transaction's writes together and outlives a close, so a reopen
// reads what a relaunched app would. Synthetic messages only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeHeld, applyChangeList, applyChangesToShown, olderFromHeld, mediaEvictions, holdsMedia, serverDigest, sha256Hex, MEDIA_ITEM_MAX_BYTES } from '../app/rules/message-store.js';
import { openMessageCache, STORE_NAME } from '../app/message-cache.js';
import { openDeviceStore } from '../kit/device-store.js';
import { createFakeIdb } from './fake-idb.js';

const msg = (n, extra = {}) => ({ id: 'm' + String(n).padStart(3, '0'), chatId: '1', fromMe: false, text: 'Synthetic ' + n, sentAt: '2026-01-01T00:00:00.000Z', attachments: [], reactions: [], historyCursor: '1000:' + n, ...extra });
const run = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => msg(from + i));
const ids = (list) => list.map((m) => m.id);

test('a page that overlaps what is held merges into one run, and the marks follow the end each side reaches', () => {
  const held = mergeHeld(null, { messages: run(10, 20), hasOlder: true, current: true });
  assert.deepEqual(ids(held.messages), ids(run(10, 20)));
  const newer = mergeHeld(held, { messages: run(15, 25), hasOlder: true, current: true });
  assert.deepEqual(ids(newer.messages), ids(run(10, 25)));
  assert.equal(newer.hasOlder, true, 'the page did not reach further back, so the held mark stands');
  assert.equal(newer.current, true);
  // A window kept with no marks changes no mark.
  const kept = mergeHeld(newer, { messages: run(12, 18) });
  assert.deepEqual([kept.hasOlder, kept.current, kept.messages.length], [true, true, 16]);
});

test('a page with a gap before it replaces the older stretch, and an older stretch with a gap is not kept over a newer one', () => {
  const held = mergeHeld(null, { messages: run(1, 10), hasOlder: false, current: true });
  const jumped = mergeHeld(held, { messages: run(40, 50), hasOlder: true, current: true });
  assert.deepEqual(ids(jumped.messages), ids(run(40, 50)), 'the store keeps one run, never two with a gap between');
  assert.equal(jumped.hasOlder, true);
  const back = mergeHeld(jumped, { messages: run(1, 5), hasOlder: false });
  assert.deepEqual(ids(back.messages), ids(run(40, 50)), 'an older stretch that does not touch it leaves it alone');
});

test('an older page fetched from the oldest held message joins it, and its own mark says whether more lie beyond', () => {
  const held = mergeHeld(null, { messages: run(50, 60), hasOlder: true, current: true });
  const older = mergeHeld(held, { messages: run(40, 49), hasOlder: false }, { adjacent: true });
  assert.deepEqual(ids(older.messages), ids(run(40, 60)));
  assert.equal(older.hasOlder, false);
  assert.equal(older.current, true, 'reaching back says nothing about the newest');
  assert.deepEqual(ids(olderFromHeld(older, 'm045', 3).messages), ['m042', 'm043', 'm044']);
  assert.equal(olderFromHeld(older, 'm042', 5).hasMore, false, 'nothing held and nothing on the server beyond');
  assert.equal(olderFromHeld(older, 'm040', 5), null, 'the oldest held has nothing before it in the store');
});

test('a message being sent, or one that failed, is the page\'s own and is never held', () => {
  const held = mergeHeld(null, { messages: [msg(1), { ...msg(2), id: 'local:abc', state: 'sending' }, { ...msg(3), state: 'failed' }] });
  assert.deepEqual(ids(held.messages), ['m001']);
});

test('changes land on what is held: an edit keeps its reactions, a new message joins only a current run, an unsend goes, a reaction and a receipt land', () => {
  const liked = { ...msg(2), reactions: [{ type: 'like', emoji: null, fromMe: false, sender: '+15555550100' }] };
  const held = { messages: [msg(1), liked, msg(3, { fromMe: true })], hasOlder: false, current: true };
  const list = {
    messages: [{ ...msg(2), text: 'Synthetic edited', edited: true, reactions: [] }, msg(4), { ...msg(9), chatId: '2' }],
    unsent: [{ id: 'm001', chatId: '1' }],
    reactions: [{ chatId: '1', targetId: 'm003', type: 'love', emoji: null, add: true, fromMe: false, sender: '+15555550100' }],
    reads: [{ id: 'm003', chatId: '1', readAt: '2026-01-01T00:05:00.000Z' }],
  };
  const { held: next, changed } = applyChangeList(held, list, '1');
  assert.equal(changed, true);
  assert.deepEqual(ids(next.messages), ['m002', 'm003', 'm004'], 'the unsent one is gone, the new one joined, another chat\'s left out');
  assert.equal(next.messages[0].text, 'Synthetic edited');
  assert.equal(next.messages[0].reactions.length, 1, 'an edit keeps the reactions already on the message');
  assert.deepEqual(next.messages[1].reactions.map((r) => r.type), ['love']);
  assert.deepEqual([next.messages[1].read, next.messages[1].readAt], [true, '2026-01-01T00:05:00.000Z']);

  const stale = applyChangeList({ ...held, current: false }, { messages: [msg(4)] }, '1');
  assert.equal(stale.changed, false, 'a run that does not reach the newest never takes a message past a gap');
  assert.equal(applyChangeList(held, { messages: [], unsent: [], reactions: [], reads: [] }, '1').held, held, 'nothing changed, nothing new');
});

test('the conversation on screen takes the same changes, and hands new messages back for its window to place', () => {
  const { messages, arrived } = applyChangesToShown([msg(1), msg(2)], { messages: [{ ...msg(2), text: 'Synthetic edited', edited: true }, msg(3)], unsent: [{ id: 'm001', chatId: '1' }] }, '1');
  assert.deepEqual(ids(messages), ['m002']);
  assert.equal(messages[0].text, 'Synthetic edited');
  assert.deepEqual(ids(arrived), ['m003']);
});

test('one edited message in a changes list leaves every neighbour unmarked, and a cached mark is corrected (issue 498)', () => {
  const stale = { ...msg(1), edited: true, edits: [{ text: 'Synthetic old', at: '2026-01-01T00:00:00.000Z' }] };
  const { messages, arrived } = applyChangesToShown([stale, msg(2), msg(3)], {
    messages: [msg(1), { ...msg(2), text: 'Synthetic edited', edited: true }, msg(3)],
    unsent: [], reactions: [], reads: [],
  }, '1');
  assert.deepEqual(messages.map((m) => Boolean(m.edited)), [false, true, false], 'only the one the server marks');
  assert.equal(messages[0].edits, undefined, 'a mark the server never set goes with its history');
  assert.equal(messages[1].text, 'Synthetic edited');
  assert.deepEqual(ids(arrived), [], 'the newer rows were already on screen');
});

test('a page replaces a cached edit mark on every message it does not name (issue 498)', () => {
  const held = mergeHeld(null, { messages: [{ ...msg(1), edited: true }, msg(2)], hasOlder: false, current: true });
  const next = mergeHeld(held, { messages: [msg(1), { ...msg(2), text: 'Synthetic edited', edited: true }], hasOlder: false, current: true });
  assert.deepEqual(next.messages.map((m) => Boolean(m.edited)), [false, true], 'a page names exactly the edited rows');
  assert.equal(next.messages[0].edits, undefined, 'and clears the history a false mark carried');
});

test('held pictures go least recently used first until the rest fit under the cap, never the one just written', () => {
  const entries = [{ key: 'a', size: 40, usedAt: 3 }, { key: 'b', size: 40, usedAt: 1 }, { key: 'c', size: 40, usedAt: 2 }, { key: 'new', size: 40, usedAt: 0 }];
  assert.deepEqual(mediaEvictions(entries, { cap: 100, keep: 'new' }), ['b', 'c']);
  assert.deepEqual(mediaEvictions(entries, { cap: 1000 }), [], 'under the cap nothing goes');
  assert.equal(holdsMedia({ mime: 'image/jpeg' }, { size: 5000 }), true);
  assert.equal(holdsMedia({ mime: 'video/mp4' }, { part: 'poster', size: 5000 }), true, 'a video\'s poster is held');
  assert.equal(holdsMedia({ mime: 'video/mp4' }, { size: 5000 }), false, 'its own bytes never are');
  assert.equal(holdsMedia({ mime: 'image/heic' }, { part: 'live', size: 5000 }), false, 'nor a Live Photo\'s motion');
  assert.equal(holdsMedia({ mime: 'image/jpeg' }, { size: MEDIA_ITEM_MAX_BYTES + 1 }), false, 'nor an original over the item cap');
});

test('a store belongs to one server by a one-way digest of its address, the same however the address is written', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(serverDigest('https://Fixture.Invalid:8443/'), serverDigest('https://fixture.invalid:8443'));
  assert.notEqual(serverDigest('https://fixture.invalid'), serverDigest('https://other.invalid'));
  assert.doesNotMatch(serverDigest('https://fixture.invalid'), /fixture/);
});

test('the store keeps what it was given across a reopen', async () => {
  const idb = createFakeIdb();
  const cache = await openMessageCache('https://fixture.invalid', { idb, saveMs: 1 });
  assert.equal(cache.cursor, null);
  await cache.apply({ cursor: 'v1.1', messages: [], reactions: [], unsent: [], reads: [] });
  await cache.keep('1', { messages: run(1, 5), hasOlder: false, current: true });
  cache.saveChats([{ id: '1', name: 'Fixture One' }]);
  await cache.flush();
  cache.close();
  const again = await openMessageCache('https://fixture.invalid', { idb });
  assert.equal(again.cursor, 'v1.1');
  assert.deepEqual(again.chats.map((c) => c.id), ['1']);
  const held = await again.convo('1');
  assert.deepEqual(ids(held.messages), ids(run(1, 5)));
  assert.deepEqual([held.hasOlder, held.current], [false, true]);
  assert.equal(await again.convo('2'), null, 'a conversation never kept is not held');
  again.close();
});

test('a list of changes and its cursor land in one transaction: a write that fails moves neither', async () => {
  const idb = createFakeIdb();
  const cache = await openMessageCache('https://fixture.invalid', { idb, saveMs: 1 });
  await cache.apply({ cursor: 'v1.1', messages: [] });
  await cache.keep('1', { messages: run(1, 3), hasOlder: false, current: true });
  await cache.flush();
  idb.failNextWrite = true;
  await assert.rejects(cache.apply({ cursor: 'v1.2', messages: [msg(4)], unsent: [{ id: 'm001', chatId: '1' }] }));
  assert.equal(cache.cursor, 'v1.1', 'the cursor never claims what the store does not hold');
  assert.deepEqual(ids((await cache.convo('1')).messages), ids(run(1, 3)), 'and what the page holds in memory is put back');
  cache.close();
  const again = await openMessageCache('https://fixture.invalid', { idb });
  assert.equal(again.cursor, 'v1.1');
  assert.deepEqual(ids((await again.convo('1')).messages), ids(run(1, 3)), 'and none of the changes landed either');
  await again.apply({ cursor: 'v1.2', messages: [msg(4)], unsent: [{ id: 'm001', chatId: '1' }] });
  again.close();
  const third = await openMessageCache('https://fixture.invalid', { idb });
  assert.equal(third.cursor, 'v1.2');
  assert.deepEqual(ids((await third.convo('1')).messages), ['m002', 'm003', 'm004']);
  third.close();
});

test('a different server, a reset answer and a sign-out each leave nothing of what was held', async () => {
  const idb = createFakeIdb();
  const fill = async (url) => {
    const c = await openMessageCache(url, { idb, saveMs: 1 });
    await c.apply({ cursor: 'v1.7', messages: [] });
    await c.keep('1', { messages: run(1, 3), current: true });
    c.saveChats([{ id: '1' }]);
    await c.keepMedia({ id: 'att1', mime: 'image/png' }, new Blob([new Uint8Array(64)], { type: 'image/png' }));
    await c.flush();
    return c;
  };
  (await fill('https://fixture.invalid')).close();
  const other = await openMessageCache('https://other.invalid', { idb });
  assert.deepEqual([other.cursor, other.chats.length, await other.convo('1'), await other.media({ id: 'att1', mime: 'image/png' })], [null, 0, null, null]);
  other.close();

  const reset = await fill('https://fixture.invalid');
  await reset.reset('v1.9');
  assert.equal(reset.cursor, 'v1.9');
  assert.equal(await reset.convo('1'), null);
  assert.equal(await reset.media({ id: 'att1', mime: 'image/png' }), null);
  reset.close();

  const out = await fill('https://fixture.invalid');
  await out.clear();
  const rows = [...idb.dump(STORE_NAME).stores.values()].reduce((n, s) => n + s.rows.size, 0);
  assert.equal(rows, 0, 'signing out empties every part of the store');
});

test('the store holds no token and no server address', async () => {
  const idb = createFakeIdb();
  const cache = await openMessageCache('https://fixture.invalid:8443', { idb, saveMs: 1 });
  await cache.apply({ cursor: 'v1.1', messages: [] });
  await cache.keep('1', { messages: run(1, 2), current: true });
  cache.saveChats([{ id: '1', name: 'Fixture One' }]);
  await cache.flush();
  const text = JSON.stringify([...idb.dump(STORE_NAME).stores.values()].map((s) => [...s.rows.values()]));
  assert.doesNotMatch(text, /fixture\.invalid|token|secret|authorization/i);
  cache.close();
});

test('held pictures survive a reopen, and the least recently used goes when the cap is reached', async () => {
  const idb = createFakeIdb();
  let clock = 0;
  const cache = await openMessageCache('https://fixture.invalid', { idb, now: () => (clock += 1) });
  const pic = (id) => ({ id, mime: 'image/jpeg' });
  const bytes = (n) => new Blob([new Uint8Array(n)], { type: 'image/jpeg' });
  const big = 700 * 1024;
  // 48 MiB cap: seventy of these fill it, and the seventy-first pushes out the one used least recently.
  for (let i = 0; i < 70; i += 1) await cache.keepMedia(pic('p' + i), bytes(big));
  assert.ok(await cache.media(pic('p0')), 'reading the first marks it used');
  await cache.keepMedia(pic('p70'), bytes(big));
  assert.equal(await cache.media(pic('p1')), null, 'the least recently used went');
  assert.ok(await cache.media(pic('p0')), 'the one just read stayed');
  assert.ok(cache.mediaBytes() <= 48 * 1024 * 1024);
  assert.equal(await cache.keepMedia({ id: 'v', mime: 'video/mp4' }, bytes(100)), false, 'a video is never held');
  cache.close();
  const again = await openMessageCache('https://fixture.invalid', { idb });
  const back = await again.media(pic('p70'));
  assert.equal(back.size, big);
  assert.equal(back.type, 'image/jpeg');
  again.close();
});

test('a web view with no IndexedDB, or one that refuses it, opens no store', async () => {
  assert.equal(await openMessageCache('https://fixture.invalid', { idb: undefined }), null);
  assert.equal(await openMessageCache('https://fixture.invalid', { idb: createFakeIdb({ refuse: true }) }), null);
  const never = { open: () => ({}) };
  assert.equal(await openDeviceStore({ name: 'x', stores: { a: 'key' }, idb: never, openMs: 20 }), null, 'one that never answers is given up on');
});
