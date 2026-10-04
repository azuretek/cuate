// Threads are drawn from the stored pointer alone (issues 195 and 208). Only a message the engine records with a
// thread originator is a reply: imsg also reports `reply_to_guid`, which Messages fills on ordinary rows with the
// message before it, and reading that as a thread marked every consecutive message as a reply to the one above it.
// Every drawn path is that originator pointer walked back, so two interleaved threads stay apart and nothing is
// inferred from who spoke before whom. The rows below are shaped like imsg's real history output (the keys it emits on
// ordinary and threaded rows, measured on a Mac), with synthetic handles, guids and text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapMessage } from '../app/rules/engine-imsg.js';
import { threadMarks, threadPath, threadIds, threadRoot, replyCountLabel, mergeMessages } from '../app/rules/messages.js';

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
const withParts = (h) => { for (const k of ['bubble', 'threadView', 'menu', 'threadSummary', 'composerPlaceholder']) h[k] = conversation[k]; return h; };

test('only a message the engine records with a thread originator is a reply, never one that reply_to_guid chains to the row before it', () => {
  const byId = new Map(mapped().map((m) => [m.id, m]));
  for (const id of ['SYN-0001', 'SYN-0002', 'SYN-0003', 'SYN-0004', 'SYN-0007']) assert.equal(byId.get(id).replyTo, null, id + ' is an ordinary message');
  assert.equal(byId.get('SYN-0005').replyTo, 'SYN-0002', 'the reply names its thread\'s original, not the row before it');
  assert.equal(byId.get('SYN-0006').replyTo, 'SYN-0002');
});

test('an ordinary message carries no thread affordance, and no line is drawn between two messages', () => {
  const h = withParts(host());
  const list = mapped();
  const marks = threadMarks(list);
  for (const id of ['SYN-0001', 'SYN-0003', 'SYN-0004', 'SYN-0007']) {
    assert.equal(marks.has(id), false, id + ' answers nothing and is answered by nothing, so it carries no mark');
    const markup = words(conversation.bubble.call(h, { message: list.find((m) => m.id === id), first: true, last: true }, null, false, 'list'));
    assert.ok(!/thread-reply|thread-count|thread-line|thread-ghost/.test(markup), id + ' draws no thread chrome');
  }
  const page = words(conversation.render.call(h));
  assert.ok(!/thread-line|thread-ghost|reply-mark/.test(page), 'nothing is drawn between two messages, so no pairing is implied');
  assert.equal((page.match(/class=thread-replies/g) || []).length, 1, 'exactly one summary line, for the one real thread');
});

