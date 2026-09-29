import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
export function packedSmoke() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const dist = path.join(root, 'desktop/dist');
  const naming = JSON.parse(readFileSync(path.join(root, 'core/spec/naming.json')));
  let executable;
  if (process.platform === 'linux') {
    executable = path.join(dist, readdirSync(dist).find((name) => name.endsWith('.AppImage')) || 'missing.AppImage');
  } else if (process.platform === 'win32') {
    const folder = process.arch === 'arm64' ? 'win-arm64-unpacked' : 'win-unpacked';
    executable = path.join(dist, folder, naming.product + '.exe');
  } else {
    const folder = process.arch === 'arm64' ? 'mac-arm64' : 'mac';
    executable = path.join(dist, folder, naming.product + '.app/Contents/MacOS/' + naming.product);
  }
  const result = spawnSync(process.execPath, [path.join(root, 'desktop/scripts/smoke.mjs')], {
    stdio: 'inherit', timeout: 150000,
    env: { ...process.env, SMOKE_APP: executable, APPIMAGE_EXTRACT_AND_RUN: '1' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Packaged smoke failed: ' + result.status);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) packedSmoke();
