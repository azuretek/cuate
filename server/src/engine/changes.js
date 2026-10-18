// What changed in place in the Messages store, read from the store itself (issue 441). New rows have their own cursor
// (ROWID, which the engine's messages.after already walks) and edits have theirs (edits.js); this reader answers the
// other two changes a row can take after it is written: an unsend, which stamps date_retracted, and a read receipt on
// one of our own messages, which stamps date_read. Both are read-only, by when they happened, so a client that was away
// asks for what changed after the mark it holds rather than reading every page again.
//
// A mark is [milliseconds since 2001, ROWID]: two rows stamped in the same millisecond are still told apart, so a page
// that ends between them never skips the second.
import { DatabaseSync } from 'node:sqlite';

const APPLE_EPOCH_MS = Date.UTC(2001, 0, 1);
const NS_PER_MS = 1000000;
// How many changed rows one read answers at most; a read that fills it says more, and the next starts where it stopped.
export const CHANGE_SCAN_ROWS = 200;

const iso = (msSince2001) => new Date(APPLE_EPOCH_MS + Number(msSince2001)).toISOString();
const ZERO = [0, 0];
const mark = (m) => (Array.isArray(m) && m.length === 2 ? [Math.max(0, Math.trunc(Number(m[0]) || 0)), Math.max(0, Math.trunc(Number(m[1]) || 0))] : ZERO);

/**
 * The reader opens the store lazily, read-only, and keeps the connection; close() lets it go.
 * @param {{ dbPath: string, open?: (file: string) => any }} options
 */
export function createChangeReader({ dbPath, open = (file) => new DatabaseSync(file, { readOnly: true }) }) {
  let db = null;
  let columns = null;
  const conn = () => {
    if (!db) db = open(dbPath);
    if (!columns) columns = new Set(db.prepare("SELECT name FROM pragma_table_info('message')").all().map((r) => r.name));
    return db;
  };
  const has = (name) => Boolean(conn()) && columns.has(name);
  // A row stamped by a column, after a mark, oldest first; where says which rows the column counts for.
  const stamped = (column, where) => {
    const at = 'm.' + column + ' / ' + NS_PER_MS;
    return {
      at,
      latest: () => {
        if (!has(column)) return ZERO;
        const r = conn().prepare('SELECT ' + at + ' AS at, m.ROWID AS rowid FROM message m WHERE m.' + column + ' > 0' + where() + ' ORDER BY at DESC, rowid DESC LIMIT 1').get();
        return r ? [Number(r.at), Number(r.rowid)] : ZERO;
      },
      since: (cursor, limit) => {
        const [from, row] = mark(cursor);
        if (!has(column)) return { rows: [], cursor: [from, row], more: false };
        const rows = conn().prepare(
          'SELECT m.ROWID AS rowid, m.guid AS guid, j.chat_id AS chat_id, ' + at + ' AS at ' +
          'FROM message m JOIN chat_message_join j ON j.message_id = m.ROWID ' +
          'WHERE m.' + column + ' > 0' + where() + ' AND (' + at + ' > ? OR (' + at + ' = ? AND m.ROWID > ?)) ORDER BY at ASC, rowid ASC LIMIT ?',
        ).all(from, from, row, limit);
        const last = rows.at(-1);
        return { rows, cursor: last ? [Number(last.at), Number(last.rowid)] : [from, row], more: rows.length >= limit };
      },
    };
  };
  const unsent = stamped('date_retracted', () => '');
  // A read receipt is the other person reading one of OUR messages; date_read on their message is us reading it, which
  // the chat list's unread count already carries.
  const read = stamped('date_read', () => (columns.has('is_from_me') ? ' AND m.is_from_me = 1' : ' AND 0'));

  return {
    // Where the store stands now: its newest row, and its newest unsend and read receipt.
    latest() {
      const top = conn().prepare('SELECT MAX(ROWID) AS rowid FROM message').get();
      return { rowid: top && top.rowid ? Number(top.rowid) : 0, unsent: unsent.latest(), read: read.latest() };
    },
    unsentSince(cursor, limit = CHANGE_SCAN_ROWS) {
      const page = unsent.since(cursor, limit);
      return { ...page, rows: page.rows.map((r) => ({ rowid: Number(r.rowid), guid: String(r.guid), chatId: String(r.chat_id) })) };
    },
    readSince(cursor, limit = CHANGE_SCAN_ROWS) {
      const page = read.since(cursor, limit);
      return { ...page, rows: page.rows.map((r) => ({ rowid: Number(r.rowid), guid: String(r.guid), chatId: String(r.chat_id), readAt: iso(r.at) })) };
    },
    // Of these message guids, the ones that were unsent: a new row that was taken back before anyone asked is never served.
    unsentAmong(guids) {
      const list = [...new Set((guids || []).map(String))].filter(Boolean);
      if (!list.length || !has('date_retracted')) return new Set();
      const rows = conn().prepare('SELECT m.guid AS guid FROM message m WHERE m.date_retracted > 0 AND m.guid IN (' + list.map(() => '?').join(',') + ')').all(...list);
      return new Set(rows.map((r) => String(r.guid)));
    },
    close() {
      try { db?.close(); } catch { /* already closed */ }
      db = null;
      columns = null;
    },
  };
}
