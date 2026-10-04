import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTyping, typingActive, typingLabel, TYPING_TTL_MS } from '../app/rules/typing.js';

const at = 1_000_000;
const start = (chatId, kind = 'device', typing = true) => ({ chatId, kind, typing });

test('our own typing shows while it is live and clears when it stops', () => {
  const s = applyTyping(null, start('1'), { chatId: '1', now: at });
  assert.deepEqual(s, { chatId: '1', kind: 'device', at });
  assert.equal(typingLabel(s, at + 10), "You're typing on another device");
  assert.equal(applyTyping(s, start('1', 'device', false), { chatId: '1', now: at + 20 }), null);
});

test('a stale indicator clears on its own, with no stop ever arriving', () => {
  const s = applyTyping(null, start('1'), { chatId: '1', now: at });
  assert.equal(typingActive(s, at + TYPING_TTL_MS - 1), true);
  assert.equal(typingActive(s, at + TYPING_TTL_MS), false);
  assert.equal(typingLabel(s, at + TYPING_TTL_MS), '');
});

test('typing never shows for another account or another conversation', () => {
  const s = applyTyping(null, start('1'), { chatId: '1', now: at });
  assert.equal(applyTyping(s, start('2'), { chatId: '1', now: at + 5 }), s, 'another conversation is not ours');
  assert.equal(applyTyping(null, start('2'), { chatId: '1', now: at }), null, 'and never starts one');
  assert.equal(applyTyping(null, start('1', 'contact'), { chatId: '1', now: at }).kind, 'contact');
  assert.equal(typingLabel(applyTyping(null, start('1', 'contact'), { chatId: '1', now: at }), at + 5), 'typing\u2026');
});
