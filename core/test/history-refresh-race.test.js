// Issue 504: a refresh of the conversation on screen and a page of history in flight at the same time. A window shown
// again re-opens its conversation while the person scrolls, and on the Windows packaged leg that refresh began before
// one page landed and answered while the next was in flight. It put the window back where it was when it began, and
// the next page was then laid against the window held at its ask, which left a gap where the message being read was.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const defined = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { defined[name] = cls; }, get() { return undefined; } };
globalThis.document = { hidden: false, createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
await import('../app/components/app-root.js');
const proto = defined['app-root'].prototype;

const message = (n) => ({ id: 'SYNTHETIC-' + n, chatId: '1', text: 'Synthetic ' + n, sentAt: '2026-01-01T00:00:00.000Z', fromMe: false, attachments: [], historyCursor: '800000000000000000:' + n });
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => message(from + i));
const ids = (list) => list.map((m) => Number(m.id.split('-')[1]));
// Every id from the first to the last, once each: a window with a gap in it fails this.
const contiguous = (list) => ids(list).every((n, i, all) => i === 0 || n === all[i - 1] + 1);
const turn = () => new Promise((resolve) => setImmediate(resolve));

// The page, scrolled back over 801 to 950 with fifty newer messages past its end: where the Windows run stood.
function host() {
  const asks = [];
  const messages = range(801, 950);
  const historyWindow = { messages, beforeCount: 800, afterCount: 50, beforeHeight: 800, afterHeight: 50, estimate: 1, hasOlder: true, hasNewer: true };
  const page = {
    openChatId: '1', openSeq: 1, pendingHistory: false, messages, hasMore: true, historyWindow,
    chats: [{ id: '1', unread: 0 }], cache: null, convos: new Map(), arrivals: new Set(), noticeWait: null, typingChat: null,
    client: { messages: (chatId, options) => new Promise((resolve) => { asks.push({ options, answer: resolve }); }) },
    resetTyping() {}, clearTyping() {}, querySelector() { return null; },
    describe: proto.describe, applyWindow: proto.applyWindow, open: proto.open, loadHistory: proto.loadHistory,
  };
  // The latest ask of a kind still unanswered: the newest page (a refresh) or a page before a cursor.
  const ask = (kind) => {
    const found = asks.filter((a) => !a.done && (kind === 'newest' ? !a.options.beforeCursor && !a.options.afterCursor : a.options[kind])).at(-1);
    found.done = true;
    return found;
  };
  return { page, ask };
}
// What the page holds for its conversation after every render (app-root updated()), which a later open starts from.
const remember = (page) => page.convos.set('1', { messages: page.messages, hasMore: page.hasMore, historyWindow: { ...page.historyWindow, messages: page.messages } });

test('a refresh that began before a page landed keeps that page when it answers', async () => {
  const { page, ask } = host();
  // Where the window stood when the refresh began, one page newer than the person has since scrolled to.
  page.messages = range(851, 1000);
  page.historyWindow = { messages: page.messages, beforeCount: 850, afterCount: 0, beforeHeight: 850, afterHeight: 0, estimate: 1, hasOlder: true, hasNewer: false };
  remember(page);
  const refresh = page.open('1');
  await turn();
  // The person scrolls back a page while the refresh is in flight.
  const older = page.loadHistory('older');
  ask('beforeCursor').answer({ messages: range(801, 850), hasMore: true });
  assert.equal(await older, true);
  assert.deepEqual([page.messages[0].id, page.messages.at(-1).id], ['SYNTHETIC-801', 'SYNTHETIC-950']);
  remember(page);
  // The next page is asked for, and the refresh answers with the newest page while it is in flight.
  const next = page.loadHistory('older');
  ask('newest').answer({ messages: range(951, 1000), hasMore: true, totalCount: 1000 });
  await refresh;
  assert.equal(page.messages[0].id, 'SYNTHETIC-801', 'the window stays on the page the person scrolled to');
  assert.equal(page.messages.at(-1).id, 'SYNTHETIC-950');
  assert.ok(page.messages.some((m) => m.id === 'SYNTHETIC-826'), 'the message being read is still drawn');
  assert.equal(page.historyWindow.afterCount, 50);
  ask('beforeCursor').answer({ messages: range(751, 800), hasMore: true });
  assert.equal(await next, true);
  assert.deepEqual([page.messages[0].id, page.messages.at(-1).id], ['SYNTHETIC-751', 'SYNTHETIC-900']);
  assert.ok(page.messages.some((m) => m.id === 'SYNTHETIC-826'), 'the message being read is still drawn');
  assert.ok(contiguous(page.messages), 'no gap in the window: ' + JSON.stringify(ids(page.messages)));
});

test('a page whose window moved while it was in flight is not laid against the old window', async () => {
  const { page, ask } = host();
  const older = page.loadHistory('older');
  // Another writer moves the window one page newer while the older page is in flight.
  page.applyWindow({ messages: range(851, 1000), beforeCount: 850, afterCount: 0, beforeHeight: 850, afterHeight: 0, estimate: 1, hasOlder: true, hasNewer: false });
  ask('beforeCursor').answer({ messages: range(751, 800), hasMore: true });
  assert.equal(await older, false, 'the page no longer meets the window');
  assert.deepEqual([page.messages[0].id, page.messages.at(-1).id], ['SYNTHETIC-851', 'SYNTHETIC-1000']);
  assert.ok(contiguous(page.messages), 'no gap in the window: ' + JSON.stringify(ids(page.messages)));
  assert.equal(page.pendingHistory, false);
});

test('a page lands on the window as it is now, keeping counts that changed while it was in flight', async () => {
  const { page, ask } = host();
  const older = page.loadHistory('older');
  // A live message past the end of a window scrolled back is counted, not drawn (receiveHistoryMessage).
  page.historyWindow = { ...page.historyWindow, afterCount: 51, afterHeight: 51 };
  ask('beforeCursor').answer({ messages: range(751, 800), hasMore: true });
  assert.equal(await older, true);
  assert.deepEqual([page.messages[0].id, page.messages.at(-1).id], ['SYNTHETIC-751', 'SYNTHETIC-900']);
  assert.equal(page.historyWindow.afterCount, 101, 'the live message and the fifty evicted rows are all counted');
  assert.equal(page.historyWindow.beforeCount, 750);
});
