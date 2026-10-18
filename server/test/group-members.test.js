import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createEngine } from '../src/engine/index.js';
import { createMemberReader } from '../src/engine/members.js';
import { createContacts } from '../src/contacts.js';
import { createLogger } from '../../core/kit/log.js';
import { logSpec } from '../src/paths.js';
import { eventText, chatPreview, applyMessageToChats, upsertChat } from '../../core/app/rules/chats.js';
import { MEMBER_ACTIONS, memberAction } from '../../core/app/rules/engine-imsg.js';
import { buildFixtures, SCRIPT, CONTACTS } from '../src/engine/fixtures.js';
import { boot, waitFor, openSocket } from './helpers.js';

// Issue 456: a person added to a group, removed from it, or leaving it is a row of its own with no text and no
// attachment. Messages records an added or removed person as item type 1 (group action 0 added, 1 removed) with the person
// in other_handle, and someone leaving as item type 3, group action 0, the one who left being the sender. The engine's read
// says none of that, so the row reached the app as an empty message. Every row is synthetic.
const SAM = '+15555550123';
const RILEY = 'riley@example.com';
const row = (over = {}) => ({ id: 9, guid: 'MB-9', chat_id: 5, is_from_me: false, sender: SAM, sender_name: 'Sam Example', text: '', created_at: '2026-01-02T03:04:05.000Z', attachments: [], ...over });
const words = { id: 8, guid: 'TX-8', chat_id: 5, is_from_me: false, sender: SAM, sender_name: 'Sam Example', text: 'Synthetic hello', created_at: '2026-01-02T03:00:00.000Z', attachments: [] };

function transport(rows) {
  const lineCbs = new Set();
  const send = (o) => setImmediate(() => { for (const cb of lineCbs) cb(JSON.stringify(o)); });
  return {
    write(s) {
      const req = JSON.parse(s);
      if (req.method === 'status') return send({ jsonrpc: '2.0', id: req.id, result: { version: 't', database: { ready: true }, methods: [], capabilities: { features: {} } } });
      if (req.method === 'watch.subscribe') return send({ jsonrpc: '2.0', id: req.id, result: { subscription: 1 } });
      if (req.method === 'chats.list') return send({ jsonrpc: '2.0', id: req.id, result: { chats: [{ id: 5, display_name: 'Group', is_group: true }] } });
      if (req.method === 'messages.history') return send({ jsonrpc: '2.0', id: req.id, result: { messages: req.params.chat_id === 5 ? rows : [] } });
      return send({ jsonrpc: '2.0', id: req.id, result: { ok: true } });
    },
    onLine(cb) { lineCbs.add(cb); },
    onExit() {},
    close() { return Promise.resolve(); },
  };
}

// What the store records for those rows: the shape the adapter is given in place of the real reader (members.js).
const membersFor = (events) => ({ among: (guids) => new Map(events.filter((e) => guids.includes(e.guid)).map((e) => [e.guid, { action: e.action, handle: e.handle || null }])) });

async function withEngine(rows, members, fn) {
  const log = createLogger({ spec: logSpec, app: 'test', run: 'test', sink: () => {}, now: Date.now, level: 'debug', strict: true });
  const engine = createEngine({ kind: 'fake', makeTransport: () => transport(rows), log: log.child('engine'), attachmentId: (a) => 'att:' + a.original_path, timeoutMs: 2000, members });
  await engine.start();
  try {
    await fn(engine);
  } finally {
    await engine.stop();
  }
}

