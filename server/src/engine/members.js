// A group's people changing (issue 456). A person added to a group or removed from it is a row of its own in the
// Messages store, item type 1 with group action 0 (added) or 1 (removed) and the person in other_handle, a row of the
// store's handle table; someone leaving is item type 3 with group action 0, the one who left being the row's sender.
// imsg's message reads carry no mark of any of it, so this module reads WHICH rows those are, and whom each was about,
// from the store itself, read-only and only for the rows a page or the live stream asks about, the way backgrounds.js
// reads which rows are a background changing.
import { DatabaseSync } from 'node:sqlite';
import { MEMBER_ACTIONS, memberAction } from '../../../core/app/rules/engine-imsg.js';

const KINDS = Object.keys(MEMBER_ACTIONS).map((k) => k.split(':').map(Number));

/** @param {{ dbPath: string, open?: (file: string) => any }} options */
export function createMemberReader({ dbPath, open = (file) => new DatabaseSync(file, { readOnly: true }) }) {
  let db = null;
  let columns = null;
  let handles = false;
  const conn = () => {
    if (!db) db = open(dbPath);
    if (!columns) {
      columns = new Set(db.prepare("SELECT name FROM pragma_table_info('message')").all().map((r) => r.name));
      handles = db.prepare("SELECT name FROM pragma_table_info('handle')").all().some((r) => r.name === 'id');
    }
    return db;
  };
  // A store from before these rows were recorded has neither column: nothing in it is a person joining or leaving.
  const readable = () => Boolean(conn()) && columns.has('item_type') && columns.has('group_action_type');
  const where = '(' + KINDS.map(([item, action]) => '(m.item_type = ' + item + ' AND m.group_action_type = ' + action + ')').join(' OR ') + ')';
  return {
    // Of these message guids, the ones the store records as a person added, removed or leaving, each with its action
    // and the address of the person added or removed (null for someone leaving, or for one the store does not name).
    among(guids) {
      const list = [...new Set((guids || []).map(String))].filter(Boolean);
      const found = new Map();
      if (!list.length || !readable()) return found;
      const other = columns.has('other_handle') && handles;
      const sql = 'SELECT m.guid AS guid, m.item_type AS item, m.group_action_type AS action' + (other ? ', h.id AS handle' : ', NULL AS handle') +
        ' FROM message m' + (other ? ' LEFT JOIN handle h ON h.ROWID = m.other_handle' : '') +
        ' WHERE ' + where + ' AND m.guid IN (' + list.map(() => '?').join(',') + ')';
      for (const r of conn().prepare(sql).all(...list)) {
        const action = memberAction(r.item, r.action);
        if (!action) continue;
        const handle = action !== 'leave' && typeof r.handle === 'string' && r.handle.trim() ? r.handle.trim() : null;
        found.set(String(r.guid), { action, handle });
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
