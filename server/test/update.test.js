// The installed server's updater on a scratch install: real version folders, a real `current` link, a real data
// folder and its backup, and a stand-in for launchd that runs whatever `current` points at. The releases are built here
// with the publisher's own writer (src/artifact.js) and served by a fake GitHub, so every refusal is the check the
// publisher would have made. Issue 117's acceptance: a bad digest and a tampered file are refused and nothing changes,
// a version that fails its health check rolls back by itself to the previous one, which then serves, a send in flight
// finishes before the switch, and a pause stops installs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '../../core/kit/log.js';
import { compareVersions } from '../../core/kit/rules/build.js';
import { serverUpdateNotice } from '../../core/app/rules/notifications.js';
import { artifactNames, digestText, manifestOf, sha256, writeTarball } from '../src/artifact.js';
import { assertInstalledPlatform, currentVersion, installLayout, installRootOf, nodeSatisfies, pointCurrent, presentVersions, pruneList, readState, updateState } from '../src/install.js';
import { naming, logSpec } from '../src/paths.js';
import { DATA_FORMAT, DATA_NEWER, dataFormatOf, openStore } from '../src/store.js';
import { backoffMs, createUpdater, downloadPrefix, drain, finishSwitch, installRelease, pickRelease, releasesUrl } from '../src/updater.js';
import { boot, waitFor } from './helpers.js';

// A test that repoints `current` runs where the installed path does. The installed path is macOS's
// (assertInstalledPlatform in src/install.js), and these run on Linux too because a rename over a link is the same POSIX
// rename there; Windows refuses to rename over a link, so they skip it the way the service's own tests skip it.
const SWITCHES = { skip: process.platform === 'win32' && 'the installed path runs on macOS only; Windows cannot rename over a link' };

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/main.js');
const repo = naming.repo;
const slug = naming.slug;

// A release version and its commit, which a dev version names by its first ten characters.
function release(n) {
  const sha10 = (n.toString(16).padStart(2, '0') + 'abcdef0123').slice(0, 10);
  return { version: '0.0.1-dev.' + n + '.' + sha10, commit: sha10.repeat(4) };
}

// The stand-in server each release carries: it answers the health route with its own stamp and lists no chats. A
// "broken" one exits at once, after optionally moving the data folder to a newer format, which is what a release that
// migrated its data and then failed would leave behind.
const GOOD_MAIN = `import http from 'node:http';
import { readFileSync } from 'node:fs';
const stamp = JSON.parse(readFileSync(new URL('../stamp.json', import.meta.url), 'utf8'));
http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url === '/healthz') return res.end(JSON.stringify({ ok: true, version: stamp.version, commit: stamp.commit }));
  if (req.url.startsWith('/api/v1/chats') && req.headers.authorization) return res.end(JSON.stringify({ chats: [] }));
  res.statusCode = 401;
  res.end('{}');
}).listen(Number(process.env.TEST_PORT), '127.0.0.1');
`;
const BROKEN_MAIN = `import { DatabaseSync } from 'node:sqlite';
if (process.env.TEST_MIGRATE) new DatabaseSync(process.env.TEST_DB).exec('pragma user_version = 99');
process.exit(3);
`;

// The three assets for one release, built the way the publisher builds them. tamper changes one file's bytes after
// the manifest was written (the tarball and its digest file then agree with each other, and not with the manifest).
function build(n, { broken = false, tamper = false, node = '>=22.13' } = {}) {
  const { version, commit } = release(n);
  const files = [
    { path: 'server/package.json', data: Buffer.from('{ "type": "module" }\n') },
    { path: 'server/stamp.json', data: Buffer.from(JSON.stringify({ version, commit })) },
    { path: 'server/src/main.js', data: Buffer.from(broken ? BROKEN_MAIN : GOOD_MAIN) },
  ];
  const manifest = manifestOf({ name: slug + '-server', version, commit, node, files });
  const shipped = tamper ? files.map((f) => (f.path === 'server/src/main.js' ? { ...f, data: Buffer.from('process.exit(0);\n') } : f)) : files;
  const names = artifactNames(slug, version);
  const tarball = writeTarball(shipped, 1700000000);
  return { version, commit, names, tarball, digest: Buffer.from(digestText(tarball, names.tarball)), manifest: Buffer.from(JSON.stringify(manifest)) };
}

