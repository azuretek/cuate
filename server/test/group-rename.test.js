import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createEngine } from '../src/engine/index.js';
import { createLogger } from '../../core/kit/log.js';
import { logSpec } from '../src/paths.js';
import { eventText, chatPreview, chatTitle, applyMessageToChats, upsertChat } from '../../core/app/rules/chats.js';
import { boot, waitFor, openSocket } from './helpers.js';
import { buildFixtures, SCRIPT } from '../src/engine/fixtures.js';

// Issue 439: someone naming a group, or removing its name, is a row of its own with no text and no attachment
// (Messages records it as item type 2, with the new name in group_title, empty when the name was removed). The engine's
// read says none of that, so the row reached the app as an empty message. Every row here is synthetic.
const SAM = '+15555550123';
const row = (over = {}) => ({ id: 9, guid: 'RN-9', chat_id: 5, is_from_me: false, sender: SAM, sender_name: 'Sam Example', text: '', created_at: '2026-01-02T03:04:05.000Z', attachments: [], ...over });
const words = { id: 8, guid: 'TX-8', chat_id: 5, is_from_me: false, sender: SAM, sender_name: 'Sam Example', text: 'Synthetic hello', created_at: '2026-01-02T03:00:00.000Z', attachments: [] };
const quoted = (name) => '\u201c' + name + '\u201d';

// The engine as imsg answers it: the rename row is an ordinary row with nothing in it.
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

// What the store records for those rows: the shape the adapter is given in place of the real reader
// (server/src/engine/renames.js), each rename row's guid with the name it gave.
const renamesFor = (names) => ({ among: (guids) => new Map(Object.entries(names).filter(([guid]) => guids.includes(guid))) });

async function withEngine(rows, renames, fn) {
  const log = createLogger({ spec: logSpec, app: 'test', run: 'test', sink: () => {}, now: Date.now, level: 'debug', strict: true });
  const engine = createEngine({ kind: 'fake', makeTransport: () => transport(rows), log: log.child('engine'), attachmentId: (a) => 'att:' + a.original_path, timeoutMs: 2000, renames });
  await engine.start();
  try {
    await fn(engine);
  } finally {
    await engine.stop();
  }
}

test('a group renamed is a line naming who named it and the name, never an empty message (issue 439)', async () => {
  await withEngine([row(), words], renamesFor({ 'RN-9': 'Weekend plans' }), async (engine) => {
    const { messages } = await engine.messages('5');
    const m = messages.find((x) => x.id === 'RN-9');
    assert.equal(m.event && m.event.kind, 'rename', 'the row is the group being renamed');
    assert.equal(m.event.name, 'Weekend plans');
    assert.deepEqual(m.attachments, []);
    assert.equal(eventText(m), 'Sam Example named the conversation ' + quoted('Weekend plans'));
    assert.equal(eventText({ ...m, fromMe: true }), 'You named the conversation ' + quoted('Weekend plans'));
    assert.equal(messages.find((x) => x.id === 'TX-8').event, undefined, 'an ordinary message is a message');
  });
});

test('a name removed reads as removed, and an empty row Messages records as nothing else stays a message (issue 439)', async () => {
  await withEngine([row({ guid: 'RN-10', id: 10 }), row({ guid: 'NOT-RN', id: 11 })], renamesFor({ 'RN-10': '' }), async (engine) => {
    const { messages } = await engine.messages('5');
    const m = messages.find((x) => x.id === 'RN-10');
    assert.equal(m.event && m.event.kind, 'rename');
    assert.equal(m.event.name, '');
    assert.equal(eventText(m), 'Sam Example removed the name from the conversation');
    assert.equal(messages.find((x) => x.id === 'NOT-RN').event, undefined, 'only the rows the store records as a rename are one');
  });
});

test('the list preview says the same, and the group takes the name at once (issue 439)', () => {
  const m = { id: 'RN-9', chatId: '5', fromMe: false, sender: SAM, senderName: 'Sam Example', text: '', sentAt: '2026-01-02T03:04:05.000Z', attachments: [], link: null, payloads: 0, reactions: [], event: { kind: 'rename', name: 'Lake trip' } };
  const chats = [{ id: '5', name: 'Group', isGroup: true, participants: [SAM, 'friend@example.com'], unread: 0, lastMessageAt: '2026-01-01T00:00:00.000Z', lastMessage: null }];
  const named = applyMessageToChats(chats, m).chats[0];
  assert.equal(named.name, 'Lake trip', 'the title follows the rename');
  assert.equal(chatTitle(named), 'Lake trip');
  assert.equal(chatPreview(named), 'Sam Example named the conversation ' + quoted('Lake trip'));
  // The server then tells every client the chat changed, carrying no preview of its own; the line stays the preview.
  assert.equal(chatPreview(upsertChat([named], { ...chats[0], name: 'Lake trip', lastMessage: null })[0]), 'Sam Example named the conversation ' + quoted('Lake trip'));
  const removed = applyMessageToChats(chats, { ...m, fromMe: true, sender: null, senderName: null, event: { kind: 'rename', name: '' } }).chats[0];
  assert.equal(removed.name, '', 'a removed name leaves the group to be named by its people');
  assert.equal(chatPreview(removed), 'You removed the name from the conversation');
});

