// The Mac's own controls, behind one interface so the rules stay testable off a Mac: holding sleep off while the
// server runs, locking the screen once Messages and the engine are ready, and reading the settings the server
// relies on. Every effect is injected. On a Mac they run caffeinate, pmset, fdesetup, defaults, systemsetup and
// pgrep; a test passes fakes, so nothing in the suite needs a real Mac.
import { execFile, spawn } from 'node:child_process';

// Where the Mac-care section of the config starts. None of it is destructive: sleep is held off while the server
// runs (BlueBubbles holds it the same way), the lock waits until it is asked for, and Messages is relaunched only
// when nothing else is named as managing it.
export const MAC_DEFAULTS = Object.freeze({
  awake: true,
  lock: { enabled: false, method: 'displaySleep', command: null, args: [] },
  messages: { manage: true, app: 'Messages', managedBy: null },
});

export const LOCK_METHODS = ['displaySleep', 'loginFramework'];

/** The Mac-care config with every default filled in, so a half-written config cannot half-apply a setting. */
export function macConfig(raw = {}) {
  const l = raw.lock || {};
  const m = raw.messages || {};
  return {
    awake: raw.awake === undefined ? MAC_DEFAULTS.awake : raw.awake,
    lock: {
      enabled: l.enabled === undefined ? MAC_DEFAULTS.lock.enabled : l.enabled,
      method: LOCK_METHODS.includes(l.method) ? l.method : MAC_DEFAULTS.lock.method,
      command: l.command || null,
      args: Array.isArray(l.args) ? l.args.map(String) : [],
    },
    messages: {
      manage: m.manage === undefined ? MAC_DEFAULTS.messages.manage : m.manage,
      app: m.app || MAC_DEFAULTS.messages.app,
      managedBy: m.managedBy || null,
    },
  };
}

// The parsers below read one macOS command's output each. They are pure and take the text, so a test proves them
// against fixture output and nobody needs a Mac to check a setting.

/** `pmset -g`: the sleep line names the minutes the Mac waits, 0 meaning it never sleeps. */
export function parseSleep(text) {
  const m = /^\s*sleep\s+(\d+)\s*$/m.exec(String(text || ''));
  return m ? Number(m[1]) : null;
}

/** `defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser`: a quoted user name, or nothing. */
export function parseAutomaticLogin(text) {
  const t = String(text || '').trim();
  const quoted = /"([^"]+)"/.exec(t);
  if (quoted) return quoted[1];
  return /^[A-Za-z0-9._-]+$/.test(t) ? t : null;
}

/** `fdesetup status`: "FileVault is On." or "FileVault is Off.". */
export function parseFileVault(text) {
  const t = String(text || '');
  if (/FileVault is On/i.test(t)) return true;
  if (/FileVault is Off/i.test(t)) return false;
  return null;
}

/** `systemsetup -getrestartpowerfailure`: "Restart After Power Failure: On". It needs an administrator. */
export function parsePowerFailure(text) {
  const m = /restart after power failure:\s*(on|off)/i.exec(String(text || ''));
  return m ? m[1].toLowerCase() === 'on' : null;
}

/** `defaults -currentHost read com.apple.screensaver askForPassword` and the delay in seconds beside it. */
export function parseScreenLock(askText, delayText) {
  const a = /^\s*1\s*$/m.test(String(askText || '')) ? true : /^\s*0\s*$/m.test(String(askText || '')) ? false : null;
  const d = /^\s*(\d+)\s*$/m.exec(String(delayText || ''));
  return { required: a, delaySeconds: d ? Number(d[1]) : null };
}

const NOT_A_MAC = Object.freeze({
  sleepMinutes: null, automaticLogin: null, fileVault: null,
  restartAfterPowerFailure: null, screenLockRequired: null, screenLockDelaySeconds: null,
});

/** Reads the Mac settings the server relies on. Off a Mac every answer is null, which doctor reports as unread. */
export async function readMacSettings({ exec, platform = process.platform } = {}) {
  if (platform !== 'darwin' || typeof exec !== 'function') return { ...NOT_A_MAC };
  const out = async (cmd, args) => {
    try {
      const r = await exec(cmd, args);
      return r && typeof r.stdout === 'string' ? r.stdout : '';
    } catch {
      return '';
    }
  };
  const [power, login, vault, failure, ask, delay] = await Promise.all([
    out('pmset', ['-g']),
    out('defaults', ['read', '/Library/Preferences/com.apple.loginwindow', 'autoLoginUser']),
    out('fdesetup', ['status']),
    out('systemsetup', ['-getrestartpowerfailure']),
    out('defaults', ['-currentHost', 'read', 'com.apple.screensaver', 'askForPassword']),
    out('defaults', ['-currentHost', 'read', 'com.apple.screensaver', 'askForPasswordDelay']),
  ]);
  const lock = parseScreenLock(ask, delay);
  return {
    sleepMinutes: parseSleep(power),
    automaticLogin: parseAutomaticLogin(login),
    fileVault: parseFileVault(vault),
    restartAfterPowerFailure: parsePowerFailure(failure),
    screenLockRequired: lock.required,
    screenLockDelaySeconds: lock.delaySeconds,
  };
}

