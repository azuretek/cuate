// Writes server/stamp.json: the version and the commit a built server reports. The version comes from
// scripts/release/version.mjs, the one producer the desktop, iOS and Android builds take theirs from, so a server
// built from a commit reports exactly what the clients built from that commit report. A development checkout carries
// no stamp (it is gitignored) and reports core/spec/version.json with the commit read from git.
//
//   node scripts/gen-server-stamp.mjs                 stamp this checkout
//   node scripts/gen-server-stamp.mjs --root DIR      stamp a staged copy, such as the release artifact
//   node scripts/gen-server-stamp.mjs --check         fail when a stamp exists and is not this commit's
//   node scripts/gen-server-stamp.mjs --check --root DIR   fail unless the staged copy carries this commit's stamp
//
// BUILD_VERSION, where the release workflow sets it, must equal what version.mjs derives, or nothing is written. A
// packaging job checks out one commit with no history (fetch-depth 1), where git cannot count the commits, so there
// the version the release's own version job derived is taken as given once it names this commit and this base: the
// count is the one part a shallow checkout cannot know, and the commit and base are the parts it can check.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { snapshot } from './release/version.mjs';
import { channelOf, stampProblem } from '../core/kit/rules/build.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const STAMP = path.join('server', 'stamp.json');

/** The stamp for the commit checked out in cwd. Deterministic: the build time is the commit's own time. */
export function stampOf({ cwd = ROOT, env = process.env } = {}) {
  const derived = snapshot({ cwd });
  let { version, count } = derived;
  const { sha, base } = derived;
  if (env.BUILD_VERSION && env.BUILD_VERSION !== version) {
    const shallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], { cwd, encoding: 'utf8' }).trim() === 'true';
    const given = shallow ? givenVersion(env.BUILD_VERSION, { base, sha }) : null;
    if (!given) throw new Error('BUILD_VERSION ' + env.BUILD_VERSION + ' is not this commit\'s version ' + version + ': the server and the clients would disagree');
    ({ version, count } = given);
  }
  const builtAt = execFileSync('git', ['show', '-s', '--format=%cI', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
  const stamp = { version, channel: channelOf(version), commit: sha, count, builtAt };
  const problem = stampProblem(stamp);
  if (problem) throw new Error('refusing to write a bad stamp: ' + problem);
  return stamp;
}

/**
 * A handed-down version accepted in a shallow checkout: it must be this base's next patch, a dev count, and end in
 * this commit. Anything else returns null and the caller refuses.
 */
export function givenVersion(text, { base, sha }) {
  const m = /^(\d+)\.(\d+)\.(\d+)-dev\.(\d+)\.([a-f0-9]{10})$/.exec(text ?? '');
  if (!m) return null;
  const [major, minor, patch] = base.split('.').map(Number);
  if (Number(m[1]) !== major || Number(m[2]) !== minor || Number(m[3]) !== patch + 1) return null;
  if (m[5] !== sha.slice(0, 10)) return null;
  const count = Number(m[4]);
  return Number.isSafeInteger(count) && count >= 1 ? { version: text, count } : null;
}

/** The file's bytes. JSON carries no comment, so the generator names itself in a field. */
export const render = (stamp) => JSON.stringify({ generatedBy: 'scripts/gen-server-stamp.mjs', ...stamp }, null, 2) + '\n';

export function run(argv = process.argv.slice(2), env = process.env) {
  const at = argv.indexOf('--root');
  const root = at >= 0 ? path.resolve(argv[at + 1]) : ROOT;
  const file = path.join(root, STAMP);
  const doc = render(stampOf({ env }));
  if (argv.includes('--check')) {
    if (!existsSync(file)) {
      // A checkout may go unstamped; a staged copy named by --root is a build, and a build always carries one.
      if (at >= 0) {
        console.error(file + ' is missing: a built server must carry its stamp');
        process.exitCode = 1;
        return false;
      }
      console.log('no server stamp: a development checkout reports core/spec/version.json');
      return true;
    }
    if (readFileSync(file, 'utf8') !== doc) {
      console.error(path.relative(ROOT, file) + ' is stale or edited: run pnpm run server-stamp, or delete it in a development checkout');
      process.exitCode = 1;
      return false;
    }
    console.log('server stamp is fresh');
    return true;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, doc);
  console.log('wrote ' + file);
  return true;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
