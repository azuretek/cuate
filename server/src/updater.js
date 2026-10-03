// The installed server's updater. It checks this repository's releases, and when a newer server is there it downloads
// the three assets, runs the publisher's own checks on them (server/src/artifact.js), unpacks only the verified bytes
// into a version folder, backs the data folder up, waits for any send in flight and any export to finish, repoints
// `current` and hands over to a separate process that restarts the service and decides, from the health route,
// whether the new version stays. A version that fails is rolled back and marked bad, so it is never tried again.
//
// Two halves, because the process that switches is the process the restart replaces:
//   createUpdater   runs inside the server: the schedule, the check, the download, the verification and the switch
//   finishSwitch    runs as `update finish`, detached, from the version being replaced: the restart, the health
//                   check, and either keeping the new version (pruning the old ones) or the rollback
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { artifactNames, sha256, verifyArtifact, writeFiles } from './artifact.js';
import { backupDataDir, restoreDataDir } from './backup.js';
import { compareVersions } from '../../core/kit/rules/build.js';
import { acquireUpdateLock, assertSeparateData, currentVersion, nodeSatisfies, pointCurrent, prune, readDrill, readState, setDrill, updateState, versionDir } from './install.js';
import { naming, ROOT } from './paths.js';
import { dataFormatOf, openStore, revokeTokenIn } from './store.js';

export const FIRST_CHECK_MS = 2 * 60 * 1000;
export const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
export const BACKOFF_MIN_MS = 15 * 60 * 1000;
export const BACKOFF_MAX_MS = 24 * 60 * 60 * 1000;
export const BUSY_RETRY_MS = 10 * 60 * 1000;
export const DRAIN_MS = 2 * 60 * 1000;
export const HEALTH_SECONDS = 90;
export const MAX_ASSET_BYTES = 256 * 1024 * 1024;
const DOWNLOAD_MS = 10 * 60 * 1000;
export const REFUSED = 'update_refused';
export const HEALTH_TOKEN_NAME = 'updater health check';
const VERSION = /^\d+\.\d+\.\d+(-dev\.\d+\.[a-f0-9]{10})?$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (t) => new Date(t).toISOString();

const refused = (reason, message) => Object.assign(new Error(message), { code: REFUSED, reason });

export const releasesUrl = (repo) => 'https://api.github.com/repos/' + repo + '/releases?per_page=30';
/** Every asset is downloaded from here and nowhere else. */
export const downloadPrefix = (repo) => 'https://github.com/' + repo + '/releases/download/';

/** How long to wait after the n-th failed check in a row: doubling from BACKOFF_MIN_MS, never above BACKOFF_MAX_MS. */
export function backoffMs(failures) {
  if (failures < 1) return CHECK_EVERY_MS;
  return Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** Math.min(20, failures - 1));
}

/**
 * The release to install from a GitHub release list, or null: the newest version above current that is not marked
 * bad, not a draft, and carries all three server assets. The dev channel takes prereleases; only, when given, names
 * the one version wanted (an install by hand), which may be older than current.
 */
export function pickRelease(releases, { slug = naming.slug, current = null, bad = {}, channel = 'dev', only = null } = {}) {
  let best = null;
  for (const r of Array.isArray(releases) ? releases : []) {
    if (channel !== 'dev') throw new Error('only the dev channel is supported');
    if (!r || r.draft || r.prerelease !== true) continue;
    const tag = String(r.tag_name || '');
    const version = tag.replace(/^v/, '');
    if (!VERSION.test(version) || !version.includes('-dev.') || (only && version !== only)) continue;
    if (!only && (Object.hasOwn(bad, version) || (current && compareVersions(version, current) <= 0))) continue;
    const names = artifactNames(slug, version);
    const assets = {};
    for (const [key, name] of Object.entries(names)) {
      const a = (r.assets || []).find((x) => x && x.name === name);
      if (a) assets[key] = { name, url: a.browser_download_url, size: a.size, digest: a.digest || null };
    }
    if (Object.keys(assets).length !== 3) continue;
    if (!best || compareVersions(version, best.version) > 0) best = { version, tag, assets };
  }
  return best;
}