// A fake GitHub: the release list, and each asset at its download URL. recorded overrides the digest GitHub reports.
function github() {
  const releases = new Map();
  const fetched = [];
  const add = (b, { recorded = null, url = null, digestFile = null } = {}) => {
    const asset = (key, bytes) => ({
      name: b.names[key],
      size: bytes.length,
      browser_download_url: url && key === 'tarball' ? url : downloadPrefix(repo) + 'v' + b.version + '/' + b.names[key],
      digest: key === 'tarball' ? recorded || 'sha256:' + sha256(bytes) : 'sha256:' + sha256(bytes),
      bytes,
    });
    releases.set(b.version, { tag_name: 'v' + b.version, draft: false, prerelease: true, assets: [asset('tarball', b.tarball), asset('digest', digestFile || b.digest), asset('manifest', b.manifest)] });
    return b;
  };
  const fetchImpl = async (url) => {
    fetched.push(url);
    if (url === releasesUrl(repo)) return Response.json([...releases.values()].map((r) => ({ ...r, assets: r.assets.map(({ bytes: _bytes, ...a }) => a) })));
    for (const r of releases.values()) for (const a of r.assets) if (a.browser_download_url === url) return new Response(a.bytes);
    return new Response('not found', { status: 404 });
  };
  return { add, fetchImpl, fetched, releases };
}

