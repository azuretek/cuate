// The Mac care, proven with fakes so the suite never needs a Mac: the sleep hold, the lock and its refusals, the
// watchdog's restarts and its rate limit, and doctor's report of the Mac settings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../../core/kit/log.js';
import { logSpec } from '../src/paths.js';
import { readFileSync } from 'node:fs';
import { createMac, foreignReason, injectionVerdict, macConfig, OUR_HELPER, parseAutomaticLogin, parseFileVault, parseInjectedLibraries, parsePowerFailure, parseProgramName, parseScreenLock, parseSleep } from '../src/mac.js';
import { createRestarts, createWatchdog } from '../src/watchdog.js';
import { databaseVerdict, runDoctor } from '../src/doctor.js';
import { IMSG_BRIDGE_PROBE_MS, STATUS_TIMEOUT_MS } from '../src/engine/link.js';
import { createContacts } from '../src/contacts.js';

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
  contactsSettleMs: 50,
  contactsPollMs: 5,
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

// A store behind the injected reader, answering the way the Mac's program does. Synthetic people only.
const storeAnswering = (answer) => createContacts({ run: async () => JSON.stringify(answer), watchDir: null });
const PERSON = { given: 'Ada', middle: '', family: 'Example', nickname: '', organization: '', displayName: 'Ada Example', phones: ['+15550100'], emails: [] };

test('doctor reports the Contacts grant the engine status names', async () => {
  const off = await doctor({
    makeTransport: () => statusTransport({ version: '1.2.3', database: { ready: true }, contacts: { available: false } }),
    contacts: storeAnswering({ authorized: false, status: 2 }),
  });
  assert.ok(find(off.lines, 'warn  the Contacts permission is not granted, so contact names are left out: grant it in System Settings, Privacy & Security, Contacts, then run doctor again'), off.lines.join('\n'));
  const on = await doctor({ makeTransport: () => statusTransport({ version: '1.2.3', database: { ready: true }, contacts: { available: true } }) });
  assert.ok(find(on.lines, 'ok    the Contacts permission is granted, so contact names are resolved'), on.lines.join('\n'));
  const unknown = await doctor({ makeTransport: () => statusTransport({ version: '1.2.3', database: { ready: true }, contacts: { available: false } }) });
  assert.ok(!unknown.lines.some((l) => l.includes('not granted')), unknown.lines.join('\n'));
  assert.ok(find(unknown.lines, 'warn  the engine reports Contacts unavailable, so contact names are left out; the macOS Contacts state could not be read here'), unknown.lines.join('\n'));
});

test('doctor never calls an authorized Contacts store not granted, and names an authorized read of nobody', async () => {
  const empty = await doctor({
    makeTransport: () => statusTransport({ version: '1.2.3', database: { ready: true }, contacts: { available: false } }),
    contacts: storeAnswering({ authorized: true, status: 3, contacts: [] }),
  });
  assert.ok(!empty.lines.some((l) => l.includes('not granted')), empty.lines.join('\n'));
  assert.ok(find(empty.lines, 'warn  the Contacts store is authorized (macOS state 3) but the read returned 0 people'), empty.lines.join('\n'));
  assert.ok(find(empty.lines, 'warn  the engine reports Contacts unavailable, but macOS reports the Contacts permission granted (state 3)'), empty.lines.join('\n'));
  const full = await doctor({ contacts: storeAnswering({ authorized: true, status: 3, contacts: [PERSON] }) });
  assert.ok(find(full.lines, 'ok    the Contacts store is readable, 1 people'), full.lines.join('\n'));
  assert.ok(!full.lines.some((l) => l.includes('not granted') || l.includes('returned 0 people')), full.lines.join('\n'));
  for (const status of [0, 1, 2]) {
    const refused = await doctor({
      makeTransport: () => statusTransport({ version: '1.2.3', database: { ready: true }, contacts: { available: false } }),
      contacts: storeAnswering({ authorized: false, status }),
    });
    assert.ok(find(refused.lines, 'warn  the Contacts permission is not granted'), status + '\n' + refused.lines.join('\n'));
    assert.ok(!refused.lines.some((l) => l.includes('returned 0 people')), refused.lines.join('\n'));
  }
});

