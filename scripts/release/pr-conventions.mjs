// The check that keeps the changelog honest: a pull request the generator can
// summarise has a conventional title with a scope and a body whose "## What
// changed" section opens with a line. It reads the pull request's own title and
// body from the event file, so it needs no token and no install, and it is a leg
// of the repository's sole gate. parseTitle and whatChanged are the generator's
// own functions, so the check and the notes cannot disagree.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseTitle, whatChanged, SECTIONS } from './changelog.mjs';

export const TYPES = SECTIONS.map(([type]) => type).join(', ');

export function check(title, body) {
  const problems = [];
  if (!parseTitle(title)) {
    problems.push('The title must read "type(scope): what changed", where type is one of ' + TYPES + ' and scope names the area, for example "fix(composer): the send arrow fills its circle". The title is: ' + JSON.stringify(String(title || '')));
  }
  if (!whatChanged(body)) {
    problems.push('The body must open its "## What changed" section with one line saying what changed, because the release notes are generated from that line. Add the "## What changed" heading with the line under it.');
  }
  return problems;
}

// A workflow command's message is written by a person and read by the runner, so
// escape what would end the command or start another.
const data = (text) => String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

export function annotation(problem) {
  return '::error title=Pull request conventions::' + data(problem);
}

export function run({ eventPath = process.env.GITHUB_EVENT_PATH, eventName = process.env.GITHUB_EVENT_NAME, stdout = process.stdout, stderr = process.stderr } = {}) {
  // A push carries no pull request; the gate needs this leg green on both events.
  if (eventName !== 'pull_request' || !eventPath) return 0;
  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  const pull = event.pull_request;
  if (!pull) return 0;
  const problems = check(pull.title, pull.body);
  if (!problems.length) { stdout.write('The pull request title and body can be summarised.\n'); return 0; }
  for (const problem of problems) stderr.write(annotation(problem) + '\n');
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = run();
