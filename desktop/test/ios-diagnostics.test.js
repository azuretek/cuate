import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTests } from '../../ios/scripts/test-with-diagnostics.mjs';

for (const code of [0, 65]) {
  test('iOS diagnostic wrapper retains output and exit ' + code, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ios-diagnostic-'));
    try {
      const status = await runTests(process.execPath, ['-e', 'console.log("synthetic proof"); process.exit(' + code + ')'],
        { directory, diagnostics: false, timeoutMs: 5000 });
      assert.equal(status, code);
      assert.match(readFileSync(join(directory, 'test.log'), 'utf8'), /synthetic proof/);
      assert.equal(JSON.parse(readFileSync(join(directory, 'result.json'))).status, code);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}

test('iOS diagnostic wrapper bounds a stuck command and records timeout', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ios-diagnostic-'));
  try {
    const status = await runTests(process.execPath, ['-e', 'setInterval(() => {}, 1000)'],
      { directory, diagnostics: false, timeoutMs: 100 });
    assert.equal(status, 124);
    assert.equal(JSON.parse(readFileSync(join(directory, 'result.json'))).timedOut, true);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
