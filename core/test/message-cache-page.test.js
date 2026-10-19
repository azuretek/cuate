// The page over the device's store (issue 441), on the real page code over a stand-in server, the way
// fresh-start.test.js drives it. A launch with a populated store draws the conversation list and the conversation it
// opens from the store before any server read answers, asks the server only for what changed since its cursor, reads
// no page of a conversation it holds and that is current, and still draws what changed while it was closed: an edit, an
// unsend, a reaction, a read receipt and a new message. Signing out leaves nothing. Synthetic records only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeIdb } from './fake-idb.js';

const STORE_NAME = 'message-store';

const defined = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { defined[name] = cls; }, get() { return undefined; } };
globalThis.document = { hidden: false, visibilityState: 'visible', createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
await import('../app/components/app-root.js');
const proto = defined['app-root'].prototype;

const URL_ = 'http://fixture.invalid';
const message = (n, extra = {}) => ({ id: 'm-' + n, chatId: '1', fromMe: n % 2 === 0, sender: '+15555550100', text: 'Fixture ' + n, sentAt: '2026-01-01T00:00:' + String(n).padStart(2, '0') + '.000Z', replyTo: null, read: null, attachments: [], link: null, payloads: 0, reactions: [], historyCursor: '1000:' + n, ...extra });
const CHATS = [{ id: '1', name: 'Fixture One', isGroup: false, participants: ['+15555550100'], unread: 0, lastMessageAt: '2026-01-01T00:00:06.000Z', lastMessage: { text: 'Fixture 6' } }];

// The stand-in server: its history, the changes it answers after each cursor, every request recorded, and a gate that
// holds the info read so a test can look at the page before the server has answered anything.
function server() {
  const s = { asked: [], history: [1, 2, 3, 4, 5, 6].map((n) => message(n)), changes: new Map(), gate: null };
  s.changes.set(null, { cursor: 'c1', reset: true, more: false, messages: [], reactions: [], unsent: [], reads: [] });
  globalThis.fetch = async (url, { method = 'GET' } = {}) => {
    const u = new URL(url);
    s.asked.push(method + ' ' + u.pathname + u.search);
    const answer = (body) => ({ ok: true, status: 200, json: async () => body });
    if (u.pathname === '/api/v1/info') { if (s.gate) await s.gate; return answer({ apiVersion: 1, sending: true }); }
    if (u.pathname === '/api/v1/chats') return answer({ chats: CHATS.map((c) => ({ ...c })) });
    if (u.pathname === '/api/v1/settings') return answer({ values: {} });
    if (u.pathname === '/api/v1/changes') {
      const since = u.searchParams.get('since');
      return answer(s.changes.get(since) || { cursor: since, more: false, messages: [], reactions: [], unsent: [], reads: [] });
    }
    if (u.pathname === '/api/v1/chats/1/messages') return answer({ messages: s.history.map((m) => ({ ...m })), hasMore: false, totalCount: s.history.length });
    if (/\/read$/.test(u.pathname)) return answer({ chatId: '1', unread: 0 });
    return answer({});
  };
  globalThis.WebSocket = class { send() {} close() {} };
  return s;
}

function page() {
  const host = {
    phase: 'loading', chats: [], messages: [], openChatId: null, selecting: null, listOpen: true, view: 'messages', dataset: {}, pending: new Map(),
    bridge: async () => null,
    applyNoticeQuiet() {}, applyUpdateSetting() {}, applyTheme() {}, registerPush() {}, releaseHeldUpdate() {}, launchCheck() {}, noticeServerUpdate() {}, releaseHeldScreen() {},
    onEvent() {}, onConnState() {}, closeView() {}, querySelector() { return null; }, resetTyping() {}, clearTyping() {},
  };
  for (const name of ['loadCachedFavourites', 'syncFavourites', 'flushFavourites', 'migrateFavourites', 'resetFavourites', 'queueFavouriteChange', 'favouriteEmoji', 'forgetEmoji', 'adoptFavouriteList', 'start', 'open', 'readSettings', 'describe', 'takeNotice', 'takeLink', 'loadOlder', 'loadHistory', 'applyWindow', 'measureHistory', 'reconcile', 'openStore', 'catchUp', 'showChanges', 'storedWindow', 'keepShown', 'receiveHistoryMessage', 'signOut', 'stopNoticeWait']) {
    if (typeof proto[name] === 'function') host[name] = proto[name];
  }
  return host;
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
const until = async (check, what) => {
  for (let i = 0; i < 400; i += 1) { if (check()) return; await tick(); }
  throw new Error('timed out waiting for ' + what);
};

test('a launch over a populated store draws from it before the server answers, and asks only for what changed', async () => {
  const idb = createFakeIdb();
  globalThis.indexedDB = idb;
  try {
    // The first launch, with an empty store: the conversation is read from the server, and the store takes its head.
    const s = server();
    const cold = page();
    await cold.start(URL_, 'fixture-token');
    await cold.open('1');
    cold.keepShown();
    await cold.cache.flush();
    assert.ok(s.asked.includes('GET /api/v1/changes'), 'a store with no cursor asks the server for its head');
    assert.ok(s.asked.includes('GET /api/v1/chats/1/messages?limit=50&includeTotal=true'), 'and reads the conversation it does not hold');
    cold.client.close();
    cold.cache.close();

    // Then, while the app is closed, the conversation changes in every way it can.
    s.changes.set('c1', {
      cursor: 'c2', more: false,
      messages: [message(3, { text: 'Fixture 3 edited', edited: true }), message(7, { text: 'Fixture 7 new' })],
      reactions: [{ chatId: '1', targetId: 'm-2', type: 'love', emoji: null, add: true, fromMe: false, sender: '+15555550100' }],
      unsent: [{ id: 'm-5', chatId: '1' }],
      reads: [{ id: 'm-6', chatId: '1', readAt: '2026-01-01T00:01:00.000Z' }],
    });

    // The second launch: the server is slow to answer anything at all.
    s.asked.length = 0;
    let release;
    s.gate = new Promise((resolve) => { release = resolve; });
    const warm = page();
    const started = warm.start(URL_, 'fixture-token');
    await until(() => warm.phase === 'ready', 'the list from the store');
    assert.deepEqual(warm.chats.map((c) => c.id), ['1'], 'the conversation list is drawn from the store');
    const opened = warm.open('1');
    await until(() => warm.messages.length > 0, 'the conversation from the store');
    // The start's three reads are asked for together (issue 427); none has answered.
    assert.deepEqual([...s.asked].sort(), ['GET /api/v1/chats', 'GET /api/v1/info', 'GET /api/v1/settings'], 'and so is the conversation, before the server has answered anything');
    assert.equal(warm.messages.at(-1).id, 'm-6');
    release();
    await started;
    await opened;
    await warm.cache.flush();

    assert.ok(s.asked.includes('GET /api/v1/changes?since=c1'), 'the server is asked what changed since the cursor the store held');
    assert.deepEqual(s.asked.filter((a) => a.includes('/messages')), [], 'and no page of a conversation the store holds and is current');
    const byId = new Map(warm.messages.map((m) => [m.id, m]));
    assert.equal(byId.get('m-3').text, 'Fixture 3 edited', 'an edit made while away is drawn');
    assert.equal(byId.has('m-5'), false, 'an unsend made while away is drawn');
    assert.deepEqual(byId.get('m-2').reactions.map((r) => r.type), ['love'], 'and a reaction');
    assert.equal(byId.get('m-6').readAt, '2026-01-01T00:01:00.000Z', 'and a read receipt');
    assert.equal(warm.messages.at(-1).id, 'm-7', 'and a new message');
    assert.equal(warm.cache.cursor, 'c2', 'the store now stands at the cursor that answer ended at');

    // Signing out leaves nothing on the device.
    await warm.signOut('');
    const rows = [...idb.dump(STORE_NAME).stores.values()].reduce((n, st) => n + st.rows.size, 0);
    assert.equal(rows, 0);
  } finally {
    delete globalThis.indexedDB;
  }
});

test('a cursor the server cannot honour empties the store, and the conversation is read again', async () => {
  const idb = createFakeIdb();
  globalThis.indexedDB = idb;
  try {
    const s = server();
    const first = page();
    await first.start(URL_, 'fixture-token');
    await first.open('1');
    await first.cache.flush();
    first.client.close();
    first.cache.close();
    // Another Mac, or a rebuilt history: the old cursor means nothing there.
    s.changes.set('c1', { cursor: 'x1', reset: true, more: false, messages: [], reactions: [], unsent: [], reads: [] });
    s.asked.length = 0;
    const next = page();
    await next.start(URL_, 'fixture-token');
    await next.open('1');
    assert.equal(next.cache.cursor, 'x1');
    assert.deepEqual(s.asked.filter((a) => a.includes('/messages')), ['GET /api/v1/chats/1/messages?limit=50&includeTotal=true']);
    next.client.close();
    next.cache.close();
  } finally {
    delete globalThis.indexedDB;
  }
});

test('with no IndexedDB the page reads as it always has', async () => {
  const s = server();
  const host = page();
  await host.start(URL_, 'fixture-token');
  await host.open('1');
  assert.equal(host.cache, null);
  assert.deepEqual(s.asked.filter((a) => a.includes('/changes')), [], 'no store, no changes asked');
  assert.equal(s.asked.filter((a) => a.includes('/messages')).length, 1);
  host.client.close();
});
