import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
const naming = JSON.parse(readFileSync(new URL('../../core/spec/naming.json', import.meta.url)));
export function expectedAssets(version) {
  const stem = naming.slug + '-desktop-' + version + '-';
  return [
    ...['arm64', 'x64'].flatMap((arch) => ['dmg', 'zip', 'exe'].flatMap((ext) => [stem + arch + '.' + ext, stem + arch + '.' + ext + '.blockmap'])),
    ...['x86_64', 'arm64'].map((arch) => stem + arch + '.AppImage'),
    'dev.yml', 'dev-mac.yml', 'dev-linux.yml', 'dev-linux-arm64.yml',
  ];
}
export function verifyAssets(dir, version) {
  const expected = expectedAssets(version);
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
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(verifyAssets(process.argv[2], process.argv[3])));
