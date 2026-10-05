import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parse } from 'yaml';
import { titleProblem } from '../../scripts/release/pr-title.mjs';

const read = (file) => readFileSync(new URL('../../' + file, import.meta.url), 'utf8');
const at = (path) => new URL('../../' + path, import.meta.url);

test('release-please owns the version, the tag and the changelog', () => {
  const config = JSON.parse(read('release-please-config.json'));
  const pkg = config.packages['.'];
  assert.equal(pkg['release-type'], 'node');
  assert.match(String(config['bootstrap-sha']), /^[a-f0-9]{40}$/, 'the pre-release tags are not read, so the history is bounded by a bootstrap');
  assert.equal(config['include-component-in-tag'], false, 'a release tag reads vX.Y.Z');
  const sections = Object.fromEntries(pkg['changelog-sections'].map((s) => [s.type, s.section]));
  for (const [type, section] of Object.entries({ feat: 'Features', fix: 'Fixes', perf: 'Performance', refactor: 'Refactor', docs: 'Docs', chore: 'Chores' })) {
    assert.equal(sections[type], section, type + ' maps to its reader-facing heading');
  }
  const files = pkg['extra-files'];
  for (const path of ['core/spec/version.json', 'desktop/package.json', 'server/package.json', 'ios/project.yml', 'android/app/build.gradle.kts']) {
    assert.ok(files.find((f) => f.path === path), path + ' is an extra-file, so the tag matches every file that carries the version');
    assert.ok(existsSync(at(path)), path + ' exists');
  }
  for (const f of files.filter((entry) => entry.type === 'generic')) assert.match(read(f.path), /x-release-please-version/, f.path + ' is annotated for the generic updater');
  assert.equal(JSON.parse(read('.release-please-manifest.json'))['.'], '0.0.0');
});

test('the workflow maintains the release pull request on main', () => {
  const wf = parse(read('.github/workflows/release-please.yml'));
  assert.deepEqual(wf.on.push.branches, ['main']);
  assert.deepEqual(wf.permissions, { contents: 'write', 'pull-requests': 'write' });
  const step = wf.jobs['release-please'].steps.find((s) => String(s.uses).startsWith('googleapis/release-please-action'));
  assert.ok(step, 'the release-please action runs');
  assert.equal(step.with['config-file'], 'release-please-config.json');
  assert.equal(step.with['manifest-file'], '.release-please-manifest.json');
});

test('a pull request title that is not type(scope): a sentence is refused', () => {
  assert.equal(titleProblem('fix(composer): the send arrow fills its circle'), null);
  assert.equal(titleProblem('feat(engine)!: restart one child'), null);
  for (const bad of ['engine: one child', 'fix: no scope', 'a bare subject', '', null]) assert.match(titleProblem(bad), /type\(scope\)/, String(bad));
});

test('the title check is a leg of the gate', () => {
  const ci = parse(read('.github/workflows/ci.yml'));
  assert.ok(ci.jobs.title, 'the title job exists');
  assert.ok(ci.jobs.gate.needs.includes('title'), 'the gate needs it');
  assert.ok(ci.jobs.gate.steps[0].run.includes('needs.title.result'));
  const step = ci.jobs.title.steps.find((s) => s.run === 'node scripts/release/pr-title.mjs');
  assert.ok(step, 'the job runs the title check');
  assert.equal(step.if, "github.event_name == 'pull_request'");
});
