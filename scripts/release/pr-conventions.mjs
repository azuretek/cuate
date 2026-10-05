// ★ The conventions check the gate runs, because release-please consumes exactly
// this input. Merges are squashed, so the pull request title becomes the commit
// subject release-please groups into the changelog, and the body's "## What
// changed" line is what a reader has to be able to find. release-please refuses
// neither, so this leg does, naming precisely what to add. It reads the pull
// request's own title and body from the event file: no token and no install, and
// a no-op on a push, which carries no pull request.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const TITLE = /^[a-z]+\([^()\s]+\)!?: \S.*$/;
const HEADING = /^#{1,6}\s+What changed\s*$/i;
const ANY_HEADING = /^#{1,6}\s+\S/;

// The first line under "## What changed", or null when the section is absent or
// empty, which is exactly the case this check refuses.
export function whatChanged(body) {
  const lines = String(body || '').split(/\r?\n/);
  const at = lines.findIndex((line) => HEADING.test(line));
  if (at < 0) return null;
  for (let i = at + 1; i < lines.length; i += 1) {
    if (ANY_HEADING.test(lines[i])) break;
    const text = lines[i].trim().replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, '').trim();
    if (text && !text.startsWith('<!--')) return text;
  }
  return null;
}

export function conventionsProblems(title, body) {
  const problems = [];
  if (!TITLE.test(String(title || '').trim())) {
    problems.push('The title must read "type(scope): a sentence", for example "fix(composer): the send arrow fills its circle". release-please uses the title as the changelog line when the pull request is squashed into main, so it may not be a bare subject or a scope with no type.');
  }
  if (!whatChanged(body)) {
    problems.push('The body must open its "## What changed" section with one line saying what changed. Add the "## What changed" heading with the line under it.');
  }
  return problems;
}

const data = (text) => String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

export function run({ eventPath = process.env.GITHUB_EVENT_PATH, eventName = process.env.GITHUB_EVENT_NAME, stdout = process.stdout, stderr = process.stderr } = {}) {
  if (eventName !== 'pull_request' || !eventPath) return 0;
  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  const pull = event.pull_request;
  if (!pull) return 0;
  const problems = conventionsProblems(pull.title, pull.body);
  if (!problems.length) { stdout.write('The pull request title and body follow the conventions.\n'); return 0; }
  for (const problem of problems) stderr.write('::error title=Pull request conventions::' + data(problem) + '\n');
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = run();
