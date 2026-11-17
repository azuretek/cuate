// Issue 537: the server gives a live or changes-lane row the history cursor imsg would give it on a history page, read
// from the store: the row's date and ROWID, joined as imsg's HistoryCursor.token joins them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHistoryCursorReader } from '../src/engine/history-cursors.js';
import { historyCursor } from '../../core/app/rules/history.js';

test('a row\'s cursor is its exact date and ROWID, past the integers a number holds (issue 537)', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, date INTEGER)');
  // A Messages timestamp in nanoseconds since 2001: larger than Number.MAX_SAFE_INTEGER, so a number would round it.
  db.prepare('INSERT INTO message (ROWID, guid, date) VALUES (?, ?, ?)').run(41, 'SYNTHETIC-41', 815364450121000123n);
  db.prepare('INSERT INTO message (ROWID, guid, date) VALUES (?, ?, ?)').run(42, 'SYNTHETIC-42', null);
  const reader = createHistoryCursorReader({ dbPath: ':memory:', open: () => db });
  const found = reader.among([41, 42, 43, 'x']);
  assert.equal(found.get(41), '815364450121000123:41', 'the exact date, never a rounded one');
  assert.equal(found.get(42), '0:42', 'a row with no date reads as imsg reads it, zero');
  assert.equal(found.has(43), false, 'a row the store does not hold has no cursor');
  assert.ok(historyCursor(found.get(41)), 'a cursor the history routes accept');
  assert.equal(reader.among([]).size, 0);
  reader.close();
});