export async function listReleases({ repo = naming.repo, fetchImpl = globalThis.fetch } = {}) {
  const res = await fetchImpl(releasesUrl(repo), { headers: { accept: 'application/vnd.github+json', 'user-agent': naming.slug + '-server-updater' }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error('the release list answered ' + res.status);
  const list = JSON.parse((await boundedBytes(res, 4 * 1024 * 1024)).toString('utf8'));
  if (!Array.isArray(list)) throw new Error('the release list is not a list');
  return list;
}

async function boundedBytes(res, limit) {
  const reader = res.body?.getReader();
  if (!reader) throw refused('size', 'an empty download');
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw refused('size', 'download exceeded its byte limit');
      chunks.push(Buffer.from(value));
    }
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}

/** One asset's bytes. An asset served from anywhere but this repository's releases is refused before it is fetched. */
async function fetchAsset(asset, { repo, tag, fetchImpl }) {
  const want = downloadPrefix(repo) + tag + '/' + asset.name;
  if (asset.url !== want) throw refused('source', 'an asset that is not from this repository\'s releases: ' + asset.url);
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_ASSET_BYTES) throw refused('size', asset.name + ' is larger than an update may be');
  const res = await fetchImpl(asset.url, { redirect: 'follow', headers: { accept: 'application/octet-stream', 'user-agent': naming.slug + '-server-updater' }, signal: AbortSignal.timeout(DOWNLOAD_MS) });
  if (!res.ok) throw new Error('downloading ' + asset.name + ' answered ' + res.status);
  const bytes = await boundedBytes(res, asset.size);
  if (Number.isInteger(asset.size) && bytes.length !== asset.size) throw new Error(asset.name + ' arrived with ' + bytes.length + ' bytes, not ' + asset.size);
  return bytes;
}

/**
 * Download one release and unpack it as an installable version, or refuse it. The tarball must match the SHA-256
 * GitHub recorded for it and its digest file; every file must match the manifest (verifyArtifact, the publisher's
 * checks); and this Node must satisfy the manifest's range. Only the bytes verifyArtifact returned are written, into a
 * dot folder renamed into place, so a half-written version is never a version. A refusal leaves nothing behind.
 */
async function stageRelease({ L, release, repo = naming.repo, slug = naming.slug, fetchImpl = globalThis.fetch, nodeVersion = process.versions.node, current = null }) {
  if (current && release.version === current) throw refused('running', 'it is the version already running');
  if (!/^sha256:[a-f0-9]{64}$/.test(release.assets.tarball.digest || '')) throw refused('digest', 'the release has no recorded SHA-256');
  const names = artifactNames(slug, release.version);
  const get = (key) => fetchAsset(release.assets[key], { repo, tag: release.tag, fetchImpl });
  const [tarball, digest, manifestBytes] = await Promise.all([get('tarball'), get('digest'), get('manifest')]);
  const recorded = release.assets.tarball.digest;
  if (!recorded || recorded !== 'sha256:' + sha256(tarball)) throw refused('digest', 'the tarball does not match the digest the release recorded');
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    throw refused('manifest', 'the manifest is not JSON');
  }
  let files;
  try {
    files = verifyArtifact({ tarball, digest: digest.toString('utf8'), manifest, names, version: release.version });
  } catch (e) {
    throw refused(/tarball digest|digest file|digest names/.test(e.message) ? 'digest' : 'verify', e.message);
  }
  let fits;
  try {
    fits = nodeSatisfies(manifest.node, nodeVersion);
  } catch (e) {
    throw refused('node', e.message);
  }
  if (!fits) throw refused('node', 'it needs Node ' + manifest.node + ', and this server runs Node ' + nodeVersion);
  mkdirSync(L.versions, { recursive: true, mode: 0o700 });
  const dir = versionDir(L, release.version);
  const tmp = path.join(L.versions, '.' + release.version + '.partial');
  rmSync(tmp, { recursive: true, force: true });
  try {
    writeFiles(files, tmp);
    rmSync(dir, { recursive: true, force: true });
    renameSync(tmp, dir);
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  return { version: release.version, commit: manifest.commit, files: files.size, dir };
}

/**
 * Hold new sends and exports, then wait until no send is in flight and no export runs. True once quiet; false (the gate
 * released again) when that did not happen within ms, so the switch waits for a later check rather than cutting one off.
 */
