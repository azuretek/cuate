// The Mac care, proven with fakes so the suite never needs a Mac: the sleep hold, the lock and its refusals, the
// watchdog's restarts and its rate limit, and doctor's report of the Mac settings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../../core/kit/log.js';
import { logSpec } from '../src/paths.js';
import { createMac, macConfig, parseAutomaticLogin, parseFileVault, parsePowerFailure, parseScreenLock, parseSleep } from '../src/mac.js';
import { createRestarts, createWatchdog } from '../src/watchdog.js';
import { databaseVerdict, runDoctor } from '../src/doctor.js';

const logger = () => {
  const lines = [];
  const log = createLogger({ spec: logSpec, app: 'test', run: 'test', sink: (l) => lines.push(l), now: Date.now, level: 'debug', strict: true });
  return { lines, log };
};
const events = (lines) => lines.map((l) => l.event);
const find = (lines, prefix) => lines.find((l) => l.startsWith(prefix));

// A transport that answers one status request, so doctor can be run without an engine.
const statusTransport = (result) => {
  const lines = new Set();
  return {
    onLine: (cb) => lines.add(cb),
    onExit: () => {},
    write: (s) => {
      const msg = JSON.parse(s);
      setImmediate(() => { for (const cb of lines) cb(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })); });
    },
    close: async () => {},
  };
};

const CONFIG = {
  port: 0,
  engine: { kind: 'imsg', bin: 'imsg', db: null, live: null },
  sending: { enabled: false, perMinute: 20 },
  attachmentsRoot: null,
  mac: { lock: { enabled: false }, messages: { manage: true } },
};
const STORE = { listTokens: () => [{ scope: 'device', revoked_at: null }] };
const READY = { version: '1.2.3', database: { ready: true } };

const SETTINGS = {
  automaticLogin: 'abi',
  fileVault: false,
  restartAfterPowerFailure: true,
  sleepMinutes: 0,
  screenLockRequired: true,
  screenLockDelaySeconds: 0,
};
const fakeControl = (over = {}, settings = {}) => ({
  settings: macConfig(settings),
  readSettings: async () => ({ ...SETTINGS, ...over }),
  messagesRunning: async () => true,
  relaunchMessages: async () => ({ launched: true }),
});

const doctor = (over = {}) => runDoctor({
  config: CONFIG,
  store: STORE,
  makeTransport: () => statusTransport(READY),
  dataDir: '/tmp/mac-care-data',
  attachmentsRoot: '/tmp/mac-care-attachments',
  platform: 'linux',
  mac: fakeControl(),
  ...over,
});

test('doctor reports the Mac settings the server relies on', async () => {
  const r = await doctor();
  assert.equal(r.failed, false, r.lines.join('\n'));
  assert.equal(find(r.lines, 'ok    automatic login is on for abi'), 'ok    automatic login is on for abi');
  assert.equal(find(r.lines, 'ok    FileVault is off'), 'ok    FileVault is off, so automatic login can work');
  assert.ok(find(r.lines, 'ok    the Mac starts up again after a power failure'));
  assert.ok(find(r.lines, 'ok    the Mac is set never to sleep on its own'));
});

test('doctor reads the grant behind the Messages database from the engine status report', async () => {
  const blocked = await doctor({
    makeTransport: () => statusTransport({
      version: '1.2.3',
      database: { ready: false, error: 'The configured Messages database could not be opened read-only. Verify the path and grant Full Disk Access to the supervising process, then retry.' },
    }),
  });
  assert.equal(blocked.failed, true);
  assert.ok(find(blocked.lines, 'ok    engine imsg 1.2.3 answered'), blocked.lines.join('\n'));
  assert.ok(/^fail +the Messages database could not be opened: give the program that starts the server Full Disk Access, and if its entry is already on, switch it off and on again because a macOS or Homebrew update leaves the grant stale/.test(find(blocked.lines, 'fail  the Messages database could not be opened')), blocked.lines.join('\n'));
});

test('doctor tells a missing Messages database apart from a grant it cannot use', async () => {
  const missing = await doctor({
    makeTransport: () => statusTransport({
      version: '1.2.3',
      database: { ready: false, error: 'The configured Messages database does not exist. Create or copy chat.db at this path, then retry.' },
    }),
  });
  assert.equal(missing.failed, true);
  assert.ok(/^fail +the Messages database is not there, so Messages is not signed in/.test(find(missing.lines, 'fail  the Messages database is not there')), missing.lines.join('\n'));
});

