// The first paint waits on one round trip, not three (issue 427): a start asks the server for its info, the
// conversations and the settings together, and draws the list once all three have answered. The boot runs on the real
// page code over a stand-in server that holds every answer until the test gives it, so what was in flight at once is
// what the server saw, not what the code meant to do.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const defined = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { defined[name] = cls; }, get() { return undefined; } };
globalThis.document = { hidden: false, visibilityState: 'visible', createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
await import('../app/components/app-root.js');
const proto = defined['app-root'].prototype;
const { connectionSentence } = await import('../app/rules/connection.js');

const CHATS = [{ id: '1', name: 'Fixture One', isGroup: false, participants: ['+15555550100'], unread: 0, lastMessageAt: '2026-01-02T00:00:00.000Z', lastMessage: { text: 'fixture' } }];
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// A stand-in server whose every answer waits for the test.
function server({ apiVersion = 1, settings = { values: { 'appearance.skin': 'dark' } } } = {}) {
  const open = [];
  globalThis.fetch = (url, { method = 'GET' } = {}) => new Promise((resolve) => {
    const path = new URL(url).pathname;
    const answer = (body) => resolve({ ok: true, status: 200, json: async () => body });
    const replies = { '/api/v1/info': { apiVersion, sending: true }, '/api/v1/chats': { chats: CHATS.map((c) => ({ ...c })) }, '/api/v1/settings': settings };
    open.push({ what: method + ' ' + path, answer: () => answer(replies[path] || {}) });
  });
  globalThis.WebSocket = class { send() {} close() {} };
  return open;
}

function page() {
  const host = {
    phase: 'boot', chats: [], messages: [], openChatId: null, selecting: null, listOpen: true, view: 'messages', dataset: {}, pending: new Map(), settings: {},
    bridge: async () => null,
    applyNoticeQuiet() {}, applyUpdateSetting() {}, applyTheme() {}, registerPush() {}, releaseHeldUpdate() {}, launchCheck() {}, noticeServerUpdate() {}, releaseHeldScreen() {}, takeLink() {}, takeNotice() {},
    onEvent() {}, onConnState() {}, closeView() {}, querySelector() { return null; },
  };
  // The device's store (issue 441) is the page's own code too; with no IndexedDB here it opens none, as a web view that
  // refuses one does.
  for (const name of ['start', 'readSettings', 'describe', 'openStore', 'catchUp']) host[name] = proto[name];
  return host;
}

test('a start asks for the info, the conversations and the settings together, and draws once all three answer (issue 427)', { timeout: 5000 }, async () => {
  const open = server();
  const host = page();
  const started = proto.start.call(host, 'http://fixture.invalid', 'fixture-token');
  await tick();
  assert.deepEqual(open.map((r) => r.what).sort(), ['GET /api/v1/chats', 'GET /api/v1/info', 'GET /api/v1/settings'], 'all three are in flight before any has answered');
  for (const r of open.slice(0, 2)) r.answer();
  await tick();
  assert.notEqual(host.phase, 'ready', 'nothing is drawn until every read has answered');
  open[2].answer();
  await started;
  assert.equal(host.phase, 'ready');
  assert.equal(host.chats.length, 1, 'the list is there');
  assert.equal(host.settings['appearance.skin'], 'dark', 'drawn with the settings the server holds');
  host.client.close();
});

test('a server on another API version is still refused, and nothing it answered is used (issue 427)', { timeout: 5000 }, async () => {
  const open = server({ apiVersion: 99 });
  const host = page();
  const started = proto.start.call(host, 'http://fixture.invalid', 'fixture-token');
  // Answered as they arrive, whichever way the page asks for them.
  for (let i = 0; i < 20 && host.phase === 'loading'; i += 1) {
    await tick();
    for (const r of open.splice(0)) r.answer();
  }
  await started;
  assert.equal(host.phase, 'onboarding');
  assert.equal(host.problem, connectionSentence('version-mismatch'));
  assert.deepEqual(host.chats, [], 'no conversation from that server is drawn');
  assert.equal(host.client, undefined, 'and the page keeps no client for it');
});

test('a server on another API version is refused with the version sentence even when its other reads fail first (issue 427)', { timeout: 5000 }, async () => {
  // A server on another API version may not answer the conversation read in this version's shape at all. Asked for
  // together, that failure can come back before the info does, and the person must still be told the version is wrong.
  const open = [];
  globalThis.fetch = (url) => new Promise((resolve) => {
    const path = new URL(url).pathname;
    if (path === '/api/v1/chats') resolve({ ok: false, status: 404, json: async () => ({ error: { code: 'not_found', message: 'No such route.' } }) });
    else open.push({ path, answer: () => resolve({ ok: true, status: 200, json: async () => (path === '/api/v1/info' ? { apiVersion: 99, sending: true } : { values: {} }) }) });
  });
  globalThis.WebSocket = class { send() {} close() {} };
  const host = page();
  const started = proto.start.call(host, 'http://fixture.invalid', 'fixture-token');
  await tick();
  await tick();
  for (const r of open.splice(0)) r.answer();
  await started;
  assert.equal(host.phase, 'onboarding');
  assert.equal(host.problem, connectionSentence('version-mismatch'));
  assert.deepEqual(host.chats, [], 'no conversation from that server is drawn');
});

test('a settings read that fails still leaves the defaults, and the list is drawn (issue 427)', { timeout: 5000 }, async () => {
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/api/v1/settings') return { ok: false, status: 500, json: async () => ({ error: { code: 'boom', message: 'Synthetic failure.' } }) };
    const body = path === '/api/v1/info' ? { apiVersion: 1, sending: true } : { chats: CHATS.map((c) => ({ ...c })) };
    return { ok: true, status: 200, json: async () => body };
  };
  globalThis.WebSocket = class { send() {} close() {} };
  const host = page();
  await proto.start.call(host, 'http://fixture.invalid', 'fixture-token');
  assert.equal(host.phase, 'ready');
  assert.deepEqual(host.settings, {}, 'the schema defaults stand');
  assert.equal(host.chats.length, 1);
  host.client.close();
});
