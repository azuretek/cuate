// Release notes are generated from MERGED PULL REQUESTS, never from raw commits.
//
// The version stays single-sourced in scripts/release/version.mjs; this module
// turns the pull requests merged between two tags into the body a release
// carries. Each entry is the pull request's number and link, its title, and the
// one line the body's own "## What changed" section gives, grouped by
// conventional type. pr-conventions.mjs imports parseTitle and whatChanged from
// here, so the check and the generator cannot disagree about what a
// summarisable pull request is.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// The conventional types and the section each lands in. A title outside this
// set does not parse and is grouped as Other, the bucket the check exists to
// keep empty on new work.
export const SECTIONS = [
  ['feat', 'Features'],
  ['fix', 'Fixes'],
  ['perf', 'Performance'],
  ['refactor', 'Refactor'],
  ['docs', 'Docs'],
  ['chore', 'Chores'],
];
export const OTHER = 'Other';
const SECTION_OF = new Map(SECTIONS);
const TYPES = SECTIONS.map(([type]) => type);
const TITLE = new RegExp('^(' + TYPES.join('|') + ')\\(([^()\\s]+)\\)(!?):\\s+(\\S.*)$');
const HEADING = /^#{1,6}\s+What changed\s*$/i;
const ANY_HEADING = /^#{1,6}\s+\S/;
const CLOSES = /\b(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?)\b\s*:?\s*(?:[\w.-]+\/[\w.-]+)?#(\d+)/gi;

// A conventional title parses into its type, scope, breaking marker and
// subject; anything else, a missing scope included, returns null and lands in
// Other. The check refuses a null title on a new pull request.
export function parseTitle(title) {
  const match = TITLE.exec(String(title || '').trim());
  if (!match) return null;
  const [, type, scope, bang, subject] = match;
  return { type, scope, breaking: bang === '!', subject: subject.trim() };
}

export function sectionOf(type) {
  return SECTION_OF.get(type) || null;
}

// A candidate summary line is non-empty, is not an HTML comment, and has its
// list marker stripped so a bulleted "What changed" section reads as prose.
function cleanSummary(line) {
  let text = String(line).trim();
  if (!text || text.startsWith('<!--')) return '';
  text = text.replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, '').trim();
  text = text.replace(/^\*\*(.+)\*\*$/, '$1').replace(/^__(.+)__$/, '$1').trim();
  return text.startsWith('<!--') ? '' : text;
}

// The first line under "## What changed", which is the summary the generator
// lifts. Null when the section is absent or empty, which is exactly the case
// pr-conventions refuses.
export function whatChanged(body) {
  const lines = String(body || '').split(/\r?\n/);
  const at = lines.findIndex((line) => HEADING.test(line));
  if (at < 0) return null;
  for (let i = at + 1; i < lines.length; i += 1) {
    if (ANY_HEADING.test(lines[i])) break;
    const text = cleanSummary(lines[i]);
    if (text) return text;
  }
  return null;
}

// The summary the generator uses: the "What changed" line where there is one,
// and otherwise the first line of the body that is not just an issue reference,
// so a body written before the section existed still reads.
export function extractSummary(body) {
  const section = whatChanged(body);
  if (section) return section;
  for (const raw of String(body || '').split(/\r?\n/)) {
    if (ANY_HEADING.test(raw)) break;
    const text = cleanSummary(raw);
    if (!text) continue;
    if (/^(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?|part of|related)\b/i.test(text)) continue;
    return text;
  }
  return null;
}

// The issue numbers a body closes, in the order the body names them.
export function closingIssues(body) {
  const seen = new Set();
  const out = [];
  for (const match of String(body || '').matchAll(CLOSES)) {
    const number = Number(match[1]);
    if (!seen.has(number)) {
      seen.add(number);
      out.push(number);
    }
  }
  return out;
}

function renderEntry(pr, repo) {
  const link = 'https://github.com/' + repo + '/pull/' + pr.number;
  const fixes = closingIssues(pr.body)
    .map((number) => '[#' + number + '](https://github.com/' + repo + '/issues/' + number + ')');
  const closes = fixes.length ? ' - fixes ' + fixes.join(', ') : '';
  const header = '- [#' + pr.number + '](' + link + ') **' + String(pr.title).trim() + '**' + closes;
  const summary = extractSummary(pr.body);
  return summary ? header + '\n  ' + summary : header;
}

const newestFirst = (a, b) => (Date.parse(b.mergedAt || 0) - Date.parse(a.mergedAt || 0)) || (b.number - a.number);

