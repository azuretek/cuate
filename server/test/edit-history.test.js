// The edit history of an edited message (issue 437). Messages keeps every version a message part has had on the row
// itself, in message_summary_info: under ec, for each edited part, each version's attributed words (t, a typedstream
// archive) and when it was written (d, seconds since 2001), oldest first, the last being the words the message carries
// now. imsg reads none of it, so the server reads it from the store, read-only, and a message carries its earlier
// versions as edits, oldest first, through every read, the live edit event and an edit made from this app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { boot, waitFor, openSocket } from './helpers.js';
import { apiSpec } from '../src/paths.js';
import { validate } from '../../core/kit/rules/schema.js';
import { createEditReader } from '../src/engine/edits.js';
import { writePlist } from '../src/engine/bplist.js';

const conforms = (v, type) => assert.deepEqual(validate(v, type, apiSpec.models), []);
const { versions } = JSON.parse(readFileSync(new URL('./fixtures/edit-history.json', import.meta.url), 'utf8'));
const body = (v) => Buffer.from(v.base64, 'base64');
const sec = (iso) => Math.round((Date.parse(iso) - Date.UTC(2001, 0, 1)) / 1000);
const ns = (iso) => BigInt(sec(iso)) * 1000000000n;
const AT = ['2026-05-01T10:00:00.000Z', '2026-05-01T10:01:00.000Z', '2026-05-01T10:02:30.000Z'];
const summary = (events) => writePlist({ otr: { 0: { lo: 0, le: 34 } }, ec: { 0: events } });

function store() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'edit-history-'));
  const file = path.join(dir, 'chat.db');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, text TEXT, date_edited INTEGER DEFAULT 0, date_retracted INTEGER DEFAULT 0, message_summary_info BLOB); CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);');
  const add = db.prepare('INSERT INTO message (ROWID, guid, text, date_edited, date_retracted, message_summary_info) VALUES (?, ?, ?, ?, ?, ?)');
  // Three versions: two earlier ones and the words it carries now.
  add.run(1, 'G-1', null, ns(AT[2]), 0, summary(versions.map((v, i) => ({ d: sec(AT[i]), t: body(v) }))));
  // Edited, but the store kept no history for it.
  add.run(2, 'G-2', null, ns(AT[1]), 0, null);
  // A summary that is not a property list at all.
  add.run(3, 'G-3', null, ns(AT[1]), 0, Buffer.from('not a property list, synthetic'));
  // A version whose words are not an archive: the history cannot be trusted, so none is told.
  add.run(4, 'G-4', null, ns(AT[1]), 0, summary([{ d: sec(AT[0]), t: Buffer.from('synthetic, not typedstream') }, { d: sec(AT[1]), t: body(versions[2]) }]));
  // Never edited, though it has a summary: its history is not read.
  add.run(5, 'G-5', 'Synthetic plain', 0, 0, summary([{ d: sec(AT[0]), t: body(versions[0]) }]));
  // Unsent after an edit: not an edit, so no history.
  add.run(6, 'G-6', null, ns(AT[1]), ns(AT[2]), summary(versions.map((v, i) => ({ d: sec(AT[i]), t: body(v) }))));
  return { dir, file, db };
}

test('the store reader tells each edited row\'s earlier versions, oldest first, and nothing it cannot trust', (t) => {
  const st = store();
  const reader = createEditReader({ dbPath: st.file });
  // Close everything that holds the file before the folder is removed: on Windows a directory with an open handle cannot be removed.
  t.after(() => { reader.close(); st.db.close(); rmSync(st.dir, { recursive: true, force: true }); });
  const found = reader.histories(['G-1', 'G-2', 'G-3', 'G-4', 'G-5', 'G-6', 'G-none']);
  assert.deepEqual([...found.keys()], ['G-1']);
  assert.deepEqual(found.get('G-1'), [
    { text: versions[0].text, at: AT[0] },
    { text: versions[1].text, at: AT[1] },
  ], 'the earlier versions, oldest first; the words it carries now are the message\'s own');
});

test('a store from before edit history existed tells none', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'edit-history-'));
  const file = path.join(dir, 'chat.db');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, text TEXT, date_edited INTEGER DEFAULT 0); CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);');
  const reader = createEditReader({ dbPath: file });
  t.after(() => { reader.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });
  assert.equal(reader.histories(['G-1']).size, 0);
});

const listen = async (s) => {
  const a = await openSocket(s.base);
  a.ws.send(JSON.stringify({ type: 'auth', token: s.tokens.device }));
  await waitFor(() => a.frames.some((f) => f.type === 'hello'));
  return a;
};
const editedEvents = (a, id) => a.frames.filter((f) => f.type === 'event' && f.name === 'message.edited' && f.data.message.id === id);
const page = async (s) => (await (await s.get('/api/v1/chats/1/messages?limit=50', s.tokens.device)).json()).messages;

test('an edit made on another device adds the words it replaced to the history, live and on every read', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const before = (await page(s)).find((m) => m.id === 'FAKE-0013');
  assert.ok(before && before.text, 'the message being edited');
  assert.equal(before.edits, undefined, 'a message never edited carries no history');
  const a = await listen(s);
  t.after(() => a.ws.close());
  s.world.editElsewhere('FAKE-0013', 'Synthetic words edited once');
  await waitFor(() => editedEvents(a, 'FAKE-0013').length === 1);
  const first = editedEvents(a, 'FAKE-0013')[0].data;
  conforms(first, 'MessageEvent');
  assert.deepEqual(first.message.edits.map((v) => v.text), [before.text]);
  assert.ok(!Number.isNaN(Date.parse(first.message.edits[0].at)));
  s.world.editElsewhere('FAKE-0013', 'Synthetic words edited twice');
  await waitFor(() => editedEvents(a, 'FAKE-0013').length === 2);
  const second = editedEvents(a, 'FAKE-0013')[1].data.message;
  assert.equal(second.text, 'Synthetic words edited twice');
  assert.deepEqual(second.edits.map((v) => v.text), [before.text, 'Synthetic words edited once'], 'oldest first');
  const read = (await page(s)).find((m) => m.id === 'FAKE-0013');
  conforms(read, 'Message');
  assert.deepEqual(read.edits.map((v) => v.text), [before.text, 'Synthetic words edited once'], 'kept on reload');
});

test('an edit made from this app adds the words it replaced to the history', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const a = await listen(s);
  t.after(() => a.ws.close());
  const r = await s.post('/api/v1/chats/1/messages', s.tokens.device, { text: 'Synthetic words before', clientKey: 'key-' + Math.random().toString(36).slice(2, 12) });
  const id = (await r.json()).messageId;
  assert.equal((await s.put('/api/v1/chats/1/messages/' + id + '/text', s.tokens.device, { text: 'Synthetic words after' })).status, 200);
  await waitFor(() => editedEvents(a, id).length === 1);
  assert.deepEqual(editedEvents(a, id)[0].data.message.edits.map((v) => v.text), ['Synthetic words before']);
});
