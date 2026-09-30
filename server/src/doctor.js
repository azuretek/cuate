// Checks the Mac and the engine and says what to fix, one line each. It never changes anything.
import { accessSync, constants } from 'node:fs';
import { createRpc } from './engine/rpc.js';
import { createMac } from './mac.js';

const quiet = { emit: () => {} };

export async function runDoctor({
  config,
  store,
  makeTransport,
  dataDir,
  attachmentsRoot,
  platform = process.platform,
  mac = null,
  engineNeedsScreen = Boolean(config.engine && config.engine.needsScreen),
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
  let exited = false;
  transport.onExit(() => { exited = true; });
  try {
    const st = await rpc.request('status', {}, 10000);
    const version = st && st.version != null ? ' ' + st.version : '';
    if (st && st.database && st.database.ready) ok('engine ' + config.engine.kind + version + ': the Messages database is readable');
    else bad('engine ' + config.engine.kind + version + ' cannot read the Messages database: give Full Disk Access to the program that starts the server, then run doctor again');
  } catch (e) {
    bad('engine ' + config.engine.kind + ' did not answer (' + (exited ? 'it exited' : e.message) + '): check engine.bin in config.json (' + config.engine.bin + ')');
  } finally {
    await transport.close();
  }
  if (config.sending.enabled) ok('sending is on, at most ' + config.sending.perMinute + ' a minute');
  else warn('sending is off: switch it on with the command "sending on"');
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
