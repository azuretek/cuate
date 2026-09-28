import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';

const LEVELS = ['debug', 'info', 'notice', 'warn', 'error', 'fatal'];
export const DEFAULTS = Object.freeze({
  port: 7447,
  engine: { kind: 'imsg', bin: 'imsg', db: null, live: null },
  attachmentsRoot: null,
  sending: { enabled: false, perMinute: 20 },
  previews: 40,
  log: { level: 'notice' },
});

/** A raw config's values without the undefined ones, so a flag nobody gave cannot erase a default. */
const given = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== undefined));

export function normalizeConfig(raw = {}) {
  const c = {
    ...DEFAULTS,
    ...given(raw),
    engine: { ...DEFAULTS.engine, ...given(raw.engine) },
    sending: { ...DEFAULTS.sending, ...given(raw.sending) },
    log: { ...DEFAULTS.log, ...given(raw.log) },
  };
  const problems = [];
  if (!Number.isInteger(c.port) || c.port < 0 || c.port > 65535) problems.push('port must be a whole number from 0 to 65535');
  if (!['imsg', 'fake'].includes(c.engine.kind)) problems.push('engine.kind must be imsg or fake');
  if (typeof c.engine.bin !== 'string' || !c.engine.bin) problems.push('engine.bin must be a command or a path');
  if (c.engine.db !== null && typeof c.engine.db !== 'string') problems.push('engine.db must be a path or null');
  if (c.engine.live !== null && typeof c.engine.live !== 'string') problems.push('engine.live must be text or null');
  if (c.attachmentsRoot !== null && typeof c.attachmentsRoot !== 'string') problems.push('attachmentsRoot must be a path or null');
  if (typeof c.sending.enabled !== 'boolean') problems.push('sending.enabled must be true or false');
  if (!Number.isInteger(c.sending.perMinute) || c.sending.perMinute < 1 || c.sending.perMinute > 600) problems.push('sending.perMinute must be from 1 to 600');
  if (!Number.isInteger(c.previews) || c.previews < 0 || c.previews > 500) problems.push('previews must be from 0 to 500');
  if (!LEVELS.includes(c.log.level)) problems.push('log.level must be one of ' + LEVELS.join(', '));
  if (problems.length) throw Object.assign(new Error('config: ' + problems.join('; ')), { problems });
  return c;
}

export const configPath = (dataDir) => path.join(dataDir, 'config.json');

export function loadConfig(dataDir) {
  const file = configPath(dataDir);
  if (!existsSync(file)) throw Object.assign(new Error('no config at ' + file + ': run init first'), { code: 'no_config' });
  return normalizeConfig(JSON.parse(readFileSync(file, 'utf8')));
}

export function saveConfig(dataDir, config) {
  const file = configPath(dataDir);
  writeFileSync(file + '.tmp', JSON.stringify(normalizeConfig(config), null, 2) + '\n', { mode: 0o600 });
  renameSync(file + '.tmp', file);
}
