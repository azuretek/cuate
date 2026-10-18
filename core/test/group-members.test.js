// A group's people changing (issue 456): a person added, removed or leaving is a quiet centred line in the conversation
// naming who did it and whom, the chat list preview says the same, and every platform runs the same proof of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyMessageToChats, chatPreview, eventText, eventPreview } from '../app/rules/chats.js';
import { mapMessage } from '../app/rules/engine-imsg.js';

const defined = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { defined[name] = cls; }, get() { return undefined; } };
globalThis.document = { createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
await import('../app/components/app-root.js');
const conversation = defined['app-conversation'].prototype;

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const naming = JSON.parse(read('core/spec/naming.json'));
function words(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(words).join('');
  if (value?.strings) return value.strings.map((s, i) => s + words(value.values[i])).join('');
  return '';
}

const SAM = '+15555550123';
const raw = (over) => ({ id: 1, guid: 'MB-1', chat_id: 2, is_from_me: false, sender: SAM, sender_name: 'Sam Example', text: '', created_at: '2026-01-15T10:04:00.000Z', attachments: [], ...over });
const id = (a) => 'att:' + a.original_path;

test('a row the store marks as a person added, removed or leaving maps to a member event, and any other empty row does not (issue 456)', () => {
  assert.deepEqual(mapMessage(raw({ member_action: 'add', member_handle: 'riley@example.com' }), { attachmentId: id }).event, { kind: 'member', action: 'add', person: { handle: 'riley@example.com', name: null } });
  assert.deepEqual(mapMessage(raw({ member_action: 'remove', member_handle: 'riley@example.com' }), { attachmentId: id }).event, { kind: 'member', action: 'remove', person: { handle: 'riley@example.com', name: null } });
  assert.deepEqual(mapMessage(raw({ member_action: 'leave', member_handle: 'riley@example.com' }), { attachmentId: id }).event, { kind: 'member', action: 'leave' }, 'someone leaving is the sender alone');
  assert.deepEqual(mapMessage(raw({ member_action: 'add' }), { attachmentId: id }).event, { kind: 'member', action: 'add' });
  assert.equal(mapMessage(raw({ member_action: 'joined' }), { attachmentId: id }).event, undefined);
  assert.equal(mapMessage(raw({}), { attachmentId: id }).event, undefined);
});

test('each change reads who did it and whom, by contact name, by address, or as You (issue 456)', () => {
  const m = (over) => ({ fromMe: false, sender: SAM, senderName: 'Sam Example', ...over });
  assert.equal(eventText(m({ event: { kind: 'member', action: 'add', person: { handle: 'riley@example.com', name: 'Riley Example' } } })), 'Sam Example added Riley Example to the conversation');
  assert.equal(eventText(m({ event: { kind: 'member', action: 'add', person: { handle: 'riley@example.com', name: null } } })), 'Sam Example added riley@example.com to the conversation');
  assert.equal(eventText(m({ event: { kind: 'member', action: 'remove', person: { handle: 'riley@example.com', name: 'Riley Example' } } })), 'Sam Example removed Riley Example from the conversation');
  assert.equal(eventText(m({ senderName: null, event: { kind: 'member', action: 'leave' } })), '+15555550123 left the conversation');
  assert.equal(eventText(m({ fromMe: true, event: { kind: 'member', action: 'leave' } })), 'You left the conversation');
  assert.equal(eventText(m({ fromMe: true, event: { kind: 'member', action: 'remove', person: { handle: SAM, name: null } } })), 'You removed +15555550123 from the conversation');
  assert.equal(eventText(m({ event: { kind: 'member', action: 'add' } })), 'Sam Example added someone to the conversation', 'a person the store did not name');
  assert.deepEqual(eventPreview({ kind: 'member', action: 'add', person: { handle: 'a@example.com', name: 'A' }, extra: 1 }), { kind: 'member', action: 'add', person: { handle: 'a@example.com', name: 'A' } });
  assert.deepEqual(eventPreview({ kind: 'background', action: 'set' }), { kind: 'background', action: 'set' }, 'the events before it keep their preview');
});

test('the line is a quiet centred event row, never a bubble, and the preview says the same (issue 456)', () => {
  const msg = { id: 'MB-1', chatId: '2', fromMe: false, sender: 'riley@example.com', senderName: null, text: '', sentAt: '2026-01-15T10:04:00.000Z', replyTo: null, attachments: [], reactions: [], payloads: 0, link: null, event: { kind: 'member', action: 'leave' } };
  const chat = { id: '2', service: 'iMessage', isGroup: true, participants: ['riley@example.com', SAM], members: [] };
  const host = { messages: [msg], chat, sending: true, pop: null, replyingTo: null, reactFor: null, reacting: null, note: null, ownNote: null, editing: null, shownEdits: new Set() };
  const markup = words(conversation.bubble.call(host, { message: msg, first: true, last: true }, null, 'list'));
  assert.match(markup, /<div class="bubble-row event" data-id=MB-1><div class="conv-event"><span>riley@example\.com left the conversation<\/span><\/div><\/div>/);
  assert.doesNotMatch(markup, /class="bubble[ "]/);
  const { chats } = applyMessageToChats([{ id: '2', isGroup: true, participants: ['riley@example.com', SAM], members: [], unread: 0, lastMessageAt: '2026-01-15T10:00:00.000Z', lastMessage: null }], msg);
  assert.equal(chatPreview(chats[0]), 'riley@example.com left the conversation', 'an unnamed sender is their address in the preview too');
  assert.deepEqual(chats[0].participants, [SAM]);
});

test('every platform runs the same group members proof (issue 456)', () => {
  assert.match(read('core/test/group-members-fixture.js'), /window\.membersProof = /);
  const shell = read('ios/' + naming.product + '/ShellView.swift');
  assert.match(shell, /#if DEBUG[\s\S]*--group-members-fixture[\s\S]*#endif/, 'the iOS fixture is a Debug seam');
  assert.match(read('ios/project.yml'), /CONFIGURATION.*Debug[\s\S]*core\/test\/group-members-fixture\.js/, 'copied into test builds only');
  assert.match(read('ios/' + naming.product + 'UITests/GroupMembersTests.swift'), /--group-members-fixture[\s\S]*hasPrefix\("members:pass"\)/);
  const pkg = 'com/azuretek/' + naming.product.toLowerCase();
  assert.match(read('android/app/src/androidTest/kotlin/' + pkg + '/GroupMembersTest.kt'), /PageFixture\.run\(scenario, "group-members-fixture\.js", "membersProof"\)/);
  assert.match(read('.github/workflows/android.yml'), /group-members\.png/);
  assert.match(read('desktop/scripts/smoke.mjs'), /key: 'groupMembers'/, 'the desktop smoke checks it on every desktop platform');
});
