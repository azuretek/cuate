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
import { judge, isSupersession, check, findRun, splitList, ghJson, isTransient, statusFor, postStatus, STATUS_DESCRIPTION_MAX } from '../../scripts/release/gate.mjs';
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

// ★ The pull request's path: one look, no runner held. A pipeline that is still
// running or has no run yet makes the look undecided, so nothing is posted and
// the pipeline that finishes last decides; the look never waits, so a clock
// that only advances on a wait stays at zero.
test('a no-wait look is undecided while a pipeline is still running, and never waits', () => {
  const gh = fakeGitHub({ run: { id: 7, name: 'ios', head_branch: 'feat/x', created_at: 'x', html_url: 'u' }, states: [jobs(['boot', '', 'in_progress'])] });
  const result = check({ repo: 'o/r', sha: 'abc', refName: 'feat/x', pipelines: ['ios'], wait: false }, gh.io);
  assert.equal(result.ok, null);
  assert.equal(result.undecided.length, 1);
  assert.match(result.undecided[0].waitFor, /not finished/);
  assert.equal(gh.io.now(), 0, 'a no-wait look must not wait');
  assert.equal(statusFor(result, { pipelines: ['ios'] }), null, 'an undecided look posts nothing');
});

test('a no-wait look is undecided while a pipeline has not registered a run, and never waits', () => {
  const gh = fakeGitHub({ run: null, states: [[]] });
  const result = check({ repo: 'o/r', sha: 'abc', refName: 'feat/x', pipelines: ['ios'], wait: false }, gh.io);
  assert.equal(result.ok, null);
  assert.match(result.undecided[0].waitFor, /not registered a run/);
  assert.equal(gh.io.now(), 0, 'a no-wait look must not wait for the run to appear');
  assert.equal(statusFor(result, { pipelines: ['ios'] }), null);
});

// Several pipelines: one green and one unfinished is still undecided, because
// the status is one answer for all of them.
test('a no-wait look stays undecided until the LAST pipeline has finished', () => {
  const runs = { ios: { id: 1, name: 'ios', head_branch: 'feat/x', created_at: 'x', html_url: 'ios-run' }, android: { id: 2, name: 'android', head_branch: 'feat/x', created_at: 'x', html_url: 'android-run' } };
  const io = {
    ...fakeGitHub({ run: null, states: [[]] }).io,
    runsFor: () => Object.values(runs),
    jobsFor: (id) => (id === 1 ? jobs(['build and boot (simulator)', 'success']) : jobs(['build and boot (emulator)', '', 'in_progress'])),
  };
  const result = check({ repo: 'o/r', sha: 'abc', refName: 'feat/x', pipelines: ['ios', 'android'], wait: false }, io);
  assert.equal(result.ok, null);
  assert.deepEqual(result.undecided.map((entry) => entry.pipeline), ['android']);
});

test('a no-wait look passes once every pipeline is green, and the status names them all', () => {
  const gh = fakeGitHub({ run: { id: 7, name: 'ios', head_branch: 'feat/x', created_at: 'x', html_url: 'u' }, states: [jobs(['build and boot (simulator)', 'success'], ['release to TestFlight', 'skipped'])] });
  const result = check({ repo: 'o/r', sha: 'abc', refName: 'feat/x', pipelines: ['ios'], exempt: 'release to TestFlight', wait: false }, gh.io);
  assert.equal(result.ok, true);
  const status = statusFor(result, { pipelines: ['ios', 'android'] });
  assert.equal(status.state, 'success');
  assert.match(status.description, /ios, android/);
});

test('a no-wait look refuses a red leg, and the status names the platform, the job, its conclusion and the run', () => {
  const gh = fakeGitHub({ run: { id: 7, name: 'ios', head_branch: 'feat/x', created_at: 'x', html_url: 'https://example.com/run/7' }, states: [jobs(['build and boot (simulator)', 'failure'])] });
  const result = check({ repo: 'o/r', sha: 'abc', refName: 'feat/x', pipelines: ['ios'], wait: false, purpose: 'merge' }, gh.io);
  assert.equal(result.ok, false);
  const status = statusFor(result, { pipelines: ['ios'], purpose: 'merge' });
  assert.equal(status.state, 'failure');
  assert.match(status.description, /ios did not pass \(build and boot \(simulator\): failure\)/);
  assert.equal(status.target_url, 'https://example.com/run/7');
  // A skipped leg refuses here exactly as it does on the publishing gate.
  const skipped = fakeGitHub({ run: { id: 8, name: 'android', head_branch: 'feat/x', created_at: 'x', html_url: 'u' }, states: [jobs(['build and boot (emulator)', 'skipped'])] });
  assert.equal(check({ repo: 'o/r', sha: 'abc', refName: 'feat/x', pipelines: ['android'], wait: false }, skipped.io).ok, false);
});

test('a no-wait look stands down on a superseded run and posts nothing', () => {
  const gh = fakeGitHub({ run: { id: 7, name: 'ios', head_branch: 'feat/x', created_at: 'x', html_url: 'u' }, states: [jobs(['boot', 'cancelled'])], newer: 1 });
  const result = check({ repo: 'o/r', sha: 'abc', refName: 'feat/x', pipelines: ['ios'], wait: false }, gh.io);
  assert.equal(result.ok, null);
  assert.deepEqual(result.superseded.map((entry) => entry.pipeline), ['ios']);
  assert.equal(statusFor(result, { pipelines: ['ios'] }), null);
});