// The release body: entries grouped by conventional type in a fixed order, each
// group newest first, with the pull requests that do not parse under Other.
export function renderNotes({ tag, previousTag, repo, pulls = [] }) {
  const groups = new Map(SECTIONS.map(([, name]) => [name, []]));
  groups.set(OTHER, []);
  for (const pr of pulls) {
    const parsed = parseTitle(pr.title);
    const name = parsed ? sectionOf(parsed.type) : null;
    groups.get(name || OTHER).push(pr);
  }
  const lines = [];
  lines.push('Release notes for `' + tag + '`.');
  lines.push('');
  lines.push('Generated from the ' + pulls.length + ' pull request' + (pulls.length === 1 ? '' : 's') + ' merged since `' + previousTag + '`.');
  for (const name of [...SECTIONS.map(([, n]) => n), OTHER]) {
    const items = groups.get(name).sort(newestFirst);
    if (!items.length) continue;
    lines.push('', '## ' + name, '');
    for (const pr of items) lines.push(renderEntry(pr, repo));
  }
  lines.push('', '---', 'Generated from merged pull requests by `scripts/release/changelog.mjs`. A change is described by editing the pull request, never this list.');
  return lines.join('\n') + '\n';
}

// The pull requests merged in a range: enumerated from GitHub so the content is
// the pull request itself, then kept only when its merge commit is in the
// range, so a pull request merged after the previous tag but before this one is
// included and an older one is not. git and gh are injectable so a test needs
// neither a repository nor a token.
export function pullsInRange({ repo, base = 'main', previousTag, until = 'HEAD', cwd = process.cwd(), ghRun, gitRun } = {}) {
  const revs = new Set(gitRun(cwd, ['rev-list', previousTag + '..' + until]).split('\n').filter(Boolean));
  const all = JSON.parse(ghRun(['pr', 'list', '--repo', repo, '--state', 'merged', '--base', base, '--limit', '1000', '--json', 'number,title,body,url,mergedAt,mergeCommit']));
  return all.filter((pr) => pr.mergeCommit && revs.has(pr.mergeCommit.oid));
}

// The release before this one is the closest dev tag reachable from the commit,
// which git describe answers directly. A version sort is wrong here: an earlier
// base (0.1.1) sorts above the current one (0.0.1), so it would pick a tag from
// months back and the range would name every change since.
export function previousTagOf({ cwd = process.cwd(), until = 'HEAD', tag, gitRun } = {}) {
  const describe = (ref) => {
    try {
      return gitRun(cwd, ['describe', '--tags', '--abbrev=0', '--match', 'v*-dev.*', ref]).trim();
    } catch {
      return null;
    }
  };
  const described = describe(until);
  if (described && described !== tag) return described;
  // A rerun of the same release finds its own tag already on the commit, so step
  // to the parent to find the one before it.
  const before = describe(until + '^');
  return before && before !== tag ? before : null;
}

const defaultGh = (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const defaultGit = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--tag') out.tag = argv[++i];
    else if (flag === '--previous') out.previousTag = argv[++i];
    else if (flag === '--until') out.until = argv[++i];
    else if (flag === '--base') out.base = argv[++i];
    else if (flag === '--repo') out.repo = argv[++i];
    else if (flag === '--out') out.out = argv[++i];
    else throw new Error('unknown argument: ' + flag);
  }
  return out;
}

export function run(argv = process.argv.slice(2), { ghRun = defaultGh, gitRun = defaultGit, write = writeFileSync } = {}) {
  const args = parseArgs(argv);
  if (!args.tag) throw new Error('--tag is required');
  const repo = args.repo || JSON.parse(readFileSync(new URL('../../core/spec/naming.json', import.meta.url))).repo;
  const until = args.until || 'HEAD';
  const tag = args.tag;
  const previousTag = args.previousTag || previousTagOf({ until, tag, gitRun });
  if (!previousTag) throw new Error('No previous dev tag is reachable from ' + until + ', so there is no range to summarise');
  const pulls = pullsInRange({ repo, base: args.base || 'main', previousTag, until, ghRun, gitRun, cwd: process.cwd() });
  const notes = renderNotes({ tag, previousTag, repo, pulls });
  if (args.out) { write(args.out, notes); console.log(JSON.stringify({ tag, previousTag, pullRequests: pulls.length, out: args.out })); } else process.stdout.write(notes);
  return notes;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
