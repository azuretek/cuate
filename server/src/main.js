#!/usr/bin/env node
// The server's command line. Everything is headless: a config file in the data folder, these commands, and logs as
// JSON lines on stdout and stderr for the LaunchAgent to collect.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

// node:sqlite still announces itself as experimental; that one warning is noise here, anything else is printed.
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name === 'ExperimentalWarning' && /SQLite/i.test(w.message)) return;
  process.stderr.write(w.name + ': ' + w.message + '\n');
});

const { defaultDataDir, naming, logSpec, serverVersion, messagesAttachmentsRoot } = await import('./paths.js');
const { loadConfig, saveConfig, normalizeConfig, configPath } = await import('./config.js');
const { openStore, SCOPES } = await import('./store.js');

const argv = process.argv.slice(2);
const flags = {};
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) flags[a.slice(2)] = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  else pos.push(a);
}
const dataDir = path.resolve(String(flags.data || defaultDataDir()));
const [cmd = 'help', sub] = pos;
const HELP = `usage: node server/src/main.js <command> [--data DIR]
  init [--engine imsg|fake] [--port N] [--bin PATH] [--db PATH]   create the data folder and its config
  token create --scope device|tooling|admin --name NAME            print a new token, once
  token list                                                       list tokens (never the tokens themselves)
  token revoke ID                                                  revoke a token
  sending on|off                                                   switch sending (it starts off)
  doctor                                                           check the engine and the Mac
  run                                                              start the server
data folder: ${dataDir}`;

const die = (msg) => {
  process.stderr.write(msg + '\n');
  process.exit(1);
};
const store = () => openStore(path.join(dataDir, 'state.db'));

function engineSetup(config) {
  if (config.engine.kind === 'fake') {
    const root = path.join(dataDir, 'fake-attachments');
    return import('./engine/fake.js').then(({ createFakeImsg }) => {
      const world = createFakeImsg({ attachmentsRoot: root, liveText: process.env.FAKE_LIVE || config.engine.live || null });
      return { makeTransport: () => world.transport(), attachmentsRoot: root };
    });
  }
  return import('./engine/child.js').then(({ childTransport }) => ({
    makeTransport: (log) => childTransport({ bin: config.engine.bin, args: ['rpc', ...(config.engine.db ? ['--db', config.engine.db] : [])], log }),
    attachmentsRoot: config.attachmentsRoot || messagesAttachmentsRoot(),
  }));
}

const quiet = { emit: () => {} };

if (cmd === 'help' || flags.help) {
  console.log(HELP);
} else if (cmd === 'init') {
  if (existsSync(configPath(dataDir)) && !flags.force) {
    console.log('already initialised: ' + dataDir);
  } else {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const config = normalizeConfig({
      port: flags.port !== undefined ? Number(flags.port) : undefined,
      engine: { kind: typeof flags.engine === 'string' ? flags.engine : 'imsg', ...(typeof flags.bin === 'string' ? { bin: flags.bin } : {}), ...(typeof flags.db === 'string' ? { db: flags.db } : {}) },
    });
    saveConfig(dataDir, config);
    const secret = path.join(dataDir, 'secret');
    if (!existsSync(secret)) writeFileSync(secret, randomBytes(32).toString('hex') + '\n', { mode: 0o600 });
    store().close();
    console.log('initialised ' + dataDir + ' (engine ' + config.engine.kind + ', port ' + config.port + ', sending off)');
    console.log('next: token create --scope device --name <device>, then doctor, then run');
  }
} else if (cmd === 'token') {
  const s = store();
  if (sub === 'create') {
    const scope = String(flags.scope || 'device');
    if (!SCOPES.includes(scope)) die('scope must be one of ' + SCOPES.join(', '));
    const name = String(flags.name || scope);
    const { id, token } = s.createToken(scope, name);
    console.log('token ' + id + ' (' + scope + ') for ' + name + '. It is shown once; store it now:');
    console.log(token);
  } else if (sub === 'list') {
    for (const t of s.listTokens()) console.log([t.id, t.scope, t.revoked_at ? 'revoked' : 'active', t.name, 'created ' + t.created_at, t.last_used_at ? 'last used ' + t.last_used_at : 'never used'].join('  '));
  } else if (sub === 'revoke') {
    console.log(s.revokeToken(pos[2]) ? 'revoked ' + pos[2] : 'no active token ' + pos[2]);
  } else {
    die('usage: token create|list|revoke');
  }
  s.close();
} else if (cmd === 'sending') {
  if (sub !== 'on' && sub !== 'off') die('usage: sending on|off');
  const config = loadConfig(dataDir);
  config.sending.enabled = sub === 'on';
  saveConfig(dataDir, config);
  console.log('sending is ' + sub);
} else if (cmd === 'doctor') {
  const config = loadConfig(dataDir);
  const { makeTransport, attachmentsRoot } = await engineSetup(config);
  const { runDoctor } = await import('./doctor.js');
  const s = store();
  const r = await runDoctor({ config, store: s, makeTransport: () => makeTransport(quiet), dataDir, attachmentsRoot });
  s.close();
  console.log(r.lines.join('\n'));
  process.exitCode = r.failed ? 1 : 0;
} else if (cmd === 'run') {
  const config = loadConfig(dataDir);
  const { createLogger } = await import('../../core/kit/log.js');
  const { installCrashHandlers } = await import('./crash.js');
  const { createEngine } = await import('./engine/index.js');
  const { startServer } = await import('./app.js');
  const { makeAttachmentId } = await import('./ids.js');
  const sink = (line) => {
    const s = JSON.stringify(line) + '\n';
    if (line.level === 'error' || line.level === 'fatal') process.stderr.write(s);
    else process.stdout.write(s);
  };
  const logger = createLogger({ spec: logSpec, app: naming.slug + '-server', version: serverVersion, run: randomUUID().slice(0, 8), pid: process.pid, sink, now: Date.now, level: process.env.LOG_LEVEL || config.log.level });
  installCrashHandlers({ log: logger, logger, dataDir });
  const s = store();
  const secret = readFileSync(path.join(dataDir, 'secret'), 'utf8').trim();
  const { makeTransport, attachmentsRoot } = await engineSetup(config);
  const engineLog = logger.child('engine');
  const engine = createEngine({ kind: config.engine.kind, makeTransport: () => makeTransport(engineLog), log: engineLog, attachmentId: makeAttachmentId({ secret, store: s }) });
  logger.emit('server.start', { port: config.port, engine: config.engine.kind, sending: config.sending.enabled });
  await engine.start();
  const srv = await startServer({ config, store: s, engine, log: logger.child('http'), dataDir, attachmentsRoot });
  let stopping = false;
  const stop = async (reason) => {
    if (stopping) return;
    stopping = true;
    logger.emit('server.stop', { reason });
    setTimeout(() => process.exit(0), 8000).unref();
    await srv.close();
    await engine.stop();
    s.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
} else {
  die(HELP);
}
