// A single publisher: build jobs never receive a publishing token. Dry-run unless --apply is named.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyAssets } from './assets.mjs';
const naming = JSON.parse(readFileSync(new URL('../../core/spec/naming.json', import.meta.url)));
export function publish({ dir, version, sha, apply = false, gh = (args) => execFileSync('gh', args, { encoding: 'utf8', timeout: 120000 }) }) {
  if (!/^\d+\.\d+\.\d+-dev\.\d+\.[a-f0-9]{10}$/.test(version) || !/^[a-f0-9]{40}$/.test(sha) || !version.endsWith(sha.slice(0, 10))) throw new Error('Invalid snapshot identity');
  const assets = verifyAssets(dir, version);
  const tag = 'v' + version;
  console.log(JSON.stringify({ repo: naming.repo, tag, sha, assets, apply }));
  if (!apply) return;
  const repo = ['--repo', naming.repo];
  // Refuse an existing tag/release rather than replacing assets an installed client may already trust.
  const releases = JSON.parse(gh(['api', 'repos/' + naming.repo + '/releases?per_page=100']));
  if (releases.some((release) => release.tag_name === tag)) throw new Error('Release already exists: ' + tag);
  let created = false;
  let published = false;
  try {
    gh(['release', 'create', tag, ...repo, '--target', sha, '--draft', '--prerelease', '--title', tag, '--notes', 'Desktop test build of commit ' + sha + '. See docs/release.md for installation and update channels.']);
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
  } finally {
    if (created && !published) gh(['release', 'delete', tag, ...repo, '--yes']);
  }
  const older = releases.filter((release) => release.prerelease && !release.draft && /^v\d+\.\d+\.\d+-dev\./.test(release.tag_name)).sort((a, b) => b.published_at.localeCompare(a.published_at));
  for (const release of older.slice(9)) gh(['release', 'delete', release.tag_name, ...repo, '--yes']);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) publish({ dir: process.argv[2], version: process.argv[3], sha: process.argv[4], apply: process.argv.includes('--apply') });
