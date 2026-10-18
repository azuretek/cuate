// The edit history of an edited message (issue 437): under an edited message whose earlier versions the server sent,
// Edited is a control; pressing it shows those versions above the message, oldest first, quieter than the message, and
// the control then reads Hide edits; pressing that folds them away. A message with no history keeps the plain mark. An
// edit made anywhere carries the history it grew to, so the versions follow live.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyEdit, editVersions } from '../app/rules/messages.js';

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

const sentAt = '2026-01-15T10:04:00.000Z';
const msg = (o) => ({ id: 'A', chatId: '1', fromMe: false, sender: '+15555550100', senderName: null, text: 'Synthetic third words', sentAt, replyTo: null, attachments: [], reactions: [], payloads: 0, link: null, ...o });
const EDITS = [{ text: 'Synthetic first words', at: '2026-01-15T10:04:00.000Z' }, { text: 'Synthetic second words', at: '2026-01-15T10:05:00.000Z' }];
const host = (m, shown = []) => ({ messages: [m], chat: { id: '1', service: 'iMessage', participants: [] }, sending: true, pop: null, replyingTo: null, reactFor: null, reacting: null, note: null, ownNote: null, editing: null, shownEdits: new Set(shown), toggleEdits() {} });
const draw = (m, shown) => words(conversation.bubble.call(host(m, shown), { message: m, first: true, last: true }, null, 'list'));

test('a message\'s earlier versions are read oldest first, and an edit carries the history it grew to', () => {
  assert.deepEqual(editVersions(msg({ edited: true, edits: [EDITS[1], EDITS[0]] })).map((v) => v.text), ['Synthetic first words', 'Synthetic second words']);
  assert.deepEqual(editVersions(msg({ edited: true, edits: [EDITS[0], { text: '' }, null, { at: sentAt }] })).map((v) => v.text), ['Synthetic first words'], 'a version with no words is not drawn');
  assert.deepEqual(editVersions(msg({ edited: true })), []);
  const list = [msg({ edited: true, edits: [EDITS[0]], text: 'Synthetic second words' })];
  const out = applyEdit(list, msg({ text: 'Synthetic third words', edits: EDITS }));
  assert.deepEqual(out[0].edits, EDITS, 'the history follows the edit live');
  assert.deepEqual(applyEdit(list, msg({ text: 'Synthetic third words' }))[0].edits, [EDITS[0]], 'an edit told without a history keeps the one it had');
});

test('Edited under a message with history is a control, folded until pressed (issue 437)', () => {
  const m = msg({ edited: true, edits: EDITS });
  const folded = draw(m);
  assert.match(folded, /<button type="button" class="edited-mark edited-toggle" aria-expanded="false"[^>]*>Edited<\/button>/);
  assert.ok(!folded.includes('edit-version'), 'no earlier version is drawn until it is asked for');
  const shown = draw(m, ['A']);
  assert.match(shown, /aria-expanded="true"[^>]*>Hide edits<\/button>/);
  const first = shown.indexOf('Synthetic first words');
  const second = shown.indexOf('Synthetic second words');
  const now = shown.indexOf('Synthetic third words');
  assert.ok(first > 0 && first < second && second < now, 'the earlier versions are drawn above the message, oldest first');
  assert.equal((shown.match(/class="bubble edit-version/g) || []).length, 2);
});

test('an edited message with no history keeps the plain mark (issue 437)', () => {
  const markup = draw(msg({ edited: true }));
  assert.ok(markup.includes('class="edited-mark">Edited<'));
  assert.ok(!markup.includes('edited-toggle'));
});

test('the earlier versions are quieter than the message, from the tokens (issue 437)', () => {
  const css = read('core/app/styles/app.css');
  assert.match(css, /\.edit-version \{[^}]*color: var\(--color-fg-muted\)/);
  assert.match(css, /\.edited-toggle \{/);
});

test('every platform runs the same edit history proof (issue 437)', () => {
  const fixture = read('core/test/edit-history-fixture.js');
  assert.match(fixture, /window\.editHistoryProof = /);
  const shell = read('ios/' + naming.product + '/ShellView.swift');
  assert.match(shell, /#if DEBUG[\s\S]*--edit-history-fixture[\s\S]*#endif/, 'the iOS fixture is a Debug seam');
  assert.match(read('ios/project.yml'), /CONFIGURATION.*Debug[\s\S]*core\/test\/edit-history-fixture\.js/, 'copied into test builds only');
  assert.match(read('ios/' + naming.product + 'UITests/EditHistoryTests.swift'), /--edit-history-fixture[\s\S]*hasPrefix\("edits:pass"\)/);
  const pkg = 'com/azuretek/' + naming.product.toLowerCase();
  assert.match(read('android/app/src/androidTest/kotlin/' + pkg + '/EditHistoryTest.kt'), /PageFixture\.run\(scenario, "edit-history-fixture\.js", "editHistoryProof"\)/);
  assert.match(read('.github/workflows/android.yml'), /edit-history\.png/);
  assert.match(read('desktop/scripts/smoke.mjs'), /key: 'editHistory'/, 'the desktop smoke checks it on every desktop platform');
  assert.doesNotMatch(read('core/app/main.js'), /edit-history-fixture/);
});
