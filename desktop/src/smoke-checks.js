// The desktop smoke's required checks, each naming the bound it enforces.
//
// The smoke proves a dozen surfaces in one run, and a failure used to end with only "smoke failed: exit"
// and the whole report: that says something was wrong, but not which check read what, nor the line it
// crossed. This module evaluates the report against a table of checks and answers, for each, the value it
// read and the bound it had to meet, so a failure names the check, the number and the bound together.
//
// Pure by design: it reads the report the renderer produced and touches neither Electron nor the
// filesystem, so every branch is a unit test rather than a live run.

// Run a value function defensively: a missing report, or a key a partial run never wrote, answers
// undefined rather than throwing, and an undefined value fails its check. A failure path that could
// itself fail would hide the failure it exists to explain. A value function that throws is itself a
// failed read: the check cannot be verified, so it fails rather than passing on an unread number.
function readValue(check, report) {
  try {
    return { read: true, value: check.value(report) };
  } catch {
    return { read: false };
  }
}

// Only JSON-safe, finite values are reported; a missing value reads as null so one line stays legible.
function normalize(value) {
  if (value === undefined) return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  return value;
}

// One result per check: its key, the bound it enforces, the value it read and whether it passed.
export function evaluateChecks(checks, report) {
  const results = [];
  for (const check of checks) {
    const read = readValue(check, report);
    const measured = read.read ? normalize(read.value) : null;
    let ok = false;
    if (read.read) {
      try {
        ok = check.test(measured) === true;
      } catch {
        ok = false;
      }
    }
    results.push({ key: check.key, bound: check.bound, measured, ok });
  }
  const failures = results.filter((result) => !result.ok);
  return { ok: failures.length === 0, results, failures };
}

// One line per failed check: the key, the value it read and the bound it had to meet.
export function formatFailure(result) {
  return 'check ' + result.key + ': measured ' + JSON.stringify(result.measured) + ', required ' + result.bound;
}

export function formatFailures(results) {
  return results.filter((result) => !result.ok).map(formatFailure);
}
