// The Messages store reader behind GET /api/v1/changes (issue 441): unsends and read receipts found by their own marks
// in a synthetic store, oldest first, in bounded pages, so a page that ends between two rows stamped in the same
// millisecond never skips the second.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createChangeReader } from '../src/engine/changes.js';

function syntheticStore() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'changes-'));
  const file = path.join(dir, 'chat.db');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, text TEXT, is_from_me INTEGER DEFAULT 0, date_read INTEGER DEFAULT 0, date_retracted INTEGER DEFAULT 0); CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);');
  const ns = (iso) => (BigInt(Date.parse(iso) - Date.UTC(2001, 0, 1)) * 1000000n) + 123456n;
  const add = db.prepare('INSERT INTO message (ROWID, guid, text, is_from_me, date_read, date_retracted) VALUES (?, ?, ?, ?, ?, ?)');
  const join = db.prepare('INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)');
  add.run(1, 'G-1', 'Synthetic plain', 0, ns('2026-05-01T09:00:00.000Z'), 0); join.run(7, 1);
  add.run(2, 'G-2', 'Synthetic mine', 1, ns('2026-05-01T10:00:00.000Z'), 0); join.run(7, 2);
  add.run(3, 'G-3', null, 1, 0, ns('2026-05-01T10:05:00.000Z')); join.run(8, 3);
  add.run(4, 'G-4', 'Synthetic mine too', 1, ns('2026-05-01T10:00:00.000Z'), 0); join.run(8, 4);
  return { dir, file, db, add, join, ns };
}

test('the store reader finds unsent rows and read receipts by their marks, in order, and only our own messages are read receipts', (t) => {
  const st = syntheticStore();
  const reader = createChangeReader({ dbPath: st.file });
  t.after(() => { reader.close(); st.db.close(); rmSync(st.dir, { recursive: true, force: true }); });
  const latest = reader.latest();
  assert.equal(latest.rowid, 4);
  assert.deepEqual(reader.unsentSince(latest.unsent).rows, [], 'nothing after the newest unsend');
  assert.deepEqual(reader.readSince(latest.read).rows, [], 'nothing after the newest read receipt');
  assert.deepEqual(reader.unsentSince([0, 0]).rows, [{ rowid: 3, guid: 'G-3', chatId: '8' }]);
  // Two receipts at the same moment are both found, one page apart, because the mark carries the row as well.
  const first = reader.readSince([0, 0], 1);
  assert.deepEqual(first.rows.map((r) => r.guid), ['G-2']);
  assert.equal(first.more, true);
  const second = reader.readSince(first.cursor, 1);
  assert.deepEqual(second.rows.map((r) => [r.guid, r.chatId, r.readAt]), [['G-4', '8', '2026-05-01T10:00:00.000Z']]);
  assert.deepEqual([...reader.unsentAmong(['G-1', 'G-3', 'G-none'])], ['G-3']);
});

test('a store from before unsends and receipts existed has none', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'changes-'));
  const file = path.join(dir, 'chat.db');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, text TEXT); CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);');
  const reader = createChangeReader({ dbPath: file });
  t.after(() => { reader.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });
  assert.deepEqual(reader.latest(), { rowid: 0, unsent: [0, 0], read: [0, 0] });
  assert.deepEqual(reader.unsentSince([0, 0]).rows, []);
  assert.deepEqual(reader.readSince([0, 0]).rows, []);
  assert.equal(reader.unsentAmong(['G-1']).size, 0);
});
