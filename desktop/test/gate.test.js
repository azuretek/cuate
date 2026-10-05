// The platforms gate's rules are tested rather than trusted. The gate decides
// whether a test build may publish, so the ways it can be WRONG are the tests
// that matter: a leg that was skipped, cancelled or timed out must refuse, a run
// whose jobs have not registered must wait rather than pass, and every pipeline
// that builds a platform must be named by a gate call, so a platform that lands
// without joining the gate fails a test instead of publishing silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parse } from 'yaml';
import { judge, isSupersession, check, findRun, splitList, ghJson, isTransient } from '../../scripts/release/gate.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WORKFLOWS = new URL('../../.github/workflows/', import.meta.url);
const readWorkflow = (file) => parse(readFileSync(new URL(file, WORKFLOWS), 'utf8'));
const jobs = (...list) => list.map(([name, conclusion, status = 'completed']) => ({ name, status, conclusion }));

test('judge passes only when every required job concluded success', () => {
  const verdict = judge({ jobs: jobs(['build', 'success'], ['test', 'success']), state: { status: 'completed', conclusion: 'success' } });
  assert.equal(verdict.verdict, 'pass');
  assert.deepEqual(verdict.required.map((job) => job.name), ['build', 'test']);
});

test('judge refuses a skipped job exactly as a failure', () => {
  for (const conclusion of ['failure', 'skipped', 'cancelled', 'timed_out', 'neutral', 'action_required']) {
    const verdict = judge({ jobs: jobs(['build', 'success'], ['release', conclusion]), state: { status: 'completed', conclusion: 'failure' } });
    assert.equal(verdict.verdict, 'refuse', conclusion);
    assert.deepEqual(verdict.red.map((job) => job.name), ['release']);
  }
});

test('judge waits while a job is unfinished, and never reads a partial list as green', () => {
  const verdict = judge({ jobs: jobs(['build', 'success'], ['release', '', 'in_progress']), state: { status: 'in_progress', conclusion: null } });
  assert.equal(verdict.verdict, 'wait');
  assert.equal(verdict.pending.length, 1);
});

test('judge waits for a running run whose jobs have not registered, and refuses a concluded one', () => {
  const running = judge({ jobs: [], state: { status: 'queued', conclusion: null } });
  assert.equal(running.verdict, 'wait');
  const concluded = judge({ jobs: [], state: { status: 'completed', conclusion: 'failure' } });
  assert.equal(concluded.verdict, 'refuse');
});

test('judge refuses an exempt pattern that would require nothing at all', () => {
  const verdict = judge({ jobs: jobs(['build', 'success']), state: { status: 'completed', conclusion: 'success' }, exempt: '.*' });
  assert.equal(verdict.verdict, 'refuse');
  assert.match(verdict.reason, /exempt pattern/);
});

test('judge exempts only the jobs the pattern names', () => {
  const verdict = judge({
    jobs: jobs(['build and boot (simulator)', 'success'], ['release to TestFlight', 'skipped']),
    state: { status: 'completed', conclusion: 'success' },
    exempt: 'release to TestFlight',
  });
  assert.equal(verdict.verdict, 'pass');
  assert.deepEqual(verdict.exempted.map((job) => job.name), ['release to TestFlight']);
});

test('isSupersession stands down only for a wholly cancelled run the branch moved past', () => {
  assert.equal(isSupersession({ red: [{ conclusion: 'cancelled' }], newerRuns: 1 }), true);
  assert.equal(isSupersession({ red: [{ conclusion: 'cancelled' }, { conclusion: 'failure' }], newerRuns: 1 }), false);
  assert.equal(isSupersession({ red: [{ conclusion: 'cancelled' }], newerRuns: 0 }), false);
  assert.equal(isSupersession({ red: [], newerRuns: 3 }), false);
});

test('findRun prefers the run recorded against this branch, newest first', () => {
  const runs = [
    { id: 1, name: 'ios', head_branch: 'main', created_at: '2026-01-01T00:00:00Z', html_url: 'a' },
    { id: 2, name: 'ios', head_branch: 'main', created_at: '2026-01-02T00:00:00Z', html_url: 'b' },
    { id: 3, name: 'ios', head_branch: 'other', created_at: '2026-01-03T00:00:00Z', html_url: 'c' },
  ];
  assert.equal(findRun(runs, 'ios', 'main').id, 2);
  assert.equal(findRun(runs, 'ios', 'missing').id, 3);
  assert.equal(findRun(runs, 'ci', 'main'), null);
});