test('a person added, removed or leaving is a line naming who did it and whom it was about, never an empty message (issue 456)', async () => {
  const rows = [words, row({ guid: 'MB-1', id: 1 }), row({ guid: 'MB-2', id: 2 }), row({ guid: 'MB-3', id: 3, sender: RILEY, sender_name: '' }), row({ guid: 'MB-4', id: 4, is_from_me: true, sender: '' }), row({ guid: 'EMPTY', id: 5 })];
  const events = [{ guid: 'MB-1', action: 'add', handle: RILEY }, { guid: 'MB-2', action: 'remove', handle: RILEY }, { guid: 'MB-3', action: 'leave' }, { guid: 'MB-4', action: 'add', handle: SAM }];
  await withEngine(rows, membersFor(events), async (engine) => {
    const { messages } = await engine.messages('5');
    const by = (id) => messages.find((x) => x.id === id);
    assert.deepEqual(by('MB-1').event, { kind: 'member', action: 'add', person: { handle: RILEY, name: null } });
    assert.deepEqual(by('MB-1').attachments, []);
    assert.equal(eventText(by('MB-1')), 'Sam Example added riley@example.com to the conversation', 'a person Contacts does not know is named by address');
    assert.equal(eventText(by('MB-2')), 'Sam Example removed riley@example.com from the conversation');
    assert.deepEqual(by('MB-3').event, { kind: 'member', action: 'leave' }, 'someone leaving is the sender, and the event names no one else');
    assert.equal(eventText(by('MB-3')), 'riley@example.com left the conversation');
    assert.equal(eventText(by('MB-4')), 'You added +15555550123 to the conversation', 'a change made by you reads from You');
    assert.equal(eventText({ ...by('MB-3'), fromMe: true, sender: null, senderName: null }), 'You left the conversation');
    assert.equal(by('EMPTY').event, undefined, 'only the rows the store records as a change are one');
    assert.equal(by('TX-8').event, undefined, 'an ordinary message is a message');
  });
});

test('the list preview names the change, and the group\'s people follow at once (issue 456)', () => {
  const m = { id: 'MB-1', chatId: '5', fromMe: false, sender: SAM, senderName: 'Sam Example', text: '', sentAt: '2026-01-02T03:04:05.000Z', attachments: [], link: null, payloads: 0, reactions: [], event: { kind: 'member', action: 'add', person: { handle: RILEY, name: 'Riley Example' } } };
  const chats = [{ id: '5', name: 'Group', isGroup: true, unread: 0, participants: [SAM, 'jordan@example.com'], members: [{ handle: SAM, name: 'Sam Example', photo: null }, { handle: 'jordan@example.com', name: 'jordan@example.com', photo: null }], lastMessageAt: '2026-01-01T00:00:00.000Z', lastMessage: null }];
  const added = applyMessageToChats(chats, m).chats[0];
  assert.equal(chatPreview(added), 'Sam Example added Riley Example to the conversation');
  assert.deepEqual(added.participants, [SAM, 'jordan@example.com', RILEY]);
  assert.deepEqual(added.members.at(-1), { handle: RILEY, name: 'Riley Example', photo: null });
  const removed = applyMessageToChats([added], { ...m, sentAt: '2026-01-02T03:05:00.000Z', event: { kind: 'member', action: 'remove', person: { handle: RILEY, name: 'Riley Example' } } }).chats[0];
  assert.equal(chatPreview(removed), 'Sam Example removed Riley Example from the conversation');
  assert.deepEqual(removed.participants, [SAM, 'jordan@example.com']);
  const left = applyMessageToChats([removed], { ...m, sender: 'jordan@example.com', senderName: null, sentAt: '2026-01-02T03:06:00.000Z', event: { kind: 'member', action: 'leave' } }).chats[0];
  assert.equal(chatPreview(left), 'jordan@example.com left the conversation');
  assert.deepEqual(left.participants, [SAM]);
  assert.deepEqual(left.members.map((x) => x.handle), [SAM]);
  // The chat changing straight after, which carries no preview, keeps the line the list draws.
  const after = upsertChat([left], { id: '5', name: 'Group', isGroup: true, participants: [SAM], lastMessage: null });
  assert.equal(chatPreview(after[0]), 'jordan@example.com left the conversation');
});