export async function drain(quiesce, { ms = DRAIN_MS, poll = 50, now = Date.now } = {}) {
  quiesce.hold();
  const until = now() + ms;
  for (;;) {
    const b = quiesce.busy();
    if (!b.sends && !b.exporting) return true;
    if (now() >= until) {
      quiesce.release();
      return false;
    }
    await sleep(poll);
  }
}

/**
 * The updater inside a running installed server. handoff({ from, to }) starts the post-switch half and is null where
 * nothing can restart the server (no LaunchAgent runs it), in which case it checks but never installs. A pause, from
 * the CLI (the state file) or the updates.serverAuto setting, also checks without installing.
 */
export function createUpdater({
  L, dataDir, log, running, runningCommit = null, repo = naming.repo, slug = naming.slug, publish = () => {}, quiesce = null,
  settings = () => ({}), handoff = null, fetchImpl = globalThis.fetch, nodeVersion = process.versions.node, now = Date.now,
  drainMs = DRAIN_MS, timers = globalThis, serviceNode = () => null,
}) {
  assertSeparateData(L, dataDir);
  const announce = (outcome) => {
    updateState(L, (s) => { s.outcome = outcome; });
    publish('server.update', outcome);
    return outcome;
  };
  const pausedNow = (state) => Boolean(state.paused) || settings()['updates.serverAuto'] === false;

  async function check() {
    const release = acquireUpdateLock(L);
    if (!release) return { state: 'busy' };
    try { return await checkLocked(); } finally { release(); }
  }

  async function checkLocked() {
    const state = readState(L);
    if (currentVersion(L) !== running && !state.pending) return { state: 'stale', version: currentVersion(L) };
    const paused = pausedNow(state);
    const base = { current: running, paused };
    if (state.pending) {
      if (handoff) await handoff({ recover: true });
      log.emit('update.check', { ...base, installs: false, reason: 'switch_pending' });
      return { state: 'pending', version: state.pending.to };
    }
    const pick = pickRelease(await listReleases({ repo, fetchImpl }), { slug, current: running, bad: state.bad });
    const why = !pick ? 'current' : pausedNow(readState(L)) ? 'paused' : !handoff ? 'no_service' : null;
    log.emit('update.check', { ...base, latest: pick ? pick.version : null, installs: !why, reason: why });
    if (why) return { state: why, version: pick ? pick.version : null };
    // A LaunchAgent whose Node is gone cannot restart into the new version, or back into this one.
    const gone = serviceNode();
    if (gone) {
      log.emit('update.refused', { version: pick.version, reason: 'service_node', error: gone });
      announce({ state: 'refused', version: pick.version, from: running, detail: 'Version ' + pick.version + ' was not installed: ' + gone + '. The server stays on ' + running + '.', at: iso(now()) });
      return { state: 'refused', version: pick.version, reason: 'service_node' };
    }

    let staged;
    try {
      staged = await stageRelease({ L, release: pick, repo, slug, fetchImpl, nodeVersion, current: running });
    } catch (e) {
      if (e.code !== REFUSED) throw e;
      log.emit('update.refused', { version: pick.version, reason: e.reason, error: e.message });
      announce({ state: 'refused', version: pick.version, from: running, detail: 'Version ' + pick.version + ' was not installed: ' + e.message + '. The server stays on ' + running + '.', at: iso(now()) });
      return { state: 'refused', version: pick.version, reason: e.reason };
    }
    log.emit('update.verified', { version: staged.version, commit: staged.commit, files: staged.files });
    if (stopped || pausedNow(readState(L))) return { state: 'paused', version: staged.version };

    if (quiesce && !(await drain(quiesce, { ms: drainMs, now }))) {
      log.emit('update.check', { ...base, latest: staged.version, installs: false, reason: 'busy' });
      return { state: 'busy', version: staged.version };
    }
    let backup = null;
    try {
      mkdirSync(L.backups, { recursive: true, mode: 0o700 });
      backup = path.join(L.backups, iso(now()).replace(/[:.]/g, '-') + '-' + running + '-to-' + staged.version + '.json');
      const sends = sendFingerprint(path.join(dataDir, 'state.db'));
      await backupDataDir({ dataDir, out: backup, log });
      if (sendFingerprint(path.join(dataDir, 'state.db')) !== sends) throw new Error('send records changed during backup');
      if (stopped || pausedNow(readState(L))) {
        if (quiesce) quiesce.release();
        return { state: 'paused', version: staged.version };
      }
      const dataFormat = dataFormatOf(path.join(dataDir, 'state.db'));
      updateState(L, (s) => { s.pending = { from: running, fromCommit: runningCommit, to: staged.version, commit: staged.commit, backup, dataFormat, sends, at: iso(now()) }; });
      pointCurrent(L, staged.version);
      log.emit('update.switched', { from: running, to: staged.version, backup: path.basename(backup) });
      await handoff({ from: running, to: staged.version });
    } catch (e) {
      // A failed handoff reverses the link before releasing the running server's gate.
      try { if (currentVersion(L) !== running) pointCurrent(L, running); } catch { /* reported below */ }
      if (currentVersion(L) === running) {
        updateState(L, (s) => { s.pending = null; });
        if (quiesce) quiesce.release();
      }
      log.emit('update.refused', { version: staged.version, reason: 'switch', error: e.message });
      announce({ state: 'refused', version: staged.version, from: running, detail: 'Version ' + staged.version + ' could not be switched to: ' + e.message + '. The server stays on ' + running + '.', at: iso(now()) });
      return { state: 'refused', version: staged.version, reason: 'switch' };
    }
    return { state: 'switched', version: staged.version };
  }

  let timer = null;
  let busy = false;
  let stopped = false;
  const later = (ms) => {
    if (stopped) return;
    timers.clearTimeout(timer);
    timer = timers.setTimeout(() => { run(); }, ms);
    if (timer && timer.unref) timer.unref();
  };

  /** One check now, then the next one scheduled: CHECK_EVERY_MS after a check, backing off after a failure. */
  async function run() {
    if (busy) return null;
    busy = true;
    let result = null;
    let next = CHECK_EVERY_MS;
    try {
      result = await check();
      if (result.state === 'busy' || result.state === 'pending') next = BUSY_RETRY_MS;
      const unlock = acquireUpdateLock(L);
      if (unlock) {
        try { updateState(L, (s) => { s.failures = 0; s.lastCheck = { at: iso(now()), state: result.state, version: result.version || null }; }); } finally { unlock(); }
      }
    } catch (e) {
      const unlock = acquireUpdateLock(L);
      let s = readState(L);
      if (unlock) {
        try { s = updateState(L, (st) => { st.failures = (st.failures || 0) + 1; st.lastCheck = { at: iso(now()), state: 'failed', version: null, error: String(e.message || e) }; }); } finally { unlock(); }
      }
      next = backoffMs(s.failures);
      log.emit('update.check', { current: running, paused: pausedNow(s), installs: false, reason: 'failed', error: String(e.message || e) });
      result = { state: 'failed', error: String(e.message || e) };
    } finally {
      busy = false;
      if (!result || result.state !== 'switched') later(next);
    }
    return result;
  }

  return {
    check,
    run,
    start(ms = FIRST_CHECK_MS) { later(ms); },
    stop() { stopped = true; timers.clearTimeout(timer); },
  };
}