// A scratch folder; the reader is closed before the folder is removed, since Windows cannot remove an open file.
const scratch = (t, name) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), name + '-'));
  const holders = [];
  t.after(() => { for (const h of holders) h.close(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, hold: (h) => { holders.push(h); return h; } };
};

test('the store reader names the rows Messages records as a rename, each with the name it gave (issue 439)', async (t) => {
  const { createRenameReader } = await import('../src/engine/renames.js');
  const { dir, hold } = scratch(t, 'rename-store');
  const file = path.join(dir, 'chat.db');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, text TEXT, item_type INTEGER, group_action_type INTEGER, group_title TEXT)');
  const put = db.prepare('INSERT INTO message (ROWID, guid, text, item_type, group_action_type, group_title) VALUES (?, ?, ?, ?, ?, ?)');
  for (const r of [[1, 'N-1', null, 2, 0, 'Weekend plans'], [2, 'R-2', null, 2, 0, null], [3, 'B-3', null, 3, 4, null], [4, 'T-4', 'Synthetic hello', 0, 0, null], [5, 'P-5', null, 1, 0, 'Not a rename']]) put.run(...r);
  db.close();
  const reader = hold(createRenameReader({ dbPath: file }));
  assert.deepEqual([...reader.among(['N-1', 'R-2', 'B-3', 'T-4', 'P-5']).entries()].sort(), [['N-1', 'Weekend plans'], ['R-2', '']], 'a background change, a member change and a message are none');
  assert.equal(reader.among([]).size, 0);
});

test('a store from before renames were recorded has none (issue 439)', async (t) => {
  const { createRenameReader } = await import('../src/engine/renames.js');
  const { dir, hold } = scratch(t, 'rename-old');
  const file = path.join(dir, 'chat.db');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT)');
  db.close();
  const reader = hold(createRenameReader({ dbPath: file }));
  assert.equal(reader.among(['X']).size, 0);
});

test('the fake engine\'s rename is a synthetic row in a synthetic group (issue 439)', () => {
  const { messages, renames } = buildFixtures({ base: 0, imagePath: '/x', imageBytes: 1 });
  assert.ok(Array.isArray(renames), 'the fixtures carry the renames the store records');
  assert.equal(renames.length, 1);
  const m = messages.find((x) => x.guid === renames[0].guid);
  assert.equal(m.text, '');
  assert.deepEqual(m.attachments, []);
  assert.equal(renames[0].name, 'Weekend plans');
  assert.ok(SCRIPT.some((line) => line[5] === 'rename'));
});

const event = (frames, name, test) => frames.find((f) => f.type === 'event' && f.name === name && test(f.data));

test('end to end: the history draws the line, a rename on another phone retitles the group everywhere, and one made here is a line from You (issue 439)', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const page = await (await s.get('/api/v1/chats/2/messages?limit=50', s.tokens.device)).json();
  const line = page.messages.find((m) => m.event && m.event.kind === 'rename');
  assert.ok(line, 'the rename is in the history as an event');
  assert.equal(eventText(line), 'Sam Rivera named the conversation ' + quoted('Weekend plans'));
  assert.equal(page.messages.filter((m) => !m.event && !m.text && !m.attachments.length).length, 0, 'and nothing in the history is an empty message');

  const a = await openSocket(s.base);
  t.after(() => a.ws.close());
  a.ws.send(JSON.stringify({ type: 'auth', token: s.tokens.device }));
  await waitFor(() => a.frames.some((f) => f.type === 'hello'));
  const live = s.world.renameElsewhere(2, 'jordan@example.com', 'Lake trip');
  await waitFor(() => Boolean(event(a.frames, 'message.new', (d) => d.message.id === live.guid)));
  const arrived = event(a.frames, 'message.new', (d) => d.message.id === live.guid).data.message;
  assert.equal(eventText(arrived), 'Jordan Lee named the conversation ' + quoted('Lake trip'));
  await waitFor(() => Boolean(event(a.frames, 'chat.changed', (d) => d.id === '2' && d.name === 'Lake trip')));

  const mine = (name) => event(a.frames, 'message.new', (d) => d.message.fromMe && d.message.event && d.message.event.kind === 'rename' && d.message.event.name === name);
  const renamed = await s.put('/api/v1/chats/2/name', s.tokens.device, { name: 'Our trip' });
  assert.equal(renamed.status, 200);
  await waitFor(() => Boolean(mine('Our trip')));
  assert.equal(eventText(mine('Our trip').data.message), 'You named the conversation ' + quoted('Our trip'), 'a rename made here is the same line, from You');
  const after = await (await s.get('/api/v1/chats', s.tokens.device)).json();
  const group = after.chats.find((c) => c.id === '2');
  assert.equal(group.name, 'Our trip');
  assert.equal(chatPreview(group), 'You named the conversation ' + quoted('Our trip'), 'and the list preview says the same');

  assert.equal((await s.put('/api/v1/chats/2/name', s.tokens.device, { name: '' })).status, 200);
  await waitFor(() => Boolean(mine('')));
  const cleared = (await (await s.get('/api/v1/chats', s.tokens.device)).json()).chats.find((c) => c.id === '2');
  assert.equal(chatPreview(cleared), 'You removed the name from the conversation');
});
