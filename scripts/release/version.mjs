import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
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

/**
 * The stable version a release tag names. A release tag reads vX.Y.Z with no
 * prerelease identifier, so the tag and the three-integer marketing version are
 * the same string. Accepts a full ref (refs/tags/vX.Y.Z) as CI hands it over, or
 * a bare vX.Y.Z as a person types it.
 */
export function stableFromRef(ref) {
  if (typeof ref !== 'string') throw new Error('Invalid release ref');
  const bare = ref.startsWith('refs/tags/') ? ref.slice('refs/tags/'.length) : ref;
  const match = /^v(\d+\.\d+\.\d+)$/.exec(bare);
  if (!match) throw new Error('Invalid release tag ' + ref + ': a release tag reads vX.Y.Z');
  return match[1];
}

/**
 * Every file that owns the version, and how a value is read back out of it. This
 * is the same set release-please-config.json bumps together, so a tag that
 * disagrees with any of them is a release that would ship two versions.
 */
export const VERSION_FILES = [
  { path: 'core/spec/version.json', read: (text) => JSON.parse(text).version },
  { path: 'desktop/package.json', read: (text) => JSON.parse(text).version },
  { path: 'server/package.json', read: (text) => JSON.parse(text).version },
  { path: 'ios/project.yml', read: (text) => (text.match(/^\s*MARKETING_VERSION:\s*"?([^"\s#]+)"?/m) || [])[1] },
  { path: 'android/app/build.gradle.kts', read: (text) => (text.match(/versionName\s*=\s*[^\n]*?:\s*"([^"]+)"/) || [])[1] },
];

/**
 * Assert that a release version agrees with every file that owns it. Returns the
 * list of disagreements (empty when they agree); the caller refuses loudly with
 * it. The version is the tag's, and every file must equal it, because
 * release-please bumps them together and a tag is only a release once they match.
 */
export function versionFileProblems(version, { root = new URL('../../', import.meta.url) } = {}) {
  const problems = [];
  for (const file of VERSION_FILES) {
    const url = new URL(file.path, root);
    if (!existsSync(url)) { problems.push({ path: file.path, found: null, reason: 'missing' }); continue; }
    const found = file.read(readFileSync(url, 'utf8'));
    if (found !== version) problems.push({ path: file.path, found: found == null ? null : found, reason: found == null ? 'no version found' : 'says ' + found });
  }
  return problems;
}

export function assertVersionFiles(version, options) {
  // A dev snapshot is not a release and no file carries it, so only a stable
  // (three integer) version is checked against the files.
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Not a release version: ' + version);
  const problems = versionFileProblems(version, options);
  if (problems.length) {
    throw new Error('The tag v' + version + ' disagrees with ' + problems.length + ' file(s) that own the version, so nothing is published: '
      + problems.map((p) => p.path + ' ' + p.reason).join('; ')
      + '. Run release-please first so every file is bumped to the tag.');
  }
  return version;
}

function emit(pairs) {
  if (!process.env.GITHUB_OUTPUT) return;
  for (const [key, value] of Object.entries(pairs)) appendFileSync(process.env.GITHUB_OUTPUT, key + '=' + value + '\n');
}

export function run({ argv = [] } = {}) {
  if (argv.includes('--marketing')) {
    const marketing = marketingOf(baseOf());
    console.log(marketing);
    return marketing;
  }
  // --stable <ref>: the version a release tag names, for the tag lane.
  const stableAt = argv.indexOf('--stable');
  if (stableAt !== -1) {
    const version = stableFromRef(argv[stableAt + 1] || process.env.GITHUB_REF || '');
    const count = Number(gitIn()('rev-list', '--count', 'HEAD'));
    console.log(version);
    emit({ version, marketing: version, count, tagged: 'true' });
    return version;
  }
  // --check-files <ref>: refuse loudly when the tag and any version file disagree.
  const checkAt = argv.indexOf('--check-files');
  if (checkAt !== -1) {
    const version = stableFromRef(argv[checkAt + 1] || process.env.GITHUB_REF || '');
    assertVersionFiles(version);
    console.log('v' + version + ' agrees with every file that owns the version');
    emit({ version, marketing: version, tagged: 'true' });
    return version;
  }
  const { version, marketing, count } = snapshot();
  console.log(version);
  emit({ version, marketing, count });
  return version;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run({ argv: process.argv.slice(2) });

