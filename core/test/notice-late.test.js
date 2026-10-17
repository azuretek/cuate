// A pressed notice whose message has not reached the server yet (issue 414). The press opens the conversation at its
// newest messages, waits a bounded time on the live stream for that message and brings it into view when it lands.
// Past the bound the conversation says the message is still loading, and still brings it into view if it lands later.
// Coming back to the foreground reads the newest messages of the conversation on screen. The real page code runs over
// a stand-in server, with synthetic messages only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initialWindow } from '../app/rules/history-window.js';

const defined = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { defined[name] = cls; }, get() { return undefined; } };
globalThis.document = { hidden: false, visibilityState: 'visible', createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
await import('../app/components/app-root.js');
const proto = defined['app-root'].prototype;
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

const msg = (id, second) => ({ id, chatId: '1', text: 'Fixture ' + id, sentAt: '2026-01-01T00:00:' + String(second).padStart(2, '0') + 'Z', fromMe: false, attachments: [], historyCursor: 'cursor-' + id });

// Waits on a state, never a count: the condition ends it, the deadline only fails it.
async function until(check, what, ms = 2000) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for ' + what);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

// The page as a press drives it: every method is the real one, and the server answers what the test names.
function page(answer) {
  const asked = [];
  const host = {};
  for (const name of Object.getOwnPropertyNames(proto)) {
    const d = Object.getOwnPropertyDescriptor(proto, name);
    if (name !== 'constructor' && typeof d.value === 'function') host[name] = d.value;
  }
  // The shell and the element's own surface are stood in for; everything else is the page's code.
  Object.assign(host, {
    phase: 'ready', chats: [{ id: '1', name: 'Fixture One', unread: 0 }], messages: [], openChatId: null, selecting: null, listOpen: true,
    view: 'messages', dataset: {}, pending: new Map(), problem: '', settings: {},
    client: { messages: async (chatId, options = {}) => { asked.push(options); return answer(options); } },
    bridge: async () => null, querySelector: () => null, closeView() {},
  });
  return { host, asked };
}

test('a notice pressed before its message synced reveals it when it arrives on the live stream', async () => {
  const late = msg('late', 3);
  let synced = false;
  const { host } = page(() => ({ messages: synced ? [msg('a', 1), late] : [msg('a', 1)], hasMore: false }));
  const work = proto.openMessage.call(host, { chatId: '1', messageId: 'late' });
  await until(() => host.openChatId === '1' && host.messages.length, 'the conversation to open');
  // The message reaches the server and the live stream after the press.
  synced = true;
  proto.onEvent.call(host, { name: 'message.new', data: { message: late } });
  assert.equal(await work, true, 'the press lands on its message');
  assert.equal(host.revealing?.id, 'late', 'the late message is brought into view');
  assert.ok(!host.revealing.pending, 'nothing says it is still loading');
  assert.ok(host.messages.some((m) => m.id === 'late'), 'the message is drawn');
});

test('a press over a conversation held scrolled back reads the newest window, not only older pages', async () => {
  const older = [msg('o1', 1), msg('o2', 2)];
  const { host, asked } = page((o) => (o.beforeCursor ? { messages: [], hasMore: false } : { messages: [msg('n1', 8), msg('target', 9)], hasMore: true }));
  host.convos = new Map([['1', { messages: older, hasMore: true, historyWindow: { ...initialWindow(older, { totalCount: 40, hasMore: true }), afterCount: 30, hasNewer: true } }]]);
  host.noticeWaitMs = 50;
  assert.equal(await proto.openMessage.call(host, { chatId: '1', messageId: 'target' }), true, 'the message in the newest window is found');
  assert.equal(host.revealing?.id, 'target');
  assert.ok(host.messages.some((m) => m.id === 'target'), 'the newest window is on screen');
  assert.ok(asked.some((o) => !o.beforeCursor && !o.afterCursor), 'the newest window was asked for');
});

test('past the bound the conversation says the message is still loading, and reveals it if it lands later', async () => {
  const late = msg('late', 5);
  const { host } = page(() => ({ messages: [msg('a', 1)], hasMore: false }));
  host.noticeWaitMs = 30;
  assert.equal(await proto.openMessage.call(host, { chatId: '1', messageId: 'late' }), false, 'the bound passes without the message');
  assert.equal(host.openChatId, '1', 'its conversation is open');
  assert.equal(host.revealing?.id, 'late');
  assert.equal(host.revealing?.pending, true, 'the conversation is told the message is still loading');
  proto.onEvent.call(host, { name: 'message.new', data: { message: late } });
  await until(() => host.revealing && !host.revealing.pending, 'the late message to be revealed');
  assert.equal(host.revealing.id, 'late');
  assert.ok(host.messages.some((m) => m.id === 'late'));
});

test('a press stops waiting when another conversation opens', async () => {
  const { host } = page(() => ({ messages: [msg('a', 1)], hasMore: false }));
  host.chats = [...host.chats, { id: '2', name: 'Fixture Two', unread: 0 }];
  host.noticeWaitMs = 30;
  await proto.openMessage.call(host, { chatId: '1', messageId: 'late' });
  await proto.open.call(host, '2');
  assert.equal(host.revealing, null, 'the other conversation draws no loading line');
  proto.onEvent.call(host, { name: 'message.new', data: { message: msg('late', 5) } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(host.revealing, null, 'nothing is revealed in a conversation that is no longer open');
});

test('returning to the foreground reads the newest window of the conversation on screen', async () => {
  let newest = [msg('a', 1)];
  const { host, asked } = page(() => ({ messages: newest, hasMore: false }));
  await proto.open.call(host, '1');
  newest = [msg('a', 1), msg('while-away', 2)];
  asked.length = 0;
  await proto.onShown.call(host);
  assert.ok(asked.some((o) => !o.beforeCursor && !o.afterCursor), 'the newest window was asked for');
  assert.deepEqual(host.messages.map((m) => m.id), ['a', 'while-away'], 'what landed while away is drawn');
});

test('the page wires the foreground and the conversation draws the still-loading line', () => {
  const root = read('../app/components/app-root.js');
  assert.match(root, /this\.onVisible = \(\) => this\.onShown\(\);/);
  const conv = read('../app/components/app-conversation.js');
  assert.match(conv, /this\.reveal\?\.pending \? html`<div class="reveal-pending" role="status">/);
  assert.match(conv, /changed\.has\('reveal'\) && this\.reveal && !this\.reveal\.pending/, 'a pending reveal moves nothing');
});
