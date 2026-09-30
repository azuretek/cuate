import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export function versionOf(base, count, sha) {
  if (!/^\d+\.\d+\.\d+$/.test(base) || !Number.isSafeInteger(count) || count < 1 || !/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid release version inputs');
  const [major, minor, patch] = base.split('.').map(Number);
  return major + '.' + minor + '.' + (patch + 1) + '-dev.' + count + '.' + sha.slice(0, 10);
}
export function run() {
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const base = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url))).version;
  const version = versionOf(base, Number(git('rev-list', '--count', 'HEAD')), git('rev-parse', 'HEAD'));
  console.log(version);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'version=' + version + '\n');
  return version;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
