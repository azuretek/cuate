// Which messages are voice messages, and which of those were played, read from the Messages store itself (issue 440).
// imsg reports a voice message as a message with one Core Audio attachment, with no mark that it is a voice message and
// no mark that anyone played it. Messages records both on the message's own row: is_audio_message, and is_played with
// date_played (nanoseconds since 2001) once it is played on any of the person's devices. This module reads them,
// read-only, for the rows a page or a live message names, the way edits.js reads date_edited.
import { DatabaseSync } from 'node:sqlite';

const APPLE_EPOCH_MS = Date.UTC(2001, 0, 1);
const NS_PER_MS = 1000000;

/**
 * The reader opens the store lazily, read-only, and keeps the connection; close() lets it go.
 * @param {{ dbPath: string, open?: (file: string) => any }} options
 */
export function createVoiceReader({ dbPath, open = (file) => new DatabaseSync(file, { readOnly: true }) }) {
  let db = null;
  let columns = null;
  const conn = () => {
    if (!db) db = open(dbPath);
    if (!columns) columns = new Set(db.prepare("SELECT name FROM pragma_table_info('message')").all().map((r) => r.name));
    return db;
  };
  return {
    // Of these message guids, the voice messages, each with whether it was played and when. A store from before the
    // columns existed names none.
    among(guids) {
      const list = [...new Set((guids || []).map(String))].filter(Boolean);
      const found = new Map();
      if (!list.length || !conn() || !columns.has('is_audio_message')) return found;
      const played = columns.has('is_played') ? 'm.is_played' : '0';
      const at = columns.has('date_played') ? 'm.date_played / ' + NS_PER_MS : '0';
      const rows = conn().prepare(
        'SELECT m.guid AS guid, ' + played + ' AS played, ' + at + ' AS at FROM message m WHERE m.is_audio_message = 1' +
        ' AND m.guid IN (' + list.map(() => '?').join(',') + ')',
      ).all(...list);
      for (const r of rows) {
        const heard = Number(r.played) === 1;
        found.set(String(r.guid), { played: heard, ...(heard && Number(r.at) > 0 ? { playedAt: new Date(APPLE_EPOCH_MS + Number(r.at)).toISOString() } : {}) });
      }
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
