// Conversation backgrounds (issue 417). A participant setting or clearing a conversation's background is a row of its
// own in the Messages store, item type 3 with group action 4 (set) or 6 (cleared), and imsg's message reads carry no
// mark of it, so this module reads WHICH rows those are from the store itself, read-only, the way edits.js reads which
// rows were edited. What a chat's background IS now is asked of the engine: `imsg chat-background status` reads the
// chat's own record and names the picture Messages rendered for it in its transcript background cache.
import { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { BACKGROUND_ACTIONS } from '../../../core/app/rules/engine-imsg.js';

const CODES = Object.keys(BACKGROUND_ACTIONS).map(Number);
const STATUS_TIMEOUT_MS = 10000;

const runEngine = (bin, args) => new Promise((resolve, reject) => {
  execFile(bin, args, { timeout: STATUS_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err, stdout) => {
    if (err) reject(Object.assign(new Error('chat-background status failed'), { code: err.code === 'ENOENT' ? 'engine_missing' : err.killed ? 'timeout' : 'status_failed' }));
    else resolve(String(stdout));
  });
});

/**
 * engineDb is the database the engine was told to read (config.engine.db), passed on to it the way the rpc child is.
 * @param {{ dbPath: string, bin: string, engineDb?: string | null, open?: (file: string) => any, run?: (bin: string, args: string[]) => Promise<string> }} options
 */
export function createBackgroundReader({ dbPath, bin, engineDb = null, open = (file) => new DatabaseSync(file, { readOnly: true }), run = runEngine }) {
  let db = null;
  let columns = null;
  const conn = () => {
    if (!db) db = open(dbPath);
    if (!columns) columns = new Set(db.prepare("SELECT name FROM pragma_table_info('message')").all().map((r) => r.name));
    return db;
  };
  // A store from before backgrounds existed has neither column: nothing in it is a background change.
  const readable = () => Boolean(conn()) && columns.has('item_type') && columns.has('group_action_type');
  const where = 'm.item_type = 3 AND m.group_action_type IN (' + CODES.join(',') + ')';
  return {
    // Of these message guids, the ones the store records as a background change, each with its action.
    among(guids) {
      const list = [...new Set((guids || []).map(String))].filter(Boolean);
      const found = new Map();
      if (!list.length || !readable()) return found;
      const rows = conn().prepare('SELECT m.guid AS guid, m.group_action_type AS action FROM message m WHERE ' + where + ' AND m.guid IN (' + list.map(() => '?').join(',') + ')').all(...list);
      for (const r of rows) found.set(String(r.guid), BACKGROUND_ACTIONS[Number(r.action)]);
      return found;
    },
    // Each chat's newest background change, so the chat list asks the engine only for the chats that have one.
    latest() {
      const found = new Map();
      if (!readable()) return found;
      const rows = conn().prepare(
        'SELECT j.chat_id AS chat_id, m.guid AS guid, m.group_action_type AS action FROM message m JOIN chat_message_join j ON j.message_id = m.ROWID ' +
        'WHERE ' + where + ' ORDER BY m.date DESC, m.ROWID DESC',
      ).all();
      for (const r of rows) {
        const id = String(r.chat_id);
        if (!found.has(id)) found.set(id, { chatId: id, guid: String(r.guid), action: BACKGROUND_ACTIONS[Number(r.action)] });
      }
      return found;
    },
    // What the engine reports for the chat's background now, as its JSON.
    async status(chatId) {
      const id = String(chatId);
      if (!/^\d{1,12}$/.test(id)) return null;
      const out = await run(bin, ['chat-background', 'status', '--chat-id', id, '--json', ...(engineDb ? ['--db', engineDb] : [])]);
      const line = out.split('\n').map((l) => l.trim()).find((l) => l.startsWith('{'));
      return line ? JSON.parse(line) : null;
    },
    close() {
      try { db?.close(); } catch { /* already closed */ }
      db = null;
      columns = null;
    },
  };
}
