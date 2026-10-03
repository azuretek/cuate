// The installed server: each release unpacked into its own folder under an install root, a `current` link that the
// LaunchAgent runs, and the updater's state, its backups and its log beside them. The data folder lives elsewhere and is
// never inside a version folder, so switching versions never moves or rewrites it.
//
//   <root>/versions/<version>/   one verified release, unpacked
//   <root>/current               a relative link to versions/<version>, repointed in one rename
//   <root>/update-state.json     paused, the versions marked bad, the install order, a switch in progress, the outcome
//   <root>/backups/              the data folder's backup taken before each switch
//   <root>/update.log            the post-switch half's own log lines
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { naming } from './paths.js';

/** SQLite owns the process lock, releasing it on process death without a stale-file race. */
export function acquireUpdateLock(L) {
  mkdirSync(L.root, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(L.root, 'update-lock.db'));
  try {
    db.exec('PRAGMA busy_timeout = 0; BEGIN IMMEDIATE');
    return () => { db.exec('ROLLBACK'); db.close(); };
  } catch (e) {
    db.close();
    if (/locked|busy/.test(e.message)) return null;
    throw e;
  }
}

/** How many versions are kept before the current one, for a rollback. */
export const KEEP_PREVIOUS = 2;
/** How many pre-switch backups are kept. */
export const KEEP_BACKUPS = 3;
const VERSION = /^\d+\.\d+\.\d+(-dev\.\d+\.[a-f0-9]{10})?$/;

/** Where releases are installed, apart from the data folder: SERVER_INSTALL_ROOT, else beside it under its own name. */
export function defaultInstallRoot({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  if (env.SERVER_INSTALL_ROOT) return env.SERVER_INSTALL_ROOT;
  const name = naming.slug + '-server-install';
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', name);
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), name);
  return path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), name);
}

// Resolve existing ancestors too: a not-yet-created child of a symlink is not a separate data folder.
function canonical(dir) {
  const absolute = path.resolve(dir);
  if (existsSync(absolute)) return realpathSync(absolute);
  return path.join(canonical(path.dirname(absolute)), path.basename(absolute));
}

export function assertSeparateData(L, dataDir) {
  const root = canonical(L.root);
  const data = canonical(dataDir);
  const inside = (a, b) => a === b || b.startsWith(a + path.sep);
  if (inside(root, data) || inside(data, root)) throw new Error('code and data must stay separate, not nested');
}

export function installLayout(root) {
  return {
    root,
    versions: path.join(root, 'versions'),
    current: path.join(root, 'current'),
    state: path.join(root, 'update-state.json'),
    backups: path.join(root, 'backups'),
    log: path.join(root, 'update.log'),
  };
}

/** The install root a server's code runs from, or null when it runs from a checkout. */
export function installRootOf(codeRoot) {
  const versions = path.dirname(codeRoot);
  if (path.basename(versions) !== 'versions') return null;
  const root = path.dirname(versions);
  return existsSync(path.join(root, 'current')) ? root : null;
}

export function versionDir(L, version) {
  if (!VERSION.test(String(version))) throw new Error('not a release version: ' + version);
  return path.join(L.versions, version);
}

/** The version `current` points at, or null before the first install. */
export function currentVersion(L) {
  try {
    return path.basename(readlinkSync(L.current));
  } catch {
    return null;
  }
}

/** The installed version folders, oldest name first; a half-written one (a dot folder) is not a version. */
export function presentVersions(L) {
  if (!existsSync(L.versions)) return [];
  return readdirSync(L.versions).filter((n) => VERSION.test(n)).sort();
}

/**
 * Point `current` at an installed version in one step: a new relative link beside it, renamed over it. A rename
 * replaces the old link whole, so anything starting the server sees one version or the other, never neither.
 */
