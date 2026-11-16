// The Android half of a test release (issue 192): the signed APK built for the commit in the release's own run
// (issue 525), and a manifest naming its version, commit, size, SHA-256 and the SHA-256 of the certificate that
// signed it. A phone that updates itself checks the download against this manifest, and its signer against both the
// manifest and itself, before Android's installer is asked. The names come from core/spec/releases.json through the same function the
// phone's page uses (releaseAssets in core/app/rules/updates.js), and the manifest is held by the same rule.
//
//   build <apk> <signer> <version> <commit> <out>   name the APK and write its manifest (android-release.yml)
//   verify <dir> <version> [<commit>]               the leg's own check, and the publisher's
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { releaseAssets, apkManifestProblem } from '../../core/app/rules/updates.js';

const naming = JSON.parse(readFileSync(new URL('../../core/spec/naming.json', import.meta.url)));
const releases = JSON.parse(readFileSync(new URL('../../core/spec/releases.json', import.meta.url)));

export function androidAssetNames(version) {
  const assets = releaseAssets(releases, naming, version);
  return { apk: assets.apk.name, manifest: assets.manifest.name };
}

export const androidAssets = (version) => Object.values(androidAssetNames(version));

// apksigner prints the certificate digest as hex, with or without colons; the manifest carries it plain and lower-case.
export function signerDigest(text) {
  const digest = String(text || '').replaceAll(':', '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('not a certificate SHA-256 digest: ' + text);
  return digest;
}

export function buildAndroidAssets({ apk, signer, version, commit, out }) {
  const names = androidAssetNames(version);
  const bytes = readFileSync(apk);
  mkdirSync(out, { recursive: true });
  copyFileSync(apk, path.join(out, names.apk));
  const manifest = { version, commit, file: names.apk, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), signer: signerDigest(signer) };
  const problem = apkManifestProblem(manifest, { version, slug: naming.slug });
  if (problem) throw new Error('Android manifest: ' + problem);
  writeFileSync(path.join(out, names.manifest), JSON.stringify(manifest, null, 2) + '\n');
  return { names, manifest };
}

export function verifyAndroidAssets(dir, version, { commit } = {}) {
  const names = androidAssetNames(version);
  for (const name of Object.values(names)) if (!existsSync(path.join(dir, name))) throw new Error('Missing or empty asset: ' + name);
  let manifest;
  try { manifest = JSON.parse(readFileSync(path.join(dir, names.manifest), 'utf8')); } catch { throw new Error('Android manifest is not JSON'); }
  const problem = apkManifestProblem(manifest, { version, slug: naming.slug });
  if (problem) throw new Error('Android manifest: ' + problem);
  if (commit && manifest.commit !== commit) throw new Error('Android manifest names commit ' + manifest.commit);
  const bytes = readFileSync(path.join(dir, names.apk));
  if (bytes.length !== manifest.size) throw new Error('Android APK size mismatch');
  if (createHash('sha256').update(bytes).digest('hex') !== manifest.sha256) throw new Error('Android APK digest mismatch');
  return Object.values(names);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [verb, ...args] = process.argv.slice(2);
  if (verb === 'build') console.log(JSON.stringify(buildAndroidAssets({ apk: args[0], signer: args[1], version: args[2], commit: args[3], out: args[4] }).manifest));
  else if (verb === 'verify') console.log(JSON.stringify(verifyAndroidAssets(args[0], args[1], { commit: args[2] })));
  else throw new Error('usage: android-artifact.mjs build|verify ...');
}
