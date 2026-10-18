// Issue 443: the Android emulator still exits under VideoControlsTest with the host decoder off, and leaves no crash dump.
// A process killed from outside writes none, so a failed leg reads the kernel's log for a kill and states the memory it
// saw, so the next failure names its cause instead of being rerun.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const steps = parse(readFileSync(new URL('../../.github/workflows/android.yml', import.meta.url), 'utf8')).jobs['build-and-boot'].steps;

test('a failed Android leg reads the kernel log for why the emulator went away', () => {
  const say = steps.find((s) => s.name === 'Say why the emulator went away');
  assert.ok(say, 'no step reads why the emulator went away');
  assert.equal(say.if, 'failure()');
  assert.match(String(say.run), /dmesg/);
  assert.match(String(say.run), /free -m/);
  const boot = steps.findIndex((s) => String(s.uses ?? '').startsWith('reactivecircus/android-emulator-runner'));
  assert.ok(steps.indexOf(say) > boot, 'after the emulator step');
});
