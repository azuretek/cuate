import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { parseTitle, whatChanged, extractSummary, closingIssues, renderNotes, pullsInRange, previousTagOf } from '../../scripts/release/changelog.mjs';
import { check } from '../../scripts/release/pr-conventions.mjs';

const read = (file) => readFileSync(new URL('../../' + file, import.meta.url), 'utf8');
// The repository comes from the naming spec, so this file carries no product name
// (core/test/guards.test.js holds that rule).
const REPO = JSON.parse(read('core/spec/naming.json')).repo;

test('a title parses only in the conventional type(scope) form', () => {
  assert.deepEqual(parseTitle('fix(composer): the send arrow fills its circle'), { type: 'fix', scope: 'composer', breaking: false, subject: 'the send arrow fills its circle' });
  assert.equal(parseTitle('feat(a/b)!: a breaking change').breaking, true);
  for (const bad of ['engine: one child', 'fix: no scope', 'test(core): an unknown type', 'fix(composer) missing the colon', '']) assert.equal(parseTitle(bad), null, bad);
  assert.equal(parseTitle(null), null);
});

test('a body summarises from its What changed section, and falls back for an older body', () => {
  assert.equal(whatChanged('## What changed\n\n- Each conversation remembers its place.\n\n## Why\nx'), 'Each conversation remembers its place.');
  assert.equal(whatChanged('## What changed\n\n**The arrow is a glyph.**\n'), 'The arrow is a glyph.');
  assert.equal(whatChanged('## Why\n\nno summary here'), null);
  assert.equal(whatChanged('## What changed\n\n## Why\nx'), null);
  assert.equal(whatChanged('nothing at all'), null);
  assert.equal(extractSummary('Fixes #251.\n\nTwo live defects on the chats header.'), 'Two live defects on the chats header.');
  assert.equal(extractSummary('Settings and About, restructured from the screenshots.'), 'Settings and About, restructured from the screenshots.');
});

test('only Fixes, Closes and Resolves name a closed issue, in body order and without repeats', () => {
  assert.deepEqual(closingIssues('Closes #271. Part of #263. Fixes #244, fixes #244'), [271, 244]);
  assert.deepEqual(closingIssues('Related to #12'), []);
  assert.deepEqual(closingIssues(''), []);
});

const pulls = [
  { number: 12, title: 'feat(engine): one child and a readiness gate', body: '## What changed\n\nEngine restarts one child behind a ready gate.\n\nFixes #9', mergedAt: '2026-10-04T22:57:19Z' },
  { number: 11, title: 'fix(composer): the arrow fills its circle', body: '## What changed\n\nThe arrow is the icon set glyph.\n\nCloses #8', mergedAt: '2026-10-04T20:00:00Z' },
  { number: 7, title: 'fix(ui): a control holds one line', body: '## What changed\n\nA label never wraps.\n', mergedAt: '2026-10-01T09:00:00Z' },
  { number: 10, title: 'chore(ci): tighten a timeout', body: '## What changed\n\nThe leg times out in five minutes.\n', mergedAt: '2026-10-03T10:00:00Z' },
  { number: 9, title: 'engine: one child', body: 'A change described before the section existed.', mergedAt: '2026-10-02T10:00:00Z' },
];

test('the notes group merged pull requests by type, newest first, with a link, the title and the body summary', () => {
  const notes = renderNotes({ tag: 'v0.1.1-dev.5.abcdef0123', previousTag: 'v0.1.1-dev.4.abcdef0123', repo: REPO, pulls });
  assert.match(notes, /Release notes for `v0\.1\.1-dev\.5\.abcdef0123`\./);
  assert.match(notes, /Generated from the 5 pull requests merged since `v0\.1\.1-dev\.4\.abcdef0123`\./);
  // The fixed section order, with the unparsed title under Other.
  const order = ['## Features', '## Fixes', '## Chores', '## Other'].map((h) => notes.indexOf(h));
  assert.ok(order.every((at) => at >= 0), 'every section is present');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'the sections keep their order');
  assert.equal(notes.indexOf('## Performance'), -1);
  // An entry: the number and link, the title, the body summary, and the issue it fixes.
  assert.ok(notes.includes('- [#12](https://github.com/' + REPO + '/pull/12) **feat(engine): one child and a readiness gate** - fixes [#9](https://github.com/' + REPO + '/issues/9)'));
  assert.ok(notes.includes('\n  Engine restarts one child behind a ready gate.'));
  assert.ok(notes.includes('- [#11](https://github.com/' + REPO + '/pull/11) **fix(composer): the arrow fills its circle** - fixes [#8](https://github.com/' + REPO + '/issues/8)'));
  // Newest first within a group: #11 merged after #7.
  assert.ok(notes.indexOf('pull/11)') < notes.indexOf('pull/7)'));
  // A title that does not parse keeps its own summary under Other.
  assert.ok(notes.indexOf('## Other') < notes.indexOf('engine: one child'));
  assert.ok(notes.includes('A change described before the section existed.'));
});

