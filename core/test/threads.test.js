// Threads as iMessage draws them (issue 195). Only a message the engine records with a thread originator is a reply:
// imsg also reports `reply_to_guid`, which Messages fills on ordinary rows with the message before it, and reading that
// as a thread marked every consecutive message as a reply to the one above it. The rows below are shaped like imsg's
// real history output (the keys it emits on ordinary and threaded rows, measured on a Mac), with synthetic handles,
// guids and text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapMessage } from '../app/rules/engine-imsg.js';
import { threadMarks, threadLinks, threadIds, replyCountLabel, mergeMessages } from '../app/rules/messages.js';

const defined = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { defined[name] = cls; }, get() { return undefined; } };
globalThis.document = { createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
await import('../app/components/app-conversation.js');
const conversation = defined['app-conversation'].prototype;
const composer = defined['app-composer'].prototype;

function words(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(words).join('');
  if (value?.strings) return value.strings.map((s, i) => s + words(value.values[i])).join('');
  return '';
}

const HANDLE = '+15555550100';
const row = (id, minute, fields) => ({
  id,
  chat_id: 7,
  chat_identifier: HANDLE,
  chat_guid: 'iMessage;-;' + HANDLE,
  chat_name: '',
  participants: [HANDLE],
  is_group: false,
  guid: 'SYN-' + String(id).padStart(4, '0'),
  sender: HANDLE,
  is_from_me: false,
  text: '',
  created_at: new Date(Date.UTC(2026, 0, 15, 10, minute)).toISOString(),
  attachments: [],
  reactions: [],
  ...fields,
});
const mine = { is_from_me: true, sender: '', destination_caller_id: 'synthetic@example.com' };
const theirs = { is_read: true, date_read: '2026-01-15T11:00:00.000Z' };
// Messages fills reply_to_guid on an ordinary row with the guid of the row before it, and imsg resolves that row's sender
// and text into reply_to_sender and reply_to_text. None of the three means the row is in a thread.
const chained = (prev) => ({ reply_to_guid: prev, reply_to_sender: HANDLE, reply_to_text: 'Synthetic earlier text' });
const IMSG_ROWS = [
  row(1, 0, { ...theirs, text: 'Are we still on for the hike?' }),
  row(2, 1, { ...mine, ...chained('SYN-0001'), text: 'Yes, nine at the trailhead.' }),
  row(3, 2, { ...theirs, ...chained('SYN-0002'), text: 'Great.' }),
  row(4, 3, { ...mine, ...chained('SYN-0003'), text: 'I will bring water.' }),
  // A real reply: the person used Reply on message 2. Its reply_to_guid still names the row before it (4); only
  // thread_originator_guid, with the part of the original it answers, names the thread.
  row(5, 9, { ...theirs, ...chained('SYN-0004'), thread_originator_guid: 'SYN-0002', thread_originator_part: '0:0:27', text: 'Could we make it half past?' }),
  row(6, 10, { ...mine, ...chained('SYN-0005'), thread_originator_guid: 'SYN-0002', thread_originator_part: '0:0:27', text: 'Half past works.' }),
  row(7, 12, { ...theirs, ...chained('SYN-0006'), text: 'See you there.' }),
];
const attachmentId = (a) => 'att:' + a.filename;
const mapped = () => mergeMessages([], IMSG_ROWS.map((m) => mapMessage(m, { attachmentId })));
const chat = { id: '7', name: 'Avery Quinn', participants: [HANDLE], isGroup: false, service: 'iMessage' };
const host = (o = {}) => ({ messages: mapped(), chat, sending: true, pop: null, replyingTo: null, reactFor: null, reacting: null, note: null, hasMore: false, windowControls: null, uploadMaxBytes: 1, ...o });
const withParts = (h) => { for (const k of ['bubble', 'threadView', 'menu', 'ghost', 'links', 'composerPlaceholder']) h[k] = conversation[k]; return h; };

test('only a message the engine records with a thread originator is a reply, never one that reply_to_guid chains to the row before it', () => {
  const byId = new Map(mapped().map((m) => [m.id, m]));
  for (const id of ['SYN-0001', 'SYN-0002', 'SYN-0003', 'SYN-0004', 'SYN-0007']) assert.equal(byId.get(id).replyTo, null, id + ' is an ordinary message');
  assert.equal(byId.get('SYN-0005').replyTo, 'SYN-0002', 'the reply names its thread\'s original, not the row before it');
  assert.equal(byId.get('SYN-0006').replyTo, 'SYN-0002');
});

test('two ordinary consecutive messages show no thread mark', () => {
  const h = withParts(host());
  const list = mapped();
  const ordinary = [list[1], list[2]];
  assert.deepEqual(ordinary.map((m) => m.text), ['Yes, nine at the trailhead.', 'Great.']);
  const marks = threadMarks(list);
  for (const m of ordinary) {
    assert.equal(marks.has(m.id), false, m.id + ' carries no mark');
    const markup = words(conversation.bubble.call(h, { message: m, first: true, last: true }, null, false, 'list'));
    assert.ok(!/thread-line|thread-ghost|thread-count|thread-reply|reply-mark/.test(markup), m.id + ' draws nothing extra');
  }
  const page = words(conversation.render.call(h));
  assert.equal((page.match(/class="thread-ghost"/g) || []).length, 1, 'one ghost in the whole conversation, for the one real thread');
  assert.ok(!page.includes('reply-mark'), 'the old per-message mark is gone');
});

test('a real reply connects to its original: a ghost of the original with its reply count above the replies, and a line from the original to the reply', () => {
  const list = mapped();
  const marks = threadMarks(list);
  assert.deepEqual([...marks.keys()].sort(), ['SYN-0005', 'SYN-0006']);
  assert.deepEqual(marks.get('SYN-0005'), { root: 'SYN-0002', ghost: { root: 'SYN-0002', count: 2 } }, 'the ghost sits above the run of replies that holds the newest');
  assert.deepEqual(marks.get('SYN-0006'), { root: 'SYN-0002', ghost: null });
  assert.deepEqual(threadLinks(list).map((l) => l.from + '>' + l.to), ['SYN-0002>SYN-0005', 'SYN-0005>SYN-0006'], 'your original to their reply, and their reply to your answer');
  assert.equal(replyCountLabel(1), '1 Reply');
  assert.equal(replyCountLabel(2), '2 Replies');
  const h = withParts(host());
  const page = words(conversation.render.call(h));
  const ghostAt = page.indexOf('class="thread-ghost"');
  assert.ok(ghostAt > page.indexOf('Great.') && ghostAt < page.indexOf('Could we make it half past?'), 'the ghost sits in time order, just above the replies');
  assert.ok(page.slice(ghostAt, page.indexOf('Could we make it half past?')).includes('Yes, nine at the trailhead.'), 'the ghost repeats the original');
  assert.ok(page.includes('2 Replies'));
  assert.match(page, /thread-ghost-row mine/, 'the ghost is on the original\'s side');
  assert.equal((page.match(/class="thread-line"/g) || []).length, 2, 'one line where the thread changes hands each time');
  assert.ok(page.includes('aria-label="Open the thread"'));
  // Tapping the line, the ghost, the count or a reply opens the thread named by its original.
  const t = host();
  conversation.openThread.call(t, list[4]);
  assert.deepEqual(t.replyingTo, { id: 'SYN-0002' });
});

test('the thread view lists exactly the original and its replies, with time separators and delivery, in a card with the shared close control at its top right, under the contact header left as it is, and the composer reads Reply', () => {
  const h = withParts(host({ replyingTo: { id: 'SYN-0002' } }));
  assert.deepEqual([...threadIds(h.messages, 'SYN-0002')].sort(), ['SYN-0002', 'SYN-0005', 'SYN-0006']);
  const view = words(conversation.threadView.call(h, false));
  const ids = [...view.matchAll(/data-id=(SYN-\d{4})/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['SYN-0002', 'SYN-0005', 'SYN-0006'], 'exactly the thread, in order');
  assert.equal((view.match(/class="separator"/g) || []).length, 3, 'each message under its time');
  assert.ok(view.includes('class="delivery"'), 'the delivery status of your last message in the thread');
  assert.ok(!/thread-line|thread-ghost/.test(view), 'no marks inside the thread');
  const page = words(conversation.render.call(h));
  assert.match(page, /class=messages behind/);
  // The close control is the shared one, first in the thread card, so it sits at the card's top right (issue 213); the
  // contact header keeps its way back and carries no close control, so nothing there reads as closing the conversation.
  const card = view.slice(view.indexOf('class="thread-list"'));
  assert.ok(card.indexOf('class="thread-card-head"') >= 0 && card.indexOf('class="thread-card-head"') < card.indexOf('data-id='), 'the close control heads the card');
  assert.match(card, /class="thread-card-head"><button type="button" class="close-button" data-close="thread"[^>]*aria-label="Close thread"/, 'the shared close control');
  const head = page.slice(0, page.indexOf('</header>'));
  assert.ok(!head.includes('close-button') && !head.includes('Close thread'), 'no close control in the header');
  assert.match(head, /aria-label="Back to chats"/, 'the header keeps its way back, the shared chats icon');
  assert.match(head, /data-icon="messages-square"/, 'the way back is the shared chats icon, never a close control');
  assert.ok(page.includes('Avery Quinn'), 'the contact header stays');
  const c = { emojiOpen: false, attachOpen: false, reactFor: null, staged: null, stageProblem: '', replyTo: { id: 'SYN-0002' }, frequent: [], preview: '', disabled: false, placeholder: 'Reply' };
  const markup = words(composer.render.call(c));
  assert.ok(!markup.includes('Replying in thread') && !markup.includes('composer-thread'), 'the composer carries no indicator row');
  assert.equal(conversation.composerPlaceholder.call(h), 'Reply');
  assert.equal(conversation.composerPlaceholder.call(host()), 'Message');
  assert.equal(conversation.composerPlaceholder.call(host({ sending: false })), 'Sending is off on the server');
});

// Issue 214: the timeline links a thread's messages only where the conversation in it changes hands. Synthetic messages
// in the client's own shape, one minute apart.
const msg = (id, minute, fromMe, replyTo = null) => ({ id, sentAt: new Date(Date.UTC(2026, 0, 16, 9, minute)).toISOString(), fromMe, sender: fromMe ? '' : HANDLE, text: 'Synthetic ' + id, replyTo, attachments: [], reactions: [] });
const linkPairs = (links) => links.map((l) => l.from + '>' + l.to);
const drawnLines = (page) => [...page.matchAll(/class="thread-line"[^>]*?data-from=([A-Z0-9-]+)[^>]*?data-to=([A-Z0-9-]+)/g)].map((m) => m[1] + '>' + m[2]);

test('a thread draws a line only at the end of a run from one side, to the first message of the other side\'s answer', () => {
  const list = [
    msg('R', 0, true),
    msg('X1', 1, false),
    msg('A1', 2, false, 'R'),
    msg('A2', 3, false, 'R'),
    msg('X2', 4, true),
    msg('B1', 5, true, 'R'),
    msg('B2', 6, true, 'R'),
    msg('A3', 7, false, 'R'),
    msg('X3', 8, false),
  ];
  const links = threadLinks(list);
  // Your original links to the reply it received; their latest in the run (A2, never A1) links to your next reply; your
  // latest (B2, never B1) links to their next reply. Nothing starts or ends on a message outside the thread.
  assert.deepEqual(linkPairs(links), ['R>A1', 'A2>B1', 'B2>A3']);
  assert.deepEqual(links.map((l) => l.side), ['mine', 'theirs', 'mine'], 'each line runs on the side of the message it leaves');
  for (const id of ['X1', 'X2', 'X3', 'A1', 'B1']) assert.ok(!links.some((l) => l.from === id), id + ' starts no line');
  const h = withParts(host({ messages: list }));
  const page = words(conversation.render.call(h));
  assert.deepEqual(drawnLines(page), ['R>A1', 'A2>B1', 'B2>A3'], 'the conversation draws exactly those lines, between those bubbles');
  for (const m of list) assert.ok(!words(conversation.bubble.call(h, { message: m, first: true, last: true }, null, false, 'list')).includes('thread-line'), m.id + ' carries no line of its own');
  const own = threadLinks([msg('S', 0, false), msg('S1', 1, false, 'S'), msg('S2', 2, false, 'S')]);
  assert.deepEqual(own, [], 'a thread answered only from one side has no change of hands to draw');
});

test('two interleaved threads link each message only to the answer in its own thread, on separate lanes where they overlap', () => {
  const list = [
    msg('T2', 0, false),
    msg('T1', 1, true),
    msg('O1', 2, false),
    msg('P1', 3, false, 'T1'),
    msg('Q1', 4, true, 'T2'),
    msg('P2', 5, true, 'T1'),
    msg('Q2', 6, false, 'T2'),
    msg('O2', 7, true),
  ];
  const links = threadLinks(list);
  assert.deepEqual(linkPairs(links), ['T2>Q1', 'T1>P1', 'P1>P2', 'Q1>Q2'], 'P1 answers into P2, never the neighbouring Q1');
  assert.deepEqual(links.map((l) => l.root), ['T2', 'T1', 'T1', 'T2']);
  const lane = (pair) => links.find((l) => l.from + '>' + l.to === pair).lane;
  assert.notEqual(lane('T2>Q1'), lane('P1>P2'), 'two lines on their side whose spans overlap take separate lanes');
  assert.equal(lane('T1>P1'), lane('Q1>Q2'), 'a lane is reused once the line in it has ended');
  const h = withParts(host({ messages: list }));
  const page = words(conversation.render.call(h));
  assert.deepEqual(drawnLines(page), linkPairs(links));
  assert.equal((page.match(/class="thread-line"/g) || []).length, 4, 'no line for O1 or O2');
});
