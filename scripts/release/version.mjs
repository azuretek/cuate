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
export function run({ argv = [] } = {}) {
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const base = JSON.parse(readFileSync(new URL('../../core/spec/version.json', import.meta.url))).version;
  const marketing = marketingOf(base);
  // --marketing prints only what a bundle can carry: an App Store version is three
  // dot separated integers, so the dev string stays in the app's own build field.
  if (argv.includes('--marketing')) {
    console.log(marketing);
    return marketing;
  }
  const version = versionOf(base, Number(git('rev-list', '--count', 'HEAD')), git('rev-parse', 'HEAD'));
  console.log(version);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, 'version=' + version + '\n');
    appendFileSync(process.env.GITHUB_OUTPUT, 'marketing=' + marketing + '\n');
    appendFileSync(process.env.GITHUB_OUTPUT, 'count=' + git('rev-list', '--count', 'HEAD') + '\n');
  }
  return version;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run({ argv: process.argv.slice(2) });
