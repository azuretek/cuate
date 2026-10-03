import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { serverAssets, verifyServerAssets } from './server-artifact.mjs';
import { androidAssets, verifyAndroidAssets } from './android-artifact.mjs';
const naming = JSON.parse(readFileSync(new URL('../../core/spec/naming.json', import.meta.url)));
// The desktop half: installers, blockmaps and update feeds from the six packaging legs.
export function desktopAssets(version) {
  const stem = naming.slug + '-desktop-' + version + '-';
  return [
    ...['arm64', 'x64'].flatMap((arch) => ['dmg', 'zip', 'exe'].flatMap((ext) => [stem + arch + '.' + ext, stem + arch + '.' + ext + '.blockmap'])),
    ...['x86_64', 'arm64'].map((arch) => stem + arch + '.AppImage'),
    'dev.yml', 'dev-mac.yml', 'dev-linux.yml', 'dev-linux-arm64.yml',
  ];
}
// Every asset a test release carries: the desktop half, the server's tarball, manifest and digest, and the signed
// Android APK with its manifest (issue 192), all built from one commit and one version.
export const expectedAssets = (version) => [...desktopAssets(version), ...serverAssets(version), ...androidAssets(version)];
export function verifyDesktopAssets(dir, version) {
  const expected = desktopAssets(version);
  const names = readdirSync(dir);
  for (const name of expected) {
    if (!names.includes(name) || !statSync(path.join(dir, name)).size) throw new Error('Missing or empty asset: ' + name);
  }
  for (const name of expected.filter((name) => name.endsWith('.yml'))) {
    const doc = parse(readFileSync(path.join(dir, name), 'utf8'));
    if (doc.version !== version || !Array.isArray(doc.files) || !doc.files.length) throw new Error('Invalid update metadata: ' + name);
    const stem = naming.slug + '-desktop-' + version + '-';
    const required = name === 'dev.yml' ? ['x64.exe', 'arm64.exe'] : name === 'dev-mac.yml' ? ['x64.zip', 'arm64.zip'] : name === 'dev-linux.yml' ? ['x86_64.AppImage'] : ['arm64.AppImage'];
    for (const suffix of required) if (!doc.files.some((file) => decodeURIComponent(file.url) === stem + suffix)) throw new Error('Feed omits architecture: ' + name + ' ' + suffix);
    for (const file of doc.files) {
      const asset = decodeURIComponent(file.url);
      if (path.basename(asset) !== asset || !expected.includes(asset)) throw new Error('Unexpected update asset: ' + asset);
      const bytes = readFileSync(path.join(dir, asset));
      if (file.sha512 !== createHash('sha512').update(bytes).digest('base64') || (file.size !== undefined && file.size !== bytes.length)) throw new Error('Update hash mismatch: ' + asset);
    }
  }
  return expected;
}
// The publisher's whole check: the desktop half as above, then the server's digest, manifest and every file in its
// tarball (server/src/artifact.js). commit, when given, must be the commit the server's manifest names.
export function verifyAssets(dir, version, { commit } = {}) {
  verifyDesktopAssets(dir, version);
  verifyServerAssets(dir, version, { commit });
  verifyAndroidAssets(dir, version, { commit });
  return expectedAssets(version);
}
// --desktop checks the desktop half alone: package.yml's completeness job sees only the six packaging legs.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const check = process.argv.includes('--desktop') ? verifyDesktopAssets : verifyAssets;
  console.log(JSON.stringify(check(process.argv[2], process.argv[3])));
}
