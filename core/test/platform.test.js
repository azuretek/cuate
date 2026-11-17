// The conversation's own platform decides what is offered and how a reaction is sent (issue 184). The service the
// engine reports on a chat is the only source; a service the app does not know offers nothing rather than guessing.
// These are the pure rules: what each platform offers, the phrase a platform without tapbacks exchanges, the parse of
// an incoming text-fallback reaction, and the fold that shows one as a reaction on the message it quotes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { platformOf, conversationPlatform, platformCapabilities, reactionFallbackText, parseReactionText, foldReactions, platformReactionUnsupported, serviceNote } from '../app/rules/platform.js';
import { messageActions, reactionChoices, reactionOffer, reactionAllowed, EMOJI_TAPBACK_VERSION } from '../app/rules/messages.js';
import { eventText, chatPreview } from '../app/rules/chats.js';

const L = '\u201c';
const R = '\u201d';
const q = (s) => L + s + R;

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

test('the six classic reactions go on SMS as the words an iPhone sends there, curly quotes and removals included', () => {
  // Word for word what the Mac builds a tapback's body from (openclaw/imsg Sources/IMsgHelper/ReactionHandlers.inc),
  // which is what an iPhone sends on SMS and what Google Messages reads back as a reaction (issue 184).
  assert.equal(reactionFallbackText('love', 'the plan stands'), 'Loved ' + q('the plan stands'));
  assert.equal(reactionFallbackText('like', 'the plan stands'), 'Liked ' + q('the plan stands'));
  assert.equal(reactionFallbackText('dislike', 'x'), 'Disliked ' + q('x'));
  assert.equal(reactionFallbackText('laugh', 'x'), 'Laughed at ' + q('x'));
  assert.equal(reactionFallbackText('emphasis', 'x'), 'Emphasized ' + q('x'));
  assert.equal(reactionFallbackText('question', 'x'), 'Questioned ' + q('x'));
  assert.equal(reactionFallbackText('love', ''), 'Loved a message', 'a message with no words is named, never quoted empty');
  assert.equal(reactionFallbackText('love', 'x', { remove: true }), 'Removed a heart from ' + q('x'));
  assert.equal(reactionFallbackText('like', 'x', { remove: true }), 'Removed a like from ' + q('x'));
  assert.equal(reactionFallbackText('dislike', 'x', { remove: true }), 'Removed a dislike from ' + q('x'));
  assert.equal(reactionFallbackText('laugh', 'x', { remove: true }), 'Removed a laugh from ' + q('x'));
  assert.equal(reactionFallbackText('emphasis', 'x', { remove: true }), 'Removed an exclamation from ' + q('x'));
  assert.equal(reactionFallbackText('question', 'x', { remove: true }), 'Removed a question mark from ' + q('x'));
  assert.equal(reactionFallbackText(null, 'x'), null, 'an arbitrary emoji has no phrase and cannot be sent this way');
});

