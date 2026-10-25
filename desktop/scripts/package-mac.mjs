import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// Apple's ticket service drops the connection now and then (Error 68, "The network connection was lost", on most
// Intel release runs of 2026-10-15 to 2026-10-17), after notarization itself has succeeded. Both stapling a ticket and
// validating one ask that service, and so does Gatekeeper's assessment, so none of them can tell a dropped connection
// from an unnotarized app. A stapling failure is therefore told apart by what is on disk: the app is signed and
// carries no stapled ticket. Then the ticket is stapled here, a bounded number of times with a pause between, and only
// once that works, which proves Apple holds a ticket for this code, are its disk image and update files built from
// the existing bundle. Rebuilding would sign new code and discard the recovered ticket. Other failures are thrown.
export const STAPLE_ATTEMPTS = 3;
export const PACKAGE_ATTEMPTS = 3;
// The checks after packaging that ask Apple's service are asked again, bounded, before they fail the build; the
// signature check needs no network and is asked once.
export const CHECK_ATTEMPTS = 3;
const pauseFor = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
// A bundle's stapled ticket is the file stapler writes at Contents/CodeResources (the signature's own resources live
// under Contents/_CodeSignature instead), so whether one is stapled is read without the network.
const ticketOnDisk = (app) => existsSync(path.join(app, 'Contents', 'CodeResources'));

export function packageMac(arch, { environment = process.env, execute = execFileSync, pause = pauseFor, ticketed = ticketOnDisk } = {}) {
  if (!['arm64', 'x64'].includes(arch)) throw new Error('Name the architecture');
  for (const key of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_API_KEY_P8', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']) if (!environment[key]) throw new Error('Missing signing input: ' + key);
  const desktop = fileURLToPath(new URL('../', import.meta.url));
  const temp = mkdtempSync(path.join(os.tmpdir(), 'notarize-'));
  const key = path.join(temp, 'AuthKey.p8');
  const run = (command, args, options = {}) => execute(command, args, { stdio: 'inherit', timeout: 20 * 60 * 1000, ...options });
  const passes = (command, args) => { try { run(command, args); return true; } catch { return false; } };
  // Asks Apple's service up to `attempts` times, pausing longer each time; the last failure is the result.
  const asked = (what, command, args, attempts) => {
    for (let attempt = 1; ; attempt += 1) {
      try { return run(command, args); } catch (error) {
        if (attempt >= attempts) throw error;
        console.error('packaging: ' + what + ' failed (attempt ' + attempt + ' of ' + attempts + '), asking again');
        pause(30000 * attempt);
      }
    }
  };
  try {
    writeFileSync(key, environment.APPLE_API_KEY_P8, { mode: 0o600 });
    const env = { ...environment, APPLE_API_KEY: key, CSC_IDENTITY_AUTO_DISCOVERY: 'true' };
    delete env.APPLE_API_KEY_P8;
    const naming = JSON.parse(readFileSync(new URL('../../core/spec/naming.json', import.meta.url)));
    const app = path.join(desktop, 'dist', arch === 'arm64' ? 'mac-arm64' : 'mac', naming.product + '.app');
    for (let attempt = 1; ; attempt += 1) {
      try {
        const args = ['package', '--mac', '--' + arch, '--config.forceCodeSigning=true'];
        if (attempt > 1) args.push('--prepackaged', app);
        run('pnpm', args, { cwd: desktop, env });
        break;
      } catch (error) {
        if (attempt >= PACKAGE_ATTEMPTS || ticketed(app) || !passes('codesign', ['--verify', '--deep', '--strict', app])) throw error;
        try { asked('stapling', 'xcrun', ['stapler', 'staple', app], STAPLE_ATTEMPTS); } catch { throw error; }
        console.error('packaging: notarized but the ticket was not stapled until asked again (attempt ' + attempt + ' of ' + PACKAGE_ATTEMPTS + '), packaging again');
      }
    }
    run('codesign', ['--verify', '--deep', '--strict', app]);
    asked('the Gatekeeper assessment', 'spctl', ['--assess', '--type', 'execute', '--verbose=2', app], CHECK_ATTEMPTS);
    asked('the ticket validation', 'xcrun', ['stapler', 'validate', app], CHECK_ATTEMPTS);
    // The app is notarized and stapled before the disk image and its update hashes are built.
    // Do not mutate a finished container after its blockmap and metadata have been emitted.
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) packageMac(process.argv[2]);
