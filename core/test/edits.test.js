// Edited messages (issue 391): an edit made on any device replaces the message's words in the open conversation and the
// chat list's preview, live, marked Edited, and the mark is kept on reload; and Edit is offered on your own message on the
// message service within its fifteen-minute window, only where the engine can edit, never on SMS or RCS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { messageActions, editRefusal, applyEdit, EDIT_WINDOW_MS } from '../app/rules/messages.js';
import { applyEditToChats, chatPreview } from '../app/rules/chats.js';
import { platformCapabilities } from '../app/rules/platform.js';

const defined = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { defined[name] = cls; }, get() { return undefined; } };
globalThis.document = { createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
await import('../app/components/app-root.js');
const AppRoot = defined['app-root'];
const conversation = defined['app-conversation'].prototype;
const composer = defined['app-composer'].prototype;

// The Lit template as the text it would draw, nested templates included, without a browser.
function words(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(words).join('');
  if (value?.strings) return value.strings.map((s, i) => s + words(value.values[i])).join('');
  return '';
}

const sentAt = '2026-01-15T10:04:00.000Z';
const NOW = Date.parse(sentAt) + 60 * 1000;
const msg = (o) => ({ id: 'FAKE-0001', chatId: '1', fromMe: true, sender: null, senderName: null, text: 'Synthetic first words', sentAt, replyTo: null, attachments: [], reactions: [], payloads: 0, link: null, ...o });

test('Edit is offered on your own text message on the message service within fifteen minutes, only where the engine can edit', () => {
  const own = msg({});
  assert.deepEqual(messageActions(own, { sending: true, edit: true, now: NOW }), ['react', 'edit']);
  assert.deepEqual(messageActions(own, { sending: true, edit: false, now: NOW }), ['react'], 'an engine that cannot edit is offered nothing to edit');
  assert.deepEqual(messageActions(own, { sending: true, edit: true, now: Date.parse(sentAt) + EDIT_WINDOW_MS + 1 }), ['react'], 'past the window');
  assert.deepEqual(messageActions(own, { sending: true, edit: true, now: NOW, platform: 'sms' }), ['react'], 'never on SMS');
  assert.deepEqual(messageActions(own, { sending: true, edit: true, now: NOW, platform: 'rcs' }), ['react'], 'never on RCS');
  assert.deepEqual(messageActions(msg({ fromMe: false, sender: '+15555550100' }), { sending: true, edit: true, now: NOW }), ['reply', 'react'], 'never on someone else\'s');
  assert.deepEqual(messageActions(own, { sending: false, edit: true, now: NOW }), [], 'sending off offers nothing');
  assert.equal(EDIT_WINDOW_MS, 15 * 60 * 1000);
  assert.equal(platformCapabilities('imessage').edit, true);
  assert.equal(platformCapabilities('sms').edit, false);
});

test('an edit is refused for someone else\'s message, a file, SMS, past the window, or to the words it already has', () => {
  assert.equal(editRefusal(msg({}), { now: NOW, text: 'Synthetic new words' }), null);
  assert.equal(editRefusal(msg({ fromMe: false }), { now: NOW })[0], 'edit_not_yours');
  assert.equal(editRefusal(msg({ attachments: [{ id: 'a' }] }), { now: NOW })[0], 'edit_unsupported');
  assert.equal(editRefusal(msg({}), { now: NOW, platform: 'sms' })[0], 'edit_unsupported');
  assert.equal(editRefusal(msg({}), { now: Date.parse(sentAt) + EDIT_WINDOW_MS + 1 })[0], 'edit_window');
  assert.equal(editRefusal(msg({}), { now: NOW, text: '  Synthetic first words ' })[0], 'edit_same');
  assert.equal(editRefusal(msg({}), { now: NOW, text: '   ' })[0], 'bad_text');
  assert.equal(editRefusal(null, { now: NOW })[0], 'edit_unknown');
  assert.equal(editRefusal(msg({ id: 'local:1', state: 'sending' }), { now: NOW })[0], 'edit_unknown', 'a message not sent yet');
});

test('an edited message replaces its words in the conversation, keeps its reactions and its thread, and is marked Edited', () => {
  const reactions = [{ type: 'love', emoji: null, fromMe: false, sender: '+15555550100' }];
  const list = [msg({ id: 'A', reactions }), msg({ id: 'B', text: 'Synthetic other' })];
  const out = applyEdit(list, { ...list[0], text: 'Synthetic second words', reactions: [] });
  assert.equal(out[0].text, 'Synthetic second words');
  assert.equal(out[0].edited, true);
  assert.deepEqual(out[0].reactions, reactions, 'the reactions are the message\'s own');
  assert.equal(out[1], list[1], 'no other message changes');
  assert.equal(applyEdit(list, msg({ id: 'Z' })), list, 'a message not loaded here is left alone');
  const it = { message: out[0], first: true, last: true };
  const host = { messages: out, chat: { id: '1', service: 'iMessage', participants: [] }, sending: true, pop: null, replyingTo: null, reactFor: null, reacting: null, note: null, ownNote: null, editing: null };
  const markup = words(conversation.bubble.call(host, it, null, 'list'));
  assert.ok(markup.includes('Synthetic second words'), 'the new words are drawn');
  assert.ok(markup.includes('class="edited-mark">Edited<'), 'the mark is drawn under the message');
  assert.ok(!words(conversation.bubble.call(host, { message: list[1], first: true, last: true }, null, 'list')).includes('edited-mark'), 'an unedited message carries no mark');
});

test('an edit changes the chat list preview only when it is the message the preview shows', () => {
  const chats = [{ id: '1', name: 'Synthetic', unread: 0, lastMessageAt: sentAt, lastMessage: { text: 'Synthetic first words', fromMe: true, sentAt, attachments: 0, link: null, payloads: 0 } }, { id: '2', name: 'Other', unread: 0, lastMessage: null }];
  const out = applyEditToChats(chats, msg({ text: 'Synthetic second words' }));
  assert.equal(out[0].lastMessage.text, 'Synthetic second words');
  assert.equal(out[0].lastMessage.edited, true);
  assert.equal(chatPreview(out[0]), 'You: Synthetic second words');
  assert.equal(out[1], chats[1]);
  assert.equal(applyEditToChats(chats, msg({ sentAt: '2026-01-15T09:00:00.000Z', text: 'x' })), chats, 'an older message\'s edit leaves the preview alone');
  assert.equal(applyEditToChats(chats, msg({ chatId: '9' })), chats, 'a chat the list does not hold');
});

test('a message.edited event replaces the message in the open conversation and the chat preview, live', () => {
  const page = new AppRoot();
  page.openChatId = '1';
  page.messages = [msg({ id: 'A' })];
  page.chats = [{ id: '1', name: 'Synthetic', unread: 0, lastMessageAt: sentAt, lastMessage: { text: 'Synthetic first words', fromMe: true, sentAt, attachments: 0, link: null, payloads: 0 } }];
  page.onEvent({ name: 'message.edited', data: { message: msg({ id: 'A', text: 'Synthetic edited elsewhere', edited: true }) } });
  assert.equal(page.messages[0].text, 'Synthetic edited elsewhere');
  assert.equal(page.messages[0].edited, true);
  assert.equal(page.chats[0].lastMessage.text, 'Synthetic edited elsewhere');
  page.openChatId = '2';
  page.onEvent({ name: 'message.edited', data: { message: msg({ id: 'A', text: 'Synthetic again' }) } });
  assert.equal(page.messages[0].text, 'Synthetic edited elsewhere', 'a conversation not open is not touched');
  assert.equal(page.chats[0].lastMessage.text, 'Synthetic again', 'its preview still is');
});

test('the menu\'s Edit puts the words in the composer, and saving sends an edit, never a new message', async () => {
  const m = msg({ sentAt: new Date(Date.now() - 60000).toISOString() });
  const host = { messages: [m], chat: { id: '1', service: 'iMessage', participants: [] }, sending: true, canEdit: true, pop: { id: m.id, kind: 'menu', side: 'above' }, replyingTo: null, reactFor: null, editing: null, fired: [], fire(name, detail) { this.fired.push([name, detail]); return true; } };
  const markup = words(conversation.menu.call(host, m));
  assert.ok(markup.includes('aria-label="Edit"') && markup.includes('data-icon="pencil"'), 'Edit from the shared icon set');
  assert.ok(!words(conversation.menu.call({ ...host, canEdit: false }, m)).includes('aria-label="Edit"'), 'not where the engine cannot edit');
  conversation.startEdit.call(host, m);
  assert.deepEqual(host.editing, { id: m.id, text: m.text });
  assert.equal(host.pop, null, 'the menu closes');
  assert.equal(conversation.composerPlaceholder.call(host), 'Edit message');
  conversation.onSend.call(host, { text: 'Synthetic second words', file: null, replyTo: null, editOf: m.id });
  assert.deepEqual(host.fired, [['edit', { messageId: m.id, text: 'Synthetic second words' }]]);
  assert.equal(host.editing, null, 'the edit ends when it is saved');
  const old = msg({ sentAt: new Date(Date.now() - EDIT_WINDOW_MS - 1000).toISOString() });
  conversation.startEdit.call(host, old);
  assert.equal(host.editing, null, 'a menu left open past the window edits nothing');
  // The composer sends the edit as an edit of that message, with no file and no thread.
  const sent = [];
  const field = { value: ' Synthetic typed ', focus() {} };
  const comp = { editing: { id: m.id, text: m.text }, replyTo: { id: 'T' }, staged: null, disabled: false, field: () => field, setPreview() {}, grow() {}, dispatchEvent(e) { sent.push(e); return true; } };
  composer.submit.call(comp, { preventDefault() {} });
  const send = sent.find((e) => e.type === 'send');
  assert.deepEqual(send.detail, { text: 'Synthetic typed', file: null, replyTo: null, editOf: m.id });
});
