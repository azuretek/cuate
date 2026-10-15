import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// Apple's stapling service drops the connection now and then (twice on 2026-10-13, Error 68, "The network connection
// was lost"), after notarization itself has succeeded. That failure is told apart by state, not by the log: the app is
// signed and accepted by Gatekeeper, so it was notarized, yet carries no stapled ticket. Only then is the packaging run
// again, a bounded number of times with a pause between; any other failure is the result and is thrown at once.
export const STAPLE_ATTEMPTS = 3;
const pauseFor = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function packageMac(arch, { environment = process.env, execute = execFileSync, pause = pauseFor } = {}) {
  if (!['arm64', 'x64'].includes(arch)) throw new Error('Name the architecture');
  for (const key of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_API_KEY_P8', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']) if (!environment[key]) throw new Error('Missing signing input: ' + key);
  const desktop = fileURLToPath(new URL('../', import.meta.url));
  const temp = mkdtempSync(path.join(os.tmpdir(), 'notarize-'));
  const key = path.join(temp, 'AuthKey.p8');
  const run = (command, args, options = {}) => execute(command, args, { stdio: 'inherit', timeout: 20 * 60 * 1000, ...options });
  try {
    writeFileSync(key, environment.APPLE_API_KEY_P8, { mode: 0o600 });
    const env = { ...environment, APPLE_API_KEY: key, CSC_IDENTITY_AUTO_DISCOVERY: 'true' };
    delete env.APPLE_API_KEY_P8;
    const naming = JSON.parse(readFileSync(new URL('../../core/spec/naming.json', import.meta.url)));
    const app = path.join(desktop, 'dist', arch === 'arm64' ? 'mac-arm64' : 'mac', naming.product + '.app');
    const passes = (command, args) => { try { run(command, args); return true; } catch { return false; } };
    for (let attempt = 1; ; attempt += 1) {
      try {
        run('pnpm', ['package', '--mac', '--' + arch, '--config.forceCodeSigning=true'], { cwd: desktop, env });
        break;
      } catch (error) {
        const notarizedUnstapled = passes('spctl', ['--assess', '--type', 'execute', '--verbose=2', app]) && !passes('xcrun', ['stapler', 'validate', app]);
        if (!notarizedUnstapled || attempt >= STAPLE_ATTEMPTS) throw error;
        console.error('packaging: notarized but the ticket was not stapled (attempt ' + attempt + ' of ' + STAPLE_ATTEMPTS + '), packaging again');
        pause(30000 * attempt);
      }
    }
    run('codesign', ['--verify', '--deep', '--strict', app]);
    run('spctl', ['--assess', '--type', 'execute', '--verbose=2', app]);
    run('xcrun', ['stapler', 'validate', app]);
    // The app is notarized and stapled before the disk image and its update hashes are built.
    // Do not mutate a finished container after its blockmap and metadata have been emitted.
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) packageMac(process.argv[2]);
