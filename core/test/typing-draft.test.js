// Issue 230: our own typing is told to the server while we compose in a conversation, and cleared the moment the
// draft empties or the message sends. A fast typist is throttled, nothing is sent with no conversation open, and a
// stop is only ever sent for a conversation we actually said we were typing in.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const defined = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { defined[name] = cls; }, get() { return undefined; } };
globalThis.document = { hidden: false, createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
await import('../app/components/app-root.js');
const proto = defined['app-root'].prototype;

function host(chatId = '1') {
  const sent = [];
  return {
    sent,
    openChatId: chatId,
    client: { typing: (id, typing) => { sent.push([id, typing]); return Promise.resolve(); } },
    typingChat: null, typingSentAt: 0, typingTimer: null,
    onDraft: proto.onDraft, relayTyping: proto.relayTyping, clearTyping: proto.clearTyping,
  };
}

test('composing tells the server, and emptying the draft clears it at once', () => {
  const h = host('1');
  h.onDraft({ empty: false });
  assert.deepEqual(h.sent, [['1', true]]);
  h.onDraft({ empty: true });
  assert.deepEqual(h.sent, [['1', true], ['1', false]]);
  assert.equal(h.typingChat, null);
});

test('a fast typist is throttled to one report while the draft stays full', () => {
  const h = host('1');
  h.onDraft({ empty: false });
  h.onDraft({ empty: false });
  h.onDraft({ empty: false });
  assert.equal(h.sent.filter((s) => s[1] === true).length, 1);
});

test('an empty draft in a conversation we never reported typing in sends nothing', () => {
  const h = host('1');
  h.onDraft({ empty: true });
  assert.deepEqual(h.sent, []);
});

test('typing is never sent with no conversation open', () => {
  const h = host(null);
  h.onDraft({ empty: false });
  assert.deepEqual(h.sent, []);
});

test('sending a message ends our typing for that conversation', async () => {
  const sent = [];
  const h = {
    openChatId: '1', messages: [], pending: new Map(),
    client: { typing: (id, typing) => { sent.push([id, typing]); return Promise.resolve(); }, send: async () => ({ messageId: 'm1' }) },
    typingChat: '1', typingTimer: null,
    clearTyping: proto.clearTyping, mark: proto.mark, describe: proto.describe,
  };
  const ok = await proto.send.call(h, { text: 'hi' });
  assert.equal(ok, true);
  assert.deepEqual(sent, [['1', false]], 'the stop goes out before the message is sent');
});