// A fake GitHub: run lists, job lists and run state, all from maps, so the live
// half of the gate is exercised without network or sleeping.
function fakeGitHub({ run, states, newer = 0 }) {
  // A clock that only advances when the gate waits, so a window can be reached
  // without sleeping and a hang is impossible: every poll moves time forward.
  let clock = 0;
  let step = 0;
  return {
    io: {
      wait: () => { clock += 60000; },
      now: () => clock,
      out: () => {},
      summary: () => {},
      notice: () => {},
      annotation: () => {},
      runsFor: () => (run ? [run] : []),
      jobsFor: () => states[Math.min(step++, states.length - 1)],
      runFor: () => ({ status: 'completed', conclusion: 'success' }),
      newerRunsFor: () => newer,
    },
  };
}

test('check passes and reports every platform once they are all green', () => {
  const gh = fakeGitHub({ run: { id: 7, name: 'ios', head_branch: 'main', created_at: '2026-01-01T00:00:00Z', html_url: 'u' }, states: [jobs(['build and boot (simulator)', 'success'])] });
  const result = check({ repo: 'o/r', sha: 'abc', refName: 'main', pipelines: ['ios'], windowMinutes: 1, graceSeconds: 1 }, gh.io);
  assert.equal(result.ok, true);
});

test('check refuses a platform that has no run at all', () => {
  const gh = fakeGitHub({ run: null, states: [[]] });
  const result = check({ repo: 'o/r', sha: 'abc', refName: 'main', pipelines: ['ios'], windowMinutes: 1, graceSeconds: 1 }, gh.io);
  assert.equal(result.ok, false);
  assert.match(result.refusals[0].reason, /no run/);
});

test('check refuses when a platform leg is red', () => {
  const gh = fakeGitHub({ run: { id: 7, name: 'ios', head_branch: 'main', created_at: 'x', html_url: 'u' }, states: [jobs(['build and boot (simulator)', 'failure'])] });
  const result = check({ repo: 'o/r', sha: 'abc', refName: 'main', pipelines: ['ios'], windowMinutes: 1, graceSeconds: 1 }, gh.io);
  assert.equal(result.ok, false);
  assert.deepEqual(result.refusals[0].red.map((job) => job.name), ['build and boot (simulator)']);
});

test('check stands down when the platform run was superseded, rather than failing the commit', () => {
  const gh = fakeGitHub({ run: { id: 7, name: 'ios', head_branch: 'feat/x', created_at: 'x', html_url: 'u' }, states: [jobs(['boot', 'cancelled'])], newer: 2 });
  const result = check({ repo: 'o/r', sha: 'abc', refName: 'feat/x', pipelines: ['ios'], windowMinutes: 1, graceSeconds: 1 }, gh.io);
  assert.equal(result.ok, true);
});

test('check waits past a partial job list and refuses when the window runs out', () => {
  const gh = fakeGitHub({
    run: { id: 7, name: 'ios', head_branch: 'main', created_at: 'x', html_url: 'u' },
    states: [jobs(['boot', '', 'in_progress']), jobs(['boot', '', 'in_progress'])],
  });
  const result = check({ repo: 'o/r', sha: 'abc', refName: 'main', pipelines: ['ios'], windowMinutes: 1, graceSeconds: 1 }, gh.io);
  assert.equal(result.ok, false);
  assert.match(result.refusals[0].reason, /has not passed after/);
});

test('a GitHub answer larger than the 1 MiB default output buffer is read whole', () => {
  // A page of 100 runs on main measured 1.37 MB and failed the gate with ENOBUFS; three times the default stands in for it.
  const size = 3 * 1024 * 1024;
  const answer = ghJson(process.execPath, ['-e', 'process.stdout.write(JSON.stringify({ pad: "x".repeat(' + size + ') }))']);
  assert.equal(answer.pad.length, size);
});

// A stand-in for gh that fails the way GitHub did for the first few calls, then answers. The count lives in a file, since
// each call is its own process.
function flakyGh(failures, stderr) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gate-gh-'));
  const count = path.join(dir, 'count');
  const script = 'const fs = require("fs"); const f = ' + JSON.stringify(count) + '; const n = fs.existsSync(f) ? Number(fs.readFileSync(f, "utf8")) : 0; fs.writeFileSync(f, String(n + 1));'
    + ' if (n < ' + failures + ') { process.stderr.write(' + JSON.stringify(stderr) + '); process.exit(1); } process.stdout.write(JSON.stringify({ calls: n + 1 }));';
  return { args: ['-e', script], close: () => rmSync(dir, { recursive: true, force: true }) };
}

test('a GitHub 5xx or timeout is asked again, with a growing pause, and the answer that follows is used', () => {
  const gh = flakyGh(2, 'gh: No server is currently available to service your request. (HTTP 503)\n');
  try {
    const pauses = [];
    const answer = ghJson(process.execPath, gh.args, process.env, { wait: (ms) => pauses.push(ms), pauseMs: 10 });
    assert.equal(answer.calls, 3);
    assert.deepEqual(pauses, [10, 20]);
  } finally {
    gh.close();
  }
  assert.ok(isTransient({ stderr: "gh: We couldn't respond to your request in time. (HTTP 504)" }));
  assert.ok(isTransient({ message: 'read tcp: i/o timeout' }));
});

