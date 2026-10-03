// Run the unchanged test command once, retaining launch diagnostics even on failure.
// Usage (from ios): node scripts/test-with-diagnostics.mjs xcodebuild ...
import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';
import { setInterval, setTimeout, clearInterval, clearTimeout } from 'node:timers';
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function runTests(command, args, { directory = 'proof/launch-diagnostics',
  timeoutMs = 20 * 60 * 1000, intervalMs = 10000, diagnostics = true } = {}) {
  mkdirSync(directory, { recursive: true });
  const events = resolve(directory, 'events.jsonl');
  const event = (data) => appendFileSync(events, JSON.stringify({ time: new Date().toISOString(), ...data }) + '\n');
  const capture = (name, executable, argv) => {
    const result = spawnSync(executable, argv, { encoding: 'utf8', timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
    appendFileSync(resolve(directory, name), result.stdout || '');
    event({ capture: name, status: result.status, error: result.error?.message, stderr: result.stderr });
    return result.stdout || '';
  };
  return new Promise((done) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    for (const [stream, target] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
      stream.on('data', (data) => {
        target.write(data);
        appendFileSync(resolve(directory, 'test.log'), data);
      });
    }
    event({ state: 'started', pid: child.pid });
    let sequence = 0;
    const snapshot = () => {
      if (!diagnostics) return;
      event({ state: 'snapshot', sequence });
      const processes = capture('processes.txt', '/bin/ps', ['-axo', 'pid,ppid,%cpu,%mem,state,etime,comm']);
      // No argv or environment capture: only runner process names and stacks.
      const targets = processes.split('\n').filter((line) => /xcodebuild|CoreSimulatorService|testmanagerd|debugserver/.test(line));
      for (const line of targets) {
        const pid = line.trim().split(/\s+/)[0];
        if (/^\d+$/.test(pid)) capture('sample-status.txt', '/usr/bin/sample',
          [pid, '1', '10', '-file', resolve(directory, 'sample-' + sequence + '-' + pid + '.txt')]);
      }
      sequence++;
    };
    const timer = setInterval(snapshot, intervalMs);
    let timedOut = false;
    const deadline = setTimeout(() => { timedOut = true; event({ state: 'timeout' }); child.kill('SIGKILL'); }, timeoutMs);
    child.on('error', (error) => event({ state: 'spawn-error', error: error.message }));
    child.on('close', (code, signal) => {
      clearInterval(timer);
      clearTimeout(deadline);
      if (diagnostics) capture('launch.log', '/usr/bin/log', ['show', '--last', '20m', '--style', 'compact',
        '--predicate', 'process == "testmanagerd" OR process == "debugserver" OR process == "CoreSimulatorService" OR process == "xcodebuild"']);
      const status = timedOut ? 124 : code ?? 1;
      event({ state: 'finished', code, signal, status });
      writeFileSync(resolve(directory, 'result.json'), JSON.stringify({ status, code, signal, timedOut }) + '\n');
      done(status);
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, ...args] = process.argv.slice(2);
  if (!command) throw new Error('a test command is required');
  process.exitCode = await runTests(command, args);
}
