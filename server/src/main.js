#!/usr/bin/env node
// The server's command line. Everything is headless: a config file in the data folder, these commands, and logs as
// JSON lines on stdout and stderr for the LaunchAgent to collect. Each command is one module in ./commands, loaded
// and dispatched by name, so a new command is a new file rather than another branch in this one.
import path from 'node:path';

// node:sqlite still announces itself as experimental; that one warning is noise here, anything else is printed.
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name === 'ExperimentalWarning' && /SQLite/i.test(w.message)) return;
  process.stderr.write(w.name + ': ' + w.message + '\n');
});

const { defaultDataDir, messagesAttachmentsRoot } = await import('./paths.js');
const { openStore } = await import('./store.js');
const { loadCommands } = await import('./commands/index.js');

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

const commands = await loadCommands();

if (cmd === 'help' || flags.help) {
  console.log(HELP);
} else {
  const command = commands.get(cmd);
  if (!command) die(HELP);
  try {
    const code = await command.run({ dataDir, flags, pos, sub, handoff, die, store, engineSetup, doctorReport, quiet });
    if (code !== undefined) process.exitCode = code;
  } catch (e) {
    die(e && e.message ? e.message : String(e));
  }
}