const freePort = () => new Promise((resolve) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

// launchd, for the test: it runs whatever `current` points at, as the LaunchAgent does, and restarts it on request.
function launchd({ L, port, dataDir }) {
  let child = null;
  const kill = async () => {
    if (!child) return;
    const c = child;
    child = null;
    if (c.exitCode === null && c.signalCode === null) {
      const gone = new Promise((r) => c.once('exit', r));
      c.kill('SIGKILL');
      await gone;
    }
  };
  const start = async () => {
    const main = path.join(realpathSync(L.current), 'server', 'src', 'main.js');
    child = spawn(process.execPath, [main], { stdio: 'ignore', env: { ...process.env, TEST_PORT: String(port), TEST_DB: path.join(dataDir, 'state.db'), TEST_MIGRATE: '1' } });
  };
  return { restart: async () => { await kill(); await start(); }, stop: kill, start, kill, running: () => Boolean(child && child.exitCode === null) };
}

function scratch() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'srv-update-'));
  const L = installLayout(path.join(dir, 'install'));
  const dataDir = path.join(dir, 'data');
  mkdirSync(dataDir, { recursive: true });
  openStore(path.join(dataDir, 'state.db')).close();
  const lines = [];
  const log = createLogger({ spec: logSpec, app: 'test', run: 'test', sink: (l) => lines.push(l), now: Date.now, level: 'debug', strict: true });
  const events = (name) => lines.filter((l) => l.event === name);
  return { dir, L, dataDir, lines, log, events, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const health = async (port) => (await fetch('http://127.0.0.1:' + port + '/healthz')).json();

// An install with release 1 running from it, and an updater inside that "server".
async function installed(t, { quiesce = null, settings = () => ({}), withService = true } = {}) {
  const s = scratch();
  const gh = github();
  gh.add(build(1));
  await installRelease({ L: s.L, repo, slug, fetchImpl: gh.fetchImpl });
  const port = await freePort();
  const service = launchd({ L: s.L, port, dataDir: s.dataDir });
  await service.start();
  const published = [];
  let finishing = null;
  const v1 = release(1);
  const updater = createUpdater({
    L: s.L, dataDir: s.dataDir, log: s.log.child('update'), running: v1.version, runningCommit: v1.commit, repo, slug, fetchImpl: gh.fetchImpl,
    publish: (name, data) => published.push({ name, data }), quiesce, settings,
    handoff: withService ? async () => { finishing = new Promise((resolve) => setImmediate(resolve)).then(() => finishSwitch({ L: s.L, dataDir: s.dataDir, port, service, log: s.log.child('update'), fetchImpl: globalThis.fetch, seconds: 1, poll: 25 })); } : null,
  });
  t.after(async () => { updater.stop(); await service.kill(); s.cleanup(); });
  // The first install's own server must answer before anything is switched.
  const t0 = Date.now();
  for (;;) {
    try { if ((await health(port)).version === v1.version) break; } catch { /* starting */ }
    if (Date.now() - t0 > 5000) throw new Error('release 1 did not start');
    await new Promise((r) => setTimeout(r, 30));
  }
  return { ...s, gh, port, service, updater, published, finished: () => finishing };
}

test('release versions order by their numbers, a stable release above its test builds, and anything else throws', () => {
  assert.equal(compareVersions(release(2).version, release(1).version), 1);
  assert.equal(compareVersions(release(9).version, release(10).version), -1);
  assert.equal(compareVersions('0.0.1', release(30).version), 1);
  assert.equal(compareVersions('0.1.0', '0.0.9'), 1);
  assert.equal(compareVersions(release(3).version, release(3).version), 0);
  assert.throws(() => compareVersions('latest', '0.0.1'), /not a release version/);
});

test('the release picked is the newest one above current, not bad, carrying all three server assets', () => {
  const gh = github();
  for (const n of [1, 2, 3, 4]) gh.add(build(n));
  const list = [...gh.releases.values()];
  // Release 4 lacks its manifest, so it cannot be verified and is not a candidate.
  list[3] = { ...list[3], assets: list[3].assets.slice(0, 2) };
  assert.equal(pickRelease(list, { slug, current: release(1).version }).version, release(3).version);
  assert.equal(pickRelease(list, { slug, current: release(1).version, bad: { [release(3).version]: {} } }).version, release(2).version);
  assert.equal(pickRelease(list, { slug, current: release(3).version }), null);
  assert.equal(pickRelease(list.map((r) => ({ ...r, draft: true })), { slug }), null, 'a draft is never installed');
  assert.equal(pickRelease(list, { slug, current: release(3).version, only: release(1).version }).version, release(1).version, 'an install by hand may name an older one');
});

test('the manifest Node range is read and enforced, and a range that cannot be read refuses', () => {
  assert.equal(nodeSatisfies('>=22.13', '22.13.0'), true);
  assert.equal(nodeSatisfies('>=22.13', '22.12.9'), false);
  assert.equal(nodeSatisfies('>=22.13 <25', '24.1.0'), true);
  assert.equal(nodeSatisfies('>=22.13 <25', '25.0.0'), false);
  assert.throws(() => nodeSatisfies('^22 || ^24', '24.0.0'), /cannot read/);
});

test('only dev prereleases are candidates, never stable or mislabeled releases', () => {
  const gh = github();
  gh.add(build(2));
  const r = [...gh.releases.values()][0];
  assert.equal(pickRelease([{ ...r, prerelease: false }], { slug }), null);
});

test('a failed check backs off, doubling and bounded', () => {
  assert.ok(backoffMs(1) < backoffMs(2) && backoffMs(2) < backoffMs(3));
  assert.equal(backoffMs(40), backoffMs(60), 'the backoff stops growing at its ceiling');
});

test('two previous versions are kept, and a version that never became current is not one of them', () => {
  const [a, b, c, d, e] = [1, 2, 3, 4, 5].map((n) => release(n).version);
  assert.deepEqual(pruneList({ present: [a, b, c, d, e], current: e, installed: [a, c, d, e] }), [a, b]);
  assert.deepEqual(pruneList({ present: [a, b], current: b, installed: [a, b] }), []);
});

test('current is repointed by a rename, and an installed server finds its install root from its own code', SWITCHES, (t) => {
  const s = scratch();
  t.after(s.cleanup);
  for (const n of [1, 2]) mkdirSync(path.join(s.L.versions, release(n).version, 'server', 'src'), { recursive: true });
  for (const n of [1, 2]) writeFileSync(path.join(s.L.versions, release(n).version, 'server', 'src', 'main.js'), '');
  pointCurrent(s.L, release(1).version);
  assert.equal(currentVersion(s.L), release(1).version);
  pointCurrent(s.L, release(2).version);
  assert.equal(currentVersion(s.L), release(2).version);
  assert.ok(!existsSync(s.L.current + '.new'), 'no half-made link is left beside it');
  assert.equal(installRootOf(realpathSync(s.L.current)), realpathSync(s.L.root));
  assert.equal(installRootOf(path.dirname(path.dirname(cli))), null, 'a checkout is not an install');
  assert.throws(() => pointCurrent(s.L, release(3).version), /not installed/);
});

test('the installed path refuses to run off macOS, as the service does', () => {
  assert.doesNotThrow(() => assertInstalledPlatform('darwin'));
  for (const platform of ['win32', 'linux']) assert.throws(() => assertInstalledPlatform(platform), /macOS only.*from a checkout/);
});

test('a bad digest is refused and nothing changes', async (t) => {
  const s = await installed(t);
  const before = presentVersions(s.L);
  const b = build(2);
  s.gh.add(b, { recorded: 'sha256:' + '0'.repeat(64) });
  const r = await s.updater.check();
  assert.equal(r.state, 'refused');
  assert.equal(r.reason, 'digest');
  assert.deepEqual(presentVersions(s.L), before, 'nothing was unpacked');
  assert.deepEqual(readdirSync(s.L.versions).filter((n) => n.startsWith('.')), [], 'no partial folder is left');
  assert.equal(currentVersion(s.L), release(1).version);
  assert.equal((await health(s.port)).version, release(1).version, 'the running version is untouched');
  assert.equal(s.events('update.refused').at(-1).reason, 'digest');
  assert.equal(s.published.at(-1).name, 'server.update');
  assert.equal(s.published.at(-1).data.state, 'refused');

  // The digest file disagreeing with the tarball is refused the same way.
  s.gh.add(b, { digestFile: Buffer.from('f'.repeat(64) + '  ' + b.names.tarball + '\n') });
  const again = await s.updater.check();
  assert.equal(again.reason, 'digest');
  assert.deepEqual(presentVersions(s.L), before);
});

test('a tampered file is refused, as is an asset from anywhere but this repository and a Node it cannot run on', async (t) => {
  const s = await installed(t);
  const before = presentVersions(s.L);
  s.gh.add(build(2, { tamper: true }));
  const r = await s.updater.check();
  assert.equal(r.state, 'refused');
  assert.equal(r.reason, 'verify');
  assert.match(s.events('update.refused').at(-1).error, /file digest mismatch: server\/src\/main\.js/);
  assert.deepEqual(presentVersions(s.L), before);

  s.gh.releases.clear();
  s.gh.add(build(3), { url: 'https://example.com/elsewhere.tar.gz' });
  assert.equal((await s.updater.check()).reason, 'source');
  assert.ok(!s.gh.fetched.includes('https://example.com/elsewhere.tar.gz'), 'it is refused before it is fetched');

  s.gh.releases.clear();
  s.gh.add(build(4, { node: '>=99' }));
  assert.equal((await s.updater.check()).reason, 'node');
  assert.deepEqual(presentVersions(s.L), before);
  assert.equal(currentVersion(s.L), release(1).version);
  // A refusal raises the existing update-error notice in the clients, once per outcome.
  const notice = serverUpdateNotice(readState(s.L).outcome);
  assert.equal(notice.type, 'error');
  assert.match(notice.body, /stays on/);
});

test('a version that fails its health check rolls back by itself to the previous one, which then serves', SWITCHES, async (t) => {
  const s = await installed(t);
  s.gh.add(build(2, { broken: true }));
  const r = await s.updater.check();
  assert.equal(r.state, 'switched');
  assert.equal(s.events('update.verified').at(-1).version, release(2).version);
  assert.equal(s.events('update.switched').at(-1).to, release(2).version);
  const outcome = await s.finished();
  assert.equal(outcome.state, 'rolled_back');
  assert.equal(currentVersion(s.L), release(1).version);
  assert.deepEqual(await health(s.port), { ok: true, version: release(1).version, commit: release(1).commit }, 'the previous version serves again');
  const state = readState(s.L);
  assert.ok(state.bad[release(2).version], 'the failed version is marked bad');
  assert.equal(state.pending, null);
  const rolled = s.events('update.rolled_back').at(-1);
  assert.equal(rolled.healthy, true);
  // The failed release moved the data folder to a format release 1 does not know, so the pre-switch backup came back.
  assert.equal(rolled.restored, true);
  assert.equal(dataFormatOf(path.join(s.dataDir, 'state.db')), DATA_FORMAT);
  assert.equal(serverUpdateNotice(state.outcome).type, 'error');
  // The health check's token is revoked once it has done its job.
  const store = openStore(path.join(s.dataDir, 'state.db'));
  try { assert.ok(store.listTokens().every((x) => x.revokedAt || x.revoked_at)); } finally { store.close(); }

  // A version marked bad is not tried again.
  assert.equal((await s.updater.check()).state, 'current');
  assert.equal(s.events('update.check').at(-1).reason, 'current');
});

test('a healthy version stays, and the oldest beyond two previous go only after it passed', SWITCHES, async (t) => {
  const s = await installed(t);
  for (const n of [2, 3, 4]) {
    s.gh.add(build(n));
    const running = release(n - 1);
    // Each check is made by the server that is running, which is the previous release by now.
    const u = createUpdater({
      L: s.L, dataDir: s.dataDir, log: s.log.child('update'), running: running.version, runningCommit: running.commit, repo, slug, fetchImpl: s.gh.fetchImpl,
      handoff: async () => {},
    });
    assert.equal((await u.check()).state, 'switched');
    const outcome = await finishSwitch({ L: s.L, dataDir: s.dataDir, port: s.port, service: s.service, log: s.log.child('update'), seconds: 6, poll: 50 });
    assert.equal(outcome.state, 'healthy', 'release ' + n);
    assert.equal((await health(s.port)).version, release(n).version);
  }
  assert.deepEqual(presentVersions(s.L), [2, 3, 4].map((n) => release(n).version), 'release 1 went once release 4 passed');
  assert.equal(s.events('update.healthy').at(-1).removed, 1);
  assert.equal(serverUpdateNotice(readState(s.L).outcome), null, 'a healthy update raises no notice');
});

test('a send in flight finishes before the switch, and new sends and exports wait for it', async (t) => {
  const b = await boot({ sending: true, sendTimeoutMs: 3000 });
  t.after(() => b.close());
  b.world.behavior.sendDelayMs = 400;
  const inFlight = b.post('/api/v1/chats/1/messages', b.tokens.device, { text: 'on its way', clientKey: 'k-update-1' });
  await waitFor(() => b.srv.quiesce.busy().sends === 1);
  const drained = await drain(b.srv.quiesce, { ms: 5000, poll: 10 });
  assert.equal(drained, true);
  assert.equal(b.store.getSend('k-update-1').status, 'sent', 'the durable send result exists before backup or switch');
  assert.equal((await inFlight).status, 201, 'the send in flight was not cut off');
  const held = await b.post('/api/v1/chats/1/messages', b.tokens.device, { text: 'later', clientKey: 'k-update-2' });
  assert.equal(held.status, 503);
  assert.equal((await held.json()).error.code, 'updating');
  assert.equal((await b.get('/api/v1/export?mode=full', b.tokens.tooling)).status, 503);
  b.srv.quiesce.release();
  assert.equal((await b.post('/api/v1/chats/1/messages', b.tokens.device, { text: 'now', clientKey: 'k-update-3' })).status, 201);
});

test('a send that will not finish in time holds the switch, and the gate opens again', async (t) => {
  const b = await boot({ sending: true, sendTimeoutMs: 3000 });
  t.after(() => b.close());
  b.world.behavior.sendDelayMs = 800;
  const inFlight = b.post('/api/v1/chats/1/messages', b.tokens.device, { text: 'slow', clientKey: 'k-update-4' });
  await waitFor(() => b.srv.quiesce.busy().sends === 1);
  assert.equal(await drain(b.srv.quiesce, { ms: 100, poll: 10 }), false);
  assert.equal((await inFlight).status, 201);
  assert.equal((await b.post('/api/v1/chats/1/messages', b.tokens.device, { text: 'after', clientKey: 'k-update-5' })).status, 201, 'released, not held');

  // The updater, finding the server busy, does not switch and tries again later.
  const s = await installed(t, { quiesce: { hold() {}, release() {}, busy: () => ({ sends: 1, exporting: false }) } });
  s.gh.add(build(2));
  const u = createUpdater({ L: s.L, dataDir: s.dataDir, log: s.log.child('update'), running: release(1).version, repo, slug, fetchImpl: s.gh.fetchImpl, quiesce: { hold() {}, release() {}, busy: () => ({ sends: 1, exporting: false }) }, handoff: async () => assert.fail('no switch while busy'), drainMs: 50 });
  assert.equal((await u.check()).state, 'busy');
  assert.equal(currentVersion(s.L), release(1).version);
});

test('a pause stops installs: the server still checks and installs nothing, from the CLI or the setting', async (t) => {
  const s = await installed(t);
  s.gh.add(build(2));
  const before = presentVersions(s.L);
  const cliRun = (flag) => spawnSync(process.execPath, [cli, 'service', 'update', flag, '--install-root', s.L.root, '--data', s.dataDir], { encoding: 'utf8' });
  const paused = cliRun('--pause');
  assert.equal(paused.status, 0, paused.stderr);
  assert.match(paused.stdout, /paused/);
  assert.equal(readState(s.L).paused, true);
  const assetsBefore = s.gh.fetched.filter((u) => u !== releasesUrl(repo)).length;
  const r = await s.updater.check();
  assert.equal(r.state, 'paused');
  assert.equal(r.version, release(2).version, 'it still found the release');
  assert.equal(s.events('update.check').at(-1).installs, false);
  assert.equal(s.gh.fetched.filter((u) => u !== releasesUrl(repo)).length, assetsBefore, 'nothing was downloaded');
  assert.deepEqual(presentVersions(s.L), before);

  assert.equal(cliRun('--resume').status, 0);
  assert.equal(readState(s.L).paused, false);
  const off = createUpdater({ L: s.L, dataDir: s.dataDir, log: s.log.child('update'), running: release(1).version, repo, slug, fetchImpl: s.gh.fetchImpl, settings: () => ({ 'updates.serverAuto': false }), handoff: async () => assert.fail('no install while the setting is off') });
  assert.equal((await off.check()).state, 'paused');
  assert.equal(currentVersion(s.L), release(1).version);
  updateState(s.L, (st) => { st.paused = false; });
});

test('candidate probation refuses a send until health is committed', async (t) => {
  let pending = true;
  const b = await boot({ sending: true, updatePending: () => pending });
  t.after(() => b.close());
  const request = () => b.post('/api/v1/chats/1/messages', b.tokens.device, { text: 'after validation', clientKey: 'probation-key' });
  assert.equal((await request()).status, 503);
  assert.equal(b.store.getSend('probation-key'), null);
  pending = false;
  assert.equal((await request()).status, 201);
});

test('startup preserves a live finisher transaction and recovers migrated data after it dies', SWITCHES, async (t) => {
  const s = await installed(t); s.gh.add(build(2));
  const u = createUpdater({ L: s.L, dataDir: s.dataDir, log: s.log, running: release(1).version, repo, slug, fetchImpl: s.gh.fetchImpl, handoff: async () => {} });
  await u.check(); await s.service.kill();
  const { acquireUpdateLock } = await import('../src/install.js');
  const { recoverStartup } = await import('../src/updater.js');
  const unlock = acquireUpdateLock(s.L);
  try { assert.equal((await recoverStartup({ L: s.L, dataDir: s.dataDir, running: release(2).version, log: s.log })).pending, true); } finally { unlock(); }
  assert.equal(currentVersion(s.L), release(2).version);
  spawnSync(process.execPath, ['-e', 'new (require("node:sqlite").DatabaseSync)(' + JSON.stringify(path.join(s.dataDir, 'state.db')) + ').exec("pragma user_version = 99")']);
  await recoverStartup({ L: s.L, dataDir: s.dataDir, running: release(2).version, log: s.log });
  assert.equal(dataFormatOf(path.join(s.dataDir, 'state.db')), DATA_FORMAT);
  assert.equal(currentVersion(s.L), release(1).version);
});

test('a pause during drain releases the gate and leaves current untouched', async (t) => {
  const s = await installed(t);
  s.gh.add(build(2));
  let held = false;
  const u = createUpdater({ L: s.L, dataDir: s.dataDir, log: s.log, running: release(1).version, repo, slug, fetchImpl: s.gh.fetchImpl,
    quiesce: { hold() { held = true; updateState(s.L, (st) => { st.paused = true; }); }, release() { held = false; }, busy: () => ({ sends: 0, exporting: false }) },
    handoff: async () => assert.fail('pause must prevent the switch'),
  });
  assert.equal((await u.check()).state, 'paused');
  assert.equal(held, false);
  assert.equal(currentVersion(s.L), release(1).version);
});

test('format rollback never discards a send accepted after the backup', SWITCHES, async (t) => {
  const s = await installed(t);
  s.gh.add(build(2));
  const u = createUpdater({ L: s.L, dataDir: s.dataDir, log: s.log, running: release(1).version, repo, slug, fetchImpl: s.gh.fetchImpl, handoff: async () => {} });
  await u.check();
  const store = openStore(path.join(s.dataDir, 'state.db'));
  store.putSend('newly-accepted', '1', 'sent', '43'); store.close();
  spawnSync(process.execPath, ['-e', 'new (require("node:sqlite").DatabaseSync)(' + JSON.stringify(path.join(s.dataDir, 'state.db')) + ').exec("pragma user_version = 99")']);
  const outcome = await finishSwitch({ L: s.L, dataDir: s.dataDir, port: s.port, log: s.log, seconds: 0,
    service: { restart: async () => {}, stop: async () => {}, start: async () => {} },
    fetchImpl: async () => new Response('{}', { status: 503 }),
  });
  assert.equal(outcome.state, 'rollback_failed');
  assert.equal(dataFormatOf(path.join(s.dataDir, 'state.db')), 99, 'new data is kept for recovery, never overwritten');
  assert.ok(readState(s.L).pending);
});

test('rollback stops the candidate before reading its format, preserving accepted sends', SWITCHES, async (t) => {
  const s = await installed(t);
  s.gh.add(build(2));
  const u = createUpdater({ L: s.L, dataDir: s.dataDir, log: s.log, running: release(1).version, repo, slug, fetchImpl: s.gh.fetchImpl, handoff: async () => {} });
  await u.check();
  const store = openStore(path.join(s.dataDir, 'state.db'));
  store.putSend('accepted-after-snapshot', '1', 'sent', '42');
  store.close();
  let stopped = false;
  const outcome = await finishSwitch({ L: s.L, dataDir: s.dataDir, port: s.port, log: s.log, seconds: 0,
    service: { restart: async () => {}, stop: async () => { stopped = true; }, start: async () => {} },
    fetchImpl: async (url) => {
      if (url.endsWith('/healthz')) return Response.json({ version: release(1).version, commit: release(1).commit });
      return Response.json({ chats: [] });
    },
  });
  assert.equal(stopped, true);
  assert.equal(outcome.state, 'rolled_back');
  const after = openStore(path.join(s.dataDir, 'state.db'));
  try { assert.equal(after.getSend('accepted-after-snapshot').message_id, '42'); } finally { after.close(); }
});

test('startup recovers an interrupted switch to last known good before opening the data', SWITCHES, async (t) => {
  const s = await installed(t);
  s.gh.add(build(2));
  const u = createUpdater({ L: s.L, dataDir: s.dataDir, log: s.log, running: release(1).version, repo, slug, fetchImpl: s.gh.fetchImpl, handoff: async () => {} });
  assert.equal((await u.check()).state, 'switched');
  const { recoverStartup } = await import('../src/updater.js');
  assert.equal(typeof recoverStartup, 'function');
  await s.service.kill();
  const result = await recoverStartup({ L: s.L, dataDir: s.dataDir, running: release(2).version, log: s.log });
  assert.equal(result.restart, true);
  assert.equal(currentVersion(s.L), release(1).version);
  assert.equal(readState(s.L).pending, null);
  assert.ok(readState(s.L).bad[release(2).version]);
  await s.service.start();
  let ready = false;
  const until = Date.now() + 3000;
  while (!ready && Date.now() < until) {
    try { ready = (await health(s.port)).version === release(1).version; } catch { /* starting */ }
    if (!ready) await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(ready, true);
});

test('two updater processes cannot stage and switch the same install', async (t) => {
  const s = await installed(t);
  s.gh.add(build(2));
  const module = new URL('../src/updater.js', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    'import {createUpdater} from ' + JSON.stringify(module) + ';' +
    'const u=createUpdater({L:' + JSON.stringify(s.L) + ',dataDir:' + JSON.stringify(s.dataDir) + ',running:' + JSON.stringify(release(1).version) + ',log:{emit(){}},fetchImpl:async()=>{process.stdout.write("held\\n");await new Promise(()=>{setTimeout(()=>{},10000);});}});await u.check();'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGKILL'));
  await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); child.once('exit', () => reject(new Error('child exited before lock'))); });
  assert.equal((await s.updater.check()).state, 'busy');
  assert.equal(currentVersion(s.L), release(1).version);
  const gone = new Promise((r) => child.once('exit', r));
  child.kill('SIGKILL'); await gone;
  s.gh.releases.delete(release(2).version);
  assert.equal((await s.updater.check()).state, 'current', 'process death releases the lock');
});

