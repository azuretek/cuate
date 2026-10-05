// The bound on one desktop smoke run, and the words to say when it fires.
//
// The smoke proves dozens of surfaces in a single run against a real server. Measured on the runners
// (see smoke-packed.mjs, issue 66), a whole run takes 132 to 144 seconds on arm64, Linux and Windows,
// and the macos-15-intel runner has gone past 150 seconds with every check still passing. A bound that
// fits only a quiet runner fails a run that is merely slow: while this bound was 240 seconds, a
// congested Actions queue could push a healthy run past it, and the leg failed with only
// "exit null, report null" and nothing about how far the smoke had got.
//
// The default is ten minutes, roughly four times the measured worst case, so a congested runner cannot
// SIGKILL a run that is still making progress. A bound is kept, not removed: a genuinely hung run still
// stops, and it stops at a number that knows what it measured (the elapsed time, the last step the app
// reached and every step it had completed), not at a bare job timeout.
//
// SMOKE_TIMEOUT_MS overrides the default so a developer can shorten a local run. A value that is not a
// positive integer falls back to the default rather than removing the bound.
export const SMOKE_TIMEOUT_MS_DEFAULT = 600000;

// The default may not fall below this. It is the documented floor, and the guards test holds the default
// to it so the ceiling cannot quietly shrink back to a value a congested runner has already beaten.
export const SMOKE_TIMEOUT_MS_FLOOR = 600000;

export function resolveSmokeTimeoutMs(env = process.env, fallback = SMOKE_TIMEOUT_MS_DEFAULT) {
  const raw = env ? env.SMOKE_TIMEOUT_MS : undefined;
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

// A duration a person can read at a glance: 45s, 2m 3s, 10m 0s.
export function formatDuration(ms) {
  const total = Math.max(0, Math.round(Number(ms) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? minutes + 'm ' + seconds + 's' : seconds + 's';
}

// The app prints one line per smoke group it finishes ("image viewer: {...}") on every run, before its
// final "SMOKE {...}" report, and the parent process already captures that stdout. Scanning it here
// lets the bound name the last group the app reached and every group it had completed, without a second
// copy of the smoke's step list to drift. Only a whole line whose payload parses as JSON counts, so a
// half-written marker (the stdout was cut off when the app was killed) is never read as a step.
const STEP_LINE = /^([a-z][a-z0-9 ]{0,39}): (\{.*\})$/;

export function summarizeSmokeProgress(output) {
  const completed = [];
  for (const line of String(output ?? '').split(/\r?\n/)) {
    const match = STEP_LINE.exec(line);
    if (!match) continue;
    try { JSON.parse(match[2]); } catch { continue; }
    completed.push(match[1]);
  }
  return { step: completed.length ? completed[completed.length - 1] : null, completed };
}

// The failure text. It names how long the run lasted, the bound it hit and the value that bound came
// from, the last step the app reached and the steps it had completed, so a timeout is diagnosable
// rather than a bare kill.
export function describeSmokeTimeout({ elapsedMs, timeoutMs, step, completed = [] }) {
  const where = step ? 'the last step it reached was "' + step + '"' : 'it had reached no step yet';
  const did = completed.length
    ? 'it had completed ' + completed.length + ' step' + (completed.length === 1 ? '' : 's') + ': ' + completed.join(', ')
    : 'it had completed no steps';
  return 'smoke timed out: it ran ' + formatDuration(elapsedMs) + ' and was stopped at the '
    + formatDuration(timeoutMs) + ' bound (SMOKE_TIMEOUT_MS=' + timeoutMs + '); ' + where + '; ' + did + '.';
}
