import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { classify, changedFiles } from '../../scripts/release/changes.mjs';
import { versionOf } from '../../scripts/release/version.mjs';
import { expectedAssets, verifyAssets, verifyDesktopAssets } from '../../scripts/release/assets.mjs';
import { buildServerArtifact, serverAssetNames, sourceFiles, verifyServerAssets } from '../../scripts/release/server-artifact.mjs';
import { digestText, manifestOf, readTarball, sha256, writeTarball } from '../../server/src/artifact.js';
import { collect } from '../../scripts/release/collect.mjs';
import { androidAssetNames, buildAndroidAssets, verifyAndroidAssets, signerDigest, fetchAndroidAssets } from '../../scripts/release/android-artifact.mjs';
import { publish, prunePlan } from '../../scripts/release/release.mjs';
import config from '../electron-builder.mjs';
const naming = JSON.parse(readFileSync(new URL('../../core/spec/naming.json', import.meta.url)));
const sha = 'abcdef0123'.repeat(4);
const version = versionOf('0.1.0', 8, sha);

test('non-shipped paths never release, unknown and shipped paths do', () => {
  for (const file of ['docs/a.txt', 'README.md', 'desktop/README.md', '.github/workflows/release.yml', '.githooks/pre-push', 'scripts/release/version.mjs', 'LICENSE', '.gitignore']) assert.equal(classify([file]).release, false, file);
  for (const file of ['core/app/main.js', 'desktop/src/main.js', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'new-platform/app']) assert.equal(classify([file]).release, true, file);
  assert.equal(classify([]).release, false);
  assert.equal(classify(['docs/a.md', 'core/a.js']).release, true);
});
test('a server-only change releases', () => {
  for (const file of ['server/src/main.js', 'server/package.json', 'server/test/cli.test.js']) assert.equal(classify([file]).release, true, file);
  assert.deepEqual(classify(['docs/server.md', 'server/src/send.js']).shipped, ['server/src/send.js']);
});
test('diff includes deletions and both sides of renames, dispatch uses release range', () => {
  const calls = [];
  const git = (args) => { calls.push(args); return args[0] === 'tag' ? 'v0.1.1-dev.4.abcdef0123\n' : 'desktop/deleted.js\0docs/a.md\0'; };
  assert.deepEqual(changedFiles({ GITHUB_EVENT_NAME: 'push', GITHUB_EVENT_BEFORE: sha }, git), ['desktop/deleted.js', 'docs/a.md']);
  assert.ok(calls[0].includes('--no-renames'));
  changedFiles({ GITHUB_EVENT_NAME: 'workflow_dispatch' }, git);
  assert.ok(calls.at(-1).includes('v0.1.1-dev.4.abcdef0123'));
});
test('one version format: next patch, commit count, ten SHA characters', () => {
  assert.equal(version, '0.1.1-dev.8.abcdef0123');
  for (const args of [['1.0', 2, sha], ['1.0.0', 0, sha], ['1.0.0', 1, 'no']]) assert.throws(() => versionOf(...args));
});
test('builder identity and install policy come from the naming spec', () => {
  assert.equal(config.productName, naming.product);
  assert.equal(config.appId, naming.ids.desktop);
  assert.equal(config.publish.owner + '/' + config.publish.repo, naming.repo);
  assert.equal(config.nsis.shortcutName, naming.product);
  assert.equal(config.nsis.perMachine, false);
  assert.equal(config.nsis.allowElevation, false);
  assert.equal(config.extraResources[0].to, 'core');
});
// A small server artifact for the fixture version: the checks are the real ones, the files are stand-ins.
function serverFixture(dir) {
  const names = serverAssetNames(version);
  const files = [
    { path: 'server/stamp.json', data: Buffer.from(JSON.stringify({ version, commit: sha })) },
    { path: 'server/src/main.js', data: Buffer.from('// main\n') },
  ];
  const tarball = writeTarball(files, 1700000000);
  writeFileSync(path.join(dir, names.tarball), tarball);
  writeFileSync(path.join(dir, names.digest), digestText(tarball, names.tarball));
  writeFileSync(path.join(dir, names.manifest), JSON.stringify(manifestOf({ name: naming.slug + '-server', version, commit: sha, node: '>=22.13', files })));
  return names;
}
// The Android half for the fixture version: a stand-in APK named and described by the real build step.
const SIGNER = 'AB:'.repeat(31) + 'AB';
function androidFixture(dir) {
  const apk = path.join(dir, 'built.apk');
  writeFileSync(apk, 'an apk, for the test');
  buildAndroidAssets({ apk, signer: SIGNER, version, commit: sha, out: dir });
  rmSync(apk);
  return androidAssetNames(version);
}
function fixture(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'release-assets-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const names = expectedAssets(version);
  const server = Object.values(serverFixture(dir));
  const android = Object.values(androidFixture(dir));
  for (const name of names) if (!server.includes(name) && !android.includes(name)) writeFileSync(path.join(dir, name), name);
  const asset = names.find((name) => name.endsWith('.exe'));
  for (const name of names.filter((name) => name.endsWith('.yml'))) {
    const files = names.filter((file) => name === 'dev.yml' ? file.endsWith('.exe') : name === 'dev-mac.yml' ? file.endsWith('.zip') : name === 'dev-linux.yml' ? file.endsWith('x86_64.AppImage') : file.endsWith('arm64.AppImage')).map((url) => { const bytes = readFileSync(path.join(dir, url)); return { url, size: bytes.length, sha512: createHash('sha512').update(bytes).digest('base64') }; });
    writeFileSync(path.join(dir, name), stringify({ version, files }));
  }
  return { dir, names, asset };
}
test('completeness refuses missing assets, bad versions and incorrect hashes', (t) => {
  const { dir, names, asset } = fixture(t);
  assert.deepEqual(verifyAssets(dir, version), names);
  writeFileSync(path.join(dir, asset), 'corrupt');
  assert.throws(() => verifyAssets(dir, version), /hash mismatch/);
  rmSync(path.join(dir, asset));
  assert.throws(() => verifyAssets(dir, version), /Missing/);
});
test('feed gate refuses a missing architecture even if every installer exists', (t) => {
  const { dir } = fixture(t);
  const file = path.join(dir, 'dev.yml');
  const doc = parse(readFileSync(file, 'utf8')); doc.files.pop(); writeFileSync(file, stringify(doc));
  assert.throws(() => verifyAssets(dir, version), /omits architecture/);
});
test('collector merges architecture feeds and refuses an asset collision', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'collect-assets-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const input = path.join(root, 'input'); const output = path.join(root, 'output');
  for (const arch of ['x64', 'arm64']) { const dir = path.join(input, arch); mkdirSync(dir, { recursive: true }); writeFileSync(path.join(dir, 'dev.yml'), stringify({ version, files: [{ url: arch + '.exe' }] })); writeFileSync(path.join(dir, arch + '.exe'), arch); }
  collect(input, output);
  assert.equal(parse(readFileSync(path.join(output, 'dev.yml'), 'utf8')).files.length, 2);
  writeFileSync(path.join(input, 'arm64', 'x64.exe'), 'duplicate');
  assert.throws(() => collect(input, output), /Duplicate asset/);
});
test('publisher is dry-run by default and deletes a partial draft on upload failure', (t) => {
  const { dir } = fixture(t);
  const calls = [];
  const gh = (args) => { calls.push(args); if (args[0] === 'api') return '[]'; if (args[1] === 'upload') throw new Error('upload failed'); return ''; };
  publish({ dir, version, sha, gh });
  assert.equal(calls.length, 0);
  assert.throws(() => publish({ dir, version, sha, gh, apply: true }), /upload failed/);
  assert.equal(calls.at(-1)[1], 'delete');
  assert.equal(calls.some((args) => args.includes('--draft=false')), false);
});
test('publication waits for remote digests and retains only the newest ten dev builds', (t) => {
  const { dir, names } = fixture(t);
  const calls = [];
  const releases = Array.from({ length: 11 }, (_, i) => ({ prerelease: true, draft: false, tag_name: 'v0.1.0-dev.' + i + '.abcdef0123', published_at: String(i).padStart(2, '0') }));
  releases.push({ prerelease: false, draft: false, tag_name: 'v0.1.0', published_at: '99' });
  const gh = (args) => {
    calls.push(args);
    if (args.includes('databaseId')) return JSON.stringify({ databaseId: 123 });
    if (args[0] === 'api' && args[1].includes('?')) return JSON.stringify(releases);
    if (args[0] === 'api') return JSON.stringify({ draft: true, assets: names.map((name) => { const bytes = readFileSync(path.join(dir, name)); return { name, size: bytes.length, digest: 'sha256:' + createHash('sha256').update(bytes).digest('hex') }; }) });
    if (args.includes('isDraft,isPrerelease')) return JSON.stringify({ isDraft: false, isPrerelease: true });
    return '';
  };
  publish({ dir, version, sha, gh, apply: true });
  const edit = calls.findIndex((args) => args.includes('--draft=false'));
  assert.ok(edit > calls.findIndex((args) => args[0] === 'api' && args[1].endsWith('/123')));
  assert.equal(calls.filter((args) => args[1] === 'delete').length, 2);
  assert.ok(!calls.some((args) => args[1] === 'delete' && args.includes('v0.1.0')));
});
test('a remote digest mismatch withdraws the draft, never publishes', (t) => {
  const { dir, names } = fixture(t); const calls = [];
  const gh = (args) => { calls.push(args); if (args.includes('databaseId')) return JSON.stringify({ databaseId: 123 }); if (args[0] === 'api' && args[1].includes('?')) return '[]'; if (args[0] === 'api') return JSON.stringify({ draft: true, assets: names.map((name) => ({ name, size: 0, digest: 'wrong' })) }); return ''; };
  assert.throws(() => publish({ dir, version, sha, gh, apply: true }), /Uploaded asset differs/);
  assert.equal(calls.at(-1)[1], 'delete');
  assert.ok(!calls.some((args) => args.includes('--draft=false')));
});
test('all six native packaging legs and their tests gate the sole publisher', () => {
  const workflow = parse(readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8'));
  const packaging = parse(readFileSync(new URL('../../.github/workflows/package.yml', import.meta.url), 'utf8'));
  assert.equal(packaging.jobs.build.strategy.matrix.include.length, 6);
  // The publisher needs the platforms gate beside the build: a test build may not
  // publish from a run whose phone or desktop leg was red.
  assert.deepEqual(workflow.jobs.release.needs, ['prepare', 'platforms', 'build', 'server']);
  assert.match(workflow.jobs.release.if, /needs\.platforms\.result == 'success'/);
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.deepEqual(workflow.on.push.branches, ['main']);
  assert.equal(workflow.on.push.paths, undefined);
  assert.ok(packaging.jobs.build.steps.some((step) => step.run === 'pnpm run test'));
  assert.ok(packaging.jobs.build.steps.some((step) => step.run?.includes('smoke-packed.mjs')));
});

test('the prune plan keeps exactly ten dev releases and spares stable and unrelated ones', () => {
  const dev = Array.from({ length: 14 }, (_, i) => ({ prerelease: true, draft: false, tag_name: 'v0.1.0-dev.' + i + '.abcdef0123', published_at: String(i).padStart(2, '0') }));
  const stable = { prerelease: false, draft: false, tag_name: 'v0.1.0', published_at: '99' };
  const unrelated = { prerelease: true, draft: false, tag_name: 'v9.9.9-rc.1', published_at: '50' };
  const draft = { prerelease: true, draft: true, tag_name: 'v0.1.0-dev.99.abcdef0123', published_at: '51' };
  const tag = 'v0.1.1-dev.8.abcdef0123';
  const plan = prunePlan([...dev, stable, unrelated, draft], tag);
  // Ten survive: the one just published plus the newest nine that were already up.
  assert.equal(plan.keep.length, 10);
  assert.equal(plan.keep[0], tag);
  assert.equal(plan.drop.length, 5);
  for (const spared of [stable.tag_name, unrelated.tag_name, draft.tag_name]) assert.ok(!plan.drop.includes(spared), spared + ' must never be prunable');
  // A rerun finds its own tag already listed and does not push it twice: that
  // would drop one more than it should.
  const rerun = prunePlan([{ prerelease: true, draft: false, tag_name: tag, published_at: '99' }, ...dev], tag);
  assert.equal(rerun.keep.length, 10);
  assert.equal(rerun.drop.length, 5);
});

test('an abandoned draft for this tag is cleared before re-uploading over it', (t) => {
  const { dir } = fixture(t);
  const calls = [];
  const releases = [{ prerelease: true, draft: true, tag_name: 'v0.1.1-dev.8.abcdef0123', published_at: '01' }];
  const gh = (args) => {
    calls.push(args);
    if (args[0] === 'api' && args[1].includes('?')) return JSON.stringify(releases);
    if (args.includes('databaseId')) return JSON.stringify({ databaseId: 123 });
    if (args[0] === 'api') return JSON.stringify({ draft: true, assets: [] });
    return '';
  };
  assert.throws(() => publish({ dir, version, sha, gh, apply: true }), /Draft asset count mismatch/);
  const del = calls.findIndex((args) => args[1] === 'delete' && args[2] === 'v0.1.1-dev.8.abcdef0123');
  const create = calls.findIndex((args) => args[1] === 'create');
  assert.ok(del >= 0, 'the abandoned draft is deleted');
  assert.ok(create > del, 'the delete happens before the create');
});

test('the publisher verifies the server assets with the desktop ones and refuses a tampered one', (t) => {
  const { dir } = fixture(t);
  const names = serverAssetNames(version);
  const assets = verifyAssets(dir, version, { commit: sha });
  for (const name of Object.values(names)) assert.ok(assets.includes(name), name);
  assert.throws(() => verifyAssets(dir, version, { commit: 'f'.repeat(40) }), /names commit/);
  const tarball = path.join(dir, names.tarball);
  const good = readFileSync(tarball);
  writeFileSync(tarball, Buffer.concat([good, Buffer.from('x')]));
  assert.throws(() => verifyAssets(dir, version), /tarball digest mismatch/);
  const calls = [];
  assert.throws(() => publish({ dir, version, sha, gh: (args) => { calls.push(args); return '[]'; }, apply: true }), /tarball digest mismatch/);
  assert.equal(calls.length, 0, 'nothing reaches GitHub from a tampered set');
  writeFileSync(tarball, good);
  rmSync(path.join(dir, names.manifest));
  assert.throws(() => verifyAssets(dir, version), /Missing or empty asset/);
  assert.equal(verifyDesktopAssets(dir, version).length, expectedAssets(version).length - 5, 'the desktop half alone does not look at the server or the APK');
});

test('a real server build lists every file it packs, each with a matching digest', (t) => {
  const out = mkdtempSync(path.join(os.tmpdir(), 'server-build-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const env = { ...process.env };
  delete env.BUILD_VERSION;
  const { names, manifest } = buildServerArtifact({ out, env, log: () => {} });
  const { files } = verifyServerAssets(out, manifest.version, { commit: manifest.commit });
  const packed = readTarball(readFileSync(path.join(out, names.tarball)));
  assert.equal(packed.size, manifest.files.length);
  for (const entry of manifest.files) assert.equal(sha256(packed.get(entry.path)), entry.sha256, entry.path);
  for (const source of sourceFiles()) assert.ok(files.has(source), 'the tracked source ships: ' + source);
  assert.ok(files.has('server/stamp.json') && files.has('server/node_modules/ws/package.json'), 'the stamp and the production dependencies ship');
  assert.ok(![...files.keys()].some((p) => /^(core|server)\/test\//.test(p)), 'tests do not ship');
  assert.equal(manifest.node, JSON.parse(readFileSync(new URL('../../package.json', import.meta.url))).engines.node);
  assert.equal(JSON.parse(files.get('server/stamp.json')).version, manifest.version);
});

test('the server artifact is built from the release version, tested, and holds the publisher', () => {
  const release = parse(readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8'));
  const ci = parse(readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8'));
  const server = parse(readFileSync(new URL('../../.github/workflows/server-artifact.yml', import.meta.url), 'utf8'));
  const root = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url)));
  assert.equal(release.jobs.server.uses, './.github/workflows/server-artifact.yml');
  assert.equal(release.jobs.server.with.version, release.jobs.build.with.version, 'one version for the server and the desktop');
  assert.equal(release.jobs.server.if, release.jobs.build.if);
  assert.ok(release.jobs.release.steps.some((step) => step.with?.name === 'server-release' && step.with?.path === 'release-assets'));
  assert.equal(server.jobs.server.env.BUILD_VERSION, '$' + '{{ inputs.version }}');
  const runs = server.jobs.server.steps.map((step) => step.run || '');
  const at = (re) => runs.findIndex((run) => re.test(run));
  assert.ok(at(/server\/test/) >= 0 && at(/server\/test/) < at(/server-artifact\.mjs build/), 'the server is tested before it is built');
  assert.ok(at(/server-artifact\.mjs verify/) > at(/server-artifact\.mjs build/));
  assert.ok(at(/server-artifact\.mjs smoke/) > at(/server-artifact\.mjs verify/));
  assert.ok(!JSON.stringify(server).includes('secrets.') && !JSON.stringify(server).includes('GH_TOKEN'));
  // The platforms gate names ci, whose test leg runs the server's tests and whose server leg builds this artifact,
  // so a server that fails either holds the release.
  assert.match(release.jobs.platforms.with.platforms, /\bci\b/);
  assert.match(root.scripts.test, /server\/test\/\*\.test\.js/);
  assert.ok(ci.jobs.test.steps.some((step) => step.run === 'pnpm run test'));
  assert.equal(ci.jobs.server.uses, './.github/workflows/server-artifact.yml');
  assert.ok(ci.jobs.gate.needs.includes('server'));
  assert.ok(ci.jobs.gate.steps[0].run.includes('needs.server.result'));
});

// Issue 192: a release carries the signed APK and its manifest, so a phone can update itself from the release.
test('the publisher verifies the Android APK against its manifest and refuses a tampered one', (t) => {
  const { dir } = fixture(t);
  const names = androidAssetNames(version);
  assert.deepEqual(names, { apk: naming.slug + '-android-' + version + '.apk', manifest: naming.slug + '-android-' + version + '.manifest.json' });
  const manifest = JSON.parse(readFileSync(path.join(dir, names.manifest), 'utf8'));
  assert.equal(manifest.signer, 'ab'.repeat(32), 'the signer is written plain and lower-case');
  assert.equal(manifest.file, names.apk);
  assert.equal(manifest.commit, sha);
  assert.ok(verifyAssets(dir, version, { commit: sha }).includes(names.apk));
  assert.throws(() => verifyAndroidAssets(dir, version, { commit: 'f'.repeat(40) }), /names commit/);
  const apk = path.join(dir, names.apk);
  writeFileSync(apk, 'an apk, for the tesT');
  assert.throws(() => verifyAssets(dir, version), /APK digest mismatch/);
  writeFileSync(apk, 'short');
  assert.throws(() => verifyAssets(dir, version), /APK size mismatch/);
  rmSync(apk);
  assert.throws(() => verifyAssets(dir, version), /Missing or empty asset/);
  assert.throws(() => signerDigest('not a digest'), /certificate/);
});

test('the release fetches the APK from the successful android run for its commit, and refuses without one', (t) => {
  const out = mkdtempSync(path.join(os.tmpdir(), 'android-fetch-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const calls = [];
  const gh = (runs) => (args) => { calls.push(args); return args[1] === 'list' ? JSON.stringify(runs) : ''; };
  fetchAndroidAssets({ commit: sha, out, gh: gh([{ databaseId: 5, conclusion: 'failure' }, { databaseId: 7, conclusion: 'success' }]) });
  assert.deepEqual(calls.at(-1).slice(0, 3), ['run', 'download', '7']);
  assert.ok(calls.at(-1).includes('android-release'));
  assert.ok(calls[0].includes(sha) && calls[0].includes('android.yml'));
  assert.throws(() => fetchAndroidAssets({ commit: sha, out, gh: gh([{ databaseId: 5, conclusion: 'failure' }]) }), /No successful android run/);
});
