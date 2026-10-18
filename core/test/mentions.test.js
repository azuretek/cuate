// A mention in a group (issue 453): the mentioned name draws set apart from the words around it, names the person it
// stands for (their contact name, or their address) to a screen reader and on hover, and composes with every other style.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

test('a mention draws set apart and names the person it stands for (issue 453)', () => {
  const m = { id: 'A', chatId: '2', fromMe: false, sender: 'jordan@example.com', senderName: null, text: 'Riley and Sam, dinner at 7', sentAt: '2026-01-15T10:04:00.000Z', replyTo: null, attachments: [], reactions: [], payloads: 0, link: null,
    styles: [{ start: 0, length: 5, mention: 'riley@example.com', bold: true }, { start: 10, length: 3, mention: '+1 (555) 555-0123' }] };
  const chat = { id: '2', service: 'iMessage', isGroup: true, participants: ['riley@example.com', '+15555550123', 'jordan@example.com'], members: [{ handle: '+15555550123', name: 'Sam Example', photo: null }, { handle: 'jordan@example.com', name: 'Jordan Example', photo: null }] };
  const host = { messages: [m], chat, sending: true, pop: null, replyingTo: null, reactFor: null, reacting: null, note: null, ownNote: null, editing: null, shownEdits: new Set() };
  const markup = words(conversation.bubble.call(host, { message: m, first: true, last: true }, null, 'list'));
  assert.match(markup, /<span class="fmt fmt-bold"><span class="mention" title="riley@example.com">Riley<\/span><\/span>/, 'a person Contacts does not know is named by their address');
  assert.match(markup, /<span class="mention" title="Sam Example">Sam<\/span>/, 'a known person by their contact name, the address matched however it is written');
});

test('a mention is drawn from the stylesheet, its weight a token (issue 453)', () => {
  assert.match(read('core/app/styles/app.css'), /\.mention \{ font-weight: var\(--font-weight-bold\);[^}]*\}/);
});

test('every platform runs the same mention proof (issue 453)', () => {
  assert.match(read('core/test/mention-fixture.js'), /window\.mentionProof = /);
  const shell = read('ios/' + naming.product + '/ShellView.swift');
  assert.match(shell, /#if DEBUG[\s\S]*--mention-fixture[\s\S]*#endif/, 'the iOS fixture is a Debug seam');
  assert.match(read('ios/project.yml'), /CONFIGURATION.*Debug[\s\S]*core\/test\/mention-fixture\.js/, 'copied into test builds only');
  assert.match(read('ios/' + naming.product + 'UITests/MentionTests.swift'), /--mention-fixture[\s\S]*hasPrefix\("mention:pass"\)/);
  const pkg = 'com/azuretek/' + naming.product.toLowerCase();
  assert.match(read('android/app/src/androidTest/kotlin/' + pkg + '/MentionTest.kt'), /PageFixture\.run\(scenario, "mention-fixture\.js", "mentionProof"\)/);
  assert.match(read('.github/workflows/android.yml'), /mention\.png/);
  assert.match(read('desktop/scripts/smoke.mjs'), /key: 'mention'/, 'the desktop smoke checks it on every desktop platform');
});