test('the previous tag is the closest dev tag reachable from the commit, never the one being created', () => {
  const ref = (args) => args[args.length - 1];
  const tags = { 'HEAD': 'v0.0.1-dev.6.aaa', 'HEAD^': 'v0.0.1-dev.5.bbb' };
  assert.equal(previousTagOf({ tag: 'v0.0.1-dev.7.zzz', until: 'HEAD', gitRun: (cwd, args) => tags[ref(args)] }), 'v0.0.1-dev.6.aaa');
  // A rerun finds its own tag on the commit and steps to the parent.
  assert.equal(previousTagOf({ tag: 'v0.0.1-dev.6.aaa', until: 'HEAD', gitRun: (cwd, args) => tags[ref(args)] }), 'v0.0.1-dev.5.bbb');
  assert.equal(previousTagOf({ tag: 'v0.0.1-dev.6.aaa', until: 'HEAD', gitRun: () => { throw new Error('no tag'); } }), null);
});

test('the range keeps a pull request merged after the previous tag and drops an older one', () => {
  const gitRun = () => 'aaa\nbbb\nccc';
  const ghRun = () => JSON.stringify([
    { number: 1, mergeCommit: { oid: 'aaa' } },
    { number: 2, mergeCommit: { oid: 'zzz' } },
    { number: 3, mergeCommit: null },
  ]);
  const seen = [];
  const pullsIn = pullsInRange({ repo: REPO, previousTag: 'v1', until: 'v2', cwd: '/tmp', gitRun, ghRun: (args) => { seen.push(args); return ghRun(); } });
  assert.deepEqual(pullsIn.map((pull) => pull.number), [1]);
  assert.ok(seen[0].includes('--state') && seen[0].includes('--base') && seen[0].includes('--json'));
});

test('the conventions check names exactly what to add to a bad title and a body with no summary', () => {
  assert.deepEqual(check('feat(settings): a real page', '## What changed\n\nOne line.\n'), []);
  const problems = check('engine: one child', 'Just prose with no heading.');
  assert.equal(problems.length, 2);
  assert.match(problems[0], /type\(scope\): what changed/);
  assert.match(problems[0], /feat, fix, perf, refactor, docs, chore/);
  assert.match(problems[1], /## What changed/);
  assert.equal(check('fix(ui): x', '## What changed\n\n## Why\nnothing').length, 1);
});

test('the release workflow generates the notes and the conventions check is a leg of the gate', () => {
  const ci = parse(read('.github/workflows/ci.yml'));
  const release = parse(read('.github/workflows/release.yml'));
  assert.ok(ci.jobs.conventions, 'the conventions job exists');
  assert.ok(ci.jobs.gate.needs.includes('conventions'), 'the gate needs it');
  assert.ok(ci.jobs.gate.steps[0].run.includes('needs.conventions.result'), 'the gate names the leg');
  const checkStep = ci.jobs.conventions.steps.find((step) => step.run === 'node scripts/release/pr-conventions.mjs');
  assert.ok(checkStep, 'the job runs the check');
  assert.equal(checkStep.if, "github.event_name == 'pull_request'");
  const runs = release.jobs.release.steps.map((step) => step.run || '');
  assert.ok(runs.some((run) => run.includes('changelog.mjs') && run.includes('--out release-notes.md')), 'the workflow generates the notes');
  assert.ok(runs.some((run) => run.includes('release.mjs') && run.includes('--notes-file release-notes.md')), 'the publisher takes the generated file');
  const checkout = release.jobs.release.steps.find((step) => String(step.uses).startsWith('actions/checkout'));
  assert.equal(checkout.with['fetch-depth'], 0, 'the previous tag is reachable');
  assert.equal(release.jobs.release.permissions['pull-requests'], 'read');
});

test('the publisher sends the generated notes file and keeps a fallback sentence', () => {
  const src = read('scripts/release/release.mjs');
  assert.match(src, /--notes-file/);
  assert.match(src, /\.\.\.notes/);
  assert.match(src, /Test build of commit/);
});
