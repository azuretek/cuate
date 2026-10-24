import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';

const source = readFileSync(new URL('../../ios/scripts/boot-proof.sh', import.meta.url), 'utf8');
const fallback = source.match(/ {2}timeout\(\) \{[\s\S]*?\n {2}\}/)[0];

test('the simulator deadline consumes its watchdog before returning (issue 510)', () => {
  // Hold the watchdog at its real sleep boundary. A TERM trap makes its late
  // exit deterministic rather than racing the scheduler against the caller.
  const controlled = fallback.replace('( sleep', '( trap "exit 0" TERM; sleep');
  const result = spawnSync('bash', ['-c', [
    'set -euo pipefail', controlled,
    'timeout 0.05 true',
    'if kill -0 "$!" 2>/dev/null; then echo watchdog-still-live; exit 1; fi',
    'echo ready-for-next-phase',
  ].join('\n')], { encoding: 'utf8', timeout: 3000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /ready-for-next-phase/);
});

test('the simulator deadline preserves command failure (issue 510)', () => {
  const result = spawnSync('bash', ['-c', fallback + '\ntimeout 1 bash -c "exit 7"'], { encoding: 'utf8', timeout: 3000 });
  assert.equal(result.status, 7, result.stderr);
});

test('the simulator watchdog cannot interrupt the next phase output (issue 510)', { skip: process.platform !== 'darwin' }, async () => {
  // Delay a cancelled watchdog at its sleep boundary; hold the output pipe
  // full until its real child-exit signal arrives. No simulator is involved.
  const controlled = fallback.replace('( sleep', '( trap "exit 0" TERM; sleep');
  const script = [
    'set -euo pipefail', controlled, 'payload=$(printf "%2000000s" x)',
    'timeout 1 /usr/bin/true', 'echo "$payload"', 'echo ready-for-next-phase',
  ].join('\n');
  const child = spawn('/bin/bash', ['-c', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  let errors = '';
  child.stderr.on('data', (data) => { errors += data; });
  const drain = setTimeout(() => { child.stdout.on('data', (data) => { output += data; }); }, 1600);
  const guard = setTimeout(() => { child.kill('SIGTERM'); child.stdout.resume(); }, 4000);
  const result = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal }));
  }).finally(() => { clearTimeout(drain); clearTimeout(guard); });
  assert.equal(result.code, 0, errors);
  assert.equal(result.signal, null);
  assert.match(output, /ready-for-next-phase/);
  assert.doesNotMatch(errors, /Interrupted system call/);
});