// Every phrasing an incoming reaction arrives in, each from a cited source (docs/DESIGN.md, Platforms): the six verbs an
// iPhone sends on SMS (9to5Google 2021, Google Messages Help "Use reactions"), the any-emoji and removal sentences the
// Mac builds (openclaw/imsg ReactionHandlers.inc), Google Messages' own any-emoji sentence (Business Insider 2022), the
// quote in curly or straight quotes, cut short with an ellipsis, and a message with no words named by what it is.
const PHRASINGS = [
  ['Liked ' + q('the plan stands'), { type: 'like', emoji: null, remove: false, text: 'the plan stands', truncated: false, noun: null }],
  ['Loved ' + q('the plan stands'), { type: 'love', emoji: null, remove: false, text: 'the plan stands', truncated: false, noun: null }],
  ['Disliked ' + q('the plan stands'), { type: 'dislike', emoji: null, remove: false, text: 'the plan stands', truncated: false, noun: null }],
  ['Laughed at ' + q('the plan stands'), { type: 'laugh', emoji: null, remove: false, text: 'the plan stands', truncated: false, noun: null }],
  ['Emphasized ' + q('the plan stands'), { type: 'emphasis', emoji: null, remove: false, text: 'the plan stands', truncated: false, noun: null }],
  ['Questioned ' + q('the plan stands'), { type: 'question', emoji: null, remove: false, text: 'the plan stands', truncated: false, noun: null }],
  ['Loved "the plan stands"', { type: 'love', emoji: null, remove: false, text: 'the plan stands', truncated: false, noun: null }],
  ['Loved "the plan stands' + R, { type: 'love', emoji: null, remove: false, text: 'the plan stands', truncated: false, noun: null }],
  ['Reacted \u{1F602} to ' + q('the plan stands'), { type: 'emoji', emoji: '\u{1F602}', remove: false, text: 'the plan stands', truncated: false, noun: null }],
  ['Reacted \u{1F389} to "the plan stands"', { type: 'emoji', emoji: '\u{1F389}', remove: false, text: 'the plan stands', truncated: false, noun: null }],
  ['Reacted \u{1F44D}\u{1F3FD} to ' + q('the plan stands'), { type: 'emoji', emoji: '\u{1F44D}\u{1F3FD}', remove: false, text: 'the plan stands', truncated: false, noun: null }],
  ['Loved ' + q('the plan sta\u2026'), { type: 'love', emoji: null, remove: false, text: 'the plan sta', truncated: true, noun: null }],
  ['Laughed at "the plan sta..."', { type: 'laugh', emoji: null, remove: false, text: 'the plan sta', truncated: true, noun: null }],
  ['Loved ' + q('two\nlines'), { type: 'love', emoji: null, remove: false, text: 'two\nlines', truncated: false, noun: null }],
  ['Liked an image', { type: 'like', emoji: null, remove: false, text: null, truncated: false, noun: 'image' }],
  ['Loved a photo', { type: 'love', emoji: null, remove: false, text: null, truncated: false, noun: 'image' }],
  ['Emphasized a video', { type: 'emphasis', emoji: null, remove: false, text: null, truncated: false, noun: 'video' }],
  ['Laughed at a movie', { type: 'laugh', emoji: null, remove: false, text: null, truncated: false, noun: 'video' }],
  ['Loved an audio message', { type: 'love', emoji: null, remove: false, text: null, truncated: false, noun: 'audio' }],
  ['Liked a sticker', { type: 'like', emoji: null, remove: false, text: null, truncated: false, noun: 'sticker' }],
  ['Questioned an attachment', { type: 'question', emoji: null, remove: false, text: null, truncated: false, noun: 'attachment' }],
  ['Loved a message', { type: 'love', emoji: null, remove: false, text: null, truncated: false, noun: 'message' }],
  ['Reacted \u{1F602} to an image', { type: 'emoji', emoji: '\u{1F602}', remove: false, text: null, truncated: false, noun: 'image' }],
  ['Removed a heart from ' + q('the plan stands'), { type: 'love', emoji: null, remove: true, text: 'the plan stands', truncated: false, noun: null }],
  ['Removed a like from "the plan stands"', { type: 'like', emoji: null, remove: true, text: 'the plan stands', truncated: false, noun: null }],
  ['Removed a dislike from ' + q('the plan stands'), { type: 'dislike', emoji: null, remove: true, text: 'the plan stands', truncated: false, noun: null }],
  ['Removed a laugh from ' + q('the plan stands'), { type: 'laugh', emoji: null, remove: true, text: 'the plan stands', truncated: false, noun: null }],
  ['Removed an exclamation from ' + q('the plan stands'), { type: 'emphasis', emoji: null, remove: true, text: 'the plan stands', truncated: false, noun: null }],
  ['Removed a question mark from ' + q('the plan stands'), { type: 'question', emoji: null, remove: true, text: 'the plan stands', truncated: false, noun: null }],
  ['Removed \u{1F602} from ' + q('the plan stands'), { type: 'emoji', emoji: '\u{1F602}', remove: true, text: 'the plan stands', truncated: false, noun: null }],
  ['Removed a like from an image', { type: 'like', emoji: null, remove: true, text: null, truncated: false, noun: 'image' }],
];

test('every cited phrasing of an incoming reaction is parsed, and ordinary words are not (issue 533)', () => {
  for (const [text, want] of PHRASINGS) assert.deepEqual(parseReactionText(text), want, text);
  assert.equal(parseReactionText('just a message'), null);
  assert.equal(parseReactionText('Loved the plan stands'), null, 'a phrase without the quote is not a reaction');
  assert.equal(parseReactionText('Reacted badly to ' + q('the plan')), null, 'a word where the emoji goes is not a reaction');
  assert.equal(parseReactionText('Removed the cover from ' + q('the box')), null, 'nor is an ordinary sentence that starts the same');
  assert.equal(parseReactionText('Liked a lot of it'), null, 'a noun that names no message is not a reaction');
  assert.equal(parseReactionText(''), null);
});