test('a reply links to the message it answers and to nothing else, and the message it answers carries the count', () => {
  const list = mapped();
  const marks = threadMarks(list);
  assert.deepEqual([...marks.keys()].sort(), ['SYN-0002', 'SYN-0005', 'SYN-0006']);
  assert.deepEqual(marks.get('SYN-0002'), { replies: 2 }, 'the original carries the count of the replies present');
  assert.deepEqual(marks.get('SYN-0005'), { root: 'SYN-0002' }, 'the reply names exactly the message it answers');
  assert.deepEqual(marks.get('SYN-0006'), { root: 'SYN-0002' });
  assert.deepEqual(threadPath(list, 'SYN-0005'), ['SYN-0005', 'SYN-0002'], 'the path back is the stored pointer walked');
  assert.deepEqual(threadPath(list, 'SYN-0006'), ['SYN-0006', 'SYN-0002']);
  assert.equal(threadRoot(list, 'SYN-0005'), 'SYN-0002');
  assert.equal(replyCountLabel(1), '1 Reply');
  assert.equal(replyCountLabel(2), '2 Replies');
  const h = withParts(host());
  const page = words(conversation.render.call(h));
  const summaryAt = page.indexOf('class=thread-replies');
  assert.ok(summaryAt > page.indexOf('Yes, nine at the trailhead.'), 'the count line sits under the message it answers');
  assert.ok(summaryAt < page.indexOf('Could we make it half past?'), 'and above the replies');
  assert.ok(page.includes('2 Replies'));
  assert.match(page, /thread-replies mine/, 'the count line takes the side of the message it answers');
  assert.equal((page.match(/thread-reply/g) || []).length, 2, 'each reply is marked once, linked only to its own original');
  assert.ok(page.includes('aria-label=2 Replies. Open the thread'));
  // Pressing a reply opens the thread its pointer walks back to.
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
  assert.ok(!/thread-line|thread-ghost|thread-replies/.test(view), 'no marks inside the thread');
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

// Issue 208: the drawn threads come from the stored pointer alone. Synthetic messages in the client's own shape, one
// minute apart; two threads interleave so adjacency would pair the wrong messages.
const msg = (id, minute, fromMe, replyTo = null) => ({ id, sentAt: new Date(Date.UTC(2026, 0, 16, 9, minute)).toISOString(), fromMe, sender: fromMe ? '' : HANDLE, text: 'Synthetic ' + id, replyTo, attachments: [], reactions: [] });

test('two interleaved threads each keep their own path and their own count, and nothing is inferred from adjacency', () => {
  const list = [
    msg('T2', 0, false),
    msg('T1', 1, true),
    msg('P1', 3, false, 'T1'),
    msg('Q1', 4, true, 'T2'),
    msg('P2', 5, true, 'T1'),
    msg('Q2', 6, false, 'T2'),
    msg('X', 7, false),
  ];
  const marks = threadMarks(list);
  assert.deepEqual(marks.get('T1'), { replies: 2 }, 'each thread keeps its own count');
  assert.deepEqual(marks.get('T2'), { replies: 2 });
  assert.deepEqual(marks.get('P1'), { root: 'T1' }, 'P1 answers T1, never the neighbouring Q1');
  assert.deepEqual(marks.get('P2'), { root: 'T1' });
  assert.deepEqual(marks.get('Q1'), { root: 'T2' });
  assert.deepEqual(marks.get('Q2'), { root: 'T2' });
  assert.equal(marks.has('X'), false, 'a message outside both threads carries nothing');
  assert.deepEqual(threadPath(list, 'P1'), ['P1', 'T1']);
  assert.deepEqual(threadPath(list, 'Q1'), ['Q1', 'T2']);
  // The marks are a property of the pointer, not of the order: adjacency would change with the order, the pointer does not.
  const same = (m) => [...m].sort((a, b) => a[0].localeCompare(b[0]));
  assert.deepEqual(same(threadMarks([...list].reverse())), same(marks));
  const h = withParts(host({ messages: list }));
  const page = words(conversation.render.call(h));
  assert.equal((page.match(/thread-line/g) || []).length, 0, 'no line pairs any two messages');
  assert.equal((page.match(/class=thread-replies/g) || []).length, 2, 'each thread keeps its own count line');
  assert.equal((page.match(/thread-reply/g) || []).length, 4, 'four replies, each linked only to its own original');
});

test('a reply whose parent is not loaded yet still carries its pointer, and resolves once the parent loads', () => {
  const reply = msg('D1', 0, false, 'P');
  const alone = [reply];
  const before = threadMarks(alone);
  assert.deepEqual(before.get('D1'), { root: 'P' }, 'the reply keeps the pointer it was ingested with');
  assert.equal(before.has('P'), false, 'the parent is not present, so nothing carries a count yet');
  assert.deepEqual(threadPath(alone, 'D1'), ['D1', 'P'], 'the path reaches the parent id');
  const withParent = [msg('P', 1, true), reply];
  const after = threadMarks(withParent);
  assert.deepEqual(after.get('P'), { replies: 1 }, 'once the parent is loaded it carries the count');
  assert.deepEqual(after.get('D1'), { root: 'P' });
  assert.deepEqual([...threadIds(withParent, 'D1')].sort(), ['D1', 'P']);
});

test('the count is the replies actually present', () => {
  const list = [msg('R', 0, true), msg('A', 1, false, 'R'), msg('B', 2, false, 'R'), msg('C', 3, false, 'R')];
  assert.deepEqual(threadMarks(list).get('R'), { replies: 3 });
  const fewer = list.filter((m) => m.id !== 'C');
  assert.deepEqual(threadMarks(fewer).get('R'), { replies: 2 });
  assert.equal(replyCountLabel(threadMarks(fewer).get('R').replies), '2 Replies');
});