// A scratch folder, removed by one hook that first closes everything holding a file there (Windows cannot remove a
// folder with an open handle).
const scratch = (t, name) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), name + '-'));
  const holders = [];
  t.after(() => { for (const h of holders) h.close(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, hold: (h) => { holders.push(h); return h; } };
};

test('the store reader names the rows Messages records as a person added, removed or leaving, and whom each was about (issue 456)', (t) => {
  const { dir, hold } = scratch(t, 'mb-store');
  const file = path.join(dir, 'chat.db');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT); CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, text TEXT, item_type INTEGER, group_action_type INTEGER, other_handle INTEGER, handle_id INTEGER);');
  db.prepare('INSERT INTO handle (ROWID, id) VALUES (?, ?)').run(1, SAM);
  db.prepare('INSERT INTO handle (ROWID, id) VALUES (?, ?)').run(2, RILEY);
  const put = db.prepare('INSERT INTO message (ROWID, guid, text, item_type, group_action_type, other_handle, handle_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
  // Added, removed, left, a background set (3/4), a group photo (3/1), a rename (2/0), a message, and an add whose
  // person the store does not name.
  const rows = [[1, 'A-1', null, 1, 0, 2, 1], [2, 'R-2', null, 1, 1, 2, 1], [3, 'L-3', null, 3, 0, 0, 2], [4, 'B-4', null, 3, 4, 0, 1], [5, 'P-5', null, 3, 1, 0, 1], [6, 'N-6', null, 2, 0, 0, 1], [7, 'T-7', 'Synthetic hello', 0, 0, 0, 1], [8, 'A-8', null, 1, 0, 0, 1]];
  for (const r of rows) put.run(...r);
  db.close();
  const reader = hold(createMemberReader({ dbPath: file }));
  const found = reader.among(rows.map((r) => r[1]));
  assert.deepEqual([...found.entries()].sort(), [
    ['A-1', { action: 'add', handle: RILEY }],
    ['A-8', { action: 'add', handle: null }],
    ['L-3', { action: 'leave', handle: null }],
    ['R-2', { action: 'remove', handle: RILEY }],
  ], 'a background, a group photo, a rename and a message are none of them');
  assert.equal(reader.among([]).size, 0);
  assert.deepEqual(MEMBER_ACTIONS, { '1:0': 'add', '1:1': 'remove', '3:0': 'leave' });
  assert.equal(memberAction(3, 4), null);
});

test('a store from before these rows were recorded has none (issue 456)', (t) => {
  const { dir, hold } = scratch(t, 'mb-old');
  const file = path.join(dir, 'chat.db');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT);');
  db.close();
  assert.equal(hold(createMemberReader({ dbPath: file })).among(['X']).size, 0);
});

test('the fake engine\'s group holds a synthetic person added and leaving (issue 456)', () => {
  const { messages, members } = buildFixtures({ base: 0, imagePath: '/x', imageBytes: 1 });
  assert.deepEqual(members.map((e) => e.action), ['add', 'leave']);
  for (const e of members) {
    const m = messages.find((x) => x.guid === e.guid);
    assert.equal(m.text, '');
    assert.deepEqual(m.attachments, []);
  }
  assert.ok(SCRIPT.some((line) => line[5] && line[5].member === 'add'));
});

const event = (frames, name, test) => frames.find((f) => f.type === 'event' && f.name === name && test(f.data));
const fakeContacts = () => createContacts({ run: async () => JSON.stringify({ authorized: true, status: 3, contacts: CONTACTS }), watchDir: null });