// A transport whose engine answers status the way a freshly started one does: its Contacts catalog loads behind the
// first status, so that answer says unavailable and a later one, once the load has finished, says available.
const loadingContactsTransport = (answersBeforeLoaded) => {
  const lines = new Set();
  let asked = 0;
  return {
    asked: () => asked,
    onLine: (cb) => lines.add(cb),
    onExit: () => {},
    write: (s) => {
      const msg = JSON.parse(s);
      asked += 1;
      const result = { version: '1.2.3', database: { ready: true }, contacts: { available: asked > answersBeforeLoaded } };
      setImmediate(() => { for (const cb of lines) cb(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })); });
    },
    close: async () => {},
  };
};

test('doctor waits for a fresh engine to finish loading Contacts before reporting it unavailable (issue 393)', async () => {
  const engine = loadingContactsTransport(1);
  const r = await doctor({
    makeTransport: () => engine,
    contacts: storeAnswering({ authorized: true, status: 3, contacts: [PERSON] }),
  });
  assert.ok(find(r.lines, 'ok    the Contacts permission is granted, so contact names are resolved'), r.lines.join('\n'));
  assert.ok(!r.lines.some((l) => l.includes('engine reports Contacts unavailable')), r.lines.join('\n'));
  assert.ok(engine.asked() >= 2, 'the engine was asked again after its first answer');
});

