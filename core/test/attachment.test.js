// The attachment element against the real component class, without a renderer: Lit is given just enough of a DOM to
// define the element, and the test drives the same updated() and load() calls a render would.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const defined = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { defined[name] = cls; }, get() { return undefined; } };
globalThis.document = { createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
let urls = 0;
URL.createObjectURL = () => 'blob:' + ++urls;
URL.revokeObjectURL = () => {};
await import('../app/components/app-attachment.js');
const AppAttachment = defined['app-attachment'];

const photo = { id: 'att00000000001', name: 'photo.png', mime: 'image/png', missing: false };
const element = () => {
  const el = Object.create(AppAttachment.prototype);
  el.src = '';
  el.failed = false;
  const pending = [];
  el.client = { attachment: (id) => new Promise((resolve, reject) => { pending.push({ id, resolve, reject }); }) };
  return { el, pending };
};
// What a render does when the attachment property changes.
const show = (el, next) => {
  const before = el.attachment;
  el.attachment = next;
  el.updated(new Map([['attachment', before]]));
};

test('a resync that refetches the open conversation mid-load still shows the image', async () => {
  const { el, pending } = element();
  show(el, structuredClone(photo));
  assert.equal(pending.length, 1);
  // The same attachment arrives again as a fresh object from a fresh page, while its bytes are still on the way.
  show(el, structuredClone(photo));
  assert.equal(pending.length, 1, 'the same attachment is not loaded twice');
  pending[0].resolve(new Blob(['png']));
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(el.src, 'the image is shown, not the placeholder');
  assert.equal(el.failed, false);
});

test('a load that lands after the element moved to another attachment is dropped', async () => {
  const { el, pending } = element();
  show(el, structuredClone(photo));
  show(el, { ...photo, id: 'att00000000002' });
  assert.equal(pending.length, 2);
  pending[0].reject(new Error('gone'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(el.src, '', 'the first attachment never fills the second');
  assert.equal(el.failed, false, "the first attachment's failure is not the second's");
  pending[1].resolve(new Blob(['new']));
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(el.src);
});
