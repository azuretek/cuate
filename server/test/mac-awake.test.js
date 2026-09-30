// Criterion 44's sleep-hold half, on the platform it needs: while the server runs, macOS reports its sleep
// prevention and names the server's own process. Off macOS there is nothing to ask pmset, so the test is skipped
// and the suite still needs no Mac.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/main.js');
const darwin = process.platform === 'darwin';

const waitFor = async (fn, ms = 20000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
};
const exited = (child) => new Promise((resolve) => {
  if (child.exitCode !== null || child.signalCode !== null) return resolve();
  child.once('exit', () => resolve());
});
// The hold is a state macOS reports, not an event the server announces: caffeinate registers its assertion a
// moment after it starts, and the server logs server.ready before it starts the hold, so the check waits for the
// state instead of reading pmset once and racing the hold. The assertion itself is never relaxed.
const pmsetNames = (pid, text) => new RegExp('asserting on behalf of Process ID ' + pid + '\\b').test(text);
const waitForSleepHold = async (pid, ms = 10000) => {
  const t0 = Date.now();
  for (;;) {
    const last = execFileSync('/usr/bin/pmset', ['-g', 'assertions'], { encoding: 'utf8' });
    if (pmsetNames(pid, last) || Date.now() - t0 > ms) return last;
    await new Promise((r) => setTimeout(r, 100));
  }
};

test('while the server runs, pmset names its process as the one the sleep hold stands for', { skip: darwin ? false : 'needs macOS' }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'srv-awake-'));
  let child = null;
  try {
    execFileSync(process.execPath, [cli, 'init', '--engine', 'fake', '--port', '0', '--data', dir], { stdio: 'ignore' });
    child = spawn(process.execPath, [cli, 'run', '--data', dir], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    await waitFor(() => /"event":"server.ready"/.test(out));
    // caffeinate waits on the server's own process id, so macOS says whose sleep it is preventing. The hold
    // starts just after server.ready, so this waits for the state rather than reading pmset once.
    const assertions = await waitForSleepHold(child.pid);
    assert.match(assertions, new RegExp('asserting on behalf of Process ID ' + child.pid + '\\b'), 'pmset must name the server process');
  } finally {
    if (child) {
      child.kill('SIGTERM');
      await exited(child);
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
