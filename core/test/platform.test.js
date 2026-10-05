// The conversation's own platform decides what is offered and how a reaction is sent (issue 184). The service the
// engine reports on a chat is the only source; a service the app does not know offers nothing rather than guessing.
// These are the pure rules: what each platform offers, the phrase a platform without tapbacks exchanges, the parse of
// an incoming text-fallback reaction, and the fold that shows one as a reaction on the message it quotes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { platformOf, platformCapabilities, reactionFallbackText, parseReactionText, foldReactions, platformReactionUnsupported } from '../app/rules/platform.js';
import { messageActions } from '../app/rules/messages.js';

const msg = (o) => ({ id: 'FAKE-0001', chatId: '1', fromMe: false, sender: '+15555550100', text: 'Unique body text', sentAt: '2026-01-15T10:04:00.000Z', replyTo: null, attachments: [], reactions: [], ...o });

test('the platform is the service the engine reported, and a service the app does not know is unknown', () => {
  assert.equal(platformOf({ service: 'iMessage' }), 'imessage');
  assert.equal(platformOf({ service: 'SMS' }), 'sms');
  assert.equal(platformOf({ service: 'RCS' }), 'rcs');
  assert.equal(platformOf({ service: 'something-new' }), 'unknown', 'a service the app does not know is not guessed at');
  assert.equal(platformOf(undefined), 'imessage', 'the adapter already defaults an unreported service to its own default');
});

test('a threaded reply is offered only where the platform carries threads, and React only where it carries a reaction', () => {
  const received = msg({});
  const mine = msg({ fromMe: true, sender: null });
  assert.deepEqual(messageActions(received, { sending: true, platform: 'imessage' }), ['reply', 'react']);
  assert.deepEqual(messageActions(mine, { sending: true, platform: 'imessage' }), ['react']);
  assert.deepEqual(messageActions(received, { sending: true, platform: 'sms' }), ['react'], 'SMS has no threads, so no threaded reply is offered');
  assert.deepEqual(messageActions(mine, { sending: true, platform: 'sms' }), ['react']);
  assert.deepEqual(messageActions(received, { sending: true, platform: 'rcs' }), ['react'], 'RCS carries a reaction, not a thread');
  assert.deepEqual(messageActions(received, { sending: true, platform: 'unknown' }), [], 'a platform the app cannot name offers neither');
  assert.deepEqual(messageActions(received, { sending: false, platform: 'imessage' }), [], 'sending off offers nothing anywhere');
});

test('the six classic reactions have the phrase a platform without tapbacks exchanges, and nothing else does', () => {
  assert.equal(reactionFallbackText('love', 'the plan stands'), 'Loved "the plan stands"');
  assert.equal(reactionFallbackText('like', 'the plan stands'), 'Liked "the plan stands"');
  assert.equal(reactionFallbackText('dislike', 'x'), 'Disliked "x"');
  assert.equal(reactionFallbackText('laugh', 'x'), 'Laughed at "x"');
  assert.equal(reactionFallbackText('emphasis', 'x'), 'Emphasized "x"');
  assert.equal(reactionFallbackText('question', 'x'), 'Questioned "x"');
  assert.equal(reactionFallbackText(null, 'x'), null, 'an arbitrary emoji has no phrase and cannot be sent this way');
});

test('an incoming text-fallback reaction is parsed, the six phrases and the custom-emoji phrase', () => {
  assert.deepEqual(parseReactionText('Loved "the plan stands"'), { type: 'love', emoji: null, text: 'the plan stands' });
  assert.deepEqual(parseReactionText('Laughed at "the plan stands"'), { type: 'laugh', emoji: null, text: 'the plan stands' });
  assert.deepEqual(parseReactionText('Reacted \u{1F389} to "the plan stands"'), { type: 'emoji', emoji: '\u{1F389}', text: 'the plan stands' });
  assert.equal(parseReactionText('just a message'), null);
  assert.equal(parseReactionText('Loved the plan stands'), null, 'a phrase without the quote is not a reaction');
  assert.equal(parseReactionText(''), null);
});

test('a text-fallback reaction folds onto the message it quotes, in history and live, and a quote matching nothing stays text', () => {
  const list = [
    msg({ id: 'FAKE-0001', text: 'the plan stands' }),
    msg({ id: 'FAKE-0002', fromMe: true, sender: null, text: 'okay' }),
    msg({ id: 'FAKE-0009', text: 'Loved "the plan stands"' }),
  ];
  const folded = foldReactions(list, 'sms');
  assert.deepEqual(folded.map((m) => m.id), ['FAKE-0001', 'FAKE-0002'], 'the fallback row is not drawn as a message');
  assert.deepEqual(folded[0].reactions, [{ type: 'love', emoji: null, fromMe: false, sender: '+15555550100' }], 'it shows as a reaction on the quoted message');
  const unmatched = foldReactions([msg({ id: 'a', text: 'other' }), msg({ id: 'b', text: 'Loved "nothing here"' })], 'sms');
  assert.deepEqual(unmatched.map((m) => m.id), ['a', 'b'], 'a fallback whose quote matches nothing is left as the text it is');
  assert.deepEqual(foldReactions(list, 'imessage'), list, 'a platform without the fallback leaves the list untouched');
});

test('a disabled or partially known platform is refused in place with a message naming the limit, not silently', () => {
  assert.match(platformReactionUnsupported('sms').message, /six classic reactions/);
  assert.match(platformReactionUnsupported('unknown').message, /cannot carry a reaction/);
  assert.equal(platformCapabilities('unknown').fallback, false);
});
