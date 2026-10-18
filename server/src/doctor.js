// Checks the Mac and the engine and says what to fix, one line each. It never changes anything.
import { accessSync, constants } from 'node:fs';
import { createRpc } from './engine/rpc.js';
import { createMac } from './mac.js';
import { createContacts } from './contacts.js';

const quiet = { emit: () => {} };

// What the engine's own status report says about the Messages database, which is the Full Disk Access grant in
// action. The engine retries the open on every status, and its error text tells the three states apart: ready,
// the file is not there (Messages is not signed in yet), or the file is there and could not be opened read-only
// (the grant is missing, or it went stale after a macOS or Homebrew update and has to be toggled off and on).
// Pure and exported, so every degraded state is proven against a fixture rather than a Mac.
export function databaseVerdict(status) {
  const db = status && status.database;
  if (!db) return 'unknown';
  if (db.ready) return 'ready';
  const error = String(db.error || '');
  if (/does not exist/i.test(error)) return 'missing';
  if (/could not be opened/i.test(error)) return 'blocked';
  return 'unreadable';
}

export async function runDoctor({
  config,
  store,
  makeTransport,
  dataDir,
  attachmentsRoot,
  platform = process.platform,
  mac = null,
  contacts = null,
  engineNeedsScreen = Boolean(config.engine && config.engine.needsScreen),
  contactsSettleMs = 5000,
  contactsPollMs = 250,
}) {
  const lines = [];
  let failed = false;
  const ok = (m) => lines.push('ok    ' + m);
  const warn = (m) => lines.push('warn  ' + m);
  const bad = (m) => { failed = true; lines.push('fail  ' + m); };
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj > 22 || (maj === 22 && min >= 13)) ok('Node ' + process.versions.node);
  else bad('Node ' + process.versions.node + ' is too old: 22.13 or newer is needed');
  ok('data folder ' + dataDir);
  const tokens = store.listTokens().filter((t) => !t.revoked_at);
  if (tokens.some((t) => t.scope === 'device')) ok(tokens.length + ' active token(s)');
  else warn('no device token yet: run token create --scope device --name <device>');
  const transport = makeTransport();
  const rpc = createRpc({ transport });
  let engineContacts = null;
  let exited = false;
  transport.onExit(() => { exited = true; });
  try {
    const st = await rpc.request('status', {}, 10000);
    const version = st && st.version != null ? ' ' + String(st.version) : '';
    ok('engine ' + config.engine.kind + version + ' answered');
    const verdict = databaseVerdict(st);
    if (verdict === 'ready') ok('engine ' + config.engine.kind + version + ': the Messages database is readable');
    else if (verdict === 'missing') bad('the Messages database is not there, so Messages is not signed in (or chat.db has never been created): open Messages, finish signing in, then run doctor again');
    else if (verdict === 'blocked') bad('the Messages database could not be opened: give the program that starts the server Full Disk Access, and if its entry is already on, switch it off and on again because a macOS or Homebrew update leaves the grant stale, then run doctor again');
    else bad('engine ' + config.engine.kind + version + ' cannot read the Messages database' + (st && st.database && st.database.error ? ': ' + st.database.error : '') + ': give Full Disk Access to the program that starts the server, then run doctor again');
    if (st && st.contacts) engineContacts = st.contacts;
    // ★ A freshly started imsg answers its first status before its Contacts catalog has loaded: the catalog starts
    // unavailable and the status read starts the load behind the answer rather than waiting for it, so the first
    // status always says unavailable (measured on the Mac: false at about 0.1 s, true at about 0.6 s). Doctor starts its
    // own engine and asked once, so it reported Contacts unavailable with the permission granted (issue 393). It asks
    // again until the engine says available, the engine exits, or the bound runs out, and only then reports.
    const settleBy = Date.now() + contactsSettleMs;
    while (engineContacts && engineContacts.available === false && !exited && Date.now() < settleBy) {
      await new Promise((resolve) => setTimeout(resolve, contactsPollMs));
      const again = await rpc.request('status', {}, 10000).catch(() => null);
      if (again && again.contacts) engineContacts = again.contacts;
    }
  } catch (e) {
    bad('engine ' + config.engine.kind + ' did not answer (' + (exited ? 'it exited' : e.message) + '): check engine.bin in config.json (' + config.engine.bin + ')');
  } finally {
    await transport.close();
  }
  // The server's own Contacts read (issue 393): its state is named, so an empty store and a store that was not
  // allowed are told apart. It is read before the engine's Contacts answer is reported, because macOS's own
  // authorization state is what decides whether the permission is missing.
  //
  // ★ "Not granted" is said only when macOS reports a state other than 3. An authorized store that reads nobody is
  // its own answer: the permission is there and the read is what came back empty (measured on a Mac whose store held
  // people while a container-first read answered none).
  let contactsStatus = null;
  if (contacts || platform === 'darwin') {
    const store = contacts || createContacts({ log: quiet });
    const st = await store.load().then(() => store.status()).catch(() => ({ state: 'error', status: null, count: 0, reason: 'error' }));
    contactsStatus = Number.isFinite(st.status) ? st.status : null;
    if (st.state === 'ok') ok('the Contacts store is readable, ' + st.count + ' people');
    else if (st.state === 'empty') warn('the Contacts store is authorized (macOS state 3) but the read returned 0 people: the permission is granted, so if the Contacts app holds people the read is at fault, not the grant');
    else if (st.state === 'not_determined') warn('the Contacts store has never been allowed for the program that starts the server (macOS state not determined): this headless check does not request permission; inspect the running server diagnostics before requesting any permission change');
    else if (st.state === 'denied') bad('the Contacts store was denied for the program that starts the server: switch Contacts on for it in System Settings, Privacy & Security, Contacts, then run doctor again');
    else if (st.state === 'restricted') bad('the Contacts store is restricted by the system and cannot be read here');
    else bad('the Contacts store could not be read' + (st.reason ? ' (' + st.reason + ')' : '') + ': inspect the running server diagnostics; a read error alone does not establish a permission denial');
  }
  // The engine's own Contacts answer. Its "unavailable" is reported as a missing permission only when macOS's state is
  // known and is not 3; with the state authorized, or not readable here, it is reported as what the engine said.
  if (engineContacts) {
    if (engineContacts.available !== false) ok('the Contacts permission is granted, so contact names are resolved');
    else if (contactsStatus === 3) warn('the engine reports Contacts unavailable, but macOS reports the Contacts permission granted (state 3): the permission is not the cause, so inspect the engine rather than System Settings');
    else if (contactsStatus !== null) warn('the Contacts permission is not granted, so contact names are left out: grant it in System Settings, Privacy & Security, Contacts, then run doctor again');
    else warn('the engine reports Contacts unavailable, so contact names are left out; the macOS Contacts state could not be read here, so this alone does not establish a missing permission');
  }
  if (config.sending.enabled) {
    ok('sending is on, at most ' + config.sending.perMinute + ' a minute');
    // The engine's status report cannot see whether Automation is granted: on macOS send is structurally usable
    // and macOS only answers the prompt a real send triggers. So doctor names the grant and its fix instead of
    // claiming it is there.
    warn('sending drives Messages through AppleScript and needs Automation for Messages: macOS asks the first time a send runs, and a send refused as not authorized to send Apple events is fixed in System Settings, Privacy & Security, Automation, Messages');
  } else warn('sending is off: switch it on with the command "sending on"');
  // Hooks: an endpoint the server switched off after it kept failing is named with why, since nothing else will say
  // that its receiver has stopped hearing anything.
  for (const e of (config.webhooks && config.webhooks.endpoints) || []) {
    if (e.active !== false) ok('hook ' + e.id + ' is on, for ' + (e.events || []).join(','));
    else {
      const why = [e.disabledReason === 'give_ups' ? 'too many deliveries in a row were given up on' : e.disabledReason === 'no_delivery' ? 'nothing was delivered for a day' : e.disabledReason, e.disabledAt && 'at ' + e.disabledAt, e.lastError && 'last error ' + e.lastError].filter(Boolean).join(', ');
      warn('hook ' + e.id + ' is switched off' + (why ? ' (' + why + ')' : '') + ': fix its receiver, then run hooks enable ' + e.id);
    }
  }
  if (platform === 'darwin' || config.attachmentsRoot) {
    try {
      accessSync(attachmentsRoot, constants.R_OK);
      ok('attachments folder readable');
    } catch {
      warn('attachments folder not readable: ' + attachmentsRoot);
    }
  }
  // The Mac settings the server relies on, so a restart of the Mac is not a surprise: it reports each one and
  // never changes it. An injected control makes this provable off a Mac; otherwise it is read only on a Mac.
  const lockEnabled = Boolean(config.mac && config.mac.lock && config.mac.lock.enabled);
  if (mac || platform === 'darwin') {
    const control = mac || createMac({ log: quiet, settings: config.mac, platform, engineNeedsScreen });
    const s = await control.readSettings();
    if (s.automaticLogin) ok('automatic login is on for ' + s.automaticLogin);
    else warn('automatic login could not be read or is off: after a restart the Mac waits at the login window and Messages never starts');
    if (s.fileVault === null) warn('FileVault could not be read: run fdesetup status');
    else if (s.fileVault) warn('FileVault is on: it blocks the automatic login the server relies on after a restart');
    else ok('FileVault is off, so automatic login can work');
    if (s.restartAfterPowerFailure === null) warn('restart after a power failure could not be read (systemsetup needs an administrator)');
    else if (s.restartAfterPowerFailure) ok('the Mac starts up again after a power failure');
    else warn('the Mac does not start up again after a power failure: turn it on in Energy Saver');
    if (s.sleepMinutes === null) warn('the sleep setting could not be read: run pmset -g');
    else if (s.sleepMinutes === 0) ok('the Mac is set never to sleep on its own');
    else warn('the Mac sleeps on its own after ' + s.sleepMinutes + ' minutes: the server holds sleep off while it runs, but set the Mac never to sleep as well');
    if (lockEnabled && engineNeedsScreen) bad('the lock setting is on, but the ' + config.engine.kind + ' engine needs the screen unlocked: the lock cannot be applied and is refused');
    else if (lockEnabled) {
      if (s.screenLockRequired === null) warn('the lock-screen password setting could not be read');
      else if (s.screenLockRequired && s.screenLockDelaySeconds === 0) ok('the screen locks at once and asks for a password');
      else bad('locking is on but the screen does not ask for a password at once: turn on "Require password immediately after sleep or screen saver begins"');
    }
  }
  return { failed, lines };
}
