// Crash records: an uncaught error writes the scrubbed stack and the flight recorder to the diagnostics folder, plus
// a Node diagnostic report without environment variables, then exits so the LaunchAgent can start it again.
// SIGUSR2 writes a diagnostic report on demand.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { scrub } from '../../core/kit/rules/scrub.js';

export function installCrashHandlers({ log, logger, dataDir }) {
  const dir = path.join(dataDir, 'diagnostics');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    process.report.directory = dir;
    process.report.reportOnFatalError = true;
    process.report.reportOnSignal = true;
    process.report.signal = 'SIGUSR2';
    if ('excludeEnv' in process.report) process.report.excludeEnv = true;
    if ('excludeNetwork' in process.report) process.report.excludeNetwork = true;
  } catch {
    // Reports are best effort.
  }
  let crashing = false;
  const crash = (err) => {
    if (crashing) return;
    crashing = true;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, 'crash-' + stamp + '.json');
    try {
      writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), error: scrub(err && err.stack ? err.stack : String(err), 8000), recorder: logger.recorder() }, null, 1), { mode: 0o600 });
    } catch {
      // The disk may be full; the log line below still says what happened.
    }
    try { process.report.writeReport(path.join(dir, 'report-' + stamp + '.json')); } catch { /* best effort */ }
    log.emit('server.crash', { error: String(err && err.message ? err.message : err), record: path.basename(file) });
    setTimeout(() => process.exit(1), 200);
  };
  process.on('uncaughtException', crash);
  process.on('unhandledRejection', crash);
}