test('a reaction that arrives as text folds onto the message it names, and never stays a message (issue 533)', () => {
  const photo = { id: 'att-1', name: 'photo.jpg', mime: 'image/jpeg', bytes: 10 };
  const list = [
    msg({ id: 'FAKE-0001', text: 'the plan stands' }),
    msg({ id: 'FAKE-0002', fromMe: true, sender: null, text: 'okay, and here is a much longer message that gets cut short' }),
    msg({ id: 'FAKE-0003', fromMe: true, sender: null, text: '', attachments: [photo] }),
    msg({ id: 'FAKE-0009', text: 'Loved ' + q('the plan stands') }),
    msg({ id: 'FAKE-0010', text: 'Laughed at ' + q('okay, and here is a much longer\u2026') }),
    msg({ id: 'FAKE-0011', text: 'Liked an image' }),
  ];
  const folded = foldReactions(list, 'sms');
  assert.deepEqual(folded.map((m) => m.id), ['FAKE-0001', 'FAKE-0002', 'FAKE-0003'], 'no reaction is drawn as a message');
  assert.deepEqual(folded[0].reactions, [{ type: 'love', emoji: null, fromMe: false, sender: '+15555550100' }], 'the curly-quoted heart is a reaction on the quoted message');
  assert.deepEqual(folded[1].reactions.map((r) => r.type), ['laugh'], 'a quote cut short with an ellipsis finds the message it starts');
  assert.deepEqual(folded[2].reactions.map((r) => r.type), ['like'], 'a reaction to a picture finds the latest picture');
  assert.deepEqual(foldReactions(list, 'rcs').map((m) => m.id), ['FAKE-0001', 'FAKE-0002', 'FAKE-0003'], 'RCS folds the same way');
  assert.deepEqual(foldReactions(list, 'imessage'), list, 'a platform whose reactions never arrive as text leaves the list untouched');
});

test('a reaction replaces that person\'s earlier one, and a removal takes the matching one off (issue 533)', () => {
  const list = [
    msg({ id: 'a', fromMe: true, sender: null, text: 'the plan stands' }),
    msg({ id: 'r1', text: 'Liked ' + q('the plan stands') }),
    msg({ id: 'r2', text: 'Reacted \u{1F602} to ' + q('the plan stands') }),
  ];
  let folded = foldReactions(list, 'sms');
  assert.deepEqual(folded[0].reactions, [{ type: 'emoji', emoji: '\u{1F602}', fromMe: false, sender: '+15555550100' }], 'one reaction per person');
  folded = foldReactions([...list, msg({ id: 'r3', text: 'Removed a like from ' + q('the plan stands') })], 'sms');
  assert.equal(folded[0].reactions.length, 1, 'a removal of a reaction that is not there takes nothing else off');
  folded = foldReactions([...list, msg({ id: 'r4', text: 'Removed \u{1F602} from ' + q('the plan stands') })], 'sms');
  assert.deepEqual(folded.map((m) => m.id), ['a'], 'the removal is not drawn either');
  assert.deepEqual(folded[0].reactions, [], 'the matching reaction comes off');
});

test('a reaction that names nothing loaded is a quiet labelled line, never the raw text (issue 533)', () => {
  const folded = foldReactions([msg({ id: 'a', text: 'other' }), msg({ id: 'b', senderName: 'Sam Example', text: 'Loved "nothing here"' }), msg({ id: 'c', senderName: 'Sam Example', text: 'Removed a like from an image' })], 'sms');
  assert.deepEqual(folded.map((m) => m.id), ['a', 'b', 'c'], 'kept in its place in the conversation');
  assert.equal(folded[1].text, '', 'its words are not drawn as a message');
  assert.equal(folded[1].event.kind, 'reaction');
  assert.equal(eventText(folded[1]), 'Sam Example reacted \u2764\ufe0f to ' + q('nothing here'));
  assert.equal(eventText(folded[2]), 'Sam Example removed \u{1F44D} from an image');
  assert.equal(eventText({ fromMe: true, event: { kind: 'reaction', emoji: '\u{1F602}', remove: false, quote: 'x'.repeat(80), truncated: false, noun: null } }), 'You reacted \u{1F602} to ' + q('x'.repeat(60) + '\u2026'), 'a long quote is cut to a line');
  const chat = { service: 'SMS', lastMessage: { text: 'Liked ' + q('the plan stands'), fromMe: false, senderName: 'Sam Example', attachments: 0 } };
  assert.equal(chatPreview(chat), 'Sam Example reacted \u{1F44D} to ' + q('the plan stands'), 'the list preview reads the same, never the raw words');
  assert.equal(chatPreview({ ...chat, service: 'iMessage' }), 'Liked ' + q('the plan stands'), 'a conversation whose reactions never arrive as text shows the words as typed');
});