export function pointCurrent(L, version) {
  const dir = versionDir(L, version);
  if (!existsSync(path.join(dir, 'server', 'src', 'main.js'))) throw new Error('version ' + version + ' is not installed in ' + L.versions);
  if (existsSync(L.current) && !lstatSync(L.current).isSymbolicLink()) throw new Error(L.current + ' is not a link, so it was left alone');
  const tmp = L.current + '.new';
  rmSync(tmp, { force: true });
  symlinkSync(path.join('versions', version), tmp);
  renameSync(tmp, L.current);
}

const EMPTY = () => ({ paused: false, bad: {}, installed: [], pending: null, outcome: null, failures: 0, lastCheckAt: null });

/** The updater's state; a root with none yet reads as a fresh one. */
export function readState(L) {
  let text;
  try {
    text = readFileSync(L.state, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    text = '{}';
  }
  const state = { ...EMPTY(), ...JSON.parse(text) };
  try { state.paused = JSON.parse(readFileSync(path.join(L.root, 'update-pause.json'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return state;
}

// Pause has its own atomic file: it cannot overwrite an updater's pending transaction.
export function setPaused(L, paused) {
  mkdirSync(L.root, { recursive: true, mode: 0o700 });
  const file = path.join(L.root, 'update-pause.json');
  const tmp = file + '.' + process.pid;
  writeFileSync(tmp, JSON.stringify(Boolean(paused)), { mode: 0o600 });
  renameSync(tmp, file);
}

export function writeState(L, state) {
  mkdirSync(L.root, { recursive: true, mode: 0o700 });
  const tmp = L.state + '.tmp';
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, L.state);
  return state;
}

/** Read, change and write the state in one call; fn returns the new state or changes the one it is given. */
export function updateState(L, fn) {
  const state = readState(L);
  return writeState(L, fn(state) || state);
}

/**
 * The versions to remove once `current` has passed its health check: everything but it and the KEEP_PREVIOUS that
 * were current most recently before it. A version that never became current (refused or rolled back) goes too.
 */
export function pruneList({ present, current, installed, keep = KEEP_PREVIOUS }) {
  const before = installed.filter((v) => v !== current && present.includes(v));
  const kept = new Set([current, ...before.slice(-keep)]);
  return present.filter((v) => !kept.has(v));
}

/** Remove what pruneList names, and all but the newest KEEP_BACKUPS backups. Returns how many versions went. */
export function prune(L, state) {
  const current = currentVersion(L);
  if (!current) return 0;
  const gone = pruneList({ present: presentVersions(L), current, installed: state.installed });
  for (const v of gone) rmSync(versionDir(L, v), { recursive: true, force: true });
  if (existsSync(L.backups)) {
    const backups = readdirSync(L.backups).filter((n) => n.endsWith('.json')).sort();
    for (const name of backups.slice(0, Math.max(0, backups.length - KEEP_BACKUPS))) rmSync(path.join(L.backups, name), { force: true });
  }
  return gone.length;
}

/**
 * Whether a Node version satisfies a manifest's Node range: space-separated comparators (>=, >, <=, <, =) on
 * major[.minor[.patch]], all of which must hold. A range this cannot read throws, so it refuses rather than guesses.
 */
export function nodeSatisfies(range, version = process.versions.node) {
  const num = (s) => {
    const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(s);
    return m ? [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)] : null;
  };
  const have = num(String(version));
  const parts = String(range || '').trim().split(/\s+/).filter(Boolean);
  if (!have || !parts.length) throw new Error('a Node range this server cannot read: ' + range);
  for (const part of parts) {
    const m = /^(>=|<=|>|<|=)?(.+)$/.exec(part);
    const want = num(m[2]);
    if (!want) throw new Error('a Node range this server cannot read: ' + range);
    let c = 0;
    for (let i = 0; i < 3 && !c; i++) c = Math.sign(have[i] - want[i]);
    const op = m[1] || '=';
    const ok = op === '>=' ? c >= 0 : op === '>' ? c > 0 : op === '<=' ? c <= 0 : op === '<' ? c < 0 : c === 0;
    if (!ok) return false;
  }
  return true;
}
