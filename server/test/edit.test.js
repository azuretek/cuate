// Edited messages (issue 391): an edit made on another device is read from the Messages store's own record of it and
// told to every client as message.edited with the new words; every read serves the current words with the Edited mark;
// and one of our own messages is edited through the engine's message.edit, refused in place wherever it cannot go.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { boot, waitFor, openSocket } from './helpers.js';
import { apiSpec } from '../src/paths.js';
import { validate } from '../../core/kit/rules/schema.js';
import { createEditReader } from '../src/engine/edits.js';

const conforms = (v, type) => assert.deepEqual(validate(v, type, apiSpec.models), []);
const textOf = (chat, id) => '/api/v1/chats/' + chat + '/messages/' + id + '/text';
const listen = async (s) => {
  const a = await openSocket(s.base);
  a.ws.send(JSON.stringify({ type: 'auth', token: s.tokens.device }));
  await waitFor(() => a.frames.some((f) => f.type === 'hello'));
  return a;
};
const edited = (a, id) => a.frames.find((f) => f.type === 'event' && f.name === 'message.edited' && f.data.message.id === id);
// A message we send now, so it is inside the fifteen-minute window.
const sendOwn = async (s, text) => {
  const r = await s.post('/api/v1/chats/1/messages', s.tokens.device, { text, clientKey: 'key-' + Math.random().toString(36).slice(2, 12) });
  assert.equal(r.status, 201);
  return (await r.json()).messageId;
};

test('an edit made on another device is told to every client as message.edited, with the new words and the mark', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const a = await listen(s);
  t.after(() => a.ws.close());
  s.world.editElsewhere('FAKE-0013', 'Synthetic words edited on the phone');
  await waitFor(() => Boolean(edited(a, 'FAKE-0013')));
  const ev = edited(a, 'FAKE-0013');
  conforms(ev.data, 'MessageEvent');
  assert.equal(ev.data.message.text, 'Synthetic words edited on the phone');
  assert.equal(ev.data.message.edited, true);
  assert.equal(ev.data.message.chatId, '1');
  assert.ok(!a.frames.some((f) => f.name === 'message.new' && f.data.message.id === 'FAKE-0013'), 'an edit is never a new message');
});

test('a read serves the current words with the Edited mark, so the change is kept on reload, and the list preview follows', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  await s.get('/api/v1/chats', s.tokens.device);
  const a = await listen(s);
  t.after(() => a.ws.close());
  s.world.editElsewhere('FAKE-0013', 'Synthetic words edited on the phone');
  await waitFor(() => Boolean(edited(a, 'FAKE-0013')));
  const page = await (await s.get('/api/v1/chats/1/messages?limit=50', s.tokens.device)).json();
  conforms(page, 'MessageList');
  const m = page.messages.find((x) => x.id === 'FAKE-0013');
  assert.equal(m.text, 'Synthetic words edited on the phone');
  assert.equal(m.edited, true);
  assert.ok(page.messages.filter((x) => x.id !== 'FAKE-0013').every((x) => !x.edited), 'no other message is marked');
  const { chats } = await (await s.get('/api/v1/chats', s.tokens.device)).json();
  const chat = chats.find((c) => c.id === '1');
  assert.equal(chat.lastMessage.text, 'Synthetic words edited on the phone', 'the chat list preview reads the new words');
  assert.equal(chat.lastMessage.edited, true);
});

test('our own message is edited through the engine, answered with its words, and told to every client like any edit', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const a = await listen(s);
  t.after(() => a.ws.close());
  const id = await sendOwn(s, 'Synthetic words before');
  const r = await s.put(textOf(1, id), s.tokens.device, { text: '  Synthetic words after ' });
  assert.equal(r.status, 200);
  const body = await r.json();
  conforms(body, 'EditResult');
  assert.deepEqual(body, { status: 'edited', messageId: id, text: 'Synthetic words after' });
  assert.equal(s.world.requests.filter((x) => x === 'message.edit').length, 1);
  await waitFor(() => Boolean(edited(a, id)));
  assert.equal(edited(a, id).data.message.text, 'Synthetic words after');
  const info = await (await s.get('/api/v1/info', s.tokens.device)).json();
  assert.equal(info.engine.edit, true, 'the app is told this engine can edit, so it offers Edit');
});

