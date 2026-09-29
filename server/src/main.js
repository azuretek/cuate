#!/usr/bin/env node
// The server's command line. Everything is headless: a config file in the data folder, these commands, and logs as
// JSON lines on stdout and stderr for the LaunchAgent to collect.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

// node:sqlite still announces itself as experimental; that one warning is noise here, anything else is printed.
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name === 'ExperimentalWarning' && /SQLite/i.test(w.message)) return;
  process.stderr.write(w.name + ': ' + w.message + '\n');
});

const { defaultDataDir, naming, logSpec, serverVersion, messagesAttachmentsRoot } = await import('./paths.js');
const { loadConfig, saveConfig, normalizeConfig, configPath } = await import('./config.js');
const { openStore, SCOPES } = await import('./store.js');

// Everything after a bare -- is the command token create hands a new token to, so it is never parsed here.
const rawArgs = process.argv.slice(2);
const cut = rawArgs.indexOf('--');
const handoff = cut >= 0 ? rawArgs.slice(cut + 1) : null;
const argv = cut >= 0 ? rawArgs.slice(0, cut) : rawArgs;
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
  token create ... -- COMMAND [ARG...]                             hand it to COMMAND on stdin instead; revoked if COMMAND fails
  token list                                                       list tokens (never the tokens themselves)
  token revoke ID                                                  revoke a token
  sending on|off                                                   switch sending (it starts off); restarts the service
  doctor                                                           check the engine and the Mac
  run                                                              start the server
  check [--url URL]                                                with a token on stdin: does a server answer and read
  service install [--tailscale] [--node PATH]                      run it at login and after a crash (macOS)
  service status|restart|update|remove                             look after that service
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

async function doctorReport(config) {
  const { makeTransport, attachmentsRoot } = await engineSetup(config);
  const { runDoctor } = await import('./doctor.js');
  const s = store();
  try {
    return await runDoctor({ config, store: s, makeTransport: () => makeTransport(quiet), dataDir, attachmentsRoot });
  } finally {
    s.close();
  }
}

if (handoff && !(cmd === 'token' && sub === 'create')) die('-- hands a new token to a command, so it goes only with token create');

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
    if (handoff && !handoff.length) die('-- needs a command after it');
    const { id, token } = s.createToken(scope, name);
    if (handoff) {
      const { fillHandoff } = await import('./service.js');
      // The token goes to the command's stdin, never into an argument, a log or this output.
      const r = spawnSync(handoff[0], fillHandoff(handoff.slice(1), { id, scope, name }), { input: token + '\n', stdio: ['pipe', 'inherit', 'inherit'] });
      if (r.error || r.status !== 0) {
        const revoked = s.revokeToken(id);
        s.close();
        die('the command ' + path.basename(handoff[0]) + ' failed (' + (r.error ? r.error.message : 'exit ' + r.status) + '), so token ' + id + (revoked ? ' was revoked' : ' was NOT revoked: run token revoke ' + id));
      }
      console.log('token ' + id + ' (' + scope + ') for ' + name + ' was handed to ' + path.basename(handoff[0]) + ' and not printed');
    } else {
      console.log('token ' + id + ' (' + scope + ') for ' + name + '. It is shown once; store it now:');
      console.log(token);
    }
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
  // The server reads its config when it starts, so a service running from this data folder is restarted, and the
  // switch is read back from the new run's own start line.
  const { applyIfInstalled } = await import('./service.js');
  const started = await applyIfInstalled({ dataDir, config }).catch((e) => die('sending is ' + sub + ' in the config, but restarting the service failed: ' + e.message));
  if (!started) console.log('sending is ' + sub + '; it takes effect when the server next starts');
  else if (started.sending === undefined) console.log('sending is ' + sub + ', and the service was restarted');
  else if (started.sending === config.sending.enabled) console.log('sending is ' + sub + ', and the restarted server started with it ' + sub);
  else die('sending is ' + sub + ' in the config, but the restarted server started with it ' + (started.sending ? 'on' : 'off'));
} else if (cmd === 'doctor') {
  const r = await doctorReport(loadConfig(dataDir));
  console.log(r.lines.join('\n'));
  process.exitCode = r.failed ? 1 : 0;
} else if (cmd === 'check') {
  const url = typeof flags.url === 'string' ? flags.url : 'http://127.0.0.1:' + loadConfig(dataDir).port;
  let u = null;
  try {
    u = new URL(url);
  } catch {
    die('--url must be a URL such as https://host');
  }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.search || u.hash) {
    die('--url is http or https with no credentials, query or fragment: the token goes on stdin');
  }
  if (process.stdin.isTTY) die('pipe a token on standard input; it never goes in a URL or an argument');
  const token = readFileSync(0, 'utf8').split('\n')[0].trim();
  if (!token) die('no token on standard input');
  const { check } = await import('./service.js');
  process.exitCode = (await check({ url: u.origin + u.pathname, token })) ? 0 : 1;
} else if (cmd === 'service') {
  if (process.platform !== 'darwin') die('service looks after a macOS LaunchAgent; elsewhere, run "run" under your own service manager');
  const acts = ['install', 'status', 'restart', 'update', 'remove'];
  if (!acts.includes(sub)) die('usage: service ' + acts.join('|'));
  const service = await import('./service.js');
  const config = sub === 'remove' && !existsSync(configPath(dataDir)) ? null : loadConfig(dataDir);
  try {
    const ok = await service[sub]({
      dataDir, config, tailscale: flags.tailscale === true, node: typeof flags.node === 'string' ? flags.node : null,
      doctor: () => doctorReport(config),
    });
    process.exitCode = ok === false ? 1 : 0;
  } catch (e) {
    die('fail  ' + e.message);
  }
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
