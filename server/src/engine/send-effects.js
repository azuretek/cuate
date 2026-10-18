// The effect a message was sent with (issue 442), read from the Messages store itself. A sender's Slam, Invisible Ink,
// Confetti or any other bubble or screen effect is a column on the message's own row, expressive_send_style_id, holding
// Messages' identifier for it, and imsg's message reads do not carry it. This module reads that column alone,
// read-only, and only for the rows a page of history or the live stream asks about, the way edits.js reads which rows
// were edited; the message itself is still asked of the engine, so it is mapped by the same rule as every other.
import { DatabaseSync } from 'node:sqlite';

/**
 * The reader opens the store lazily, read-only, and keeps the connection; close() lets it go.
 * @param {{ dbPath: string, open?: (file: string) => any }} options
 */
export function createSendEffectReader({ dbPath, open = (file) => new DatabaseSync(file, { readOnly: true }) }) {
  let db = null;
  let columns = null;
  const conn = () => {
    if (!db) db = open(dbPath);
    if (!columns) columns = new Set(db.prepare("SELECT name FROM pragma_table_info('message')").all().map((r) => r.name));
    return db;
  };
  // A store from before effects existed has no such column: nothing in it was sent with one.
  const readable = () => Boolean(conn()) && columns.has('expressive_send_style_id');
  return {
    // Of these message guids, the ones the store records an effect on, each with Messages' identifier for it.
    among(guids) {
      const list = [...new Set((guids || []).map(String))].filter(Boolean);
      const found = new Map();
      if (!list.length || !readable()) return found;
      const rows = conn().prepare(
        "SELECT m.guid AS guid, m.expressive_send_style_id AS style FROM message m WHERE COALESCE(m.expressive_send_style_id, '') != ''" +
        ' AND m.guid IN (' + list.map(() => '?').join(',') + ')',
      ).all(...list);
      for (const r of rows) found.set(String(r.guid), String(r.style));
      return found;
    },
    close() {
      try { db?.close(); } catch { /* already closed */ }
      db = null;
      columns = null;
    },
  };
}
