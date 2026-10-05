// A conversation's own platform decides the form of a reaction and a reply (issue 184). On an SMS or RCS
// conversation there is no bridge tapback and no thread: the six classic reactions go as the platform's own text
// fallback quoting the message, and anything the platform cannot carry (an arbitrary emoji, the removal of a
// reaction, a threaded reply) is refused in place and never sent. An iMessage conversation is unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers.js';

const at = (chat, id) => '/api/v1/chats/' + chat + '/messages/' + id + '/reactions';
const HEART = String.fromCodePoint(0x2764, 0xfe0f);
const PARTY = String.fromCodePoint(0x1f389);
// The first message of the SMS conversation (chat 3 in the fake), and the text the fallback quotes.
const SMS_ID = 'FAKE-0001';
const SMS_TEXT = 'Your table for two is confirmed for Friday at 7.';

test('a classic reaction on an SMS conversation is sent as the platform text fallback, and the bridge is never asked', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const r = await s.post(at(3, SMS_ID), s.tokens.device, { emoji: HEART, text: SMS_TEXT });
  assert.equal(r.status, 201);
  const body = await r.json();
  assert.equal(body.status, 'sent');
  assert.equal(body.type, 'love');
  assert.equal(body.form, 'text', 'the platform form is named, so the client shows it as that platform sends it');
  assert.equal(s.world.requests.filter((m) => m === 'tapback').length, 0, 'the bridge is never asked for an SMS conversation');
  const sends = s.world.sends.filter((x) => x.chatId === 3);
  assert.equal(sends.length, 1, 'one plain message went out');
  assert.equal(sends[0].text, 'Loved "' + SMS_TEXT + '"', 'the phrase the other client reads back as a reaction');
  assert.equal(sends[0].replyTo, null);
});

test('an arbitrary emoji on an SMS conversation is refused in place, and nothing is sent', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const r = await s.post(at(3, SMS_ID), s.tokens.device, { emoji: PARTY, text: SMS_TEXT });
  assert.equal(r.status, 422);
  const body = await r.json();
  assert.equal(body.error.code, 'reaction_unsupported');
  assert.match(body.error.message, /six classic reactions/, 'the limit is named honestly');
  assert.equal(s.world.sends.filter((x) => x.chatId === 3).length, 0, 'nothing was sent');
  assert.equal(s.world.requests.filter((m) => m === 'tapback').length, 0);
});

test('removing a reaction on an SMS conversation is refused, since the platform has no way to take one back', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const r = await s.post(at(3, SMS_ID), s.tokens.device, { emoji: HEART, text: SMS_TEXT, remove: true });
  assert.equal(r.status, 422);
  assert.match((await r.json()).error.message, /cannot be taken back/);
  assert.equal(s.world.sends.length, 0);
});

test('a threaded reply on an SMS conversation is refused in place, and the engine is never asked', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const r = await s.post('/api/v1/chats/3/messages', s.tokens.device, { text: 'See you then', clientKey: 'sms-reply-0001', replyTo: SMS_ID });
  assert.equal(r.status, 422);
  assert.equal((await r.json()).error.code, 'reply_unsupported');
  assert.equal(s.world.sends.length, 0, 'no reply left as a thread the recipient cannot read');
});

test('an iMessage conversation is unchanged: a classic reaction still goes through the bridge, not as text', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const r = await s.post(at(1, 'FAKE-0013'), s.tokens.device, { emoji: HEART, text: 'See you soon' });
  assert.equal(r.status, 201);
  assert.equal(s.world.tapbacks.length, 1, 'the bridge tapback is the iMessage form');
  assert.equal(s.world.sends.filter((x) => x.chatId === 1).length, 0, 'nothing is sent as text');
});

test('a threaded reply on an iMessage conversation is still allowed', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const r = await s.post('/api/v1/chats/1/messages', s.tokens.device, { text: 'See you then', clientKey: 'imsg-reply-0001', replyTo: 'FAKE-0009' });
  assert.equal(r.status, 201);
  const sent = s.world.sends.filter((x) => x.chatId === 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].replyTo, 'FAKE-0009');
});
