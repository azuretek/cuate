// A fresh start shows the chats list and marks nothing read (issue 373): signing in opens no conversation, because
// opening one reads it here and on the Mac, and only a notice press or a messaging link that launched the app opens
// its own. The boot runs on the real page code over a stand-in server, so what it asks the server is what is checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const defined = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { defined[name] = cls; }, get() { return undefined; } };
globalThis.document = { hidden: false, visibilityState: 'visible', createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
await import('../app/components/app-root.js');
const proto = defined['app-root'].prototype;
const source = readFileSync(new URL('../app/components/app-root.js', import.meta.url), 'utf8');

// Longer than the page's read coalescing (READ_COALESCE_MS), so a read the boot asked for has been sent by then.
const READ_SETTLE_MS = 800;
const settle = () => new Promise((resolve) => setTimeout(resolve, READ_SETTLE_MS));

// Synthetic conversations, both unread, the first the newest so it tops the list.
const CHATS = [
  { id: '1', name: 'Fixture One', isGroup: false, participants: ['+15555550100'], unread: 2, lastMessageAt: '2026-01-02T00:00:00.000Z', lastMessage: { text: 'newest fixture' } },
  { id: '2', name: 'Fixture Two', isGroup: false, participants: ['+15555550101'], unread: 1, lastMessageAt: '2026-01-01T00:00:00.000Z', lastMessage: { text: 'older fixture' } },
];

// A stand-in server: every request is recorded, and each answers the API's own shape.
function server() {
  const asked = [];
  globalThis.fetch = async (url, { method = 'GET' } = {}) => {
    const path = new URL(url).pathname;
    asked.push(method + ' ' + path);
    const answer = (body) => ({ ok: true, status: 200, json: async () => body });
    if (path === '/api/v1/info') return answer({ apiVersion: 1, sending: true });
    if (path === '/api/v1/chats') return answer({ chats: CHATS.map((c) => ({ ...c })) });
    if (path === '/api/v1/settings') return answer({ values: {} });
    const messages = /^\/api\/v1\/chats\/([^/]+)\/messages$/.exec(path);
    if (messages) return answer({ messages: [{ id: 'm-' + messages[1], chatId: messages[1], text: 'fixture', fromMe: false, sentAt: '2026-01-02T00:00:00.000Z', attachments: [] }], hasMore: false });
    const read = /^\/api\/v1\/chats\/([^/]+)\/read$/.exec(path);
    if (read) return answer({ chatId: read[1], unread: 0 });
    return answer({});
  };
  globalThis.WebSocket = class { send() {} close() {} };
  return asked;
}

// The page as the boot drives it: the real sign-in, open, notice and link code, with the shell's bridge answering
// what the test names and every unrelated launch step stood down.
function page({ notice = null } = {}) {
  let held = notice;
  const host = {
    phase: 'loading', chats: [], messages: [], openChatId: null, selecting: null, listOpen: true, view: 'messages', dataset: {}, pending: new Map(),
    bridge: async (name) => {
      if (name === 'notify.take') { const n = held; held = null; return n; }
      return null;
    },
    applyNoticeQuiet() {}, applyUpdateSetting() {}, applyTheme() {}, registerPush() {}, releaseHeldUpdate() {}, launchCheck() {}, noticeServerUpdate() {}, releaseHeldScreen() {},
    onEvent() {}, onConnState() {}, closeView() {}, querySelector() { return null; },
  };
  for (const name of ['loadCachedFavourites', 'syncFavourites', 'flushFavourites', 'migrateFavourites', 'resetFavourites', 'queueFavouriteChange', 'favouriteEmoji', 'forgetEmoji', 'adoptFavouriteList', 'start', 'open', 'readSettings', 'describe', 'takeNotice', 'openMessage', 'revealNotice', 'watchNotice', 'stopNoticeWait', 'takeLink', 'clearTyping', 'resetTyping', 'loadOlder', 'loadHistory', 'applyWindow', 'measureHistory', 'reconcile', 'openStore', 'catchUp', 'showChanges', 'storedWindow', 'keepShown']) {
    if (typeof proto[name] === 'function') host[name] = proto[name];
  }
  return host;
}

test('a fresh start opens no conversation and sends no read', async () => {
  const asked = server();
  const host = page();
  await proto.start.call(host, 'http://fixture.invalid', 'fixture-token');
  await settle();
  assert.equal(host.phase, 'ready');
  assert.equal(host.chats.length, 2, 'the list is there');
  assert.equal(host.openChatId, null, 'nothing is open');
  assert.equal(host.selecting, null, 'nothing is selected');
  assert.equal(host.listOpen, true, 'a phone shows the list');
  assert.deepEqual(host.chats.map((c) => c.unread), [2, 1], 'every count is as the server gave it');
  assert.deepEqual(asked.filter((a) => a.endsWith('/read')), [], 'nothing was read on the Mac');
  assert.deepEqual(asked.filter((a) => a.endsWith('/messages')), [], 'no conversation was even fetched');
  host.client.close();
});

test('a notice press that launched the app still opens its conversation, and reads only that one', async () => {
  const asked = server();
  const host = page({ notice: { chatId: '2', messageId: 'm-2' } });
  await proto.start.call(host, 'http://fixture.invalid', 'fixture-token');
  for (let i = 0; i < 50 && host.openChatId !== '2'; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  await settle();
  assert.equal(host.openChatId, '2', 'the pressed conversation is open');
  assert.equal(host.problem, '', 'opening the notice reported no swallowed error');
  assert.equal(host.messages.length, 1, 'the requested history is actually installed');
  assert.equal(host.listOpen, false, 'a phone shows it rather than the list');
  assert.deepEqual(asked.filter((a) => a.endsWith('/read')), ['POST /api/v1/chats/2/read'], 'only the pressed conversation was read');
  assert.equal(host.chats.find((c) => c.id === '1').unread, 2, 'the newest conversation stays unread');
  host.client.close();
});

test('a start over a conversation already on screen keeps that one open, and opens no other', async () => {
  const asked = server();
  const host = page();
  host.openChatId = '2';
  await proto.start.call(host, 'http://fixture.invalid', 'fixture-token');
  await settle();
  assert.equal(host.openChatId, '2', 'the conversation on screen stays');
  assert.equal(host.problem, '', 'refresh reported no swallowed error');
  assert.equal(host.messages.length, 1, 'refresh installed the history');
  assert.deepEqual(asked.filter((a) => a.endsWith('/messages')), ['GET /api/v1/chats/2/messages'], 'only that one is refreshed');
  assert.deepEqual(asked.filter((a) => a.endsWith('/read')), ['POST /api/v1/chats/2/read'], 'the top conversation is not read');
  host.client.close();
});

test('the boot opens nothing of its own, and the empty pane asks for a choice under the window strip', () => {
  const ready = source.indexOf("this.dataset.state = 'ready';");
  const boot = source.slice(source.indexOf('  async start(url, token) {'), ready);
  assert.doesNotMatch(boot, /this\.chats\[0\]/, 'sign-in never picks a conversation of its own');
  assert.doesNotMatch(source, /No conversation selected\./);
  assert.match(source, /const EMPTY_PANE = 'Choose a conversation[^']*';/);
  assert.match(source, /<header class="conv-head conv-head--empty">\$\{this\.emptyControls\(\)\}<\/header><div class="empty">\$\{EMPTY_PANE\}<\/div>/);
  // Coming back from the background reads the conversation that is open and changes nothing about which one it is.
  assert.match(source, /if \(pageHidden\(\) \|\| !this\.openChatId\) return;/);
});
