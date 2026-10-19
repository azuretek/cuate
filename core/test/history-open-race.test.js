// Issue 484: an older page still in flight when the same conversation is opened again must land, not be thrown
// away. A window shown again re-opens the conversation without leaving it, and the person is waiting for the page
// their scroll asked for.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const defined = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { defined[name] = cls; }, get() { return undefined; } };
globalThis.document = { hidden: false, createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
await import('../app/components/app-root.js');
const proto = defined['app-root'].prototype;

const message = (n) => ({ id: 'SYNTHETIC-' + n, chatId: '1', text: 'Synthetic ' + n, sentAt: '2026-01-01T00:00:00.000Z', fromMe: false, attachments: [], historyCursor: '800000000000000000:' + n });
const host = (overrides = {}) => {
  const messages = Array.from({ length: 50 }, (_, i) => message(951 + i));
  return Object.assign({
    openChatId: '1',
    openSeq: 1,
    pendingHistory: false,
    messages,
    hasMore: true,
    historyWindow: { messages, beforeCount: 950, afterCount: 0, beforeHeight: 950, afterHeight: 0, estimate: 1, hasOlder: true, hasNewer: false },
    chats: [{ id: '1', unread: 0 }, { id: '2', unread: 0 }],
    cache: null,
    client: { messages: () => new Promise((resolve) => { overrides.answer = resolve; }) },
    describe: proto.describe,
    applyWindow: proto.applyWindow,
  }, overrides);
};

test('an older page lands when the same conversation is opened again while it is in flight', async () => {
  const options = {};
  const testHost = host(options);
  const work = proto.loadHistory.call(testHost, 'older');
  // A window shown again opens the same conversation without leaving it, which moves the open sequence on.
  testHost.openSeq = 2;
  options.answer({ messages: Array.from({ length: 50 }, (_, i) => message(901 + i)), hasMore: true });
  assert.equal(await work, true, 'the page the scroll asked for is kept');
  assert.equal(testHost.messages[0].id, 'SYNTHETIC-901');
  assert.equal(testHost.messages.length, 100);
  assert.equal(testHost.pendingHistory, false);
});

test('a page for a conversation the person has left is still discarded', async () => {
  const options = {};
  const testHost = host(options);
  const work = proto.loadHistory.call(testHost, 'older');
  testHost.openChatId = '2';
  options.answer({ messages: Array.from({ length: 50 }, (_, i) => message(901 + i)), hasMore: true });
  assert.equal(await work, false, 'another conversation is never answered with this page');
  assert.equal(testHost.messages[0].id, 'SYNTHETIC-951');
  assert.equal(testHost.messages.length, 50);
});