test('an edit is refused in place where it cannot go, and the engine is never asked', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const id = await sendOwn(s, 'Synthetic words before');
  const refused = async (chat, msg, text, code, status = 422) => {
    const r = await s.put(textOf(chat, msg), s.tokens.device, { text });
    assert.equal(r.status, status, code);
    assert.equal((await r.json()).error.code, code);
  };
  await refused(1, 'FAKE-0013', 'Synthetic', 'edit_not_yours');
  await refused(1, 'FAKE-0012', 'Synthetic', 'edit_window');
  await refused(3, 'FAKE-0002', 'Synthetic', 'edit_unsupported');
  await refused(1, 'FAKE-0011', 'Synthetic', 'edit_not_yours');
  await refused(1, id, 'Synthetic words before', 'edit_same');
  await refused(1, id, '   ', 'bad_text', 400);
  await refused(1, 'FAKE-9999', 'Synthetic', 'edit_unknown');
  const tool = await s.put(textOf(1, id), s.tokens.tooling, { text: 'Synthetic' });
  assert.equal(tool.status, 403, 'a tooling token cannot send, so it cannot edit');
  assert.equal(s.world.requests.filter((x) => x === 'message.edit').length, 0, 'none of them reached the engine');
});

test('an engine that cannot edit is never asked, says so, and the app is told it cannot', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  s.world.behavior.edit = false;
  await s.engine.restart();
  const id = await sendOwn(s, 'Synthetic words before');
  const r = await s.put(textOf(1, id), s.tokens.device, { text: 'Synthetic words after' });
  assert.equal(r.status, 422);
  const body = await r.json();
  assert.equal(body.error.code, 'edit_unsupported');
  assert.match(body.error.message, /cannot edit/);
  assert.equal(s.world.requests.filter((x) => x === 'message.edit').length, 0);
  const info = await (await s.get('/api/v1/info', s.tokens.device)).json();
  assert.equal(info.engine.edit, false);
});

test('an edit whose outcome the engine cannot vouch for is reported uncertain and never retried', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const id = await sendOwn(s, 'Synthetic words before');
  s.world.behavior.send = 'uncertain';
  const r = await s.put(textOf(1, id), s.tokens.device, { text: 'Synthetic words after' });
  assert.equal(r.status, 202);
  assert.equal((await r.json()).status, 'uncertain');
  assert.equal(s.world.requests.filter((x) => x === 'message.edit').length, 1, 'asked once, not retried');
});

// The store reader, over a database shaped like the Messages one (only the columns it reads), synthetic rows only.
function syntheticStore() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'edits-'));
  const file = path.join(dir, 'chat.db');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, text TEXT, date_edited INTEGER DEFAULT 0, date_retracted INTEGER DEFAULT 0); CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);');
  const ns = (iso) => (BigInt(Date.parse(iso) - Date.UTC(2001, 0, 1)) * 1000000n) + 123456n;
  const add = db.prepare('INSERT INTO message (ROWID, guid, text, date_edited, date_retracted) VALUES (?, ?, ?, ?, ?)');
  const join = db.prepare('INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)');
  add.run(1, 'G-1', 'Synthetic plain', 0, 0); join.run(7, 1);
  add.run(2, 'G-2', null, ns('2026-05-01T10:00:00.000Z'), 0); join.run(7, 2);
  add.run(3, 'G-3', null, ns('2026-05-01T10:05:00.000Z'), ns('2026-05-01T10:05:00.000Z')); join.run(8, 3);
  return { dir, file, db, add, join, ns };
}

test('the store reader finds edited rows by their edit time, leaves out an unsent one, and starts from the newest edit', (t) => {
  const st = syntheticStore();
  t.after(() => { st.db.close(); rmSync(st.dir, { recursive: true, force: true }); });
  const reader = createEditReader({ dbPath: st.file });
  t.after(() => reader.close());
  const start = reader.latest();
  assert.equal(new Date(Date.UTC(2001, 0, 1) + start).toISOString(), '2026-05-01T10:00:00.000Z', 'the unsent row is not an edit');
  assert.deepEqual(reader.since(start).rows, [], 'nothing after the newest edit');
  const all = reader.since(0);
  assert.deepEqual(all.rows, [{ rowid: 2, guid: 'G-2', chatId: '7', editedAt: '2026-05-01T10:00:00.000Z' }]);
  st.add.run(4, 'G-4', null, st.ns('2026-05-01T10:10:00.000Z'), 0);
  st.join.run(7, 4);
  const next = reader.since(start);
  assert.deepEqual(next.rows.map((r) => r.guid), ['G-4'], 'a later edit is found from the cursor');
  assert.ok(next.cursor > start);
  assert.deepEqual([...reader.among(['G-1', 'G-2', 'G-3', 'G-4', 'G-none'])].map(([g]) => g).sort(), ['G-2', 'G-4']);
});

test('a store from before edits existed has nothing edited', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'edits-'));
  const file = path.join(dir, 'chat.db');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, text TEXT); CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);');
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const reader = createEditReader({ dbPath: file });
  t.after(() => reader.close());
  assert.equal(reader.latest(), 0);
  assert.deepEqual(reader.since(0).rows, []);
  assert.equal(reader.among(['G-1']).size, 0);
});