// Abi, 2026-11-16: offer only what the conversation can carry, decided from its service and the engine.
test('React offers exactly what the conversation can carry, decided once from its service and the engine (issue 533)', () => {
  const six = ['\u2764\ufe0f', '\u{1F44D}', '\u{1F44E}', '\u{1F602}', '\u203c\ufe0f', '\u2753'];
  const glyphs = (o) => o.choices.map((c) => c.glyph);
  for (const platform of ['sms', 'rcs']) {
    for (const tapbackEmoji of [0, 1, EMOJI_TAPBACK_VERSION, 9]) {
      const offer = reactionChoices({ platform, tapbackEmoji });
      assert.equal(offer.kind, 'classic', platform + ' carries the six classic reactions whatever the engine');
      assert.deepEqual(glyphs(offer), six);
    }
  }
  assert.equal(reactionChoices({ platform: 'imessage', tapbackEmoji: EMOJI_TAPBACK_VERSION }).kind, 'any', 'the message service with an engine at the version takes any emoji');
  assert.equal(reactionChoices({ platform: 'imessage', tapbackEmoji: EMOJI_TAPBACK_VERSION + 1 }).kind, 'any');
  assert.equal(reactionChoices({ platform: 'imessage', tapbackEmoji: EMOJI_TAPBACK_VERSION - 1 }).kind, 'classic', 'an older engine sends the six');
  assert.equal(reactionChoices({ platform: 'imessage' }).kind, 'classic', 'an engine the app has not heard from is offered the six');
  assert.equal(reactionChoices({ platform: 'unknown', tapbackEmoji: 9 }).kind, 'none', 'a service the app cannot name offers nothing');
  assert.deepEqual(reactionChoices({ platform: 'sms' }).choices.map((c) => c.name), ['Heart', 'Thumbs up', 'Thumbs down', 'Ha ha', 'Exclamation marks', 'Question mark']);
  assert.equal(reactionOffer({ service: 'SMS' }, { tapbackEmoji: 2 }).kind, 'classic');
  assert.equal(reactionOffer({ service: 'iMessage' }, { tapbackEmoji: 2 }).kind, 'any');
  assert.equal(reactionOffer({ service: 'iMessage' }, null).kind, 'classic');
  const classic = reactionChoices({ platform: 'sms' });
  assert.equal(reactionAllowed(classic, '\u2764'), true, 'either presentation of a classic reaction is one of the six');
  assert.equal(reactionAllowed(classic, '\u{1F389}'), false);
  assert.equal(reactionAllowed(reactionChoices({ platform: 'imessage', tapbackEmoji: 2 }), '\u{1F389}'), true);
  assert.equal(reactionAllowed(reactionChoices({ platform: 'unknown' }), '\u2764\ufe0f'), false);
});

test('a group is only as capable as its most limited member (issue 533)', () => {
  assert.equal(conversationPlatform({ service: 'iMessage', isGroup: true }), 'imessage');
  assert.equal(conversationPlatform({ service: 'SMS', isGroup: true }), 'sms', 'a group with anyone off the message service is a text conversation');
  assert.equal(conversationPlatform({ service: 'iMessage', isGroup: true, members: [{ handle: 'a', service: 'iMessage' }, { handle: 'b', service: 'RCS' }] }), 'rcs', 'a member reported on RCS limits the group');
  assert.equal(conversationPlatform({ service: 'RCS', isGroup: true, members: [{ handle: 'a', service: 'SMS' }] }), 'sms', 'and SMS limits it further');
  assert.equal(conversationPlatform({ service: 'iMessage', isGroup: true, members: [{ handle: 'a' }, { handle: 'b', service: '' }] }), 'imessage', 'a member with no service reported changes nothing');
  assert.equal(reactionOffer({ service: 'iMessage', isGroup: true, members: [{ handle: 'b', service: 'SMS' }] }, { tapbackEmoji: 2 }).kind, 'classic', 'the offer follows the most limited member');
});

test('a disabled or partially known platform is refused in place with a message naming the limit, not silently', () => {
  assert.match(platformReactionUnsupported('sms').message, /six classic reactions/);
  assert.match(platformReactionUnsupported('unknown').message, /cannot carry a reaction/);
  assert.equal(platformCapabilities('unknown').fallback, false);
});

// Abi, 2026-10-12 and 2026-10-14: no second bubble colour; who is on the other end is told by an icon by the name and a
// lock beside the time, and a platform the app does not know says nothing.
test('a conversation says whether it is on Apple devices and encrypted, and an unknown one says nothing', () => {
  const one = serviceNote({ service: 'iMessage', isGroup: false });
  assert.deepEqual([one.apple, one.encrypted], [true, true]);
  assert.match(one.label, /^On Apple devices\. .*end-to-end encrypted\.$/);
  assert.match(serviceNote({ service: 'iMessage', isGroup: true }).label, /^Everyone here is on Apple devices\./);
  for (const service of ['SMS', 'RCS']) {
    const n = serviceNote({ service, isGroup: false });
    assert.deepEqual([n.apple, n.encrypted], [false, false]);
    assert.match(n.label, /text messages and are not end-to-end encrypted/);
  }
  assert.equal(serviceNote({ service: 'Carrier pigeon' }), null);
});