// Send idempotency records are the durable proof of accepted work. An unknown schema or changed record refuses
// a destructive format restore rather than guessing that a snapshot is still safe.
function sendFingerprint(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const hash = createHash('sha256');
    for (const row of db.prepare('select client_key, chat_id, status, message_id, at from sends order by client_key').iterate()) hash.update(JSON.stringify(row) + '\n');
    return hash.digest('hex');
  } finally { db.close(); }
}

function restorePending(L, p, dataDir) {
  if (dataFormatOf(path.join(dataDir, 'state.db')) === p.dataFormat) return false;
  if (!existsSync(p.backup)) throw new Error('rollback needs its pre-switch backup');
  if (!p.sends || sendFingerprint(path.join(dataDir, 'state.db')) !== p.sends) throw new Error('send records changed after the backup; preserve the data and reconcile by hand');
  if (!path.resolve(p.backup).startsWith(path.resolve(L.backups) + path.sep)) throw new Error('backup is outside the install');
  restoreDataDir({ file: p.backup, dataDir, force: true });
  return true;
}

/** Before the store or engine opens, recover an orphaned transaction. A live finisher owns the lock. */
export async function recoverStartup({ L, dataDir, running, log }) {
  assertSeparateData(L, dataDir);
  const release = acquireUpdateLock(L);
  if (!release) return { pending: true, restart: false };
  try {
    const p = readState(L).pending;
    if (!p) return { restart: currentVersion(L) !== running };
    if (running !== p.from && running !== p.to) throw new Error('startup does not match the pending switch');
    pointCurrent(L, p.from);
    const restored = restorePending(L, p, dataDir);
    const at = iso(Date.now());
    updateState(L, (s) => {
      s.bad[p.to] = { at, error: 'interrupted update' };
      s.pending = null;
      s.outcome = { state: 'rolled_back', version: p.to, from: p.from, at, detail: 'An interrupted update was recovered to ' + p.from + '.' };
    });
    log.emit('update.rolled_back', { from: p.to, to: p.from, restored, healthy: false, error: 'interrupted update recovered before startup' });
    return { restart: running !== p.from };
  } finally { release(); }
}

