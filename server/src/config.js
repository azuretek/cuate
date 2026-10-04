import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';
import { LOCK_METHODS, MAC_DEFAULTS } from './mac.js';
import { ALL_EVENTS, DEFAULT_EVENTS, eventNames, isLoopback } from './webhooks.js';

const LEVELS = ['debug', 'info', 'notice', 'warn', 'error', 'fatal'];

/** The Mac-care section, copied so a caller can never change the defaults underneath a config. */
const macDefaults = () => ({
  awake: MAC_DEFAULTS.awake,
  lock: { ...MAC_DEFAULTS.lock, args: [...MAC_DEFAULTS.lock.args] },
  messages: { ...MAC_DEFAULTS.messages },
});
export const DEFAULTS = Object.freeze({
  port: 7447,
  engine: { kind: 'imsg', bin: 'imsg', db: null, live: null },
  // Inbound typing is present and OFF: the ordinary database watch reports none, and the only source is an injected
  // v2 bridge (imsg bridge.events.subscribe). Turning this on needs an already-running bridge and is not something
  // this server starts (issue 230).
  typing: { incoming: false },
  attachmentsRoot: null,
  sending: { enabled: false, perMinute: 20 },
  previews: 40,
  log: { level: 'notice', syslog: null },
  mac: macDefaults(),
  webhooks: { endpoints: [] },
});

/** A hook endpoint with its defaults filled in. A 2d endpoint's single `secret` is read as its current secret. */
function readEndpoint(e) {
  if (!e || typeof e !== 'object') return e;
  const { secret, ...rest } = e;
  const out = { events: DEFAULT_EVENTS.slice(), encrypt: true, active: true, ...rest };
  if (out.secrets === undefined && secret !== undefined) out.secrets = [secret];
  return out;
}
const keyOk = (k) => Boolean(k) && typeof k.kid === 'string' && k.kid.length > 0 && typeof k.key === 'string' && /^[A-Za-z0-9_-]+$/.test(k.key) && Buffer.from(k.key, 'base64url').length === 32;

/** A raw config's values without the undefined ones, so a flag nobody gave cannot erase a default. */
const given = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== undefined));