test('a download larger than its recorded size is cancelled without buffering it all', async (t) => {
  const s = scratch(); t.after(s.cleanup);
  const gh = github(); gh.add(build(1));
  let pulls = 0;
  let cancelled = false;
  const fetchImpl = async (url) => {
    if (url.endsWith('.tar.gz')) return new Response(new ReadableStream({
      pull(c) { pulls++; if (pulls > 10) c.close(); else c.enqueue(new Uint8Array(4096)); },
      cancel() { cancelled = true; },
    }));
    return gh.fetchImpl(url);
  };
  await assert.rejects(installRelease({ L: s.L, repo, slug, fetchImpl }));
  assert.equal(cancelled, true);
  assert.ok(pulls < 10);
  assert.equal(currentVersion(s.L), null);
});

test('a missing recorded release digest is refused before installing', async (t) => {
  const s = await installed(t);
  s.gh.add(build(2));
  s.gh.releases.get(release(2).version).assets[0].digest = null;
  assert.equal((await s.updater.check()).reason, 'digest');
  assert.equal(currentVersion(s.L), release(1).version);
});

test('a pause arriving while the release list downloads prevents a switch', async (t) => {
  const s = await installed(t);
  s.gh.add(build(2));
  const u = createUpdater({ L: s.L, dataDir: s.dataDir, log: s.log, running: release(1).version, repo, slug,
    fetchImpl: async (...args) => { const r = await s.gh.fetchImpl(...args); updateState(s.L, (st) => { st.paused = true; }); return r; },
    handoff: async () => assert.fail('paused during download'),
  });
  assert.equal((await u.check()).state, 'paused');
  assert.equal(currentVersion(s.L), release(1).version);
});

test('data inside the install tree is refused before an updater can prune it', (t) => {
  const s = scratch();
  t.after(s.cleanup);
  assert.throws(() => createUpdater({ L: s.L, dataDir: path.join(s.L.versions, 'data'), log: s.log, running: release(1).version }), /apart|separate/);
  mkdirSync(s.L.root, { recursive: true });
  symlinkSync(s.L.root, path.join(s.dir, 'alias'));
  assert.throws(() => createUpdater({ L: s.L, dataDir: path.join(s.dir, 'alias', 'new-data'), log: s.log, running: release(1).version }), /apart|separate/);
});

test('a data folder newer than this server understands is refused, not read', (t) => {
  const s = scratch();
  t.after(s.cleanup);
  const db = path.join(s.dataDir, 'state.db');
  assert.equal(dataFormatOf(db), DATA_FORMAT, 'a store marks the format it wrote');
  spawnSync(process.execPath, ['-e', `new (require('node:sqlite').DatabaseSync)(${JSON.stringify(db)}).exec('pragma user_version = ${DATA_FORMAT + 1}')`]);
  assert.throws(() => openStore(db), (e) => e.code === DATA_NEWER);
});
