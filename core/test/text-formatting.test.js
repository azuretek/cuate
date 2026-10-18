// Bold, italic, underline and strikethrough (issue 447): a stretch the sender styled draws with each style it carries,
// composed with a text effect and a link on the same words, every weight from the tokens, and the words stay the words.
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

test('a styled stretch draws with every style it carries, a link and an effect included (issue 447)', () => {
  const m = { id: 'A', chatId: '1', fromMe: false, sender: '+15555550100', senderName: null, text: 'Bold and www.example.com glowing', sentAt: '2026-01-15T10:04:00.000Z', replyTo: null, attachments: [], reactions: [], payloads: 0, link: null,
    styles: [{ start: 0, length: 4, bold: true, italic: true }, { start: 9, length: 15, underline: true }, { start: 25, length: 7, effect: 'bloom', strikethrough: true }] };
  const host = { messages: [m], chat: { id: '1', service: 'iMessage', participants: [] }, sending: true, pop: null, replyingTo: null, reactFor: null, reacting: null, note: null, ownNote: null, editing: null, shownEdits: new Set() };
  const markup = words(conversation.bubble.call(host, { message: m, first: true, last: true }, null, 'list'));
  assert.match(markup, /<span class="fmt fmt-bold fmt-italic">Bold<\/span>/);
  assert.match(markup, /<a class="message-link"[^>]*><span class="fmt fmt-underline">www\.example\.com<\/span><\/a>/, 'the link still opens, and draws underlined');
  assert.match(markup, /<span class="fmt fmt-strikethrough"><span class="text-effect" data-effect=bloom>glowing<\/span><\/span>/, 'a style wraps the effect it shares words with');
});

test('each style is drawn from the stylesheet, its weight a token (issue 447)', () => {
  const css = read('core/app/styles/app.css');
  assert.match(css, /\.fmt-bold \{ font-weight: var\(--font-weight-bold\); \}/);
  assert.match(css, /\.fmt-italic \{ font-style: italic; \}/);
  assert.match(css, /\.fmt-underline \{ text-decoration-line: underline; \}/);
  assert.match(css, /\.fmt-strikethrough \{ text-decoration-line: line-through; \}/);
  assert.match(css, /\.fmt-underline\.fmt-strikethrough \{ text-decoration-line: underline line-through; \}/, 'both lines where both are laid');
});

test('every platform runs the same formatting proof (issue 447)', () => {
  assert.match(read('core/test/text-format-fixture.js'), /window\.textFormatProof = /);
  const shell = read('ios/' + naming.product + '/ShellView.swift');
  assert.match(shell, /#if DEBUG[\s\S]*--text-format-fixture[\s\S]*#endif/, 'the iOS fixture is a Debug seam');
  assert.match(read('ios/project.yml'), /CONFIGURATION.*Debug[\s\S]*core\/test\/text-format-fixture\.js/, 'copied into test builds only');
  assert.match(read('ios/' + naming.product + 'UITests/TextFormatTests.swift'), /--text-format-fixture[\s\S]*hasPrefix\("textfmt:pass"\)/);
  const pkg = 'com/azuretek/' + naming.product.toLowerCase();
  assert.match(read('android/app/src/androidTest/kotlin/' + pkg + '/TextFormatTest.kt'), /PageFixture\.run\(scenario, "text-format-fixture\.js", "textFormatProof"\)/);
  assert.match(read('.github/workflows/android.yml'), /text-format\.png/);
  assert.match(read('desktop/scripts/smoke.mjs'), /key: 'textFormat'/, 'the desktop smoke checks it on every desktop platform');
});
