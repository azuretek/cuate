// Issue 66: a late history answer must not erase a live message delivered while it was in flight.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const defined = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { defined[name] = cls; }, get() { return undefined; } };
globalThis.document = { hidden: false, createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
await import('../app/components/app-root.js');
const proto = defined['app-root'].prototype;

test('a history refresh preserves a live message received before its stale answer', async () => {
  const old = { id: 'old', chatId: '1', text: 'Earlier fixture', sentAt: '2026-01-01T00:00:00Z', fromMe: false, attachments: [] };
  const live = { id: 'live', chatId: '1', text: 'Live fixture', sentAt: '2026-01-01T00:00:01Z', fromMe: false, attachments: [] };
  let answer;
  const host = {
    openChatId: '1', messages: [old], chats: [{ id: '1', unread: 0 }], pending: new Map(),
    client: { messages: () => new Promise((resolve) => { answer = resolve; }) },
    reconcile: proto.reconcile, describe: proto.describe,
  };
  const work = proto.open.call(host, '1');
  proto.onEvent.call(host, { name: 'message.new', data: { message: live } });
  assert.ok(host.messages.some((m) => m.id === live.id), 'the real event handler received the message');
  answer({ messages: [old], hasMore: false });
  await work;
  assert.deepEqual(host.messages.map((m) => m.id), ['old', 'live']);
});

test('opening another conversation keeps a live message for it received while its page loads', async () => {
  const shown = { id: 'shown', chatId: '1', text: 'Open fixture', sentAt: '2026-01-01T00:00:00Z', fromMe: false, attachments: [] };
  const old = { id: 'old', chatId: '2', text: 'Earlier fixture', sentAt: '2026-01-01T00:00:00Z', fromMe: false, attachments: [] };
  const live = { id: 'live', chatId: '2', text: 'Live fixture', sentAt: '2026-01-01T00:00:01Z', fromMe: false, attachments: [] };
  let answer;
  const host = {
    openChatId: '1', messages: [shown], chats: [{ id: '1', unread: 0 }, { id: '2', unread: 0 }], pending: new Map(),
    client: { messages: () => new Promise((resolve) => { answer = resolve; }) },
    reconcile: proto.reconcile, describe: proto.describe, bridge: async () => {},
  };
  const work = proto.open.call(host, '2');
  proto.onEvent.call(host, { name: 'message.new', data: { message: live } });
  assert.deepEqual(host.messages.map((m) => m.id), ['shown'], 'the pane keeps the open conversation until the page arrives');
  answer({ messages: [old], hasMore: false });
  await work;
  assert.equal(host.openChatId, '2');
  assert.deepEqual(host.messages.map((m) => m.id), ['old', 'live']);
});
