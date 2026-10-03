// The platforms gate's rules.
//
// A test build publishes from a commit only once every pipeline that builds a
// platform on that commit has concluded green. Each publishing pipeline calls
// .github/workflows/platforms-gate.yml, which runs this file. The decision is
// here rather than in the workflow's shell so it can be tested: a gate that
// passes a commit it cannot see is the fault this exists to stop, and a shell
// block can only be tested by the situation that produces it.
//
// Adapted from the sibling app's (chela) platforms gate, which keeps the same
// rules in a shell block. The shape is this repository's, where release logic is
// a tested module under scripts/release/.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function splitList(value) {
  return String(value || '').split(',').map((part) => part.trim()).filter(Boolean);
}

// The verdict for one pipeline's run.
//
// Pure by design: the caller supplies the run's state and its WHOLE job list, so
// every branch is a unit test rather than a live GitHub condition that appears
// only in production.
//
//   pass    every required job concluded success, so this platform built and
//           tested on this commit.
//   wait    a required job has not finished, or the run's jobs have not
//           registered yet; the caller waits and asks again.
//   refuse  everything else. A skipped job, a cancelled job and a timed-out job
//           all refuse exactly as a failure does, because a job that never ran
//           is not evidence that its platform built. An unreadable run and an
//           exempt pattern that matches every job refuse too.
export function judge({ jobs, state, exempt = '' } = {}) {
  const all = Array.isArray(jobs) ? jobs : [];
  const pattern = exempt ? new RegExp(exempt) : null;
  const required = [];
  const exempted = [];
  for (const job of all) {
    const entry = {
      name: String(job && job.name || ''),
      status: String(job && job.status || ''),
      conclusion: String(job && job.conclusion || ''),
    };
    if (pattern && pattern.test(entry.name)) exempted.push(entry);
    else required.push(entry);
  }

  // A run object appears within seconds of its push while its jobs register
  // seconds later, so an empty list while the run is still going is a reason to
  // wait. Only a run that has CONCLUDED with an empty list is unreadable, and a
  // gate that cannot see the other platform must not pass it.
  if (!all.length) {
    const concluded = state && state.status === 'completed';
    if (concluded) {
      return {
        verdict: 'refuse',
        required,
        exempted,
        reason: 'its run concluded ' + (state.conclusion || 'with no conclusion')
          + ' and listed no job at all, so the gate cannot see whether it built and tested.'
          + ' A gate that cannot see the other platform must not pass it.',
      };
    }
    return { verdict: 'wait', required, exempted, waitFor: 'its jobs have not registered yet' };
  }

  // An exempt pattern that matches every job would require nothing at all,
  // which is a mistake in the calling workflow rather than a state to wait out.
  if (!required.length) {
    return {
      verdict: 'refuse',
      required,
      exempted,
      reason: 'every job in the run matches the exempt pattern, so the gate would require none of it.'
        + ' An exempt pattern names only the jobs that cannot conclude before this pipeline publishes.',
    };
  }

  const pending = required.filter((job) => job.status !== 'completed');
  if (pending.length) {
    return {
      verdict: 'wait',
      required,
      exempted,
      pending,
      waitFor: pending.length + ' of the jobs it must pass have not finished',
    };
  }

  const red = required.filter((job) => job.conclusion !== 'success');
  if (red.length) {
    return {
      verdict: 'refuse',
      required,
      exempted,
      red,
      reason: 'not every job it lists concluded success.',
    };
  }

  return { verdict: 'pass', required, exempted };
}

