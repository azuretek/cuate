// The platform list, held honest. Every platform this product ships runs its own
// validation leg, and the gate requires all of them, so a platform whose leg
// quietly did not run is a failing test rather than a pass.
//
// This reads the one spec (core/spec/platforms.json) and the workflows that must
// honour it, rather than trusting the two to stay in step: a desktop platform with
// no runner in the ci matrix, a phone pipeline the gate does not name, or a
// platform that carries neither a leg nor a stated reason all fail here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { splitList } from '../../scripts/release/gate.mjs';

const WORKFLOWS = new URL('../../.github/workflows/', import.meta.url);
const workflow = (name) => parse(readFileSync(new URL(name + '.yml', WORKFLOWS), 'utf8'));
const spec = JSON.parse(readFileSync(new URL('../../core/spec/platforms.json', import.meta.url), 'utf8'));
const platforms = Object.entries(spec.platforms || {});

test('every shipped platform carries a leg or a stated reason', () => {
  assert.ok(platforms.length > 0, 'the platform spec names no platform');
  for (const [name, entry] of platforms) {
    const desktop = entry.leg === 'ci';
    const phone = entry.leg === 'gate';
    assert.ok(desktop || phone || entry.reason, name + ' has neither a validation leg nor a reason it has none');
    if (entry.reason) assert.equal(entry.leg, undefined, name + ' states a reason and a leg');
  }
});

test('every desktop platform runs in the ci desktop matrix, on its own runner', () => {
  const ci = workflow('ci');
  const desktop = ci.jobs.desktop;
  assert.ok(desktop, 'the ci workflow has no desktop job');
  const job = desktop.runner ? desktop : desktop;
  const runners = job.strategy && job.strategy.matrix ? job.strategy.matrix.os : null;
  assert.ok(Array.isArray(runners), 'the desktop job is not a per-platform matrix, so one leg cannot name its platform');
  for (const [name, entry] of platforms) {
    if (entry.leg !== 'ci') continue;
    assert.ok(runners.includes(entry.runner), name + ' runs no leg: the ci desktop matrix omits ' + entry.runner);
  }
  assert.equal(job.strategy['fail-fast'], false, 'a desktop leg that fails must not cancel the others');
  assert.match(String(job.name), /matrix\.os/, 'the desktop job name must carry the platform, so a failure names it');
});

test('the merge gate requires every desktop leg and the phone pipelines', () => {
  const ci = workflow('ci');
  assert.ok(ci.jobs.gate.needs.includes('desktop'), 'the ci gate does not wait on the desktop legs');
  assert.match(JSON.stringify(ci.jobs.gate.steps), /needs\.desktop\.result/, 'the ci gate does not assert the desktop result');
  const phonePipelines = platforms.filter(([, entry]) => entry.leg === 'gate').map(([, entry]) => entry.pipeline).sort();
  const merge = Object.values(ci.jobs).filter((job) => job.uses && job.uses.endsWith('platforms-gate.yml'));
  assert.equal(merge.length, 1, 'the ci workflow must call the platforms gate exactly once to require the phone pipelines');
  assert.deepEqual(splitList(merge[0].with.platforms).sort(), phonePipelines, 'the ci gate does not require every phone pipeline');
});

test('the publishing gate names every pipeline that builds a platform, ci included', () => {
  const release = workflow('release');
  const publish = Object.values(release.jobs).filter((job) => job.uses && job.uses.endsWith('platforms-gate.yml') && job.with && job.with.purpose === 'publish');
  assert.equal(publish.length, 1, 'the release path must carry exactly one publishing gate call');
  const named = new Set(splitList(publish[0].with.platforms));
  assert.ok(named.has('ci'), 'the publishing gate does not name the ci pipeline, so the desktop legs are outside it');
  for (const [, entry] of platforms) if (entry.leg === 'gate') assert.ok(named.has(entry.pipeline), 'the publishing gate does not name ' + entry.pipeline);
});

test('the desktop smoke asserts the rendered tokens, in both schemes', () => {
  const smoke = readFileSync(new URL('../scripts/smoke.mjs', import.meta.url), 'utf8');
  assert.match(smoke, /report\.surface/, 'the smoke does not require the rendered surface to match the spec');
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /tokenMismatches/, 'the smoke does not compare resolved tokens against the spec');
  assert.match(main, /surfaceLight/, 'the light scheme is not validated');
  assert.match(main, /surfaceDark/, 'the dark scheme is not validated');
});
