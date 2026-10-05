import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parse } from 'yaml';
import { conventionsProblems, whatChanged } from '../../scripts/release/pr-conventions.mjs';

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

test('the conventions check refuses a title that is not type(scope): summary, or a body with no What changed line', () => {
  assert.deepEqual(conventionsProblems('fix(composer): the send arrow fills its circle', '## What changed\n\nThe arrow is the icon set glyph.\n'), []);
  assert.equal(whatChanged('## What changed\n\nOne line.\n'), 'One line.');
  assert.equal(whatChanged('## What changed\n\n## Why\nx'), null);
  const both = conventionsProblems('engine: one child', 'Just prose with no heading.');
  assert.equal(both.length, 2, 'a bare title and a body with no line are both named');
  assert.match(both[0], /type\(scope\)/);
  assert.match(both[1], /## What changed/);
  assert.equal(conventionsProblems('fix(ui): x', '## What changed\n\n## Why\nnothing').length, 1, 'a good title with an empty section is refused once');
});

test('the conventions check is a leg of the gate', () => {
  const ci = parse(read('.github/workflows/ci.yml'));
  assert.ok(ci.jobs.conventions, 'the conventions job exists');
  assert.ok(ci.jobs.gate.needs.includes('conventions'), 'the gate needs it');
  assert.ok(ci.jobs.gate.steps[0].run.includes('needs.conventions.result'));
  const step = ci.jobs.conventions.steps.find((s) => s.run === 'node scripts/release/pr-conventions.mjs');
  assert.ok(step, 'the job runs the conventions check');
  assert.equal(step.if, "github.event_name == 'pull_request'");
});
