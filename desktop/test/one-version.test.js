// One version, one owner. scripts/release/version.mjs derives the version of a commit, and every build takes it from
// there: the desktop package (BUILD_VERSION), the iOS archive (its _BUILD_VERSION setting), the Android APK (versionName)
// and the server's stamp (scripts/gen-server-stamp.mjs). These fail when any of them is wired to anything else, or
// when the server could report a version the clients built from the same commit do not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { snapshot } from '../../scripts/release/version.mjs';
import { stampOf, render, STAMP } from '../../scripts/gen-server-stamp.mjs';
import { readStamp } from '../../server/src/paths.js';
import { stampProblem } from '../../core/kit/rules/build.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const naming = JSON.parse(read('core/spec/naming.json'));
const workflow = (name) => parse(read('.github/workflows/' + name));
const steps = (doc) => Object.values(doc.jobs).flatMap((job) => job.steps || []);
const GENERATOR = path.join(ROOT, 'scripts', 'gen-server-stamp.mjs');
const scratch = () => mkdtempSync(path.join(os.tmpdir(), 'stamp-'));
const stampAt = (root, doc) => {
  mkdirSync(path.join(root, 'server'), { recursive: true });
  writeFileSync(path.join(root, STAMP), doc);
};

// The step that decides the version runs version.mjs, and the step that builds hands its output on unchanged.
function assertWired(doc, consumer, name) {
  const decide = steps(doc).find((step) => step.id === 'version');
  assert.ok(decide && /scripts\/release\/version\.mjs/.test(decide.run), name + ': the version step runs version.mjs');
  assert.ok(steps(doc).some((step) => String(step.run || '').includes(consumer)), name + ': the build is given ' + consumer);
}

test('every platform build takes its version from version.mjs', () => {
  const release = workflow('release.yml');
  assert.match(release.jobs.prepare.steps.find((step) => step.id === 'version').run, /^node scripts\/release\/version\.mjs$/);
  assert.equal(release.jobs.build.with.version, '${{ needs.prepare.outputs.version }}', 'the desktop packages are given the prepared version');
  assert.equal(workflow('package.yml').jobs.build.env.BUILD_VERSION, '${{ inputs.version }}');
  assert.match(read('desktop/electron-builder.mjs'), /version: process\.env\.BUILD_VERSION \|\|/);
  // The iOS build setting is named for the product, so it is spelled from naming.json rather than typed here.
  assertWired(workflow('ios.yml'), naming.slug.toUpperCase() + '_BUILD_VERSION="${{ steps.version.outputs.version }}"', 'ios.yml');
  assertWired(workflow('android.yml'), '-PversionName="${{ steps.version.outputs.version }}"', 'android.yml');
  assert.match(read('scripts/gen-server-stamp.mjs'), /import \{ snapshot \} from '\.\/release\/version\.mjs'/);
  assert.match(read('server/src/paths.js'), /'server', 'stamp\.json'/);
});

test('the server stamp and the desktop package name the same version for a commit', async () => {
  const printed = execFileSync(process.execPath, [path.join(ROOT, 'scripts/release/version.mjs')], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: '' } }).trim();
  const stamp = stampOf({ env: {} });
  assert.equal(stamp.version, printed, 'what the workflows hand the clients is what the server stamps');
  assert.equal(stamp.commit, snapshot().sha);
  const root = scratch();
  try {
    stampAt(root, render(stamp));
    assert.equal(readStamp(root).version, printed, 'the server reports its stamp');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  const saved = process.env.BUILD_VERSION;
  process.env.BUILD_VERSION = printed;
  try {
    const { default: config } = await import('../electron-builder.mjs?one-version');
    assert.equal(config.extraMetadata.version, printed, 'the desktop package reports the same version');
  } finally {
    if (saved === undefined) delete process.env.BUILD_VERSION;
    else process.env.BUILD_VERSION = saved;
  }
});

test('a build handed a different version stamps nothing', () => {
  assert.throws(() => stampOf({ env: { BUILD_VERSION: '9.9.9-dev.1.' + 'a'.repeat(10) } }), /would disagree/);
});

test('a stale, edited or missing stamp in a build fails the check', () => {
  const run = (root) => spawnSync(process.execPath, [GENERATOR, '--check', '--root', root], { cwd: ROOT, encoding: 'utf8' }).status;
  const root = scratch();
  try {
    assert.equal(run(root), 1, 'a built server without a stamp');
    const stamp = stampOf({ env: {} });
    stampAt(root, render(stamp));
    assert.equal(run(root), 0, 'this commit\'s stamp');
    stampAt(root, render({ ...stamp, builtAt: '2000-01-01T00:00:00Z' }));
    assert.equal(run(root), 1, 'an edited stamp');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an unsound stamp stops the server rather than being reported', () => {
  const commit = 'abcdef0123'.repeat(4);
  const good = { version: '0.0.1-dev.7.abcdef0123', channel: 'dev', commit, count: 7, builtAt: '2026-10-02T00:00:00Z' };
  assert.equal(stampProblem(good), null);
  assert.equal(stampProblem({ ...good, version: '0.0.1', channel: 'stable' }), null);
  assert.match(stampProblem({ ...good, version: '0.0.1-dev.7.0000000000' }), /does not name the commit/);
  assert.match(stampProblem({ ...good, channel: 'stable' }), /channel/);
  assert.match(stampProblem({ ...good, commit: 'abc' }), /commit/);
  assert.match(stampProblem({ ...good, version: 'latest' }), /not a release version/);
  assert.match(stampProblem({ ...good, builtAt: '' }), /build time/);
  const root = scratch();
  try {
    assert.equal(readStamp(root), null, 'a checkout without a stamp');
    stampAt(root, JSON.stringify({ ...good, version: '0.0.1-dev.7.0000000000' }));
    assert.throws(() => readStamp(root), /does not name the commit/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
