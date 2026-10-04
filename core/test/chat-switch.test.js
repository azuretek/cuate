// Switching conversations returns each to the place you left it (issue 200). The decision is pure (rules/places.js),
// so it is tested directly; the conversation component wires it to its keep controller, tested here with a fake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rememberPlace, placeFor } from '../app/rules/places.js';

test('a conversation never opened, and one whose place has gone, opens at its newest message', () => {
  const places = new Map();
  assert.deepEqual(placeFor(places, 1, { follow: true }), { end: true });
  assert.deepEqual(placeFor(places, 'gone', { follow: true }), { end: true });
  // A view that does not follow its newest message opens at its top, not its end.
  assert.deepEqual(placeFor(places, 1, { follow: false }), { top: 0 });
});

test('a place once remembered comes back exactly, keyed by id however it is written', () => {
  let places = new Map();
  places = rememberPlace(places, 7, { end: true });
  assert.deepEqual(placeFor(places, 7, { follow: true }), { end: true });
  // A numeric id and its string name the same conversation.
  assert.deepEqual(placeFor(places, '7', { follow: true }), { end: true });

  const up = { key: 'FAKE-0009', offset: -12 };
  places = rememberPlace(places, '7', up);
  assert.deepEqual(placeFor(places, 7, { follow: true }), up, 'a chat scrolled up comes back to the same message at the same offset');
  assert.deepEqual(placeFor(places, 1, { follow: true }), { end: true }, 'another chat is untouched');
});

test('remembering a place never mutates the map it was given', () => {
  const before = new Map([[1, { end: true }]]);
  const after = rememberPlace(before, 2, { top: 40 });
  assert.equal(before.has(2), false, 'the old map is left as it was');
  assert.deepEqual(after.get('2'), { top: 40 });
});

test('a place with no anchor or no id is never stored', () => {
  const before = new Map();
  assert.deepEqual([...rememberPlace(before, 1, null)], []);
  assert.deepEqual([...rememberPlace(before, null, { end: true })], []);
});

// The conversation component's own switch: the chat being left keeps the place it was last at, and the chat being
// entered is put back on its own (issue 200). Called on the prototype with a fake host and keep, as the real element
// needs a browser to construct.
const defined = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { defined[name] = cls; }, get() { return undefined; } };
globalThis.document = { createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
await import('../app/components/app-conversation.js');
const proto = defined['app-conversation'].prototype;

function switched(host, fromId, toId) {
  const changed = { has: (k) => k === 'chat', get: (k) => (k === 'chat' ? (fromId == null ? null : { id: fromId }) : undefined) };
  host.chat = { id: toId };
  proto.willUpdate.call(host, changed);
}

test('leaving a conversation remembers its place, and entering one comes back to that place', () => {
  const host = { keep: { anchor: { key: 'FAKE-0009', offset: -12 }, follow: true }, places: new Map(), pop: null, replyingTo: null, reactFor: null };
  // Leave chat 1 scrolled up, land in chat 2, which has no place, so at its newest message.
  switched(host, 1, 2);
  assert.deepEqual(host.places.get('1'), { key: 'FAKE-0009', offset: -12 });
  assert.deepEqual(host.keep.anchor, { end: true }, 'a chat with no place opens at its newest message');
  // Scroll chat 2 to its end, then go back to chat 1: it comes back to the message and offset it was left at.
  host.keep.anchor = { end: true };
  switched(host, 2, 1);
  assert.deepEqual(host.places.get('2'), { end: true }, 'a chat left at the bottom remembers the end');
  assert.deepEqual(host.keep.anchor, { key: 'FAKE-0009', offset: -12 });
});

test('a re-render of the same conversation does not touch its place', () => {
  const host = { keep: { anchor: { key: 'm3', offset: -4 }, follow: true }, places: new Map([['1', { top: 9 }]]), pop: null, replyingTo: null, reactFor: null };
  const changed = { has: () => true, get: () => ({ id: 1 }) };
  host.chat = { id: 1 };
  proto.willUpdate.call(host, changed);
  assert.deepEqual(host.keep.anchor, { key: 'm3', offset: -4 }, 'the working place is left alone');
  assert.deepEqual([...host.places], [['1', { top: 9 }]], 'and nothing is written');
});