test('doctor names an unreadable database it cannot classify, and the error the engine gave', async () => {
  const r = await doctor({ makeTransport: () => statusTransport({ version: '1.2.3', database: { ready: false } }) });
  assert.equal(r.failed, true);
  assert.ok(find(r.lines, 'fail  engine imsg 1.2.3 cannot read the Messages database: give Full Disk Access to the program that starts the server, then run doctor again'), r.lines.join('\n'));
});

test('doctor reports the Contacts grant the engine status names', async () => {
  const off = await doctor({ makeTransport: () => statusTransport({ version: '1.2.3', database: { ready: true }, contacts: { available: false } }) });
  assert.equal(off.failed, false);
  assert.ok(find(off.lines, 'warn  the Contacts permission is not granted, so contact names are left out: grant it in System Settings, Privacy & Security, Contacts, then run doctor again'), off.lines.join('\n'));
  const on = await doctor({ makeTransport: () => statusTransport({ version: '1.2.3', database: { ready: true }, contacts: { available: true } }) });
  assert.ok(find(on.lines, 'ok    the Contacts permission is granted, so contact names are resolved'), on.lines.join('\n'));
});

test('doctor names the Automation grant that sending needs', async () => {
  const r = await doctor({ config: { ...CONFIG, sending: { enabled: true, perMinute: 20 } } });
  assert.ok(/^warn +sending drives Messages through AppleScript and needs Automation for Messages/.test(find(r.lines, 'warn  sending drives Messages through AppleScript and needs Automation for Messages')), r.lines.join('\n'));
});

test('databaseVerdict reads every degraded engine state', () => {
  assert.equal(databaseVerdict({ database: { ready: true } }), 'ready');
  assert.equal(databaseVerdict({ database: { ready: false, error: 'The configured Messages database does not exist. Create or copy chat.db at this path, then retry.' } }), 'missing');
  assert.equal(databaseVerdict({ database: { ready: false, error: 'The configured Messages database could not be opened read-only. Verify the path and grant Full Disk Access to the supervising process, then retry.' } }), 'blocked');
  assert.equal(databaseVerdict({ database: { ready: false } }), 'unreadable');
  assert.equal(databaseVerdict({}), 'unknown');
});

test('doctor names each Mac setting that needs a person to fix it', async () => {
  const r = await doctor({
    mac: fakeControl({ automaticLogin: null, fileVault: true, restartAfterPowerFailure: null, sleepMinutes: 10 }),
  });
  assert.equal(r.failed, false);
  assert.ok(/warn +automatic login could not be read or is off/.test(find(r.lines, 'warn  automatic login')));
  assert.ok(/warn +FileVault is on/.test(find(r.lines, 'warn  FileVault')));
  assert.ok(/warn +restart after a power failure could not be read/.test(find(r.lines, 'warn  restart after')));
  assert.ok(/warn +the Mac sleeps on its own after 10 minutes/.test(find(r.lines, 'warn  the Mac sleeps')));
});

test('doctor reports the lock setting as unavailable with an engine that needs the screen', async () => {
  const r = await doctor({
    config: { ...CONFIG, mac: { lock: { enabled: true } } },
    engineNeedsScreen: true,
  });
  assert.equal(r.failed, true, r.lines.join('\n'));
  assert.ok(find(r.lines, 'fail  the lock setting is on, but the imsg engine needs the screen unlocked'));
});

test('doctor checks the lock-screen password setting when locking is on', async () => {
  const on = await doctor({ config: { ...CONFIG, mac: { lock: { enabled: true } } } });
  assert.ok(find(on.lines, 'ok    the screen locks at once and asks for a password'));
  const late = await doctor({
    config: { ...CONFIG, mac: { lock: { enabled: true } } },
    mac: fakeControl({ screenLockRequired: true, screenLockDelaySeconds: 30 }),
  });
  assert.equal(late.failed, true);
  assert.ok(find(late.lines, 'fail  locking is on but the screen does not ask for a password at once'));
});

test('doctor reads no Mac settings off a Mac unless a control is given', async () => {
  const r = await doctor({ mac: null });
  assert.equal(r.failed, false);
  assert.equal(r.lines.filter((l) => /FileVault|automatic login|caffeinate|sleep/.test(l)).length, 0);
});

test('the Mac setting parsers read each command output', () => {
  assert.equal(parseSleep('System-wide power settings:\n Currently in use:\n  sleep                0\n'), 0);
  assert.equal(parseSleep('  sleep 10\n'), 10);
  assert.equal(parseSleep(''), null);
  assert.equal(parseAutomaticLogin('"abi"\n'), 'abi');
  assert.equal(parseAutomaticLogin('not found\n'), null);
  assert.equal(parseFileVault('FileVault is On.\n'), true);
  assert.equal(parseFileVault('FileVault is Off.\n'), false);
  assert.equal(parseFileVault('garbage'), null);
  assert.equal(parsePowerFailure('Restart After Power Failure: On\n'), true);
  assert.equal(parsePowerFailure('Restart After Power Failure: Off\n'), false);
  assert.deepEqual(parseScreenLock('1\n', '0\n'), { required: true, delaySeconds: 0 });
  assert.deepEqual(parseScreenLock('', ''), { required: null, delaySeconds: null });
});

