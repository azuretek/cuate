// The service each message travelled on, read from the Messages store itself (issue 520). imsg names a chat's
// service but not a message's, and a chat that has carried both iMessage and SMS holds rows of each, so a consumer that
// must trust a sender (an SMS or RCS sender address can be forged; an iMessage one is authenticated by Apple) needs the
// row's own column. This module reads message.service, read-only, for the rows a page or a live message names, the way
// voices.js reads is_audio_message.
import { DatabaseSync } from 'node:sqlite';

/**
 * The reader opens the store lazily, read-only, and keeps the connection; close() lets it go.
 * @param {{ dbPath: string, open?: (file: string) => any }} options
 */
export function createServiceReader({ dbPath, open = (file) => new DatabaseSync(file, { readOnly: true }) }) {
  let db = null;
  let columns = null;
  const conn = () => {
    if (!db) db = open(dbPath);
    if (!columns) columns = new Set(db.prepare("SELECT name FROM pragma_table_info('message')").all().map((r) => r.name));
    return db;
  };
  return {
    // Of these message guids, each one's service as Messages recorded it ("iMessage", "SMS", "RCS"). A row with none, or
    // a store without the column, names none.
    among(guids) {
      const list = [...new Set((guids || []).map(String))].filter(Boolean);
      const found = new Map();
      if (!list.length || !conn() || !columns.has('service')) return found;
      const rows = conn().prepare('SELECT m.guid AS guid, m.service AS service FROM message m WHERE m.guid IN (' + list.map(() => '?').join(',') + ')').all(...list);
      for (const r of rows) if (typeof r.service === 'string' && r.service) found.set(String(r.guid), r.service);
      return found;
    },
    // For a test: the open connection, to show it is read-only.
    connection() {
      return conn();
    },
    close() {
      try { db?.close(); } catch { /* already closed */ }
      db = null;
      columns = null;
    },
  };
}