const defaultExec = (cmd, args) => new Promise((resolve) => {
  execFile(cmd, args, { encoding: 'utf8', timeout: 5000 }, (error, stdout, stderr) => {
    resolve({
      code: error ? (Number.isInteger(error.code) ? error.code : 1) : 0,
      error: error ? String(error.code || error.message) : null,
      stdout: stdout || '',
      stderr: stderr || '',
    });
  });
});

/**
 * The Mac as the server drives it: hold sleep off, lock the screen on request, and look after Messages. Everything
 * it runs is injected, so its refusals are provable without a Mac.
 * - awake: caffeinate waits on the server's own process id, so the hold ends exactly when the server does.
 * - lock: refused with a reason rather than half applied when the setting is off, the engine needs the screen, or
 *   the chosen method has no helper.
 * - messages: relaunched only when the caller decides to; another program managing Messages is never fought with.
 */
export function createMac({
  log,
  settings = {},
  platform = process.platform,
  pid = process.pid,
  engineNeedsScreen = false,
  exec = defaultExec,
  spawnChild = spawn,
}) {
  const mac = macConfig(settings);
  let hold = null;
  let locked = false;

  const refused = (what, r) => {
    log.emit('mac.refused', { what, reason: r });
    return { held: false, locked: false, launched: false, reason: r };
  };

  return {
    settings: mac,
    readSettings: () => readMacSettings({ exec, platform }),

    /** The Mac care state as it now stands, for the status route and the events. */
    state() {
      return {
        awake: Boolean(hold),
        locked,
        lockEnabled: mac.lock.enabled,
        lockMethod: mac.lock.method,
        managedBy: mac.messages.managedBy,
      };
    },

    /** Starts the sleep hold once. It is idempotent, so a second call is not a second caffeinate. */
    async holdAwake() {
      if (hold) return { held: true };
      if (!mac.awake) return refused('awake', 'the awake setting is off');
      if (platform !== 'darwin') return refused('awake', 'not macOS');
      try {
        hold = spawnChild('caffeinate', ['-i', '-s', '-w', String(pid)], { stdio: 'ignore' });
      } catch (e) {
        hold = null;
        return refused('awake', 'caffeinate did not start: ' + (e && e.message ? e.message : String(e)));
      }
      log.emit('mac.awake', { on: true });
      return { held: true };
    },

    /** Lets the hold go. The hold also ends on its own when this process exits, which is why caffeinate waits on it. */
    releaseAwake() {
      if (!hold) return { held: false, reason: 'not held' };
      try {
        hold.kill();
      } catch {
        // The process may already be gone; the hold is over either way.
      }
      hold = null;
      log.emit('mac.awake', { on: false });
      return { held: false };
    },

    /** Locks the screen with the method the plan records. It never guesses: an unusable setting is refused. */
    async lockScreen() {
      if (!mac.lock.enabled) return refused('lock', 'the lock setting is off');
      if (engineNeedsScreen) return refused('lock', 'the engine needs the screen unlocked');
      if (platform !== 'darwin') return refused('lock', 'not macOS');
      if (mac.lock.method === 'loginFramework') {
        if (!mac.lock.command) return refused('lock', 'the login-framework method has no helper configured');
        const r = await exec(mac.lock.command, mac.lock.args);
        if (!r || r.code !== 0) return refused('lock', 'the login-framework helper failed');
        locked = true;
        log.emit('mac.lock', { method: 'loginFramework', locked: true });
        return { locked: true };
      }
      const r = await exec('pmset', ['displaysleepnow']);
      if (!r || r.code !== 0) return refused('lock', 'pmset displaysleepnow failed');
      locked = true;
      log.emit('mac.lock', { method: 'displaySleep', locked: true });
      return { locked: true };
    },

    /** Whether Messages is running. Off a Mac it is always true, so the watchdog has nothing to look after. */
    async messagesRunning() {
      if (platform !== 'darwin') return true;
      const r = await exec('pgrep', ['-x', mac.messages.app]);
      return Boolean(r && r.code === 0);
    },

    /** Opens Messages. The caller decides whether to, so a refused relaunch is visible rather than silent. */
    async relaunchMessages() {
      if (platform !== 'darwin') return { launched: false, reason: 'not macOS' };
      const r = await exec('open', ['-a', mac.messages.app]);
      if (!r || r.code !== 0) return { launched: false, reason: 'open -a ' + mac.messages.app + ' failed' };
      return { launched: true };
    },
  };
}