// A leg cancelled by SUPERSESSION is a commit that has been replaced, not a
// platform that broke: a newer run of the same workflow exists on the same
// branch, so the branch moved on and nobody is waiting on this commit. Narrow on
// purpose. EVERY red job must be cancelled and a newer run must exist; a manual
// stop or a broken runner leaves a red job that is not cancelled.
export function isSupersession({ red = [], newerRuns = 0 } = {}) {
  if (!red.length || newerRuns < 1) return false;
  return red.every((job) => job.conclusion === 'cancelled');
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// One page of 100 workflow runs carries every run's whole head commit message, and on this repository that page is
// already larger than execFileSync's 1 MiB default output buffer, which killed gh with ENOBUFS and failed the gate
// for a commit whose platforms were fine. The buffer is a ceiling, not an allocation.
export const GH_MAX_BUFFER = 64 * 1024 * 1024;

// GitHub's API answers a 5xx, or times out, for a moment at a time. One such answer killed the gate mid poll and failed
// a commit whose platforms were fine, so a transient failure is asked again a bounded number of times, with a growing
// pause; anything else (a 404, a bad token, bad JSON) fails at once, and the last transient failure is thrown as it is.
const TRANSIENT = /HTTP 5\d\d|No server is currently available|couldn't respond to your request in time|ETIMEDOUT|ECONNRESET|EAI_AGAIN|i\/o timeout|connection reset/i;
export const isTransient = (err) => TRANSIENT.test([err && err.message, err && err.stderr, err && err.stdout].map((x) => String(x || '')).join('\n'));

export function ghJson(bin, args, env = process.env, { attempts = 5, wait = sleep, pauseMs = 5000 } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return JSON.parse(execFileSync(bin, args, { encoding: 'utf8', env, maxBuffer: GH_MAX_BUFFER }));
    } catch (err) {
      if (attempt >= attempts || !isTransient(err)) throw err;
      wait(pauseMs * attempt);
    }
  }
}

const ghApi = (endpoint, env = process.env) => ghJson('gh', ['api', endpoint], env);

export function findRun(runs, pipeline, refName) {
  const mine = (runs || [])
    .filter((run) => run.name === pipeline)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return mine.find((run) => run.head_branch === refName) || mine[0] || null;
}

function jobsOf(repo, runId, env) {
  return (ghApi('repos/' + repo + '/actions/runs/' + runId + '/jobs?per_page=100', env).jobs || []).map((job) => ({
    name: job.name,
    status: job.status,
    conclusion: job.conclusion || '',
  }));
}

