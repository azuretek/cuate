// Issue 241: a reaction the engine cannot send fails visibly and gracefully, in place and in the app's own notice
// style. The reader is told the honest limit (the six classic reactions, not arbitrary emoji) and, when the app knows
// it, the engine build that answered; nothing is sent, nothing is silently substituted, and the app stays usable so
// the same attempt succeeds after an engine upgrade without a restart. The real component class is driven here, with
// no browser, the way sheet-departure.test.js drives app-root.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const defined = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { defined[name] = cls; }, get() { return undefined; } };
globalThis.document = { createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
await import('../app/components/app-root.js');
const AppRoot = defined['app-root'];
const { reactionUnsupported, engineLabel } = await import('../app/rules/messages.js');

test('the refusal names the six classic reactions, the emoji it cannot do, and the engine build when it is known', () => {
  const known = reactionUnsupported({ kind: 'imsg', version: '0.9.2' });
  assert.match(known.message, /six classic reactions, not arbitrary emoji/);
  assert.match(known.message, /imsg 0\.9\.2/, 'the engine that answered is named, not the app');
  assert.match(known.detail, /tapback\.emoji version 2/, 'the version the engine would need is named');
  assert.equal(engineLabel({ kind: 'imsg', version: '0.9.2' }), 'imsg 0.9.2');
  assert.equal(engineLabel({ kind: 'imsg' }), 'imsg');
  assert.equal(engineLabel({}), '', 'an unknown build names nothing rather than inventing one');
  assert.equal(engineLabel(null), '');
  const unknown = reactionUnsupported(null);
  assert.match(unknown.message, /six classic reactions, not arbitrary emoji/);
  assert.equal(unknown.message.includes('()'), false, 'no empty build is drawn as if it were known');
});

test('a refused reaction is said in place and as a dismissible notice, and changes nothing that was sent', () => {
  const h = new AppRoot();
  h.openChatId = '1';
  h.info = { engine: { kind: 'imsg', version: '0.9.2' } };
  const messages = [{ id: 'FAKE-0001', chatId: '1', fromMe: false, reactions: [] }];
  h.messages = messages;
  h.refuseReaction('FAKE-0001', Object.assign(new Error('The engine cannot send it.'), { code: 'reaction_unsupported', status: 422 }));
  assert.equal(h.messageNote.id, 'FAKE-0001', 'said in place, under the message');
  assert.match(h.messageNote.text, /six classic reactions/);
  assert.equal(h.appNotices.length, 1, "and said in the app's own notice style");
  assert.equal(h.appNotices[0].id, 'reaction:FAKE-0001');
  assert.equal(h.appNotices[0].tone, 'warn');
  assert.match(h.appNotices[0].message, /imsg 0\.9\.2/);
  assert.match(h.appNotices[0].detail, /version 2/);
  assert.equal(h.messages, messages, 'nothing was sent, and nothing was silently substituted');
});

test('the control is not left dead: a later attempt and a plain failure both behave', () => {
  const h = new AppRoot();
  h.openChatId = '1';
  h.info = { engine: { kind: 'imsg', version: '0.9.2' } };
  h.refuseReaction('FAKE-0001', Object.assign(new Error('nope'), { code: 'reaction_unsupported' }));
  assert.equal(h.reacting, null, 'a refusal leaves no reaction in flight, so another can be made');
  // Repeating the same refusal updates the one card rather than stacking a second.
  h.refuseReaction('FAKE-0001', Object.assign(new Error('nope'), { code: 'reaction_unsupported' }));
  assert.equal(h.appNotices.length, 1);
  // A failure that is not about the capability keeps the plain description and raises no reaction notice.
  const other = new AppRoot();
  other.info = { engine: { kind: 'imsg', version: '0.9.2' } };
  other.refuseReaction('FAKE-0001', Object.assign(new Error('The server refused this token.'), { status: 401 }));
  assert.equal(other.appNotices.length, 0);
  assert.equal(other.messageNote.text, 'The server refused this token.');
});
