// Issue 443: the Android leg failed about one run in five with the emulator gone from under VideoControlsTest, the
// only tests that decode video. The emulator's HardwareDecoder feature hands the guest's H.264 decoding to the host
// process (androidboot.qemu.hwcodec.avcdec=2), so a decode that goes wrong there ends the emulator rather than a test.
// The leg boots with that feature off, so the guest decodes with its own software decoder, and keeps the crash record
// the emulator writes, so an emulator that still exits names its cause.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const workflow = parse(readFileSync(new URL('../../.github/workflows/android.yml', import.meta.url), 'utf8'));
const steps = workflow.jobs['build-and-boot'].steps;

test('the Android emulator decodes video in the guest, not in its own process', () => {
  const boot = steps.find((step) => String(step.uses ?? '').startsWith('reactivecircus/android-emulator-runner'));
  assert.ok(boot, 'the Android leg boots no emulator');
  const options = String(boot.with?.['emulator-options'] ?? '');
  assert.match(options, /(?:^|\s)-feature\s+-HardwareDecoder(?:\s|$)/, 'the emulator boots with the host video decoder on: ' + (options || '(the action defaults)'));
  // The action's defaults, which naming any option replaces.
  for (const flag of ['-no-window', '-gpu swiftshader_indirect', '-no-snapshot', '-noaudio', '-no-boot-anim']) {
    assert.ok(options.includes(flag), 'the emulator options drop the default ' + flag);
  }
});

test('the boot proof keeps the crash record of an emulator that exits', () => {
  const keep = steps.find((step) => step.name === 'Keep the boot proof');
  assert.ok(keep, 'the boot proof is not kept');
  assert.equal(keep.if, 'always()');
  assert.match(String(keep.with?.path ?? ''), /emu-crash/, 'the emulator crash record is not kept with the boot proof');
});
