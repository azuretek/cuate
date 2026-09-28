// The engine as a supervised child process speaking JSON-RPC on stdio (imsg rpc).
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export function childTransport({ bin, args = [], log, env = process.env }) {
  const lines = new Set();
  const exits = new Set();
  let exited = false;
  const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'], env });
  const done = (info) => {
    if (exited) return;
    exited = true;
    for (const cb of exits) cb(info);
  };
  child.stdin.on('error', () => {});
  createInterface({ input: child.stdout }).on('line', (l) => { for (const cb of lines) cb(l); });
  createInterface({ input: child.stderr }).on('line', (l) => log.emit('engine.stderr', { line: l }));
  child.on('exit', (code, signal) => done({ code, signal }));
  child.on('error', (err) => {
    log.emit('engine.error', { method: 'spawn', error: err.message });
    done({ code: null, signal: null });
  });
  return {
    pid: child.pid,
    write(s) { if (!exited && child.stdin.writable) child.stdin.write(s + '\n'); },
    onLine(cb) { lines.add(cb); },
    onExit(cb) { exits.add(cb); },
    close() {
      return new Promise((resolve) => {
        if (exited) { resolve(); return; }
        exits.add(() => resolve());
        child.stdin.end();
        setTimeout(() => child.kill('SIGTERM'), 3000).unref();
      });
    },
  };
}
