import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildNumberOf } from '../../core/kit/rules/build.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const json = (p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
export const naming = json('core/spec/naming.json');
export const apiSpec = json('core/spec/api.json');
export const logSpec = json('core/spec/log-events.json');

// The one version source: the server reports the same number the desktop build stamps from, never a copy of its own.
const versionFile = json('core/spec/version.json');
export const serverVersion = versionFile.version;
export const serverChannel = versionFile.channel;
export const serverBuild = buildNumberOf(serverVersion);

// The commit the server was built from and its build date. A build supplies them; otherwise they are read from the
// running checkout, and where neither exists the route reports them as absent rather than guessing.
const git = (args) => {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; }
};
export const serverCommit = process.env.BUILD_COMMIT || git(['rev-parse', 'HEAD']);
export const serverBuiltAt = process.env.BUILD_TIME || git(['show', '-s', '--format=%cI', 'HEAD']);

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
