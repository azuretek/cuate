import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
/**
 * The marketing version: the version a build reports as its own, which is the
 * base's next patch. It is here rather than at a call site so the three release
 * paths cannot disagree about what the current version is.
 */
export function marketingOf(base) {
  if (!/^\d+\.\d+\.\d+$/.test(base)) throw new Error('Invalid marketing version input');
  const [major, minor, patch] = base.split('.').map(Number);
  return major + '.' + minor + '.' + (patch + 1);
}

export function versionOf(base, count, sha) {
  if (!/^\d+\.\d+\.\d+$/.test(base) || !Number.isSafeInteger(count) || count < 1 || !/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid release version inputs');
  const [major, minor, patch] = base.split('.').map(Number);
  return major + '.' + minor + '.' + (patch + 1) + '-dev.' + count + '.' + sha.slice(0, 10);
}
const gitIn = (cwd) => (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const baseOf = () => JSON.parse(readFileSync(new URL('../../core/spec/version.json', import.meta.url))).version;

/**
 * Everything one commit's build is called, from the one base and the commit: the version every platform reports,
 * the marketing version a bundle can carry, the commit count and the commit. The desktop, the phones and the
 * server stamp (scripts/gen-server-stamp.mjs) all take their version from here, so a release cannot carry two.
 */
export function snapshot({ cwd } = {}) {
  const git = gitIn(cwd);
  const base = baseOf();
  const count = Number(git('rev-list', '--count', 'HEAD'));
  const sha = git('rev-parse', 'HEAD');
  return { base, marketing: marketingOf(base), version: versionOf(base, count, sha), count, sha };
}

export function run({ argv = [] } = {}) {
  // --marketing prints only what a bundle can carry: an App Store version is three
  // dot separated integers, so the dev string stays in the app's own build field.
  if (argv.includes('--marketing')) {
    const marketing = marketingOf(baseOf());
    console.log(marketing);
    return marketing;
  }
  const { version, marketing, count } = snapshot();
  console.log(version);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, 'version=' + version + '\n');
    appendFileSync(process.env.GITHUB_OUTPUT, 'marketing=' + marketing + '\n');
    appendFileSync(process.env.GITHUB_OUTPUT, 'count=' + count + '\n');
  }
  return version;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run({ argv: process.argv.slice(2) });
