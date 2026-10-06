// A single publisher: build jobs never receive a publishing token. Dry-run unless --apply is named.
//
// This is the sibling app's release path (chela), in this repository's shape. The
// patterns it carries are named where they are implemented, so a later reader
// can compare the two files rather than wonder what was dropped:
//
//   * a draft we abandoned is deleted before re-uploading over it, and only ours
//   * on the stable path the draft is release-please's, and it carries the
//     changelog that is this release's body, so it is KEPT and attached to
//     rather than deleted (folded in from chela issue #167)
//   * a published release is never replaced in place; a rerun leaves it alone
//   * a run that does not reach publication withdraws the draft it created
//   * the complete set is verified against remote sizes and SHA-256 digests first
//   * published dev releases are pruned to the newest ten, and a stable release,
//     or a hand-made prerelease, is never reachable by the prune
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyAssets } from './assets.mjs';
import { assertPublicationAllowed } from './policy.mjs';
const naming = JSON.parse(readFileSync(new URL('../../core/spec/naming.json', import.meta.url)));

// ★ The prune's rule, in one place: only OUR dev releases are prunable, and the
// newest KEEP survive. A stable release, or a hand-made prerelease that is not
// one of ours, must never match, so the count below cannot be applied to a set
// it was not written for.
const DEV_TAG = /^v\d+\.\d+\.\d+-dev\./;
const KEEP = 10;

// The two identities a run can carry. A dev snapshot names its own commit; a
// stable release is the version a vX.Y.Z tag names.
export const DEV_VERSION = /^\d+\.\d+\.\d+-dev\.\d+\.[a-f0-9]{10}$/;
export const STABLE_VERSION = /^\d+\.\d+\.\d+$/;

// Which tags the prune keeps and which it deletes, for a release list that
// includes the release this run just published. Pure, so a test can exercise the
// count without GitHub, and the dry run below can print exactly what would go.
export function prunePlan(releases, tag) {
  const after = releases
    .filter((release) => release.prerelease && !release.draft && DEV_TAG.test(release.tag_name))
    .map((release) => ({ tag_name: release.tag_name, published_at: release.published_at }));
  // The run that just published is the newest, so it is always kept. A rerun
  // finds it already in the list, and adding it twice would delete one too many.
  if (!after.some((release) => release.tag_name === tag)) after.push({ tag_name: tag, published_at: new Date().toISOString() });
  after.sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));
  return { keep: after.slice(0, KEEP).map((release) => release.tag_name), drop: after.slice(KEEP).map((release) => release.tag_name) };
}

export function publish({ dir, version, sha, apply = false, gh = (args) => execFileSync('gh', args, { encoding: 'utf8', timeout: 120000 }) }) {
  const stable = STABLE_VERSION.test(version);
  if (!(DEV_VERSION.test(version) || stable) || !/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid release identity');
  // A dev snapshot names its own commit; a stable release is the tagged commit,
  // and the tag-versus-files check has already run in the version job.
  if (!stable && !version.endsWith(sha.slice(0, 10))) throw new Error('Invalid snapshot identity');
  const assets = verifyAssets(dir, version, { commit: sha });
  const tag = 'v' + version;
  console.log(JSON.stringify({ repo: naming.repo, tag, sha, stable, assets, apply }));
  if (!apply) return;
  const repo = ['--repo', naming.repo];
  const releases = JSON.parse(gh(['api', 'repos/' + naming.repo + '/releases?per_page=100']));
  const existing = releases.find((release) => release.tag_name === tag);
  // ★ A published release is never replaced in place: what went out to installed
  // clients is immutable, and replacing an asset is what the sibling refuses too.
  // A rerun against a published release is a no-op here rather than an error.
  const alreadyPublished = Boolean(existing && !existing.draft);
  let created = false;
  let published = false;
  try {
    // ★ Deleting a release before re-uploading over it, on the DEV path only. A
    // hard kill leaves OUR draft behind, and `gh release create` would then fail
    // against a tag that already has a release. On the STABLE path the existing
    // draft is release-please's and carries this release's changelog body, so it
    // is kept and attached to: deleting it would throw the notes away.
    if (existing && existing.draft && !stable) gh(['release', 'delete', tag, ...repo, '--yes']);
    const reuseDraft = Boolean(stable && existing && existing.draft);
    if (!alreadyPublished && !reuseDraft) {
      gh(['release', 'create', tag, ...repo, '--target', sha, '--draft', ...(stable ? [] : ['--prerelease']), '--title', tag, '--notes',
        stable
          ? 'Release ' + tag + '. See docs/RELEASE.md for installation, update channels and verifying the server artifact.'
          : 'Test build of commit ' + sha + ': the desktop apps, the server and the Android APK, one version. See docs/RELEASE.md for installation, update channels and verifying the server artifact.']);
      created = true;
    }
    if (!alreadyPublished) {
      gh(['release', 'upload', tag, ...repo, ...assets.map((asset) => path.join(dir, asset))]);
      const draft = JSON.parse(gh(['release', 'view', tag, ...repo, '--json', 'databaseId']));
      const attached = JSON.parse(gh(['api', 'repos/' + naming.repo + '/releases/' + draft.databaseId]));
      if (!attached.draft || attached.assets.length !== assets.length) throw new Error('Draft asset count mismatch');
      for (const name of assets) {
        const remote = attached.assets.find((asset) => asset.name === name);
        const bytes = readFileSync(path.join(dir, name));
        if (!remote || remote.size !== bytes.length || remote.digest !== 'sha256:' + createHash('sha256').update(bytes).digest('hex')) throw new Error('Uploaded asset differs: ' + name);
      }
      gh(['release', 'edit', tag, ...repo, '--draft=false', ...(stable ? ['--latest'] : ['--prerelease', '--latest=false'])]);
      published = true;
      const state = JSON.parse(gh(['release', 'view', tag, ...repo, '--json', 'isDraft,isPrerelease']));
      if (state.isDraft || (stable ? state.isPrerelease : !state.isPrerelease)) throw new Error('Publication read-back failed');
    } else {
      published = true;
    }
  } finally {
    // ★ Withdraw the draft this run created when it did not reach publication, so
    // a half-release is never left in the feed for an updater to resolve. A stable
    // release's draft is release-please's and is never withdrawn here.
    if (created && !published && !stable) gh(['release', 'delete', tag, ...repo, '--yes']);
  }
  const plan = prunePlan(releases, tag);
  for (const stale of plan.drop) gh(['release', 'delete', stale, ...repo, '--yes']);
  console.log(JSON.stringify({ kept: plan.keep, pruned: plan.drop }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--apply')) assertPublicationAllowed();
  publish({ dir: process.argv[2], version: process.argv[3], sha: process.argv[4], apply: process.argv.includes('--apply') });
}

