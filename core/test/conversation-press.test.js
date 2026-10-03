// The real conversation class keeps reply work and reaction feedback through the shared press integration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configurePress, pressState } from '../kit/press.js';

const defined = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { defined[name] = cls; }, get() { return undefined; } };
globalThis.document = { createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
await import('../app/components/app-conversation.js');
const proto = defined['app-conversation'].prototype;

// Inspect the actual Lit template values, including nested templates, without a browser.
function words(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(words).join('');
  if (value?.strings) return value.strings.map((s, i) => s + words(value.values[i])).join('');
  return '';
}

test('a reply renders one quiet mark back to its thread, never the original body or a reply-to label', () => {
  const parent = { id: 'parent', text: 'Unique original body', senderName: 'Avery', fromMe: false };
  const host = { messages: [parent], chat: {}, sending: true };
  const message = { id: 'reply', replyTo: 'parent', text: 'Answer', attachments: [], reactions: [], fromMe: true };
  const markup = words(proto.bubble.call(host, { message }, message, false, 'list'));
  assert.ok(!markup.includes(parent.text));
  assert.ok(!markup.includes('Reply to'));
  assert.equal((markup.match(/class="reply-mark"/g) || []).length, 1);
  assert.ok(markup.includes('In a thread with Avery'));
  const missing = words(proto.bubble.call(host, { message: { ...message, replyTo: 'missing' } }, message, false, 'list'));
  assert.equal((missing.match(/class="reply-mark"/g) || []).length, 1, 'a thread whose first message is not loaded is still marked');
});

test('reply send returns the same work and preserves the parent id', async () => {
  const work = Promise.resolve(true);
  const detail = { text: 'reply', replyTo: 'parent' };
  const host = { replyingTo: { id: 'parent' }, fire(name, value) { assert.equal(name, 'send'); assert.equal(value, detail); return work; } };
  assert.equal(proto.onSend.call(host, detail), work);
  assert.equal(host.replyingTo, null);
});

test('reaction closes its menu but leaves shared pending and failure feedback on the composer\'s emoji button, the control it was chosen from', async () => {
  configurePress({ timers: { setTimeout() { return 1; }, clearTimeout() {} } });
  try {
    const attrs = new Map();
    const control = { dataset: {}, setAttribute(k, v) { attrs.set(k, v); }, removeAttribute(k) { attrs.delete(k); } };
    let resolve;
    let calls = 0;
    const work = new Promise((r) => { resolve = r; });
    const host = { pop: { id: 'parent' }, querySelector(sel) { assert.equal(sel, 'app-composer button.tool[aria-label="Emoji"]'); return control; }, fire() { calls++; return work; } };
    const message = { id: 'parent', reactions: [] };
    const first = proto.react.call(host, message, '👍');
    proto.react.call(host, message, '👍');
    assert.equal(calls, 1);
    assert.equal(host.pop, null);
    assert.equal(pressState(control), 'pending');
    assert.equal(attrs.get('aria-busy'), 'true');
    resolve(false);
    assert.equal(await first, false);
    assert.equal(pressState(control), 'failure');
  } finally { configurePress(null); }
});
