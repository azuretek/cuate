// A single publisher: build jobs never receive a publishing token. Dry-run unless --apply is named.
//
// This is the sibling app's release path, in this repository's shape. The
// patterns it carries are named where they are implemented, so a later reader
// can compare the two files rather than wonder what was dropped:
//
//   * a draft we abandoned is deleted before re-uploading over it, and only ours
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

export function publish({ dir, version, sha, notesFile = null, apply = false, gh = (args) => execFileSync('gh', args, { encoding: 'utf8', timeout: 120000 }) }) {
  if (!/^\d+\.\d+\.\d+-dev\.\d+\.[a-f0-9]{10}$/.test(version) || !/^[a-f0-9]{40}$/.test(sha) || !version.endsWith(sha.slice(0, 10))) throw new Error('Invalid snapshot identity');
  const assets = verifyAssets(dir, version, { commit: sha });
  const tag = 'v' + version;
  console.log(JSON.stringify({ repo: naming.repo, tag, sha, assets, apply }));
  if (!apply) return;
  const repo = ['--repo', naming.repo];
  // The body is generated from the merged pull requests (scripts/release/changelog.mjs)
  // and handed here as a file. The sentence is the fallback for a run without one,
  // so a release is never published with an empty body.
  const notes = notesFile
    ? ['--notes-file', notesFile]
    : ['--notes', 'Test build of commit ' + sha + ': the desktop apps, the server and the Android APK, one version. See docs/release.md for installation, update channels and verifying the server artifact.'];
  const releases = JSON.parse(gh(['api', 'repos/' + naming.repo + '/releases?per_page=100']));
  const existing = releases.find((release) => release.tag_name === tag);
  // ★ A published release is never replaced in place: what went out to installed
  // clients is immutable, and replacing an asset is what the sibling refuses too.
  // A rerun against a published release is a no-op here rather than an error.
  const alreadyPublished = Boolean(existing && !existing.draft);
  let created = false;
  let published = false;
  try {
    // ★ Deleting a release before re-uploading over it, copied from the sibling.
    // A hard kill (a runner death, or a cancellation between the draft create and
    // the publish) leaves OUR draft behind, and `gh release create` would then
    // fail against a tag that already has a release. Only a DRAFT for THIS tag is
    // cleared; a published release is left alone, which is what makes a rerun
    // repair in place rather than start over.
    if (existing && existing.draft) gh(['release', 'delete', tag, ...repo, '--yes']);
    if (!alreadyPublished) {
      gh(['release', 'create', tag, ...repo, '--target', sha, '--draft', '--prerelease', '--title', tag, ...notes]);
      created = true;
      gh(['release', 'upload', tag, ...repo, ...assets.map((asset) => path.join(dir, asset))]);
      const draft = JSON.parse(gh(['release', 'view', tag, ...repo, '--json', 'databaseId']));
      const attached = JSON.parse(gh(['api', 'repos/' + naming.repo + '/releases/' + draft.databaseId]));
      if (!attached.draft || attached.assets.length !== assets.length) throw new Error('Draft asset count mismatch');
      for (const name of assets) {
        const remote = attached.assets.find((asset) => asset.name === name);
        const bytes = readFileSync(path.join(dir, name));
        if (!remote || remote.size !== bytes.length || remote.digest !== 'sha256:' + createHash('sha256').update(bytes).digest('hex')) throw new Error('Uploaded asset differs: ' + name);
      }
      gh(['release', 'edit', tag, ...repo, '--draft=false', '--prerelease', '--latest=false']);
      published = true;
      const state = JSON.parse(gh(['release', 'view', tag, ...repo, '--json', 'isDraft,isPrerelease']));
      if (state.isDraft || !state.isPrerelease) throw new Error('Publication read-back failed');
    } else {
      published = true;
    }
  } finally {
    // ★ Withdraw the draft this run created when it did not reach publication, so
    // a half-release is never left in the feed for an updater to resolve.
    if (created && !published) gh(['release', 'delete', tag, ...repo, '--yes']);
  }
  const plan = prunePlan(releases, tag);
  for (const stale of plan.drop) gh(['release', 'delete', stale, ...repo, '--yes']);
  console.log(JSON.stringify({ kept: plan.keep, pruned: plan.drop }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--apply')) assertPublicationAllowed();
  const notesAt = process.argv.indexOf('--notes-file');
  publish({ dir: process.argv[2], version: process.argv[3], sha: process.argv[4], notesFile: notesAt > -1 ? process.argv[notesAt + 1] : null, apply: process.argv.includes('--apply') });
}