test('a status description fits GitHub\'s limit, however long the job names are', () => {
  const red = Array.from({ length: 6 }, (_, i) => ({ name: 'a job with a very long name number ' + i, conclusion: 'failure' }));
  const status = statusFor({ ok: false, refusals: [{ pipeline: 'ios', red, run: { html_url: 'u' } }, { pipeline: 'android', red: [], run: { html_url: 'v' } }] }, { pipelines: ['ios', 'android'] });
  assert.ok(status.description.length <= STATUS_DESCRIPTION_MAX, status.description.length + ' characters');
  assert.match(status.description, /^ios did not pass/);
});

test('posting a status reads back what GitHub recorded, and refuses a different answer', () => {
  const calls = [];
  const ok = postStatus({ repo: 'o/r', sha: 'abc', context: 'platforms', status: { state: 'failure', description: 'd', target_url: 'u' } }, {}, (bin, args) => {
    calls.push([bin, args]);
    return { state: 'failure', context: 'platforms' };
  });
  assert.equal(ok.state, 'failure');
  assert.equal(calls[0][0], 'gh');
  assert.deepEqual(calls[0][1].slice(0, 4), ['api', '-X', 'POST', 'repos/o/r/statuses/abc']);
  assert.ok(calls[0][1].includes('target_url=u'));
  assert.throws(() => postStatus({ repo: 'o/r', sha: 'abc', context: 'platforms', status: { state: 'success', description: 'd' } }, {}, () => ({ state: 'pending', context: 'platforms' })), /different status/);
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
// a publish wait on a version pull request. Every workflow that DOES build a
// platform is still caught.
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

// ★ The pull request path and the push path carry the same rules. The status
// workflow runs on the completion of every pipeline a pull request runs, judges
// the same phone pipelines with the same exemptions ci.yml's gate used to, posts
// through gate.mjs's no-wait mode, and never checks out the pull request's tree,
// since it runs with the base repository's token. ci.yml's own gate call is a
// push's alone, and its gate step reads the platforms leg differently per event.
test('the pull request platforms status is the no-wait form of the same gate, and is not a pipeline', () => {
  const status = readWorkflow('platforms-status.yml');
  const ci = readWorkflow('ci.yml');
  assert.deepEqual(Object.keys(status.on).sort(), ['workflow_dispatch', 'workflow_run'], 'the status workflow runs on completions, never as a pipeline of its own');
  assert.ok(!pipelines().includes(String(status.name)), 'the status workflow must not count as a pipeline the publishing gate has to name');
  assert.deepEqual(status.on.workflow_run.types, ['completed']);
  const phone = splitList(ci.jobs.platforms.with.platforms);
  for (const pipeline of ['ci', ...phone]) assert.ok(status.on.workflow_run.workflows.includes(pipeline), 'the status workflow does not wake on ' + pipeline + ' completing');
  for (const named of status.on.workflow_run.workflows) assert.ok(pipelines().includes(named), named + ' is not a pipeline');

  const job = status.jobs.platforms;
  assert.equal(job.name, 'platforms', 'the job is named for the status it posts');
  assert.match(String(job.if), /workflow_run\.event == 'pull_request'/, 'only a pull request\'s pipelines are judged here');
  assert.equal(job.permissions.statuses, 'write');
  assert.equal(job.permissions.actions, 'read');
  assert.equal(job.permissions.contents, undefined, 'the status job writes nothing but the status');
  assert.ok(Number(job['timeout-minutes']) > 0 && Number(job['timeout-minutes']) <= 15, 'one look is bounded in minutes, not hours');
  for (const step of job.steps.filter((entry) => String(entry.uses || '').startsWith('actions/checkout'))) {
    assert.equal(step.with?.ref, undefined, 'the checkout is the default branch\'s tree, never the pull request\'s');
    assert.equal(step.with?.['persist-credentials'], false);
  }
  const step = job.steps.find((entry) => String(entry.run || '').includes('scripts/release/gate.mjs'));
  assert.ok(step, 'the status job runs gate.mjs');
  assert.equal(step.env.MODE, 'no-wait');
  assert.equal(step.env.STATUS_CONTEXT, 'platforms');
  assert.equal(step.env.PURPOSE, 'merge');
  assert.deepEqual(splitList(step.env.PLATFORMS).sort(), phone.sort(), 'the status judges the same phone pipelines as the push gate');
  assert.equal(step.env.EXEMPT, 'release to TestFlight|sign and publish the APK', 'the publish jobs a pull request skips by design are exempt, as they were');
  assert.equal(step.env.SHA, '$' + '{{ github.event.workflow_run.head_sha || inputs.sha }}', 'the status goes on the head commit the runs were recorded against');

  // ci.yml: the waiting gate is a push's alone, and the gate step reads it so.
  assert.equal(ci.jobs.platforms.if, "github.event_name == 'push'", 'the waiting gate in ci.yml must not run on a pull request');
  assert.ok(ci.jobs.gate.needs.includes('platforms'));
  const gateRun = String(ci.jobs.gate.steps[0].run);
  assert.match(gateRun, /pull_request/, 'the gate step must read the platforms leg per event');
  assert.match(gateRun, /skipped/, 'on a pull request the platforms leg must be skipped, and the gate step says so');
  assert.equal(ci.jobs.gate.steps[0].env.PLATFORMS, '$' + '{{ needs.platforms.result }}');
});

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
