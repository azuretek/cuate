// The pull request title is the changelog line: release-please groups a merged
// commit by its Conventional Commit type, and merges are squashed, so the title
// becomes the commit subject the changelog reads. This check refuses a title that
// is not "type(scope): a sentence" and names exactly what to add. It is a leg of
// the repository's sole gate.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const TITLE = /^[a-z]+\([^()\s]+\)!?: \S.*$/;

export function titleProblem(title) {
  const value = String(title || '').trim();
  if (TITLE.test(value)) return null;
  return 'The pull request title must read "type(scope): a sentence", for example "fix(composer): the send arrow fills its circle". release-please uses the title as the line it groups into the changelog, so it may not be a bare subject or a scope with no type. The title is: ' + JSON.stringify(value);
}

const data = (text) => String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

export function run({ eventPath = process.env.GITHUB_EVENT_PATH, eventName = process.env.GITHUB_EVENT_NAME, stdout = process.stdout, stderr = process.stderr } = {}) {
  // A push carries no pull request; the gate needs this leg green on both events.
  if (eventName !== 'pull_request' || !eventPath) return 0;
  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  const pull = event.pull_request;
  if (!pull) return 0;
  const problem = titleProblem(pull.title);
  if (!problem) { stdout.write('The pull request title is a changelog line.\n'); return 0; }
  stderr.write('::error title=Pull request title::' + data(problem) + '\n');
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = run();