export function normalizeConfig(raw = {}) {
  const webhookEndpoints = (raw.webhooks && raw.webhooks.endpoints) !== undefined ? raw.webhooks.endpoints : DEFAULTS.webhooks.endpoints;
  const c = {
    ...DEFAULTS,
    ...given(raw),
    engine: { ...DEFAULTS.engine, ...given(raw.engine) },
    typing: { ...DEFAULTS.typing, ...given(raw.typing) },
    sending: { ...DEFAULTS.sending, ...given(raw.sending) },
    log: { ...DEFAULTS.log, ...given(raw.log) },
    mac: {
      ...DEFAULTS.mac,
      ...given(raw.mac),
      lock: { ...DEFAULTS.mac.lock, ...given(raw.mac && raw.mac.lock) },
      messages: { ...DEFAULTS.mac.messages, ...given(raw.mac && raw.mac.messages) },
    },
    webhooks: { endpoints: Array.isArray(webhookEndpoints) ? webhookEndpoints.map(readEndpoint) : webhookEndpoints },
  };
  const problems = [];
  if (!Number.isInteger(c.port) || c.port < 0 || c.port > 65535) problems.push('port must be a whole number from 0 to 65535');
  if (!['imsg', 'fake'].includes(c.engine.kind)) problems.push('engine.kind must be imsg or fake');
  if (typeof c.engine.bin !== 'string' || !c.engine.bin) problems.push('engine.bin must be a command or a path');
  if (c.engine.db !== null && typeof c.engine.db !== 'string') problems.push('engine.db must be a path or null');
  if (c.engine.live !== null && typeof c.engine.live !== 'string') problems.push('engine.live must be text or null');
  if (c.attachmentsRoot !== null && typeof c.attachmentsRoot !== 'string') problems.push('attachmentsRoot must be a path or null');
  if (typeof c.typing.incoming !== 'boolean') problems.push('typing.incoming must be true or false');
  if (typeof c.sending.enabled !== 'boolean') problems.push('sending.enabled must be true or false');
  if (!Number.isInteger(c.sending.perMinute) || c.sending.perMinute < 1 || c.sending.perMinute > 600) problems.push('sending.perMinute must be from 1 to 600');
  if (!Number.isInteger(c.previews) || c.previews < 0 || c.previews > 500) problems.push('previews must be from 0 to 500');
  if (!LEVELS.includes(c.log.level)) problems.push('log.level must be one of ' + LEVELS.join(', '));
  // Syslog: the collector's address and port are configuration, never hard coded, so a half-written setting is
  // refused here rather than leaving the sink pointed at nothing.
  if (c.log.syslog !== null) {
    if (typeof c.log.syslog !== 'object' || Array.isArray(c.log.syslog)) problems.push('log.syslog must be an object with a host and a port, or null');
    else {
      if (typeof c.log.syslog.host !== 'string' || !c.log.syslog.host) problems.push('log.syslog.host must be the collector address');
      if (!Number.isInteger(c.log.syslog.port) || c.log.syslog.port < 1 || c.log.syslog.port > 65535) problems.push('log.syslog.port must be a whole number from 1 to 65535');
    }
  }
  // The Mac care: the server stands between the Mac and idle sleep, so a half-written setting is refused here
  // rather than half applied at runtime.
  if (typeof c.mac.awake !== 'boolean') problems.push('mac.awake must be true or false');
  if (typeof c.mac.lock.enabled !== 'boolean') problems.push('mac.lock.enabled must be true or false');
  if (!LOCK_METHODS.includes(c.mac.lock.method)) problems.push('mac.lock.method must be one of ' + LOCK_METHODS.join(', '));
  if (c.mac.lock.command !== null && typeof c.mac.lock.command !== 'string') problems.push('mac.lock.command must be a command or null');
  if (!Array.isArray(c.mac.lock.args) || !c.mac.lock.args.every((a) => typeof a === 'string')) problems.push('mac.lock.args must be a list of strings');
  if (typeof c.mac.messages.manage !== 'boolean') problems.push('mac.messages.manage must be true or false');
  if (typeof c.mac.messages.app !== 'string' || !c.mac.messages.app) problems.push('mac.messages.app must be the name of the Messages program');
  if (c.mac.messages.managedBy !== null && typeof c.mac.messages.managedBy !== 'string') problems.push('mac.messages.managedBy must name the program that manages Messages, or null');
  // Hooks: one signed, encrypted POST per event to each endpoint that asks for it, so a half-written endpoint, or
  // an event name the spec does not hold, is refused here rather than turning into a hook that never fires.
  if (!Array.isArray(c.webhooks.endpoints)) problems.push('webhooks.endpoints must be a list');
  else {
    const names = eventNames();
    const seen = new Set();
    c.webhooks.endpoints.forEach((e, i) => {
      const at = 'webhooks.endpoints[' + i + ']';
      if (!e || typeof e !== 'object') { problems.push(at + ' must be an object'); return; }
      if (typeof e.id !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(e.id)) problems.push(at + '.id must be a name of letters, digits, dot, dash or underscore');
      else if (seen.has(e.id)) problems.push(at + '.id ' + e.id + ' is used twice');
      else seen.add(e.id);
      const loopback = isLoopback(e.url);
      if (typeof e.url !== 'string' || !/^https?:\/\//.test(e.url)) problems.push(at + '.url must be an http or https URL');
      else if (!loopback && !/^https:\/\//.test(e.url)) problems.push(at + '.url must be https unless it is loopback');
      if (!Array.isArray(e.secrets) || e.secrets.length < 1 || e.secrets.length > 2 || !e.secrets.every((s) => typeof s === 'string' && s.length >= 16)) problems.push(at + '.secrets must be the current secret, then at most one previous one');
      if (typeof e.encrypt !== 'boolean') problems.push(at + '.encrypt must be true or false');
      else if (!e.encrypt && !loopback) problems.push(at + '.encrypt can be off only for a loopback url');
      if (e.keys !== undefined || e.encrypt !== false) {
        if (!Array.isArray(e.keys) || e.keys.length < 1 || e.keys.length > 2 || !e.keys.every(keyOk)) problems.push(at + '.keys must be the current key, then at most one previous one, each a kid and a 32-byte base64url key');
      }
      if (!Array.isArray(e.events) || !e.events.length || !e.events.every((x) => typeof x === 'string')) problems.push(at + '.events must be a list of event names');
      else for (const x of e.events) if (x !== ALL_EVENTS && !names.includes(x)) problems.push(at + '.events names ' + x + ', which is not an event: use one of ' + names.join(', ') + ', or ' + ALL_EVENTS);
      if (typeof e.active !== 'boolean') problems.push(at + '.active must be true or false');
      for (const k of ['disabledAt', 'disabledReason', 'lastError']) if (e[k] !== undefined && e[k] !== null && typeof e[k] !== 'string') problems.push(at + '.' + k + ' must be text or null');
    });
  }
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
