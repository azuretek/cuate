// A conversation's own platform decides the form of a reaction and a reply (issue 184). On an SMS or RCS conversation
// there is no thread, and a reaction is one of the six classic ones: it goes through the engine's bridge, so Messages
// sends it the way that service carries one (the classic text an iPhone sends on SMS, a reaction on RCS), and where
// the bridge cannot be reached an SMS reaction goes as that same text from the server while an RCS one is refused.
// Anything the platform cannot carry (an arbitrary emoji, a threaded reply) is refused in place and never sent. An
// iMessage conversation is unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers.js';
import { createSender } from '../src/send.js';

const at = (chat, id) => '/api/v1/chats/' + chat + '/messages/' + id + '/reactions';
const HEART = String.fromCodePoint(0x2764, 0xfe0f);
const PARTY = String.fromCodePoint(0x1f389);
// The first message of the SMS conversation (chat 3 in the fake), and the text the fallback quotes.
const SMS_ID = 'FAKE-0001';
const SMS_TEXT = 'Your table for two is confirmed for Friday at 7.';

const L = '\u201c';
const R = '\u201d';
const PARTY_MSG = 'reaction_unsupported';

test('a classic reaction on an SMS conversation goes through the bridge, so Messages sends it the way SMS carries one', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const r = await s.post(at(3, SMS_ID), s.tokens.device, { emoji: HEART, text: SMS_TEXT });
  assert.equal(r.status, 201);
  const body = await r.json();
  assert.equal(body.status, 'sent');
  assert.equal(body.type, 'love');
  assert.equal(body.form, 'tapback', 'the form is named, so the client knows how it went');
  assert.deepEqual(s.world.tapbacks.map((x) => [x.chatId, x.kind, x.remove]), [[3, 'love', false]], 'one classic tapback, never an emoji');
  assert.equal(s.world.sends.filter((x) => x.chatId === 3).length, 0, 'no stray text went out beside it');
});

test('taking a reaction back on an SMS conversation sends the matching removal, never a confusing text', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  assert.equal((await s.post(at(3, SMS_ID), s.tokens.device, { emoji: HEART, text: SMS_TEXT })).status, 201);
  const r = await s.post(at(3, SMS_ID), s.tokens.device, { emoji: HEART, text: SMS_TEXT, remove: true });
  assert.equal(r.status, 201);
  assert.equal((await r.json()).add, false);
  assert.deepEqual(s.world.tapbacks.map((x) => [x.kind, x.remove]), [['love', false], ['love', true]], 'the removal of the same reaction');
  assert.equal(s.world.sends.length, 0);
});

test('with no bridge, an SMS reaction and its removal go as the words an iPhone sends, curly quotes and all', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  s.world.behavior.bridge = 'down';
  const r = await s.post(at(3, SMS_ID), s.tokens.device, { emoji: HEART, text: SMS_TEXT });
  assert.equal(r.status, 201);
  assert.equal((await r.json()).form, 'text', 'the text form is named');
  const off = await s.post(at(3, SMS_ID), s.tokens.device, { emoji: HEART, text: SMS_TEXT, remove: true });
  assert.equal(off.status, 201);
  const sends = s.world.sends.filter((x) => x.chatId === 3).map((x) => x.text);
  assert.deepEqual(sends, ['Loved ' + L + SMS_TEXT + R, 'Removed a heart from ' + L + SMS_TEXT + R], 'Messages\' own words, which Google Messages draws as a reaction');
  assert.equal(s.world.tapbacks.length, 0);
});

// The sender on its own, over an engine that records what it was asked, for a conversation on RCS (the fixtures carry
// none, and the server's chat list is read once and held).
function rcsSender({ bridge = true, tapbackEmoji = 2 } = {}) {
  const asked = { react: [], text: [] };
  const engine = {
    emojiTapbackVersion: () => tapbackEmoji,
    info: () => ({ kind: 'fake', version: 'fake-1.0' }),
    react: async (chatId, targetId, how) => {
      asked.react.push({ chatId, targetId, ...how });
      return bridge ? { ok: true } : { ok: false, uncertain: false, unsupported: true, code: 'bridge_not_started' };
    },
    sendText: async (chatId, text) => { asked.text.push(text); return { ok: true }; },
  };
  const events = [];
  const send = createSender({ engine, store: {}, config: { sending: { enabled: true, perMinute: 20 } }, log: { emit: (name, fields) => events.push([name, fields]) }, platformOfChat: () => 'rcs' });
  return { send, asked, events };
}

test('a classic reaction on an RCS conversation goes through the bridge, which carries it as a reaction there', async () => {
  const { send, asked } = rcsSender();
  const r = await send.react('3', { targetId: SMS_ID, emoji: '\u{1F44D}', text: SMS_TEXT });
  assert.equal(r.http, 201);
  assert.equal(r.body.form, 'tapback');
  assert.deepEqual(asked.react, [{ chatId: '3', targetId: SMS_ID, type: 'like', remove: false }], 'a classic tapback by kind, never an emoji');
  const off = await send.react('3', { targetId: SMS_ID, emoji: '\u{1F44D}', text: SMS_TEXT, remove: true });
  assert.equal(off.http, 201);
  assert.deepEqual(asked.react.at(-1), { chatId: '3', targetId: SMS_ID, type: 'like', remove: true }, 'and its removal the same way');
  assert.deepEqual(asked.text, [], 'nothing goes as text');
});

test('RCS is offered the six classic reactions even where the engine sends any emoji, and the server holds the same line', async () => {
  const { send, asked } = rcsSender({ tapbackEmoji: 2 });
  const r = await send.react('3', { targetId: SMS_ID, emoji: PARTY, text: SMS_TEXT });
  assert.equal(r.http, 422);
  assert.equal(r.error[0], PARTY_MSG);
  assert.match(r.error[1], /six classic reactions/);
  assert.deepEqual(asked.react, [], 'the engine is never asked');
});

test('with no bridge, an RCS reaction is refused with the reason, never sent as a stray text', async () => {
  const { send, asked } = rcsSender({ bridge: false });
  const r = await send.react('3', { targetId: SMS_ID, emoji: HEART, text: SMS_TEXT });
  assert.equal(r.http, 422);
  assert.match(r.error[1], /needs the engine bridge running/);
  assert.deepEqual(asked.text, [], 'nothing went out as text on RCS');
});

test('an SMS conversation is offered the six even where the engine sends any emoji, and the server enforces it', async (t) => {
  const s = await boot({ capabilities: { engine: { version: 'fake-2.0', commit: 'fake', built_at: '1970-01-01T00:00:00.000Z' }, features: { 'tapback.emoji': 2 } } });
  t.after(() => s.close());
  const info = await (await s.get('/api/v1/info', s.tokens.device)).json();
  assert.equal(info.engine.tapbackEmoji, 2, 'the app is told the version the engine advertises, so the menu can offer exactly what goes');
  const sms = await s.post(at(3, SMS_ID), s.tokens.device, { emoji: PARTY, text: SMS_TEXT });
  assert.equal(sms.status, 422);
  assert.match((await sms.json()).error.message, /six classic reactions/);
  const imsg = await s.post(at(1, 'FAKE-0013'), s.tokens.device, { emoji: PARTY, text: 'See you soon' });
  assert.equal(imsg.status, 201, 'the message service with that engine takes any emoji');
  assert.deepEqual(s.world.tapbacks.map((x) => [x.chatId, x.emoji || x.kind]), [[1, PARTY]]);
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
