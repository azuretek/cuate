// The server's release artifact checks (src/artifact.js): the publisher runs them before attaching the artifact, and
// the installed server's updater is meant to run the same ones before unpacking. A tampered file, a tampered digest
// and anything a tarball could use to write outside its folder must each be refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, gunzipSync } from 'node:zlib';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { artifactNames, digestText, manifestOf, pathProblem, readTarball, sha256, verifyArtifact, writeFiles, writeTarball } from '../src/artifact.js';

const commit = 'abcdef0123'.repeat(4);
const version = '0.0.1-dev.7.abcdef0123';
const names = artifactNames('app', version);
const stamp = (v = version, c = commit) => Buffer.from(JSON.stringify({ version: v, commit: c }));

function artifact(extra = []) {
  const files = [
    { path: 'server/stamp.json', data: stamp() },
    { path: 'server/src/main.js', data: Buffer.from('console.log(1);\n'), executable: true },
    { path: 'core/spec/naming.json', data: Buffer.from('{}\n') },
    { path: 'server/node_modules/dep/' + 'x'.repeat(90) + '/index.js', data: Buffer.alloc(1300, 7) },
    ...extra,
  ];
  const manifest = manifestOf({ name: 'app-server', version, commit, node: '>=22.13', files });
  const tarball = writeTarball(files, 1700000000);
  return { files, manifest, tarball, digest: digestText(tarball, names.tarball) };
}
const check = (a, more = {}) => verifyArtifact({ tarball: a.tarball, digest: a.digest, manifest: a.manifest, names, version, ...more });

// A raw tar with one header rewritten, its checksum recomputed: how a hostile tarball would look.
function patched(a, mutate) {
  const tar = Buffer.from(gunzipSync(a.tarball));
  mutate(tar);
  tar.fill(0x20, 148, 156);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += tar[i];
  tar.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'latin1');
  return gzipSync(tar);
}

test('the manifest lists every file in the tarball with its digest, and a sound artifact verifies', () => {
  const a = artifact();
  const files = check(a, { commit });
  assert.deepEqual([...files.keys()].sort(), a.files.map((f) => f.path).sort());
  for (const entry of a.manifest.files) {
    assert.equal(entry.sha256, sha256(files.get(entry.path)), entry.path);
    assert.equal(entry.size, files.get(entry.path).length, entry.path);
  }
  assert.deepEqual(Object.keys(a.manifest).sort(), ['commit', 'files', 'generatedBy', 'name', 'node', 'version']);
  assert.match(a.digest, /^[a-f0-9]{64} {2}app-server-0\.0\.1-dev\.7\.abcdef0123\.tar\.gz\n$/);
});

test('the tarball is a function of its files alone', () => {
  const a = artifact();
  const b = artifact();
  assert.ok(a.tarball.equals(b.tarball));
  assert.ok(writeTarball([...a.files].reverse(), 1700000000).equals(a.tarball), 'the input order does not matter');
});

test('a tampered digest is refused', () => {
  const a = artifact();
  assert.throws(() => check({ ...a, digest: '0'.repeat(64) + '  ' + names.tarball + '\n' }), /tarball digest mismatch/);
  assert.throws(() => check({ ...a, digest: a.digest.replace(names.tarball, 'other.tar.gz') }), /digest names other/);
  assert.throws(() => check({ ...a, digest: 'not a digest' }), /not one SHA-256 line/);
});

test('a tampered file is refused even when the tarball digest is recomputed to match', () => {
  const a = artifact();
  const files = a.files.map((f) => (f.path === 'server/src/main.js' ? { ...f, data: Buffer.from('process.exit(9);\n') } : f));
  const tarball = writeTarball(files, 1700000000);
  assert.throws(() => check({ ...a, tarball, digest: digestText(tarball, names.tarball) }), /file digest mismatch: server\/src\/main\.js/);
});

test('a tampered manifest digest, a missing file and an unlisted file are refused', () => {
  const a = artifact();
  const manifest = structuredClone(a.manifest);
  manifest.files[0].sha256 = '0'.repeat(64);
  assert.throws(() => check({ ...a, manifest }), /file digest mismatch/);
  const short = { ...a.manifest, files: a.manifest.files.slice(1) };
  assert.throws(() => check({ ...a, manifest: short }), /not in the manifest/);
  const more = { ...a.manifest, files: [...a.manifest.files, { path: 'server/src/gone.js', size: 1, sha256: '0'.repeat(64) }] };
  assert.throws(() => check({ ...a, manifest: more }), /missing from the tarball: server\/src\/gone\.js/);
});

test('the manifest must name this version, a commit, a Node range, and agree with the stamp', () => {
  const a = artifact();
  assert.throws(() => check(a, { version: '0.0.1-dev.8.abcdef0123' }), /names version/);
  assert.throws(() => check(a, { commit: 'f'.repeat(40) }), /names commit/);
  assert.throws(() => check({ ...a, manifest: { ...a.manifest, node: '' } }), /Node range/);
  const files = a.files.map((f) => (f.path === 'server/stamp.json' ? { ...f, data: stamp('0.0.1-dev.6.abcdef0123') } : f));
  const tarball = writeTarball(files, 1700000000);
  const manifest = manifestOf({ name: 'app-server', version, commit, node: '>=22.13', files });
  assert.throws(() => check({ tarball, digest: digestText(tarball, names.tarball), manifest }), /stamp and the manifest disagree/);
});

test('a link, a path out of the folder and a truncated tarball are refused', () => {
  const a = artifact();
  const link = patched(a, (tar) => { tar[156] = '2'.charCodeAt(0); });
  assert.throws(() => readTarball(link), /something other than a file/);
  const climb = patched(a, (tar) => { tar.write('../', 0, 'latin1'); });
  assert.throws(() => readTarball(climb), /not normal/);
  assert.throws(() => readTarball(gzipSync(gunzipSync(a.tarball).subarray(0, 1024))), /cut short|end-of-archive/);
  for (const bad of ['/etc/passwd', '../x', 'a/../../x', 'a//b', 'a\\b', 'C:/x', '']) assert.ok(pathProblem(bad), bad);
  assert.throws(() => writeTarball([{ path: '../x', data: Buffer.from('') }], 0), /refusing to pack/);
});

test('verified files unpack exactly as checked', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'artifact-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const a = artifact();
  writeFiles(check(a), dir);
  for (const f of a.files) assert.ok(readFileSync(path.join(dir, ...f.path.split('/'))).equals(f.data), f.path);
});