test('an engine whose Contacts stay unavailable is still reported once the wait is over (issue 393)', async () => {
  const engine = loadingContactsTransport(Infinity);
  const r = await doctor({
    makeTransport: () => engine,
    contacts: storeAnswering({ authorized: true, status: 3, contacts: [PERSON] }),
  });
  assert.ok(find(r.lines, 'warn  the engine reports Contacts unavailable, but macOS reports the Contacts permission granted (state 3)'), r.lines.join('\n'));
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

// The server owns the bridge in Messages (Abi, 2026-11-13): a plain `open -a` drops it, and nothing put it back.
test('Messages is opened through the engine with its bridge where the server owns it', async () => {
  const { log } = logger();
  const calls = [];
  const exec = async (cmd, args, opts) => { calls.push([cmd, args, opts && opts.timeoutMs]); return { code: 0, stdout: '' }; };
  const mac = createMac({ log, settings: {}, platform: 'darwin', exec, bridgeBin: '/opt/imsg/bin/imsg' });
  assert.equal(mac.ownsBridge(), true);
  assert.deepEqual(await mac.relaunchMessages(), { launched: true, bridge: true });
  assert.deepEqual(await mac.relaunchMessages({ force: true }), { launched: true, bridge: true });
  assert.deepEqual(calls, [['/opt/imsg/bin/imsg', ['launch', '--json'], 60000], ['/opt/imsg/bin/imsg', ['launch', '--force', '--json'], 60000]], 'never a plain open -a, and a launch has a minute');
  const off = createMac({ log, settings: { messages: { bridge: false } }, platform: 'darwin', exec, bridgeBin: '/opt/imsg/bin/imsg' });
  assert.equal(off.ownsBridge(), false);
  calls.length = 0;
  await off.relaunchMessages();
  assert.deepEqual(calls.map((c) => c[0]), ['open'], 'with the setting off it opens Messages as before');
  const failing = createMac({ log, settings: {}, platform: 'darwin', exec: async () => ({ code: 1 }), bridgeBin: 'imsg' });
  assert.deepEqual(await failing.relaunchMessages(), { launched: false, reason: 'the engine could not open Messages with its bridge' });
});

const bridgeWatch = (bridge) => {
  const { lines, log } = logger();
  const state = { at: 0, running: true, launches: [], checks: 0, bridge };
  const engine = { info: () => ({ ready: true }), start: async () => {}, checkBridge: async () => { state.checks += 1; return { ...state.bridge }; } };
  const mac = {
    ...fakeControl(),
    ownsBridge: () => true,
    messagesRunning: async () => state.running,
    relaunchMessages: async (o = {}) => { state.launches.push(Boolean(o.force)); return { launched: true, bridge: true }; },
  };
  const w = createWatchdog({ engine, mac, log, now: () => state.at, everyMs: 60000 });
  return { w, lines, state };
};

test('the watchdog relaunches Messages with its bridge when the bridge stops answering, and leaves a ready one alone', async () => {
  const { w, lines, state } = bridgeWatch({ known: true, ready: true });
  await w.tick();
  assert.deepEqual(state.launches, [], 'a ready bridge is left alone');
  state.bridge = { known: true, ready: false, error: 'the bridge stopped answering' };
  state.at = 60000;
  await w.tick();
  assert.deepEqual(state.launches, [true], 'a bridge that does not answer is replaced by a forced relaunch');
  assert.ok(lines.find((l) => l.event === 'mac.relaunch' && l.reason === 'the bridge in Messages was not answering'));
  state.at = 120000;
  await w.tick();
  assert.deepEqual(state.launches, [true], 'a fresh bridge gets two ticks to come up before it is judged again');
  for (const at of [180000, 300000, 420000]) { state.at = at; await w.tick(); }
  assert.equal(state.launches.length, 3, 'at most three relaunches an hour');
  assert.ok(lines.find((l) => l.event === 'mac.refused' && l.what === 'bridge' && l.reason === 'relaunched 3 times in the last hour'));
  assert.equal(w.counts().bridgeRelaunches, 3);
});

test('the watchdog never relaunches for a bridge the engine does not report, or one another program manages', async () => {
  const unknown = bridgeWatch({ known: false, ready: false });
  await unknown.w.tick();
  assert.deepEqual(unknown.state.launches, []);
  const { lines, log } = logger();
  let checks = 0;
  const engine = { info: () => ({ ready: true }), start: async () => {}, checkBridge: async () => { checks += 1; return { known: true, ready: false }; } };
  const mac = { ...fakeControl({}, { messages: { managedBy: 'bluebubbles' } }), ownsBridge: () => true, relaunchMessages: async () => { throw new Error('must not relaunch'); } };
  await createWatchdog({ engine, mac, log }).tick();
  assert.equal(checks, 0, 'a Messages another program manages is not even probed');
  assert.equal(lines.filter((l) => l.event === 'mac.relaunch').length, 0);
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

// Another program's helper injected into Messages (issue 524). Measured 2026-11-15: Messages had been launched by
// BlueBubbles with only its own helper in DYLD_INSERT_LIBRARIES, and a forced relaunch crashed Messages and BlueBubbles
// put its helper straight back. The ps output below is synthetic, shaped like `ps eww -p <pid>` on macOS.
const FOREIGN_LIB = '/Applications/BlueBubbles.app/Contents/Resources/private-api/macos11/BlueBubblesHelper.dylib';
const OUR_LIB = '/opt/imsg/lib/' + OUR_HELPER;
const psLine = (env) => '  PID   TT  STAT      TIME COMMAND\n 4242   ??  S      0:12.34 /System/Applications/Messages.app/Contents/MacOS/Messages ' + env + '\n';
const FOREIGN_PS = psLine('DYLD_INSERT_LIBRARIES=' + FOREIGN_LIB + ' PATH=/usr/bin:/bin:/usr/sbin:/sbin TMPDIR=/var/folders/zz/T/ XPC_FLAGS=0x0');

test('the injected libraries of Messages are read from its environment', () => {
  assert.deepEqual(parseInjectedLibraries(FOREIGN_PS), [FOREIGN_LIB]);
  assert.deepEqual(parseInjectedLibraries(psLine('PATH=/usr/bin DYLD_INSERT_LIBRARIES=' + OUR_LIB)), [OUR_LIB], 'last on the line');
  assert.deepEqual(parseInjectedLibraries(psLine('DYLD_INSERT_LIBRARIES=/Applications/Some Tool.app/a.dylib:' + OUR_LIB + ' HOME=/var/empty')), ['/Applications/Some Tool.app/a.dylib', OUR_LIB], 'a path with a space and a colon list');
  assert.deepEqual(parseInjectedLibraries(psLine('PATH=/usr/bin TMPDIR=/tmp')), []);
  assert.deepEqual(parseInjectedLibraries(''), []);
  assert.deepEqual(parseInjectedLibraries(psLine('XDYLD_INSERT_LIBRARIES=/x.dylib')), [], 'only the variable itself');
  assert.equal(parseProgramName('/Applications/BlueBubbles.app/Contents/MacOS/BlueBubbles\n'), 'BlueBubbles');
  assert.equal(parseProgramName('launchd'), 'launchd');
  assert.equal(parseProgramName('  '), null);
});

test('the injection verdict tells ours, none and a foreign helper apart, and names the foreign one', () => {
  assert.equal(injectionVerdict([], 'launchd').verdict, 'none');
  assert.equal(injectionVerdict([OUR_LIB], 'imsg').verdict, 'ours');
  const foreign = injectionVerdict([FOREIGN_LIB], 'BlueBubbles');
  assert.deepEqual(foreign, { verdict: 'foreign', libraries: [FOREIGN_LIB], foreign: [FOREIGN_LIB], program: 'BlueBubbles' });
  const both = injectionVerdict([OUR_LIB, FOREIGN_LIB], 'BlueBubbles');
  assert.equal(both.verdict, 'foreign', 'a foreign helper beside ours is still foreign: its program relaunches Messages with it');
  assert.deepEqual(both.foreign, [FOREIGN_LIB]);
  assert.equal(foreignReason(foreign), 'Messages runs ' + FOREIGN_LIB + " injected by BlueBubbles; turn off that program's Messages injection");
  assert.equal(foreignReason(injectionVerdict([FOREIGN_LIB], null)), 'Messages runs ' + FOREIGN_LIB + " injected by an unknown program; turn off that program's Messages injection");
});

// An exec that answers the four commands the read runs, each overridable, and records what was asked.
const injectionExec = (over = {}) => {
  const calls = [];
  const answers = {
    pgrep: { code: 0, stdout: '4242\n' },
    env: { code: 0, stdout: FOREIGN_PS },
    ppid: { code: 0, stdout: '  777\n' },
    comm: { code: 0, stdout: '/Applications/BlueBubbles.app/Contents/MacOS/BlueBubbles\n' },
    ...over,
  };
  const exec = async (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    const key = cmd === 'pgrep' ? 'pgrep' : args[0] === 'eww' ? 'env' : args[1] === 'ppid=' ? 'ppid' : 'comm';
    const a = answers[key];
    if (a instanceof Error) throw a;
    return a;
  };
  return { exec, calls };
};

test('the running Messages is read for its injected helper and the program that launched it', async () => {
  const { log } = logger();
  const read = async (over, platform = 'darwin') => {
    const x = injectionExec(over);
    return { r: await createMac({ log, platform, exec: x.exec }).readMessagesInjection(), calls: x.calls };
  };
  const foreign = await read();
  assert.deepEqual(foreign.r, { verdict: 'foreign', libraries: [FOREIGN_LIB], foreign: [FOREIGN_LIB], program: 'BlueBubbles', pid: 4242 });
  assert.deepEqual(foreign.calls, ['pgrep -x Messages', 'ps eww -p 4242', 'ps -o ppid= -p 4242', 'ps -o comm= -p 777']);
  assert.equal((await read({ env: { code: 0, stdout: psLine('DYLD_INSERT_LIBRARIES=' + OUR_LIB) } })).r.verdict, 'ours');
  assert.equal((await read({ env: { code: 0, stdout: psLine('PATH=/usr/bin') } })).r.verdict, 'none');
  const noParent = await read({ ppid: { code: 1, stdout: '' } });
  assert.equal(noParent.r.verdict, 'foreign');
  assert.equal(noParent.r.program, null, 'an unread parent leaves the program unnamed, never guessed');
  assert.equal((await read({ comm: { code: 1, stdout: '' } })).r.program, null);
  const notRunning = await read({ pgrep: { code: 1, stdout: '' } });
  assert.deepEqual([notRunning.r.verdict, notRunning.r.reason], ['unknown', 'Messages is not running']);
  assert.deepEqual(notRunning.calls, ['pgrep -x Messages']);
  const unread = await read({ env: { code: 1, stdout: '' } });
  assert.deepEqual([unread.r.verdict, unread.r.reason], ['unknown', 'the environment of Messages could not be read']);
  const thrown = await read({ env: new Error('ps went away') });
  assert.deepEqual([thrown.r.verdict, thrown.r.reason], ['unknown', 'ps went away']);
  const linux = await read({}, 'linux');
  assert.deepEqual([linux.r.verdict, linux.r.reason, linux.calls.length], ['unknown', 'not macOS', 0]);
});

const withInjection = (w, mac) => createWatchdog({ engine: { info: () => ({ ready: true }), start: async () => {}, checkBridge: async () => ({ ...w.state.bridge }) }, mac, log: w.log, now: () => w.state.at, everyMs: 60000 });

test('the watchdog reports a foreign helper in Messages once per change instead of relaunching against it', async () => {
  const { lines, log } = logger();
  const state = { at: 0, launches: 0, reads: 0, bridge: { known: true, ready: false }, injection: injectionVerdict([FOREIGN_LIB], 'BlueBubbles') };
  const mac = {
    ...fakeControl(),
    ownsBridge: () => true,
    readMessagesInjection: async () => { state.reads += 1; return state.injection; },
    relaunchMessages: async () => { state.launches += 1; return { launched: true, bridge: true }; },
  };
  const w = withInjection({ state, log }, mac);
  const refusals = () => lines.filter((l) => l.event === 'mac.refused' && l.what === 'bridge').map((l) => l.reason);
  await w.tick();
  assert.equal(state.launches, 0, 'never relaunched against the program that put its helper there');
  assert.deepEqual(refusals(), ['Messages runs ' + FOREIGN_LIB + " injected by BlueBubbles; turn off that program's Messages injection"]);
  assert.deepEqual([w.counts().reports, w.counts().bridgeRelaunches], [1, 0], 'a report, not a relaunch');
  for (const at of [60000, 120000, 180000]) { state.at = at; await w.tick(); }
  assert.equal(refusals().length, 1, 'the same helper is reported once, not every minute');
  assert.equal(w.counts().reports, 1);
  assert.equal(state.reads, 4, 'it is read again every tick, so a change is seen');
  state.injection = injectionVerdict([FOREIGN_LIB], 'launchd');
  state.at = 240000;
  await w.tick();
  assert.equal(refusals().length, 2, 'a change of program is a change');
  assert.ok(refusals()[1].includes('injected by launchd'));
  assert.equal(lines.filter((l) => l.event === 'mac.relaunch').length, 0);
  state.injection = injectionVerdict([], 'launchd');
  state.at = 300000;
  await w.tick();
  assert.equal(state.launches, 1, 'once the foreign helper is gone the bridge is relaunched as before');
  state.injection = injectionVerdict([FOREIGN_LIB], 'BlueBubbles');
  state.at = 600000;
  await w.tick();
  assert.equal(refusals().filter((r) => r.startsWith('Messages runs')).length, 3, 'a helper that comes back is reported again');
  assert.equal(state.launches, 1);
});

test('the watchdog relaunches as before when the injection is ours, none, unknown or unreadable', async () => {
  for (const injection of [injectionVerdict([OUR_LIB], 'imsg'), injectionVerdict([], 'launchd'), { verdict: 'unknown', libraries: [], foreign: [], program: null, reason: 'Messages is not running' }, new Error('ps failed')]) {
    const { lines, log } = logger();
    const state = { at: 0, launches: 0, bridge: { known: true, ready: false } };
    const mac = {
      ...fakeControl(),
      ownsBridge: () => true,
      readMessagesInjection: async () => { if (injection instanceof Error) throw injection; return injection; },
      relaunchMessages: async () => { state.launches += 1; return { launched: true, bridge: true }; },
    };
    await withInjection({ state, log }, mac).tick();
    assert.equal(state.launches, 1, String(injection.verdict || injection.message));
    assert.equal(lines.filter((l) => l.event === 'mac.refused').length, 0);
  }
});

test('the watchdog neither reads nor relaunches a Messages another program is named as managing', async () => {
  const { lines, log } = logger();
  let reads = 0;
  const engine = { info: () => ({ ready: true }), start: async () => {}, checkBridge: async () => ({ known: true, ready: false }) };
  const mac = { ...fakeControl({}, { messages: { managedBy: 'bluebubbles' } }), ownsBridge: () => true, readMessagesInjection: async () => { reads += 1; return injectionVerdict([FOREIGN_LIB], 'BlueBubbles'); }, relaunchMessages: async () => { throw new Error('must not relaunch'); } };
  await createWatchdog({ engine, mac, log }).tick();
  assert.equal(reads, 0);
  assert.equal(lines.filter((l) => l.event === 'mac.relaunch' || l.event === 'mac.refused').length, 0);
});

// The guard: no forced relaunch of Messages for the bridge without reading what Messages runs first. The only other
// forced relaunch is the one a person asks for from the Server screen or the command line.
test('every forced bridge relaunch in the watchdog reads the injection in Messages first', () => {
  const src = readFileSync(new URL('../src/watchdog.js', import.meta.url), 'utf8');
  const forced = [...src.matchAll(/relaunchMessages\(\{ force: true \}\)/g)].map((m) => m.index);
  assert.equal(forced.length, 2, 'the guard found the forced relaunches: ' + forced.length);
  const care = src.indexOf('async function careForBridge');
  const request = src.indexOf('export function createRestarts');
  assert.ok(care > 0 && request > care, 'the guard found careForBridge and createRestarts');
  for (const at of forced) {
    if (at > request) continue;
    assert.ok(at > care, 'a forced relaunch outside careForBridge');
    const before = src.slice(care, at);
    assert.ok(before.includes('readMessagesInjection()') && before.includes("verdict === 'foreign'"), 'the bridge relaunch reads the injection and refuses a foreign one first');
  }
});

// A transport that answers status after a delay, the way imsg does while its bridge probe waits on a dead bridge.
const slowStatusTransport = (result, delayMs) => {
  const cbs = new Set();
  return {
    onLine: (cb) => cbs.add(cb),
    onExit: () => {},
    write: (s) => {
      const msg = JSON.parse(s);
      setTimeout(() => { for (const cb of cbs) cb(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })); }, delayMs);
    },
    close: async () => {},
  };
};
const DEAD_BRIDGE = { ...READY, bridge: { ready: false, error: 'The existing bridge did not answer a non-launching status probe.' } };

test('doctor warns about a bridge that will not answer and never fails an install for it (issue 524)', async () => {
  const r = await doctor({ makeTransport: () => statusTransport(DEAD_BRIDGE) });
  assert.equal(r.failed, false, r.lines.join('\n'));
  assert.ok(find(r.lines, 'warn  the bridge in Messages is not answering (The existing bridge did not answer a non-launching status probe.): sends still go out'), r.lines.join('\n'));
  const ready = await doctor({ makeTransport: () => statusTransport({ ...READY, bridge: { ready: true } }) });
  assert.ok(find(ready.lines, 'ok    the bridge in Messages answers'), ready.lines.join('\n'));
  const none = await doctor();
  assert.equal(none.lines.some((l) => l.includes('the bridge in Messages')), false, 'an engine that names no bridge is not reported on it');
});

test('doctor gives the engine status longer than the engine spends probing a dead bridge (issue 524)', async () => {
  assert.ok(STATUS_TIMEOUT_MS >= 2 * IMSG_BRIDGE_PROBE_MS, 'the status request outlasts the engine bridge probe');
  const slow = await doctor({ makeTransport: () => slowStatusTransport(DEAD_BRIDGE, 60), statusTimeoutMs: 1000 });
  assert.equal(slow.failed, false, slow.lines.join('\n'));
  assert.ok(find(slow.lines, 'ok    engine imsg 1.2.3 answered'));
  const short = await doctor({ makeTransport: () => slowStatusTransport(DEAD_BRIDGE, 200), statusTimeoutMs: 20 });
  assert.equal(short.failed, true, 'an engine that truly does not answer in time still fails');
  assert.ok(find(short.lines, 'fail  engine imsg did not answer'), short.lines.join('\n'));
});

test('doctor names the program whose helper runs in Messages', async () => {
  const withInj = (injection, settings = {}, config = CONFIG) => doctor({ config, mac: { ...fakeControl({}, settings), readMessagesInjection: async () => injection } });
  const foreign = await withInj(injectionVerdict([FOREIGN_LIB], 'BlueBubbles'));
  assert.equal(foreign.failed, false, 'a warning, not a failure');
  assert.ok(find(foreign.lines, 'warn  Messages runs ' + FOREIGN_LIB + " injected by BlueBubbles; turn off that program's Messages injection (for BlueBubbles, its Private API)"), foreign.lines.join('\n'));
  const managed = await withInj(injectionVerdict([FOREIGN_LIB], 'BlueBubbles'), { messages: { managedBy: 'bluebubbles' } });
  assert.ok(find(managed.lines, 'ok    Messages runs ' + FOREIGN_LIB + ' injected by BlueBubbles, and the config names bluebubbles as managing Messages'), managed.lines.join('\n'));
  assert.ok(find((await withInj(injectionVerdict([OUR_LIB], 'imsg'))).lines, 'ok    Messages runs the imsg bridge helper'));
  assert.ok(find((await withInj(injectionVerdict([], 'launchd'))).lines, 'warn  Messages runs with no helper injected'));
  const fakeEngine = await withInj(injectionVerdict([], 'launchd'), {}, { ...CONFIG, engine: { ...CONFIG.engine, kind: 'fake' } });
  assert.equal(fakeEngine.lines.some((l) => l.includes('no helper injected')), false, 'no bridge is expected of an engine without one');
  assert.ok(find((await withInj({ verdict: 'unknown', libraries: [], foreign: [], program: null, reason: 'Messages is not running' })).lines, 'warn  which helper Messages runs could not be read: Messages is not running'));
  const offMac = await withInj({ verdict: 'unknown', libraries: [], foreign: [], program: null, reason: 'not macOS' });
  assert.equal(offMac.lines.some((l) => l.includes('helper')), false);
  const noRead = await doctor();
  assert.equal(noRead.lines.some((l) => l.includes('helper')), false, 'a control that cannot read it says nothing');
});