// The live check. Everything it decides is judge()'s or isSupersession()'s; this
// half only fetches and reports, which is what lets the rules be tested without
// GitHub.
export function check(options, io = {}) {
  const {
    repo, sha, refName, pipelines, exempt = '', purpose = 'publish',
    windowMinutes = 120, graceSeconds = 180, pollSeconds = 15,
  } = options;
  const out = io.out || ((line) => process.stdout.write(line + '\n'));
  const summary = io.summary || (() => {});
  const warn = io.notice || (() => {});
  const gha = io.annotation || (() => {});
  const wait = io.wait || sleep;
  const now = io.now || (() => Date.now());
  const env = io.env || process.env;
  const runsFor = io.runsFor || ((commit) =>
    ghApi('repos/' + repo + '/actions/runs?head_sha=' + commit + '&per_page=100', env).workflow_runs || []);
  const jobsFor = io.jobsFor || ((runId) => jobsOf(repo, runId, env));
  const runFor = io.runFor || ((runId) => ghApi('repos/' + repo + '/actions/runs/' + runId, env));
  const newerRunsFor = io.newerRunsFor || ((name, branch, createdAt) =>
    (ghApi('repos/' + repo + '/actions/runs?branch=' + branch + '&per_page=100', env).workflow_runs || [])
      .filter((run) => run.name === name && String(run.created_at) > String(createdAt)).length);

  out('the gate: nothing is ' + purpose + 'ed from ' + sha + ' until every listed platform has passed on it');
  out('required: the whole job list of ' + pipelines.join(', ') + (exempt ? ', except /' + exempt + '/' : ''));

  const refusals = [];
  for (const pipeline of pipelines) {
    const deadline = now() + windowMinutes * 60000;
    const graceEnd = now() + graceSeconds * 1000;

    let run = null;
    while (!run) {
      run = findRun(runsFor(sha), pipeline, refName);
      if (run) break;
      if (now() >= graceEnd) break;
      wait(pollSeconds * 1000);
    }

    // No escape. A commit that reaches this gate ships something, both pipelines
    // trigger on every path, and which commits publish is decided in one place,
    // scripts/release/changes.mjs. A missing run is a broken trigger or a run that
    // was never created, so publishing without this platform's evidence is
    // exactly the fault the gate exists to stop.
    if (!run) {
      refusals.push({ pipeline, reason: pipeline + ' has no run for ' + sha + ', and every commit that reaches this gate ships something. A missing run is a broken trigger rather than a platform this commit does not involve.' });
      continue;
    }

    out(pipeline + "'s run for this commit: " + run.html_url);
    for (;;) {
      const state = runFor(run.id);
      const verdict = judge({ jobs: jobsFor(run.id), state, exempt });

      if (verdict.verdict === 'pass') {
        out(pipeline + "'s whole job list is green on " + sha + ':');
        for (const job of verdict.required) out('  ' + job.name + ': ' + job.conclusion);
        summary('### ' + pipeline + ' is green on this commit\n\nEvery job it lists passed, so it is holding nothing back:\n\n'
          + verdict.required.map((job) => '- `' + job.name + '`: ' + job.conclusion).join('\n'));
        break;
      }

      if (verdict.verdict === 'refuse') {
        const red = verdict.red || [];
        if (red.length) {
          const branch = run.head_branch;
          const newer = newerRunsFor(pipeline, branch, run.created_at);
          if (isSupersession({ red, newerRuns: newer })) {
            warn(pipeline + "'s run for " + sha + ' was superseded (' + newer + ' newer run(s) of it on ' + branch
              + '), so its legs were cancelled by the branch moving on rather than by anything failing. Standing down: this commit has been replaced, and this is not a failure.');
            summary('### Superseded, not failed\n\n`' + pipeline + '` was cancelled for `' + sha + '` because '
              + newer + ' newer run(s) of it exist on `' + branch + '`.');
            out(pipeline + ' was superseded, so this commit is not the one being judged.');
            break;
          }
        }
        refusals.push({ pipeline, reason: verdict.reason, red, run });
        break;
      }

      if (now() >= deadline) {
        refusals.push({ pipeline, reason: pipeline + ' has not passed after ' + windowMinutes + ' minutes, and ' + (verdict.waitFor || 'its legs have not finished') + '.', run });
        break;
      }
      out(pipeline + "'s run: " + (verdict.waitFor || 'still going') + '; waiting, ' + windowMinutes + ' minutes allowed in total');
      wait(pollSeconds * 1000);
    }
  }

  if (!refusals.length) {
    out('the gate is satisfied: every listed platform is green, so the ' + purpose + ' may proceed');
    return { ok: true, refusals: [] };
  }

  for (const refusal of refusals) {
    gha('::error::refusing to ' + purpose + ': ' + refusal.pipeline + ' did not pass on ' + sha + '. ' + refusal.reason);
    if (refusal.red && refusal.red.length) for (const job of refusal.red) out('  ' + job.name + ': ' + job.conclusion);
    if (refusal.run) out('Look at ' + refusal.run.html_url);
  }
  summary('### No ' + purpose + ' from this commit\n\n'
    + refusals.map((r) => '- `' + r.pipeline + '`: ' + r.reason).join('\n'));
  return { ok: false, refusals };
}

function optionsFromEnv(env) {
  return {
    repo: env.REPO || env.GITHUB_REPOSITORY,
    sha: env.SHA || env.GITHUB_SHA,
    refName: env.REF_NAME || '',
    pipelines: splitList(env.PLATFORMS),
    exempt: env.EXEMPT || '',
    purpose: env.PURPOSE || 'publish',
    windowMinutes: Number(env.WINDOW_MINUTES || 120),
  };
}

export function run(env = process.env) {
  const options = optionsFromEnv(env);
  const result = check(options, {
    summary: (text) => {
      if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, text + '\n');
    },
    annotation: (text) => process.stdout.write(text + '\n'),
  });
  if (!result.ok) process.exitCode = 1;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
