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

test('while the server runs, pmset names its process as the one the sleep hold stands for', { skip: darwin ? false : 'needs macOS' }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'srv-awake-'));
  let child = null;
  try {
    execFileSync(process.execPath, [cli, 'init', '--engine', 'fake', '--port', '0', '--data', dir], { stdio: 'ignore' });
    child = spawn(process.execPath, [cli, 'run', '--data', dir], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    await waitFor(() => /"event":"server.ready"/.test(out));
    // caffeinate waits on the server's own process id, so macOS says whose sleep it is preventing.
    const assertions = execFileSync('/usr/bin/pmset', ['-g', 'assertions'], { encoding: 'utf8' });
    assert.match(assertions, new RegExp('asserting on behalf of Process ID ' + child.pid + '\\b'), 'pmset must name the server process');
  } finally {
    if (child) {
      child.kill('SIGTERM');
      await exited(child);
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