/** One look at a server: the health route must name version (and commit, when given), and the token must list chats. */
export async function probeHealth({ port, version, commit = null, token = null, fetchImpl = globalThis.fetch }) {
  const base = 'http://127.0.0.1:' + port;
  try {
    const h = await fetchImpl(base + '/healthz', { signal: AbortSignal.timeout(5000) });
    if (h.status !== 200) return { ok: false, error: 'the health route answered ' + h.status };
    const body = await h.json();
    if (body.version !== version) return { ok: false, error: 'the health route names version ' + body.version + ', not ' + version };
    if (commit && body.commit !== commit) return { ok: false, error: 'the health route names commit ' + body.commit + ', not ' + commit };
    if (!token) return { ok: false, error: 'no token to list chats with' };
    const c = await fetchImpl(base + '/api/v1/chats?limit=1', { headers: { authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(15000) });
    const list = c.status === 200 ? await c.json() : null;
    if (!list || !Array.isArray(list.chats)) return { ok: false, error: 'the chat list answered ' + c.status };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'no answer: ' + (e.cause && e.cause.code ? e.cause.code : e.message) };
  }
}

/** Probe until healthy or out of time; the last reason it was not healthy is the error. */
export async function waitHealthy({ seconds = HEALTH_SECONDS, poll = 1000, now = Date.now, ...probe }) {
  const until = now() + seconds * 1000;
  for (;;) {
    const r = await probeHealth(probe);
    if (r.ok) return r;
    if (now() >= until) return { ok: false, error: 'not healthy within ' + seconds + ' s: ' + r.error };
    await sleep(poll);
  }
}

/** A tooling token for one health check, minted while the folder still has a format this code can open. */
function withHealthToken(dataDir) {
  const db = path.join(dataDir, 'state.db');
  let t = null;
  try {
    const s = openStore(db);
    try { t = s.createToken('tooling', HEALTH_TOKEN_NAME); } finally { s.close(); }
  } catch {
    t = null; // the check then fails on the chat list, which is the truth: this code cannot read this folder
  }
  return { token: t ? t.token : null, revoke: () => { if (t) { try { revokeTokenIn(db, t.id); } catch { /* the token dies with a restored folder */ } } } };
}

/**
 * The half that runs after the switch, detached from the server it replaces. service: { restart, stop, start }, each
 * returning once launchd has been told. Healthy: the new version stays, joins the install order, and the oldest
 * versions beyond KEEP_PREVIOUS go. Not healthy within seconds: `current` goes back to the previous version, the data
 * folder is restored from the pre-switch backup if the new version changed its format, the previous version is started
 * and checked, and the new one is marked bad so it is never tried again.
 */
export async function finishSwitch(options) {
  const release = acquireUpdateLock(options.L);
  if (!release) return { state: 'busy' };
  try { return await finishSwitchLocked(options); } finally { release(); }
}

