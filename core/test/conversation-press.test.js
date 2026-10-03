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

test('reply send returns the same work and preserves the parent id', async () => {
  const work = Promise.resolve(true);
  const detail = { text: 'reply', replyTo: 'parent' };
  const host = { replyingTo: { id: 'parent' }, fire(name, value) { assert.equal(name, 'send'); assert.equal(value, detail); return work; } };
  assert.equal(proto.onSend.call(host, detail), work);
  assert.equal(host.replyingTo, null);
});

test('reaction closes its menu but leaves shared pending and failure feedback on the persistent control', async () => {
  configurePress({ timers: { setTimeout() { return 1; }, clearTimeout() {} } });
  try {
    const attrs = new Map();
    const control = { dataset: {}, setAttribute(k, v) { attrs.set(k, v); }, removeAttribute(k) { attrs.delete(k); } };
    let resolve;
    let calls = 0;
    const work = new Promise((r) => { resolve = r; });
    const host = { pop: { id: 'parent' }, querySelectorAll() { return [{ dataset: { id: 'parent' }, querySelector() { return control; } }]; }, fire() { calls++; return work; } };
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
