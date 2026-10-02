import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildNumberOf, stampProblem } from '../../core/kit/rules/build.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const json = (p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
export const naming = json('core/spec/naming.json');
export const apiSpec = json('core/spec/api.json');
export const logSpec = json('core/spec/log-events.json');

/**
 * The stamp a built server carries: server/stamp.json, written by scripts/gen-server-stamp.mjs from
 * scripts/release/version.mjs, the producer the desktop and phone builds take their version from. Null in a
 * development checkout, which has none. A stamp that is present but unsound stops the server rather than letting it
 * report a version it is not.
 */
export function readStamp(root = ROOT) {
  let text;
  try {
    text = readFileSync(path.join(root, 'server', 'stamp.json'), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  const stamp = JSON.parse(text);
  const problem = stampProblem(stamp);
  if (problem) throw new Error('server/stamp.json: ' + problem);
  return stamp;
}

// The one version source: a built server reports its stamp, which is the version every client built from the same
// commit reports. A checkout reports the version file, the base the stamp is derived from, never a copy of its own.
export const serverStamp = readStamp();
const versionFile = json('core/spec/version.json');
export const serverVersion = serverStamp ? serverStamp.version : versionFile.version;
export const serverChannel = serverStamp ? serverStamp.channel : versionFile.channel;
export const serverBuild = buildNumberOf(serverVersion);

// The commit the server was built from and its build date. A stamp supplies them; otherwise they are read from the
// running checkout, and where neither exists the route reports them as absent rather than guessing.
const git = (args) => {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; }
};
export const serverCommit = serverStamp ? serverStamp.commit : process.env.BUILD_COMMIT || git(['rev-parse', 'HEAD']);
export const serverBuiltAt = serverStamp ? serverStamp.builtAt : process.env.BUILD_TIME || git(['show', '-s', '--format=%cI', 'HEAD']);

export function defaultDataDir({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  if (env.SERVER_DATA_DIR) return env.SERVER_DATA_DIR;
  const name = naming.slug + '-server';
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', name);
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), name);
  return path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), name);
}

export function messagesAttachmentsRoot(home = os.homedir()) {
  return path.join(home, 'Library', 'Messages', 'Attachments');
}