test('the sleep hold runs caffeinate on the server pid and ends when it is released', async () => {
  const { lines, log } = logger();
  const spawned = [];
  let killed = false;
  const mac = createMac({
    log, settings: {}, platform: 'darwin', pid: 4242,
    spawnChild: (cmd, args) => { spawned.push([cmd, args]); return { kill: () => { killed = true; } }; },
  });
  assert.deepEqual(await mac.holdAwake(), { held: true });
  assert.deepEqual(spawned, [['caffeinate', ['-i', '-s', '-w', '4242']]]);
  assert.deepEqual(await mac.holdAwake(), { held: true });
  assert.equal(spawned.length, 1, 'the hold is started once');
  mac.releaseAwake();
  assert.equal(killed, true);
  assert.deepEqual(lines.filter((l) => l.event === 'mac.awake').map((l) => l.on), [true, false]);
});

test('a sleep hold whose caffeinate dies is reported, not claimed', async () => {
  const { lines, log } = logger();
  let exitCb = null;
  const mac = createMac({
    log, settings: {}, platform: 'darwin', pid: 4242,
    spawnChild: () => ({ kill: () => {}, once: (event, cb) => { if (event === 'exit') exitCb = cb; } }),
  });
  assert.deepEqual(await mac.holdAwake(), { held: true });
  assert.equal(mac.state().awake, true);
  exitCb(1, null);
  assert.equal(mac.state().awake, false, 'a dead caffeinate is not a live hold');
  assert.ok(lines.some((l) => l.event === 'mac.refused' && l.what === 'awake'), 'the dead hold is reported');
});

test('the sleep hold is refused off a Mac and when the setting is off', async () => {
  const off = logger();
  let spawns = 0;
  const notMac = createMac({ log: off.log, platform: 'linux', spawnChild: () => { spawns += 1; } });
  assert.equal((await notMac.holdAwake()).held, false);
  assert.equal(spawns, 0);
  const disabled = createMac({ log: off.log, platform: 'darwin', settings: { awake: false }, spawnChild: () => { spawns += 1; } });
  assert.deepEqual(await disabled.holdAwake(), { held: false, locked: false, launched: false, reason: 'the awake setting is off' });
  assert.equal(spawns, 0);
  assert.equal(off.lines.filter((l) => l.event === 'mac.refused').length, 2);
});

test('the lock runs the recorded method and refuses what it cannot do', async () => {
  const { lines, log } = logger();
  const runs = [];
  const exec = async (cmd, args) => { runs.push([cmd, args]); return { code: 0, stdout: '' }; };
  const off = createMac({ log, settings: { lock: { enabled: false } }, platform: 'darwin', exec });
  assert.equal((await off.lockScreen()).locked, false);
  assert.equal((await off.lockScreen()).reason, 'the lock setting is off');
  const display = createMac({ log, settings: { lock: { enabled: true } }, platform: 'darwin', exec });
  assert.deepEqual(await display.lockScreen(), { locked: true });
  assert.deepEqual(runs, [['pmset', ['displaysleepnow']]]);
  assert.ok(lines.some((l) => l.event === 'mac.lock' && l.method === 'displaySleep' && l.locked === true));
  const login = createMac({ log, settings: { lock: { enabled: true, method: 'loginFramework' } }, platform: 'darwin', exec });
  assert.equal((await login.lockScreen()).reason, 'the login-framework method has no helper configured');
  const helper = createMac({ log, settings: { lock: { enabled: true, method: 'loginFramework', command: '/usr/bin/true' } }, platform: 'darwin', exec });
  assert.deepEqual(await helper.lockScreen(), { locked: true });
  assert.ok(runs.some(([cmd]) => cmd === '/usr/bin/true'));
  const needsScreen = createMac({ log, settings: { lock: { enabled: true } }, platform: 'darwin', exec, engineNeedsScreen: true });
  assert.equal((await needsScreen.lockScreen()).reason, 'the engine needs the screen unlocked');
  const linux = createMac({ log, settings: { lock: { enabled: true } }, platform: 'linux', exec });
  assert.equal((await linux.lockScreen()).reason, 'not macOS');
});

