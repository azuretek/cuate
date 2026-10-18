// Which messages were edited, read from the Messages store itself (issue 391). imsg reports a message's CURRENT text
// (recovered from its attributedBody when an edit has emptied the text column) but no mark that it was edited, and its
// watch is a cursor over new rows, so an edit made on another device never reaches the live stream. Messages records
// each edit on the row it changes: date_edited (nanoseconds since 2001) and the edit history in message_summary_info.
// This module reads date_edited, read-only, to learn WHICH rows changed and when; the text itself is still asked of the
// engine, so it is mapped by the same rule as every other message. It also reads the history (issue 437): under the
// summary's ec key, for each edited part, every version it has had, each its attributed words (t, the typedstream
// archive attributedBody uses) and when it was written (d, seconds since 2001), oldest first, the last being the words
// the message carries now. A history any part of which cannot be read is told as none, never guessed past.
//
// An unsend also stamps the row (date_retracted) and is not an edit, so a retracted row is left out here.
import { DatabaseSync } from 'node:sqlite';
import { readPlist } from './bplist.js';
import { readAttributedString } from './typedstream.js';

const APPLE_EPOCH_MS = Date.UTC(2001, 0, 1);
const NS_PER_MS = 1000000;
// How many edited rows one scan reads at most; a scan that fills it is followed by another from where it stopped.
export const EDIT_SCAN_ROWS = 100;

const iso = (msSince2001) => new Date(APPLE_EPOCH_MS + Number(msSince2001)).toISOString();
// An inline attachment's place in the words, which the model never draws.
const OBJECT_REPLACEMENT = /\uFFFC/g;

/**
 * The earlier versions one message_summary_info holds, oldest first, without the words the message carries now; null
 * when it holds no edit history or any of it cannot be read.
 * @param {Buffer | Uint8Array} summary
 * @returns {{ text: string, at: string }[] | null}
 */
export function editHistory(summary) {
  let root;
  try {
    root = readPlist(Buffer.from(summary));
  } catch {
    return null;
  }
  const ec = root && typeof root === 'object' && !Array.isArray(root) ? root.ec : null;
  if (!ec || typeof ec !== 'object' || Array.isArray(ec)) return null;
  const earlier = [];
  for (const part of Object.keys(ec)) {
    const events = ec[part];
    if (!Array.isArray(events)) return null;
    for (let i = 0; i < events.length - 1; i += 1) {
      const ev = events[i];
      const seconds = Number(ev && ev.d);
      if (!ev || !Buffer.isBuffer(ev.t) || !Number.isFinite(seconds)) return null;
      let text;
      try {
        text = readAttributedString(ev.t).text.replace(OBJECT_REPLACEMENT, '').trim();
      } catch {
        return null;
      }
      if (text) earlier.push({ text, at: iso(seconds * 1000) });
    }
    // The newest version is checked too, so a history whose current words cannot be read is not half told.
    const last = events[events.length - 1];
    if (!last || !Buffer.isBuffer(last.t)) return null;
    try { readAttributedString(last.t); } catch { return null; }
  }
  return earlier.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/**
 * The reader opens the store lazily, read-only, and keeps the connection; close() lets it go.
 * @param {{ dbPath: string, open?: (file: string) => any }} options
 */
export function createEditReader({ dbPath, open = (file) => new DatabaseSync(file, { readOnly: true }) }) {
  let db = null;
  let columns = null;
  const conn = () => {
    if (!db) db = open(dbPath);
    if (!columns) columns = new Set(db.prepare("SELECT name FROM pragma_table_info('message')").all().map((r) => r.name));
    return db;
  };
  // A store from before edits existed has no date_edited column: nothing in it was ever edited.
  const editable = () => Boolean(conn()) && columns.has('date_edited');
  const notRetracted = () => (columns.has('date_retracted') ? ' AND COALESCE(m.date_retracted, 0) = 0' : '');
  const at = 'm.date_edited / ' + NS_PER_MS;

  return {
    // The newest edit the store holds, as milliseconds since 2001, so a scan starts from now and never replays history.
    latest() {
      if (!editable()) return 0;
      const r = conn().prepare('SELECT MAX(' + at + ') AS at FROM message m WHERE m.date_edited > 0' + notRetracted()).get();
      return r && r.at ? Number(r.at) : 0;
    },
    // The rows edited after cursor (milliseconds since 2001), oldest edit first, with the chat each belongs to.
    since(cursor, limit = EDIT_SCAN_ROWS) {
      const from = Math.max(0, Math.trunc(Number(cursor) || 0));
      if (!editable()) return { rows: [], cursor: from, more: false };
      const rows = conn().prepare(
        'SELECT m.ROWID AS rowid, m.guid AS guid, j.chat_id AS chat_id, ' + at + ' AS at ' +
        'FROM message m JOIN chat_message_join j ON j.message_id = m.ROWID ' +
        'WHERE m.date_edited > 0 AND ' + at + ' > ?' + notRetracted() + ' ORDER BY at ASC LIMIT ?',
      ).all(from, limit);
      return {
        rows: rows.map((r) => ({ rowid: Number(r.rowid), guid: String(r.guid), chatId: String(r.chat_id), editedAt: iso(r.at) })),
        cursor: rows.length ? Number(rows[rows.length - 1].at) : from,
        more: rows.length >= limit,
      };
    },
    // Of these message guids, the ones the store records as edited, each with when: a page of history is marked from it.
    among(guids) {
      const list = [...new Set((guids || []).map(String))].filter(Boolean);
      const found = new Map();
      if (!list.length || !editable()) return found;
      const rows = conn().prepare(
        'SELECT m.guid AS guid, ' + at + ' AS at FROM message m WHERE m.date_edited > 0' + notRetracted() +
        ' AND m.guid IN (' + list.map(() => '?').join(',') + ')',
      ).all(...list);
      for (const r of rows) found.set(String(r.guid), iso(r.at));
      return found;
    },
    // Of these message guids, the edited ones whose store keeps a history, each with its earlier versions, oldest first.
    histories(guids) {
      const list = [...new Set((guids || []).map(String))].filter(Boolean);
      const found = new Map();
      if (!list.length || !editable() || !columns.has('message_summary_info')) return found;
      const rows = conn().prepare(
        'SELECT m.guid AS guid, m.message_summary_info AS summary FROM message m WHERE m.date_edited > 0' + notRetracted() +
        ' AND m.message_summary_info IS NOT NULL AND m.guid IN (' + list.map(() => '?').join(',') + ')',
      ).all(...list);
      for (const r of rows) {
        const earlier = r.summary ? editHistory(Buffer.from(r.summary)) : null;
        if (earlier && earlier.length) found.set(String(r.guid), earlier);
      }
      return found;
    },
    close() {
      try { db?.close(); } catch { /* already closed */ }
      db = null;
      columns = null;
    },
  };
}
