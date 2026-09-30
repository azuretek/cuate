// Exclusions decide whether to publish, never which platforms gate publication.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export const NON_RELEASE_PATHS = [/^docs\//, /\.md$/i, /^\.github\//, /^\.githooks\//, /^scripts\//, /^LICENSE$/, /^\.gitignore$/, /^server\//];
export const ships = (file) => !NON_RELEASE_PATHS.some((pattern) => pattern.test(file));
export const classify = (files) => ({ release: files.some(ships), shipped: files.filter(ships) });
export function changedFiles(env = process.env, git = (args) => execFileSync('git', args, { encoding: 'utf8' })) {
  const sha = env.GITHUB_SHA || 'HEAD';
  let base = env.GITHUB_EVENT_BEFORE;
  if (env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
    base = git(['tag', '--merged', sha, '--sort=-version:refname', '--list', 'v*-dev.*']).trim().split('\n').find((tag) => /^v\d+\.\d+\.\d+-dev\.\d+\.[a-f0-9]{10}$/.test(tag));
  }
  return (base && !/^0+$/.test(base)
    ? git(['diff', '--name-only', '--no-renames', '-z', base, sha])
    : git(['ls-tree', '-r', '--name-only', '-z', sha])).split('\0').filter(Boolean);
}
export function run(argv = process.argv.slice(2), env = process.env) {
  const files = argv[0] === '--files' ? argv.slice(1) : changedFiles(env);
  const result = classify(files);
  console.log(JSON.stringify(result));
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, 'release=' + result.release + '\n');
  if (!result.release && env.GITHUB_EVENT_NAME === 'workflow_dispatch') throw new Error('The requested snapshot ships nothing new');
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
