// Group renames (issue 439). Someone naming a group, or removing its name, is a row of its own in the Messages store,
// item type 2 with the new name in group_title (empty when the name was removed), and imsg's message reads carry no
// mark of it, so this module reads WHICH rows those are, and the name each gave, from the store itself, read-only and
// only for the rows a page or the live stream asks about, the way edits.js and backgrounds.js do.
import { DatabaseSync } from 'node:sqlite';
import { RENAME_ITEM_TYPE } from '../../../core/app/rules/engine-imsg.js';

/** @param {{ dbPath: string, open?: (file: string) => any }} options */
export function createRenameReader({ dbPath, open = (file) => new DatabaseSync(file, { readOnly: true }) }) {
  let db = null;
  let columns = null;
  const conn = () => {
    if (!db) db = open(dbPath);
    if (!columns) columns = new Set(db.prepare("SELECT name FROM pragma_table_info('message')").all().map((r) => r.name));
    return db;
  };
  // A store from before renames were recorded has neither column: nothing in it is a rename.
  const readable = () => Boolean(conn()) && columns.has('item_type') && columns.has('group_title');
  return {
    // Of these message guids, the ones the store records as a rename, each with the name it gave ('' when removed).
    among(guids) {
      const list = [...new Set((guids || []).map(String))].filter(Boolean);
      const found = new Map();
      if (!list.length || !readable()) return found;
      const rows = conn().prepare('SELECT m.guid AS guid, m.group_title AS title FROM message m WHERE m.item_type = ' + RENAME_ITEM_TYPE + ' AND m.guid IN (' + list.map(() => '?').join(',') + ')').all(...list);
      for (const r of rows) found.set(String(r.guid), typeof r.title === 'string' ? r.title : '');
      return found;
    },
    close() {
      if (db) db.close();
      db = null;
    },
  };
}