test('end to end: the history draws each line, a change on another phone or from here reaches every client, and the group\'s people follow (issue 456)', async (t) => {
  const s = await boot({ contacts: fakeContacts() });
  t.after(() => s.close());
  const page = await (await s.get('/api/v1/chats/2/messages?limit=50', s.tokens.device)).json();
  const lines = page.messages.filter((m) => m.event && m.event.kind === 'member').map(eventText);
  assert.deepEqual(lines, ['Sam Rivera added riley@example.com to the conversation', 'riley@example.com left the conversation'], 'each is a line, the person named by contact name or by address');
  assert.equal(page.messages.filter((m) => !m.event && !m.text && !m.attachments.length).length, 0, 'and nothing in the history is an empty message');

  const a = await openSocket(s.base);
  t.after(() => a.ws.close());
  a.ws.send(JSON.stringify({ type: 'auth', token: s.tokens.device }));
  await waitFor(() => a.frames.some((f) => f.type === 'hello'));
  await s.get('/api/v1/chats', s.tokens.device);

  // Jordan adds Avery on their phone: Avery is in Contacts, so the line names her.
  const live = s.world.memberElsewhere(2, 'jordan@example.com', 'add', '+15555550100');
  await waitFor(() => Boolean(event(a.frames, 'message.new', (d) => d.message.id === live.guid)));
  const arrived = event(a.frames, 'message.new', (d) => d.message.id === live.guid).data.message;
  assert.equal(eventText(arrived), 'Jordan Lee added Avery Quinn to the conversation');
  await waitFor(() => Boolean(event(a.frames, 'chat.changed', (d) => d.id === '2' && d.participants.includes('+15555550100'))));
  const changed = event(a.frames, 'chat.changed', (d) => d.id === '2' && d.participants.includes('+15555550100')).data;
  assert.ok(changed.members.some((m) => m.handle === '+15555550100' && m.name === 'Avery Quinn'), 'the group\'s people follow at once');
  assert.equal(chatPreview(changed), 'Jordan Lee added Avery Quinn to the conversation', 'and the chat changing carries the line as its preview');

  // A person removed from here draws the same line, from You.
  const res = await fetch(s.base + '/api/v1/chats/2/members/' + encodeURIComponent('+15555550100'), { method: 'DELETE', headers: { authorization: 'Bearer ' + s.tokens.device } });
  assert.equal(res.status, 200);
  await waitFor(() => Boolean(event(a.frames, 'message.new', (d) => d.message.fromMe && d.message.event && d.message.event.action === 'remove')));
  assert.equal(eventText(event(a.frames, 'message.new', (d) => d.message.fromMe && d.message.event && d.message.event.action === 'remove').data.message), 'You removed Avery Quinn from the conversation');
  assert.ok(!(await res.json()).participants.includes('+15555550100'));

  // Priya leaves on her phone.
  const gone = s.world.memberElsewhere(2, 'priya@example.com', 'leave');
  await waitFor(() => Boolean(event(a.frames, 'message.new', (d) => d.message.id === gone.guid)));
  assert.equal(eventText(event(a.frames, 'message.new', (d) => d.message.id === gone.guid).data.message), 'Priya Shah left the conversation');
  await waitFor(() => Boolean(event(a.frames, 'chat.changed', (d) => d.id === '2' && !d.participants.includes('priya@example.com'))));
  const list = await (await s.get('/api/v1/chats', s.tokens.device)).json();
  const group = list.chats.find((c) => c.id === '2');
  assert.equal(chatPreview(group), 'Priya Shah left the conversation', 'the list read afterwards agrees');
  assert.ok(!group.participants.includes('priya@example.com'));

  // A client that keeps its messages reads the same names from what changed.
  const head = await (await s.get('/api/v1/changes', s.tokens.device)).json();
  s.world.memberElsewhere(2, 'jordan@example.com', 'add', 'priya@example.com');
  await waitFor(() => a.frames.some((f) => f.type === 'event' && f.name === 'chat.changed' && f.data.id === '2' && f.data.participants.includes('priya@example.com')));
  const since = await (await s.get('/api/v1/changes?since=' + encodeURIComponent(head.cursor), s.tokens.device)).json();
  assert.deepEqual(since.messages.filter((m) => m.event).map(eventText), ['Jordan Lee added Priya Shah to the conversation']);
});