async function finishSwitchLocked({ L, dataDir, port, service, log, fetchImpl = globalThis.fetch, seconds = HEALTH_SECONDS, poll = 1000, now = Date.now, recover = false }) {
  assertSeparateData(L, dataDir);
  const p = readState(L).pending;
  if (!p) return null;
  const t0 = now();
  let health;
  // A rollback drill is read once and disarmed by this finish, so it fails exactly one switch.
  const drill = !recover && readDrill(L);
  if (drill) setDrill(L, false);
  const first = withHealthToken(dataDir);
  try {
    if (recover) throw new Error('interrupted update');
    await service.restart();
    health = await waitHealthy({ port, version: p.to, commit: p.commit, token: first.token, seconds, poll, now, fetchImpl });
  } catch (e) {
    health = { ok: false, error: String(e.message || e) };
  } finally {
    first.revoke();
  }
  // Only the candidate's verdict is forced: the previous version's health check below is the real one.
  if (drill && health.ok) health = { ok: false, error: 'rollback drill: ' + p.to + ' answered its health check and was failed on purpose' };
  if (health.ok) {
    const state = updateState(L, (s) => {
      s.installed = [...(s.installed || []).filter((v) => v !== p.to), p.to];
      s.lastGood = p.to;
      s.pending = null;
      s.outcome = { state: 'healthy', version: p.to, from: p.from, detail: null, at: iso(now()) };
    });
    const removed = prune(L, state);
    log.emit('update.healthy', { version: p.to, ms: now() - t0, removed });
    return state.outcome;
  }

  let restored = false;
  let back;
  try {
    await service.stop();
    pointCurrent(L, p.from);
    restored = restorePending(L, p, dataDir);
    await service.start();
    const again = withHealthToken(dataDir);
    try {
      back = await waitHealthy({ port, version: p.from, commit: p.fromCommit, token: again.token, seconds, poll, now, fetchImpl });
    } finally {
      again.revoke();
    }
  } catch (e) {
    back = { ok: false, error: String(e.message || e) };
  }
  const at = iso(now());
  const outcome = back.ok
    ? { state: 'rolled_back', version: p.to, from: p.from, detail: 'Version ' + p.to + ' failed its health check (' + health.error + '), so the server went back to ' + p.from + '.', at }
    : { state: 'rollback_failed', version: p.to, from: p.from, detail: 'Version ' + p.to + ' failed its health check, and ' + p.from + ' did not come back either (' + back.error + '). Recover it by hand: see docs/server.md.', at };
  updateState(L, (s) => {
    s.bad = { ...(s.bad || {}), [p.to]: { at, error: health.error } };
    // A failed rollback stays in probation and is retried before the next startup opens data.
    s.pending = back.ok ? null : p;
    s.outcome = outcome;
  });
  log.emit('update.rolled_back', { from: p.to, to: p.from, restored, healthy: back.ok, error: health.error });
  return outcome;
}

/**
 * The production handoff: start `update finish` from this version's code, detached into its own session so the
 * service restart that replaces this process does not take it too, writing its log lines to the install's update.log.
 */
export function finisherHandoff({ L, dataDir, node = process.execPath, main = path.join(ROOT, 'server', 'src', 'main.js') }) {
  return async ({ recover = false } = {}) => {
    mkdirSync(L.root, { recursive: true, mode: 0o700 });
    const fd = openSync(L.log, 'a', 0o600);
    try {
      const child = spawn(node, [main, 'update', recover ? 'recover' : 'finish', '--data', dataDir, '--install-root', L.root], { detached: true, stdio: ['ignore', fd, fd], cwd: L.root });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      child.unref();
    } finally {
      closeSync(fd);
    }
  };
}

/**
 * The first install of a release, from a checkout or by hand: download, verify and unpack one release (the newest, or
 * only) and point `current` at it. Nothing is running from the install yet, so there is nothing to drain or restart.
 */
export async function installRelease(options) {
  const release = acquireUpdateLock(options.L);
  if (!release) throw new Error('another updater owns this install');
  try { return await installReleaseLocked(options); } finally { release(); }
}

async function installReleaseLocked({ L, only = null, repo = naming.repo, slug = naming.slug, fetchImpl = globalThis.fetch, nodeVersion = process.versions.node }) {
  const state = readState(L);
  if (state.pending) throw new Error('a switch is pending; recover it before installing');
  const pick = pickRelease(await listReleases({ repo, fetchImpl }), { slug, bad: state.bad, only });
  if (!pick) throw new Error(only ? 'no release ' + only + ' with a server artifact' : 'no release with a server artifact');
  const have = currentVersion(L);
  if (have && have !== pick.version) throw new Error('an existing install updates through its running server: service update --release');
  if (have !== pick.version) {
    const staged = await stageRelease({ L, release: pick, repo, slug, fetchImpl, nodeVersion });
    pointCurrent(L, staged.version);
  }
  updateState(L, (s) => { s.installed = [...(s.installed || []).filter((v) => v !== pick.version), pick.version]; });
  return { version: pick.version, already: have === pick.version };
}
