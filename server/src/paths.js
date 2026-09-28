import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const json = (p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
export const naming = json('core/spec/naming.json');
export const apiSpec = json('core/spec/api.json');
export const logSpec = json('core/spec/log-events.json');
export const serverVersion = json('server/package.json').version;

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
