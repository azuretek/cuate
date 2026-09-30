import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
export function packageMac(arch) {
  if (!['arm64', 'x64'].includes(arch)) throw new Error('Name the architecture');
  for (const key of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_API_KEY_P8', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']) if (!process.env[key]) throw new Error('Missing signing input: ' + key);
  const desktop = fileURLToPath(new URL('../', import.meta.url));
  const temp = mkdtempSync(path.join(os.tmpdir(), 'notarize-'));
  const key = path.join(temp, 'AuthKey.p8');
  const run = (command, args, options = {}) => execFileSync(command, args, { stdio: 'inherit', timeout: 20 * 60 * 1000, ...options });
  try {
    writeFileSync(key, process.env.APPLE_API_KEY_P8, { mode: 0o600 });
    const env = { ...process.env, APPLE_API_KEY: key };
    delete env.APPLE_API_KEY_P8;
    run('pnpm', ['package', '--mac', '--' + arch, '--config.forceCodeSigning=true'], { cwd: desktop, env });
    const naming = JSON.parse(readFileSync(new URL('../../core/spec/naming.json', import.meta.url)));
    const app = path.join(desktop, 'dist', arch === 'arm64' ? 'mac-arm64' : 'mac', naming.product + '.app');
    run('codesign', ['--verify', '--deep', '--strict', app]);
    run('spctl', ['--assess', '--type', 'execute', '--verbose=2', app]);
    run('xcrun', ['stapler', 'validate', app]);
    // The app is notarized and stapled before the disk image and its update hashes are built.
    // Do not mutate a finished container after its blockmap and metadata have been emitted.
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) packageMac(process.argv[2]);
