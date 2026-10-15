// The two release lanes: a dev snapshot per shipping main push, and a stable
// release cut only by a vX.Y.Z tag that release-please produces. One version
// source (scripts/release/version.mjs), one publisher, one publish gate call.
// The shape is mirrored from chela; the divergences are named in docs/RELEASE.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parse } from 'yaml';
import { stableFromRef, versionFileProblems, assertVersionFiles, VERSION_FILES } from '../../scripts/release/version.mjs';
import { DEV_VERSION, STABLE_VERSION, prunePlan } from '../../scripts/release/release.mjs';

const read = (file) => readFileSync(new URL('../../' + file, import.meta.url), 'utf8');
const workflow = (name) => parse(read('.github/workflows/' + name + '.yml'));

test('release-please owns the version, the tag and the changelog', () => {
  const config = JSON.parse(read('release-please-config.json'));
  const pkg = config.packages['.'];
  assert.equal(pkg['release-type'], 'node');
  assert.equal(config['include-v-in-tag'], true, 'a release tag reads vX.Y.Z');
  assert.equal(config['include-component-in-tag'], false, 'the tag has no component prefix');
  assert.equal(config.draft, true, 'release-please opens a draft the lane attaches to and publishes');
  assert.equal(config['force-tag-creation'], true, 'the tag is created even when it is not on a branch');
  assert.match(String(config['bootstrap-sha']), /^[a-f0-9]{40}$/, 'history is bounded by a bootstrap');
  const sections = Object.fromEntries(config['changelog-sections'].map((s) => [s.type, s.section]));
  for (const [type, section] of Object.entries({ feat: 'Features', fix: 'Fixes', perf: 'Performance', docs: 'Documentation', refactor: 'Internal', chore: 'Internal' })) assert.equal(sections[type], section, type);
  for (const path of ['core/spec/version.json', 'desktop/package.json', 'server/package.json', 'ios/project.yml', 'android/app/build.gradle.kts']) {
    assert.ok(pkg['extra-files'].find((f) => f.path === path), path + ' is an extra-file, so the tag matches every file that carries the version');
    assert.ok(existsSync(new URL('../../' + path, import.meta.url)), path + ' exists');
  }
  for (const f of pkg['extra-files'].filter((e) => e.type === 'generic')) assert.match(read(f.path), /x-release-please-version/, f.path + ' is annotated for the generic updater');
  assert.equal(JSON.parse(read('.release-please-manifest.json'))['.'], '0.0.0');
});

test('release-please starts the release build for the tag it creates', () => {
  const wf = workflow('release-please');
  assert.deepEqual(wf.on.push.branches, ['main']);
  const step = wf.jobs['release-please'].steps.find((s) => String(s.uses).startsWith('googleapis/release-please-action'));
  assert.ok(step, 'the release-please action runs');
  assert.equal(step.with['config-file'], 'release-please-config.json');
  assert.equal(step.with['manifest-file'], '.release-please-manifest.json');
  const handoff = wf.jobs['release-please'].steps.find((s) => String(s.run || '').includes('gh workflow run'));
  assert.ok(handoff, 'the build is started with workflow_dispatch, because a GITHUB_TOKEN tag raises no push event');
  assert.match(handoff.run, /gh workflow run release\.yml/);
});

test('the release workflow has both lanes and exactly one publish gate call', () => {
  const release = workflow('release');
  assert.deepEqual(release.on.push.branches, ['main']);
  assert.deepEqual(release.on.push.tags, ['v*'], 'a vX.Y.Z tag is a release trigger');
  const calls = Object.values(release.jobs).filter((job) => String(job.uses || '').endsWith('platforms-gate.yml'));
  assert.equal(calls.filter((c) => c.with && c.with.purpose === 'publish').length, 1, 'one gate call carries purpose publish, on both lanes');
});

test('a release tag is the stable version, and a dev snapshot is not', () => {
  assert.equal(stableFromRef('v1.2.3'), '1.2.3');
  assert.equal(stableFromRef('refs/tags/v1.2.3'), '1.2.3');
  for (const bad of ['1.2.3', 'v1.2', 'v1.2.3-dev.4.abcdef0123', 'refs/heads/main']) assert.throws(() => stableFromRef(bad), /release tag/, bad);
  assert.equal(STABLE_VERSION.test('1.2.3'), true);
  assert.equal(DEV_VERSION.test('0.1.1-dev.8.abcdef0123'), true);
  assert.equal(STABLE_VERSION.test('0.1.1-dev.8.abcdef0123'), false);
});

test('the tag lane refuses loudly when the tag and any version file disagree', () => {
  assert.equal(VERSION_FILES.length, 5, 'the five files release-please bumps');
  const problems = versionFileProblems('9.9.9');
  assert.equal(problems.length, 5, 'every version file disagrees with an un-bumped tag');
  let message = '';
  try { assertVersionFiles('9.9.9'); } catch (err) { message = err.message; }
  assert.match(message, /disagrees with 5 file/);
  assert.match(message, /core\/spec\/version\.json/);
  assert.throws(() => assertVersionFiles('1.2.3-dev.4.abcdef0123'), /Not a release version/);
});

test('the publisher never prunes a stable release', () => {
  const dev = Array.from({ length: 12 }, (_, i) => ({ prerelease: true, draft: false, tag_name: 'v0.1.0-dev.' + i + '.abcdef0123', published_at: String(i).padStart(2, '0') }));
  const stable = { prerelease: false, draft: false, tag_name: 'v0.1.0', published_at: '99' };
  const plan = prunePlan([...dev, stable], 'v0.1.1-dev.8.abcdef0123');
  assert.ok(!plan.drop.includes('v0.1.0'));
});

