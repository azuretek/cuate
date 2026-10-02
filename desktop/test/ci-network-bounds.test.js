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
      }
    }
  }
});
