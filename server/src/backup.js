// Phase 2d: the backup and its restore. It snapshots the server's own state (its config, its secret and one
// consistent copy of its SQLite state) into a single portable file, and puts it back into an empty data folder. The
// database copy is taken through SQLite's own backup, so a write landing while the backup runs cannot tear it.
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, statSync } from 'node:fs';
import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';
import path from 'node:path';
import { serverVersion } from './paths.js';

export const BACKUP_FORMAT = 'server-state';
export const BACKUP_VERSION = 1;
const CONFIG_FILES = ['config.json', 'secret'];
const STATE_FILES = [...CONFIG_FILES, 'state.db'];

export async function backupDataDir({ dataDir, out, log = null, now = () => new Date().toISOString() } = {}) {
  const files = {};
  for (const name of CONFIG_FILES) {
    const p = path.join(dataDir, name);
    if (existsSync(p)) files[name] = readFileSync(p).toString('base64');
  }
  const dbPath = path.join(dataDir, 'state.db');
  if (existsSync(dbPath)) {
    const tmp = path.join(dataDir, '.state-backup.db');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      await sqliteBackup(db, tmp);
    } finally {
      db.close();
    }
    try {
      files['state.db'] = readFileSync(tmp).toString('base64');
    } finally {
      rmSync(tmp, { force: true });
    }
  }
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: now(), serverVersion, files }), { mode: 0o600 });
  const bytes = statSync(out).size;
  if (log) log.emit('backup.written', { files: Object.keys(files).length, bytes });
  return { file: out, bytes, names: Object.keys(files) };
}

export function restoreDataDir({ file, dataDir, log = null, force = false } = {}) {
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  if (doc.format !== BACKUP_FORMAT || doc.version !== BACKUP_VERSION) throw new Error('not a server backup: ' + file);
  const present = STATE_FILES.filter((n) => existsSync(path.join(dataDir, n)));
  if (present.length && !force) throw new Error('the data folder is not empty (' + present.join(', ') + '): restore into an empty one');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  // A restored state.db must not be read with the write-ahead log of the database it replaces, which SQLite would
  // otherwise replay over it on the next open.
  for (const name of ['state.db-wal', 'state.db-shm']) rmSync(path.join(dataDir, name), { force: true });
  for (const [name, content] of Object.entries(doc.files)) writeFileSync(path.join(dataDir, name), Buffer.from(content, 'base64'), { mode: 0o600 });
  const bytes = statSync(file).size;
  if (log) log.emit('backup.restored', { files: Object.keys(doc.files).length, bytes });
  return { dataDir, names: Object.keys(doc.files) };
}
