// The engine as a supervised child process speaking JSON-RPC on stdio (imsg rpc). The engine starts children of its
// own (imsg launches an osascript sender), so the whole process group is signalled, not just the pid we spawned:
// phase 2a measured that killing the parent alone leaves the engine's children running as an orphan that still
// holds the stream.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export function childTransport({ bin, args = [], log, env = process.env }) {
  const lines = new Set();
  const exits = new Set();
  let exited = false;
  // On POSIX the child leads its own process group (its id is the child's pid), so the group can be signalled as a
  // whole. Windows has no process group to signal this way, so its tree kill is used below instead.
  const group = process.platform !== 'win32';
  const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'], env, detached: group });
  const done = (info) => {
    if (exited) return;
    exited = true;
    for (const cb of exits) cb(info);
  };
  // Signal the engine and everything it started. The group first; a bare pid and a Windows tree kill are the
  // fallbacks, so a group that is already gone cannot leave us signalling nothing.
  const signalGroup = (signal) => {
    if (group) {
      try { process.kill(-child.pid, signal); return; } catch { /* the group is gone */ }
    }
    if (process.platform === 'win32') {
      try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).on('error', () => {}); } catch { /* nothing left to kill */ }
      return;
    }
    try { child.kill(signal); } catch { /* already gone */ }
  };
  child.stdin.on('error', () => {});
  createInterface({ input: child.stdout }).on('line', (l) => { for (const cb of lines) cb(l); });
  createInterface({ input: child.stderr }).on('line', (l) => log.emit('engine.stderr', { line: l }));
  child.on('exit', (code, signal) => {
    signalGroup('SIGKILL');
    done({ code, signal });
  });
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
        signalGroup('SIGTERM');
        setTimeout(() => signalGroup('SIGKILL'), 3000).unref();
      });
    },
  };
}
