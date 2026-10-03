// The workflows reach the network to install toolchains and system packages, and
// an unbounded one is the flake this file exists to keep out. Measured on run
// 36888349385 (2026-10-01), the Linux x64 packaging leg spent forty-four minutes
// in an apt-get with no deadline of its own and was cancelled at the job's time
// limit. So a step that installs from the network must either go through the one
// bounded script (scripts/ci/install-display-packages.sh) or carry its own
// deadline, and a new unbounded one fails here rather than in a live run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parse } from 'yaml';

const WORKFLOWS = new URL('../../.github/workflows/', import.meta.url);

test('every workflow that installs from the network bounds the install', () => {
  const files = readdirSync(WORKFLOWS).filter((file) => file.endsWith('.yml'));
  assert.ok(files.length > 0, 'no workflows were read');
  for (const file of files) {
    const workflow = parse(readFileSync(new URL(file, WORKFLOWS), 'utf8'));
    for (const [jobName, job] of Object.entries(workflow.jobs || {})) {
      for (const step of job.steps || []) {
        const run = String(step.run ?? '');
        if (/(?:^|\s)(?:sudo\s+)?apt-get\s+(?:install|update)\b/.test(run)) {
          assert.ok(
            run.includes('scripts/ci/install-display-packages.sh'),
            file + ': ' + jobName + ' runs a bare apt-get; it must go through scripts/ci/install-display-packages.sh',
          );
        }
        if (/\bbrew\s+install\b/.test(run)) {
          assert.match(run, /\btimeout\s+\d+/, file + ': ' + jobName + ' runs brew install with no deadline');
        }
        // The package store and Electron's postinstall download both come from the network (issue 66).
        if (/\bpnpm\s+install\b/.test(run)) {
          assert.ok(Number(step['timeout-minutes']) > 0, file + ': ' + jobName + ' runs pnpm install with no step deadline');
        }
        // The emulator action fetches its system image before it boots.
        if (String(step.uses ?? '').startsWith('reactivecircus/android-emulator-runner')) {
          assert.ok(Number(step['timeout-minutes']) > 0, file + ': ' + jobName + ' boots the emulator with no step deadline');
        }
      }
    }
  }
});

// Issue 66: the cache hit is STATED in the log rather than assumed. Every actions/cache step in the packaging leg
// carries an id, and a later step hands that id's cache-hit output to scripts/ci/state-cache.sh, which names the
// outcome and counts the folder.
test('the packaging leg states its cache outcome in the log', () => {
  const workflow = parse(readFileSync(new URL('package.yml', WORKFLOWS), 'utf8'));
  const steps = workflow.jobs.build.steps;
  const caches = steps.filter((step) => String(step.uses ?? '').startsWith('actions/cache'));
  assert.ok(caches.length > 0, 'the packaging leg caches nothing');
  for (const cache of caches) {
    assert.ok(cache.id, 'a packaging cache step has no id, so its outcome cannot be stated');
    const stated = steps.filter((step) => String(step.run ?? '').includes('scripts/ci/state-cache.sh')
      && Object.values(step.env ?? {}).some((value) => String(value).includes('steps.' + cache.id + '.outputs.cache-hit')));
    assert.ok(stated.length >= 2, 'the cache ' + cache.id + ' must be stated before and after packaging, found ' + stated.length);
  }
});

// Issue 66: the iOS leg's slow launch was the cost of a FIRST simulator boot (run 37120809399: the data
// migration, then minutes of first-boot background work holding the runner's cores, 63 s before the first unit
// test and 55 s more before the first UI test reached the app). The device is therefore restored, already booted
// once, from a cache keyed per runner image, runtime build and device, the outcome is stated in the log, and a
// device is saved only after every test passed and the simulator shut down cleanly.
test('the iOS leg boots a cached, already booted simulator and states the outcome', () => {
  const workflow = parse(readFileSync(new URL('ios.yml', WORKFLOWS), 'utf8'));
  const steps = workflow.jobs['build-and-boot'].steps;
  const index = (predicate, what) => {
    const found = steps.findIndex(predicate);
    assert.ok(found >= 0, 'the iOS leg has no step that ' + what);
    return found;
  };
  const restore = index((step) => String(step.uses ?? '').startsWith('actions/cache/restore'), 'restores the simulator');
  const boot = index((step) => /simctl bootstatus/.test(String(step.run ?? '')), 'starts the boot');
  const tests = index((step) => /test-without-building/.test(String(step.run ?? '')), 'runs the tests');
  const shutdown = index((step) => /simctl shutdown/.test(String(step.run ?? '')), 'shuts the simulator down');
  const save = index((step) => String(step.uses ?? '').startsWith('actions/cache/save'), 'saves the simulator');
  assert.ok(restore < boot, 'the simulator must be restored before it boots');
  assert.ok(tests < shutdown && shutdown < save, 'the simulator is saved only after the tests and a clean shutdown');
  const id = steps[restore].id;
  assert.ok(id, 'the restore step has no id, so its outcome cannot be stated');
  assert.equal(steps[save].with.key, steps[restore].with.key, 'the save and the restore must use one key');
  assert.match(String(steps[shutdown].if), new RegExp('success\\(\\).*steps\\.' + id + '\\.outputs\\.cache-hit'),
    'only a passing run whose key missed may save a device');
  assert.ok(steps.some((step) => String(step.run ?? '').includes('scripts/ci/state-cache.sh')
    && Object.values(step.env ?? {}).some((value) => String(value).includes('steps.' + id + '.outputs.cache-hit'))),
  'the simulator cache outcome must be stated in the log');
});
