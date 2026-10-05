import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import { publicationAllowed, assertPublicationAllowed } from '../../scripts/release/policy.mjs';
const workflow = (name) => parse(readFileSync(new URL('../../.github/workflows/' + name + '.yml', import.meta.url), 'utf8'));
// Evaluate only the repository-owned expressions, not event data or arbitrary input.
const condition = (source, github, inputs = {}, runner = { os: 'macOS' }) => {
  const expression = source.replace(/^\$\{\{\s*/, '').replace(/\s*\}\}$/, '');
  // The release job's condition now also waits on the platforms gate, so the stub
  // carries that result: the test evaluates the repository's own expressions, and
  // a need it does not supply is a condition it cannot evaluate.
  // GitHub expressions use startsWith; the eval helper supplies it so a condition that uses it can be read.
  const startsWith = (value, prefix) => String(value).startsWith(prefix);
  return Boolean(Function('github', 'inputs', 'runner', 'needs', 'startsWith', 'return (' + expression + ')')(github, inputs, runner, { prepare: { outputs: { release: 'true' } }, platforms: { result: 'success' } }, startsWith));
};
test('publication allows only main push/manual, independent of a shipped-path verdict', () => {
  const release = workflow('release');
  for (const event_name of ['push', 'workflow_dispatch', 'pull_request', 'pull_request_target', 'workflow_run', 'workflow_call']) {
    for (const ref of ['refs/heads/main', 'refs/heads/topic', 'refs/pull/12/merge', 'refs/tags/v1.0.0']) {
      // A release tag is publication too: the tag lane is started for it with workflow_dispatch.
      const allowed = (ref === 'refs/heads/main' || /^refs\/tags\/v\d+\.\d+\.\d+$/.test(ref)) && ['push', 'workflow_dispatch'].includes(event_name);
      const env = { GITHUB_REF: ref, GITHUB_EVENT_NAME: event_name };
      assert.equal(publicationAllowed(env), allowed);
      if (!allowed) assert.throws(() => assertPublicationAllowed(env), /requires/);
      for (const job of ['prepare', 'build', 'server', 'release']) assert.equal(condition(release.jobs[job].if, { ref, event_name }), allowed, job + ': ' + event_name + ' ' + ref);
    }
  }
});
test('PR verification runs all native builds, has no secrets and reaches the sole required gate', () => {
  const ci = workflow('ci'); const pack = workflow('package'); const release = workflow('release');
  assert.ok(Object.hasOwn(ci.on, 'pull_request'));
  assert.equal(ci.on.pull_request_target, undefined);
  assert.equal(ci.jobs.packaging.uses, './.github/workflows/package.yml');
  assert.equal(ci.jobs.packaging.with.signed, false);
  assert.equal(ci.jobs.packaging.secrets, undefined);
  assert.equal(ci.jobs.packaging.if, undefined);
  assert.ok(ci.jobs.gate.needs.includes('packaging'));
  assert.ok(ci.jobs.gate.steps[0].run.includes('needs.packaging.result'));
  assert.equal([ci, pack, release].flatMap((w) => Object.entries(w.jobs)).filter(([key, value]) => (value.name || key) === 'gate').length, 1);
  assert.equal(pack.permissions.contents, 'read');
  assert.equal(pack.jobs.build.if, undefined);
  assert.equal(Object.keys(pack.jobs).length, 2);
  assert.equal(pack.jobs['verify-assets'].needs, 'build');
  assert.ok(pack.jobs['verify-assets'].steps.some((step) => step.run?.includes('scripts/release/assets.mjs')));
  assert.equal(pack.jobs.build.strategy.matrix.include.length, 6);
  assert.ok(!JSON.stringify(pack).includes('GH_TOKEN'));
  const signing = pack.jobs.build.steps.find((step) => step.name === 'Package signed macOS application');
  const unsigned = pack.jobs.build.steps.find((step) => step.name === 'Package unsigned macOS verification build');
  for (const event_name of ['pull_request', 'workflow_dispatch', 'push']) {
    for (const ref of ['refs/heads/main', 'refs/heads/topic', 'refs/pull/1/merge']) {
      assert.equal(condition(signing.if, { ref, event_name }, { signed: false }), false);
      assert.equal(condition(unsigned.if, { ref, event_name }, { signed: false }), true);
      assert.equal(condition(signing.if, { ref, event_name }, { signed: true }), publicationAllowed({ GITHUB_REF: ref, GITHUB_EVENT_NAME: event_name }));
    }
  }
  for (const step of pack.jobs.build.steps) if (JSON.stringify(step.env || {}).includes('secrets.')) assert.equal(step, signing);
  assert.ok(pack.jobs.build.steps.filter((step) => step.uses === 'actions/checkout@v4').every((step) => step.with['persist-credentials'] === false));
});
test('runner-dependent capture paths are evaluated only in step contexts', () => {
  const pack = workflow('package');
  assert.doesNotMatch(JSON.stringify(pack.jobs.build.env), /runner\./);
  const smoke = pack.jobs.build.steps.filter((step) => step.run?.includes('smoke-packed.mjs'));
  assert.equal(smoke.length, 2);
  for (const step of smoke) assert.equal(step.env.SHOTS, '${{ runner.temp }}/packaged-smoke');
  const captures = pack.jobs.build.steps.find((step) => step.with?.name === 'smoke-${{ matrix.platform }}-${{ matrix.arch }}');
  assert.equal(captures.with.path, '${{ runner.temp }}/packaged-smoke/*.png\n${{ runner.temp }}/packaged-smoke/report.json\n${{ runner.temp }}/packaged-smoke/failure.json\n');
});
test('publisher CLI refuses an untrusted apply before reading files or reaching GitHub', () => {
  for (const [event, ref] of [['pull_request', 'refs/heads/main'], ['workflow_dispatch', 'refs/heads/topic']]) {
    const result = spawnSync(process.execPath, ['scripts/release/release.mjs', 'does-not-exist', 'invalid', 'invalid', '--apply'], { encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_NAME: event, GITHUB_REF: ref } });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Publication requires/);
    assert.doesNotMatch(result.stderr, /ENOENT|Invalid snapshot/);
  }
});