test('Messages is watched and relaunched through the injected exec', async () => {
  const { log } = logger();
  const calls = [];
  let code = 1;
  const exec = async (cmd, args) => { calls.push([cmd, args]); return { code, stdout: '' }; };
  const mac = createMac({ log, settings: {}, platform: 'darwin', exec });
  assert.equal(await mac.messagesRunning(), false);
  code = 0;
  assert.equal(await mac.messagesRunning(), true);
  assert.deepEqual(await mac.relaunchMessages(), { launched: true });
  assert.deepEqual(calls, [['pgrep', ['-x', 'Messages']], ['pgrep', ['-x', 'Messages']], ['open', ['-a', 'Messages']]]);
});

const watch = (over = {}, settings = {}, macOver = {}) => {
  const { lines, log } = logger();
  const state = { restarts: 0, ready: false, running: true, relaunches: 0, at: 0 };
  const engine = { info: () => ({ ready: state.ready }), start: async () => { state.restarts += 1; } };
  const mac = {
    ...fakeControl(macOver, settings),
    messagesRunning: async () => state.running,
    relaunchMessages: async () => { state.relaunches += 1; return { launched: true }; },
  };
  const w = createWatchdog({ engine, mac, log, now: () => state.at, ...over });
  return { w, lines, log, state };
};

test('the watchdog restarts the engine with a backoff and stops once it answers', async () => {
  const { w, lines, state } = watch();
  await w.tick();
  assert.equal(state.restarts, 1);
  assert.equal(lines.filter((l) => l.event === 'mac.restart' && l.what === 'engine').length, 1);
  state.at += 500;
  await w.tick();
  assert.equal(state.restarts, 1, 'the backoff holds the second attempt');
  state.at += 600;
  await w.tick();
  assert.equal(state.restarts, 1, 'and the third, while the backoff doubles');
  state.at += 1000;
  await w.tick();
  assert.equal(state.restarts, 2);
  state.ready = true;
  state.at += 100;
  await w.tick();
  assert.equal(state.restarts, 2, 'an answering engine is left alone');
  assert.equal(w.counts().engineRestarts, 2);
});

test('the watchdog reports a restart that failed rather than swallowing it', async () => {
  const { w, lines } = watch({ restartEngine: async () => { throw new Error('engine will not start'); } });
  await w.tick();
  assert.ok(lines.find((l) => l.event === 'mac.refused' && l.what === 'engine' && l.reason === 'engine will not start'));
});

test('the watchdog relaunches Messages at most three times an hour', async () => {
  const { w, lines, state } = watch({}, {}, {});
  state.running = false;
  for (const at of [0, 1000, 2000, 3000]) { state.at = at; await w.tick(); }
  assert.equal(state.relaunches, 3);
  assert.equal(lines.filter((l) => l.event === 'mac.relaunch').length, 3);
  assert.ok(lines.find((l) => l.event === 'mac.refused' && l.reason === 'relaunched 3 times in the last hour'));
  state.at = 4000000;
  await w.tick();
  assert.equal(state.relaunches, 4, 'the window slides, so an hour later it may try again');
});

test('the watchdog reports instead of relaunching while another program manages Messages', async () => {
  const { w, lines, state } = watch({}, { messages: { managedBy: 'bluebubbles' } });
  state.running = false;
  await w.tick();
  assert.equal(state.relaunches, 0);
  assert.ok(lines.find((l) => l.event === 'mac.refused' && l.what === 'messages' && l.reason === 'managed by bluebubbles'));
  assert.equal(w.counts().reports, 1);
});

test('the watchdog leaves Messages alone when managing it is off', async () => {
  const { w, lines, state } = watch({}, { messages: { manage: false } });
  state.running = false;
  await w.tick();
  assert.equal(state.relaunches, 0);
  assert.ok(lines.find((l) => l.event === 'mac.refused' && l.reason === 'managing Messages is off'));
});

test('the three restarts on request perform their action, each one event', async () => {
  const { lines, log } = logger();
  let started = 0;
  let exited = null;
  const engine = { start: async () => { started += 1; } };
  const mac = { relaunchMessages: async () => ({ launched: true }) };
  const restarts = createRestarts({ engine, mac, log, exit: (code) => { exited = code; } });
  assert.deepEqual(await restarts.messages(), { restarted: true });
  assert.deepEqual(await restarts.engine(), { restarted: true });
  assert.equal(started, 1);
  restarts.server();
  assert.equal(exited, 0);
  assert.deepEqual(events(lines).filter((e) => e === 'mac.restart').length, 3);
  assert.deepEqual(lines.filter((l) => l.event === 'mac.restart').map((l) => l.what), ['messages', 'engine', 'server']);
});
