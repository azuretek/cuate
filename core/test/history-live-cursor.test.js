// Issue 537 (reported live on the desktop): scrolled back in a conversation, a message arrived by the live stream, and
// scrolling back down showed Load newer messages with "Update the message engine to browse the whole conversation." A
// live message carries no history cursor from a server that does not add one, the window lays it in as its newest
// message, and an older page that evicts the newest messages leaves the window ending on one. Paging newer must still
// work, from the newest message in the window that has a cursor, and the engine banner is only for an engine with none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { olderFromHeld } from '../app/rules/message-store.js';

const defined = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { defined[name] = cls; }, get() { return undefined; } };
globalThis.document = { hidden: false, createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
await import('../app/components/app-root.js');
const root = defined['app-root'].prototype;

const TOTAL = 1000;
const LIVE = 140;
const cursorOf = (n) => '800000000000000000:' + n;
// The server's view: every row has a cursor. What the live stream handed this client had none.
const row = (n) => ({ id: 'SYNTHETIC-' + n, chatId: '1', text: 'Synthetic ' + n, sentAt: new Date(Date.UTC(2026, 0, 1) + n * 60000).toISOString(), fromMe: false, attachments: [], historyCursor: cursorOf(n) });
const all = Array.from({ length: TOTAL + LIVE }, (_, i) => row(i + 1));
const live = (n) => { const m = row(n); delete m.historyCursor; return m; };
const index = (cursor) => all.findIndex((m) => m.historyCursor === cursor);

function host() {
  const asked = [];
  const messages = all.slice(TOTAL - 150, TOTAL);
  const pane = { keep: { anchor: { end: true } }, historyMeasurements: () => ({ heights: [], estimate: 40 }) };
  const h = {
    openChatId: '1', openSeq: 1, pendingHistory: false, messages, hasMore: true, chats: [{ id: '1', unread: 0 }], cache: null, problem: '',
    historyWindow: { messages, beforeCount: TOTAL - 150, afterCount: 0, beforeHeight: (TOTAL - 150) * 40, afterHeight: 0, estimate: 40, hasOlder: true, hasNewer: false },
    querySelector: (sel) => (sel === 'app-conversation' ? pane : null),
    client: {
      messages: async (chatId, o) => {
        asked.push(o);
        const at = o.beforeCursor ? index(o.beforeCursor) : index(o.afterCursor);
        const page = o.beforeCursor ? all.slice(Math.max(0, at - o.limit), at) : all.slice(at + 1, at + 1 + o.limit);
        const hasMore = o.beforeCursor ? at - o.limit > 0 : at + 1 + o.limit < all.length;
        return { messages: page.map((m) => ({ ...m })), hasMore };
      },
    },
    describe: root.describe, applyWindow: root.applyWindow, loadHistory: root.loadHistory, receiveHistoryMessage: root.receiveHistoryMessage, countedLive: root.countedLive,
  };
  return { h, asked, pane };
}

test('a window ending on live messages with no cursor still pages newer, from the newest message that has one (issue 537)', async () => {
  const { h, asked, pane } = host();
  // At the newest message, sixty messages arrive by the live stream, each without a cursor.
  for (let n = TOTAL + 1; n <= TOTAL + LIVE; n += 1) h.receiveHistoryMessage(live(n));
  assert.equal(h.messages.at(-1).id, 'SYNTHETIC-' + (TOTAL + LIVE));
  assert.equal(h.messages.length, 150);
  // The person scrolls back: an older page lands and the newest fifty messages are evicted, so the window now ends on a
  // live message with no cursor.
  pane.keep.anchor = { key: h.messages[20].id, offset: 0 };
  assert.equal(await h.loadHistory('older'), true);
  assert.equal(h.historyWindow.hasNewer, true);
  assert.equal(h.messages.at(-1).historyCursor, undefined, 'the window ends on a live message with no cursor');
  // Scrolling back down asks for the newer page, from the newest message in the window that has a cursor, in one read
  // long enough to bring the live messages again with their cursors and a whole page past the edge.
  const before = asked.length;
  const bare = h.messages.length - 1 - h.messages.findLastIndex((m) => m.historyCursor);
  assert.ok(bare > 50, 'more live messages past the last cursor than a page holds');
  assert.equal(await h.loadHistory('newer'), true, 'the newer page lands');
  assert.equal(asked.length - before, 1, 'one read, never a chain of them');
  assert.equal(asked.at(-1).limit, 50 + bare, 'the page reaches a whole page past the edge');
  assert.equal(h.problem, '', 'no engine banner for an engine that pages');
  assert.equal(asked.at(-1).afterCursor, cursorOf(TOTAL), 'asked from the newest message that has a cursor');
  const ids = h.messages.map((m) => Number(m.id.split('-')[1]));
  assert.deepEqual(ids, Array.from({ length: ids.length }, (_, i) => ids[0] + i), 'no gap and no duplicate in the window');
  assert.ok(ids.at(-1) > TOTAL + 10, 'the window moved past where it ended');
  assert.ok(h.messages.length <= 150);
  assert.equal(ids[0] - 1 + ids.length + h.historyWindow.afterCount, TOTAL + LIVE, 'the counts still add up to the conversation');
  // And on to the newest message.
  while (h.historyWindow.hasNewer) assert.equal(await h.loadHistory('newer'), true);
  assert.equal(h.messages.at(-1).id, 'SYNTHETIC-' + (TOTAL + LIVE));
  assert.equal(h.historyWindow.afterCount, 0);
});

// Issue 537, with #536's prefetch: a newer page was on its way when a live message arrived and was counted past the window.
// The page, asked before the message existed, answered that nothing is newer, and the window dropped its count and Load
// newer with it, so the message did not show until the conversation was opened again.
test('a live message counted while a newer page is on its way stays counted until a page brings it (issue 537)', async () => {
  const { h, asked } = host();
  const server = all.slice(0, TOTAL);
  let open;
  const gate = new Promise((resolve) => { open = resolve; });
  h.client.messages = async (chatId, o) => {
    asked.push(o);
    const at = server.findIndex((m) => m.historyCursor === o.afterCursor);
    const page = { messages: server.slice(at + 1, at + 1 + o.limit).map((m) => ({ ...m })), hasMore: at + 1 + o.limit < server.length };
    if (asked.length === 1) await gate;
    return page;
  };
  // Scrolled back: the window ends fifty messages before the newest.
  const shown = all.slice(TOTAL - 200, TOTAL - 50);
  h.messages = shown;
  h.historyWindow = { ...h.historyWindow, messages: shown, beforeCount: TOTAL - 200, beforeHeight: (TOTAL - 200) * 40, afterCount: 50, afterHeight: 50 * 40, hasNewer: true };
  const landing = h.loadHistory('newer');
  // While that page is on its way, a message arrives and is counted past the window.
  server.push(row(TOTAL + 1));
  h.receiveHistoryMessage(live(TOTAL + 1));
  open();
  assert.equal(await landing, true);
  assert.equal(h.messages.at(-1).id, 'SYNTHETIC-' + TOTAL, 'the page brought what the server had when asked');
  assert.equal(h.historyWindow.hasNewer, true, 'Load newer stays for the message still to come');
  assert.equal(h.historyWindow.afterCount, 1);
  // The next page brings it, and then nothing is left newer.
  assert.equal(await h.loadHistory('newer'), true);
  assert.equal(h.messages.at(-1).id, 'SYNTHETIC-' + (TOTAL + 1));
  assert.equal(h.historyWindow.hasNewer, false);
  assert.equal(h.historyWindow.afterCount, 0);
});

// Issue 537, on a device that kept messages before the fix (#441): a message stored from the live stream has no cursor in
// the device's store and keeps none. The held read stops at it, so the server reads that stretch, with its cursors.
test('the held read stops at a stored message with no cursor, and the server reads that stretch (issue 537)', async () => {
  const stored = all.slice(0, TOTAL).map((m, i) => (i >= 850 && i < 900 ? live(i + 1) : m));
  assert.deepEqual(olderFromHeld({ messages: stored, hasOlder: false }, 'SYNTHETIC-951', 50, { cursors: true }).messages.map((m) => m.id), stored.slice(900, 950).map((m) => m.id), 'a stretch with cursors is drawn from the store');
  assert.equal(olderFromHeld({ messages: stored, hasOlder: false }, 'SYNTHETIC-921', 50, { cursors: true }).messages.length, 20, 'up to the message with no cursor');
  assert.equal(olderFromHeld({ messages: stored, hasOlder: false }, 'SYNTHETIC-921', 50).messages.length, 50, 'a window that pages by no cursor reads the store as before');
  const { h, asked } = host();
  h.cache = { heldNow: () => ({ messages: stored, hasOlder: false }), keep() {} };
  const shown = all.slice(900, 1000);
  h.messages = shown;
  h.historyWindow = { ...h.historyWindow, messages: shown, beforeCount: 900, beforeHeight: 900 * 40 };
  assert.equal(await h.loadHistory('older'), true);
  assert.equal(asked.length, 1, 'the server was asked');
  assert.equal(asked[0].beforeCursor, cursorOf(901));
  assert.ok(h.messages.every((m) => m.historyCursor), 'every message in the window has its cursor');
  assert.equal(h.messages[0].id, 'SYNTHETIC-851');
});

test('the engine banner is for a window with no cursor at all, never for one that has one (issue 537)', async () => {
  const { h } = host();
  for (const m of h.messages) delete m.historyCursor;
  h.historyWindow.hasNewer = true;
  h.historyWindow.afterCount = 10;
  assert.equal(await h.loadHistory('newer'), false);
  assert.match(h.problem, /Update the message engine/);
});