test('a failure that is not transient fails at once, and a transient one fails after its attempts run out', () => {
  const missing = flakyGh(9, 'gh: Not Found (HTTP 404)\n');
  try {
    const pauses = [];
    assert.throws(() => ghJson(process.execPath, missing.args, process.env, { wait: (ms) => pauses.push(ms) }), /HTTP 404/);
    assert.deepEqual(pauses, [], 'a 404 is an answer, not a blip');
  } finally {
    missing.close();
  }
  const down = flakyGh(9, 'gh: Server Error (HTTP 502)\n');
  try {
    const pauses = [];
    assert.throws(() => ghJson(process.execPath, down.args, process.env, { attempts: 3, wait: (ms) => pauses.push(ms), pauseMs: 1 }), /HTTP 502/);
    assert.equal(pauses.length, 2, 'bounded: three attempts, two pauses');
  } finally {
    down.close();
  }
});

test('splitList reads a comma separated pipeline list', () => {
  assert.deepEqual(splitList(' ci , ios ,, '), ['ci', 'ios']);
  assert.deepEqual(splitList(''), []);
});

// ★ The rule that stops a platform being added without joining the gate. Every
// workflow that runs for a commit (a push or pull_request trigger) is a
// pipeline, and every pipeline except the one that publishes must be named by a
// gate call. A new android.yml or server.yml fails this test until it is added,
// which is what "a missing platform leg cannot pass silently" means in a file
// rather than in a promise.
// ★ A workflow that only maintains the release pull request is not a pipeline.
// release-please.yml runs on a push to main but builds no platform and publishes
// nothing, so the publishing gate has nothing to wait on and naming it would make
// a publish wait on a version pull request. It is exempt by name, and the release
// doc names it as the exception; every workflow that DOES build a platform is
// still caught.
const NOT_A_PIPELINE = new Set(['release-please']);
function pipelines() {
  const found = [];
  for (const file of readdirSync(WORKFLOWS).filter((entry) => /\.ya?ml$/.test(entry))) {
    const doc = readWorkflow(file);
    if (NOT_A_PIPELINE.has(String(doc.name || file))) continue;
    const triggers = doc.on === undefined ? [] : typeof doc.on === 'string' ? [doc.on] : Array.isArray(doc.on) ? doc.on : Object.keys(doc.on);
    if (!triggers.some((name) => name === 'push' || name === 'pull_request')) continue;
    found.push(String(doc.name || file));
  }
  return found;
}

function gateCalls() {
  const calls = [];
  for (const file of readdirSync(WORKFLOWS).filter((entry) => /\.ya?ml$/.test(entry))) {
    const doc = readWorkflow(file);
    for (const job of Object.values(doc.jobs || {})) {
      if (!job || typeof job.uses !== 'string' || !job.uses.endsWith('platforms-gate.yml')) continue;
      calls.push({ caller: String(doc.name || file), job });
    }
  }
  return calls;
}

test('every pipeline that builds a platform is named by the publishing gate', () => {
  const all = pipelines();
  const publishing = gateCalls().filter((call) => call.job.with && call.job.with.purpose === 'publish');
  // Exactly one call publishes. Two owners of the rule would mean two answers.
  assert.equal(publishing.length, 1, 'exactly one gate call carries purpose publish');
  const { caller, job } = publishing[0];
  const named = new Set(splitList(job.with.platforms));

  // The publishing pipeline is the one that cannot name itself: its own gate call
  // is a precondition of its own publish job. Every other pipeline that builds a
  // platform has to be named here, so a new android.yml or server.yml fails this
  // test until it joins the gate rather than publishing silently.
  for (const pipeline of all) {
    assert.ok(pipeline === caller || named.has(pipeline), pipeline + ' is a pipeline that the publishing gate does not name, so a platform could land outside the gate');
  }
  // And nothing is named that is not a pipeline, so a rename cannot leave a stale
  // name behind that gates nothing.
  for (const platform of named) assert.ok(all.includes(platform), platform + ' is named by the publishing gate but is not a pipeline');
  // The merge gate names the pipelines a pull request can run, and never the
  // publishing pipeline, which a pull request does not start.
  for (const call of gateCalls()) {
    if (call === publishing[0]) continue;
    for (const platform of splitList(call.job.with && call.job.with.platforms)) {
      assert.ok(all.includes(platform), platform + ' is named by the merge gate but is not a pipeline');
    }
  }
});
