// The history cursor of a message the engine handed over without one (issue 537). imsg puts `history_cursor` only on a
// history page (messages.history); a row from the live watch or from messages.after (the changes lane) has none, so a
// client whose window ended on one could not page newer from it. The cursor is the store's own two values, the row's
// `date` and its ROWID, joined the way imsg's HistoryCursor.token joins them, so it is the same string a history page
// gives the same row. Read-only, and only for the rows asked about, the way send-effects.js reads its column.
import { DatabaseSync } from 'node:sqlite';

/**
 * The reader opens the store lazily, read-only, and keeps the connection; close() lets it go.
 * @param {{ dbPath: string, open?: (file: string) => any }} options
 */
export function createHistoryCursorReader({ dbPath, open = (file) => new DatabaseSync(file, { readOnly: true }) }) {
  let db = null;
  const conn = () => {
    if (!db) db = open(dbPath);
    return db;
  };
  return {
    // Of these row ids, each one's cursor. The date is read as text: Messages' nanosecond timestamps are past the
    // integers a JavaScript number holds exactly, and a rounded one would name another place in the conversation.
    among(rowids) {
      const list = [...new Set((rowids || []).map(Number))].filter((n) => Number.isSafeInteger(n) && n > 0);
      const found = new Map();
      if (!list.length) return found;
      const rows = conn().prepare(
        "SELECT ROWID AS id, CAST(COALESCE(date, 0) AS TEXT) AS date FROM message WHERE ROWID IN (" + list.map(() => '?').join(',') + ')',
      ).all(...list);
      for (const r of rows) found.set(Number(r.id), String(r.date) + ':' + Number(r.id));
      return found;
    },
    close() {
      try { db?.close(); } catch { /* already closed */ }
      db = null;
    },
  };
}
