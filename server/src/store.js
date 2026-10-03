// The server's own state, in one SQLite file: tokens (hashed, never stored in the clear), send idempotency records
// (keys and outcomes, no text), the attachment ids it has handed out, and the settings every device shares.
// Messages stay in the Mac's Messages history.
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';

export const SCOPES = ['device', 'tooling', 'admin'];

// The format of the data folder this server understands, kept in state.db's user_version. A server that changes the
// format raises this number; one handed data newer than it understands refuses to open it rather than reading it
// wrong, which is what keeps a rollback from running an older server over a newer folder. Raising it means the
// updater's rollback restores the backup it took before the switch (server/src/updater.js).
export const DATA_FORMAT = 1;
export const DATA_NEWER = 'data_newer';

/** The data format a state.db carries, read without opening it as a store: 0 for a folder with none yet. */
export function dataFormatOf(file) {
  if (!existsSync(file)) return 0;
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db.prepare('pragma user_version').get().user_version;
  } finally {
    db.close();
  }
}

/**
 * Revoke one token straight in a state.db, whatever its format. The updater's health check mints a token before a
 * switch and revokes it after, by which time the folder may carry a format the code doing the revoking cannot open as
 * a store. The tokens table is the same in every format so far; a format that changes it must change this too.
 */
export function revokeTokenIn(file, id, at = new Date().toISOString()) {
  const db = new DatabaseSync(file);
  try {
    db.exec('pragma busy_timeout = 3000;');
    return db.prepare('update tokens set revoked_at = ? where id = ? and revoked_at is null').run(at, String(id)).changes > 0;
  } finally {
    db.close();
  }
}
const SCHEMA = `
create table if not exists tokens (id text primary key, name text not null, scope text not null, hash text not null unique, created_at text not null, last_used_at text, revoked_at text);
create table if not exists sends (client_key text primary key, chat_id text not null, status text not null, message_id text, at text not null);
create table if not exists attachments (id text primary key, path text not null, mime text not null, name text not null, seen_at text not null);
create table if not exists settings (key text primary key, value text not null, updated_at text not null);
`;
const hash = (t) => createHash('sha256').update(t).digest('hex');

export function openStore(file, { now = () => new Date().toISOString() } = {}) {
  const db = new DatabaseSync(file);
  const format = db.prepare('pragma user_version').get().user_version;
  if (format > DATA_FORMAT) {
    db.close();
    throw Object.assign(new Error('the data folder is in format ' + format + ', newer than the ' + DATA_FORMAT + ' this server understands: run a newer server, or restore the backup taken before the update'), { code: DATA_NEWER, format, understands: DATA_FORMAT });
  }
  db.exec('pragma journal_mode = wal; pragma busy_timeout = 3000;');
  db.exec(SCHEMA);
  if (format < DATA_FORMAT) db.exec('pragma user_version = ' + DATA_FORMAT);
  const q = (sql) => db.prepare(sql);
  const touched = new Map();
  return {
    createToken(scope, name) {
      if (!SCOPES.includes(scope)) throw new Error('scope must be one of ' + SCOPES.join(', '));
      const token = 'tok_' + randomBytes(32).toString('base64url');
      const id = randomBytes(4).toString('hex');
      q('insert into tokens (id, name, scope, hash, created_at) values (?, ?, ?, ?, ?)').run(id, String(name || scope), scope, hash(token), now());
      return { id, token, scope };
    },
    findToken(token) {
      if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
      const row = q('select id, name, scope from tokens where hash = ? and revoked_at is null').get(hash(token));
      if (!row) return null;
      const t = Date.now();
      if (t - (touched.get(row.id) || 0) > 60000) {
        touched.set(row.id, t);
        q('update tokens set last_used_at = ? where id = ?').run(now(), row.id);
      }
      return { id: row.id, name: row.name, scope: row.scope };
    },
    listTokens() {
      return q('select id, name, scope, created_at, last_used_at, revoked_at from tokens order by created_at').all();
    },
    revokeToken(id) {
      return q('update tokens set revoked_at = ? where id = ? and revoked_at is null').run(now(), String(id)).changes > 0;
    },
    getSend(key) {
      return q('select client_key, chat_id, status, message_id from sends where client_key = ?').get(key) || null;
    },
    putSend(key, chatId, status, messageId = null) {
      q('insert into sends (client_key, chat_id, status, message_id, at) values (?, ?, ?, ?, ?) on conflict(client_key) do update set status = excluded.status, message_id = excluded.message_id, at = excluded.at').run(key, chatId, status, messageId, now());
    },
    putAttachment(id, p, mime, name) {
      q('insert into attachments (id, path, mime, name, seen_at) values (?, ?, ?, ?, ?) on conflict(id) do update set path = excluded.path, mime = excluded.mime, name = excluded.name, seen_at = excluded.seen_at').run(id, p, mime, name, now());
    },
    getAttachment(id) {
      return q('select id, path, mime, name from attachments where id = ?').get(id) || null;
    },
    getAllSettings() {
      const out = {};
      for (const row of q('select key, value from settings').all()) out[row.key] = JSON.parse(row.value);
      return out;
    },
    putSettings(values) {
      const stmt = q('insert into settings (key, value, updated_at) values (?, ?, ?) on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at');
      for (const [k, v] of Object.entries(values)) stmt.run(k, JSON.stringify(v), now());
    },
    close() {
      db.close();
    },
  };
}
