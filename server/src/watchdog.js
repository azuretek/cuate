// The watchdog: every minute it checks that the engine answers and that Messages is running, restarts the engine
// with a backoff and relaunches Messages when it has quit, at most three times an hour. While the config names
// another program as managing Messages it reports instead of relaunching, because that program launches Messages
// with its own helper injected and a plain relaunch would drop it. Every effect is injected, so its failure states
// are proven with fakes and nothing here needs a Mac.
export const WATCHDOG_DEFAULTS = Object.freeze({
  everyMs: 60000,
  relaunchLimit: 3,
  windowMs: 3600000,
  backoffMs: 1000,
  maxBackoffMs: 30000,
});

const message = (e) => (e && e.message ? String(e.message) : String(e));

/**
 * @param engine the engine adapter, for its health and its restart
 * @param mac the control from createMac, for Messages
 * @param log the structured logger; every action and refusal is one declared event
 * @param now the clock, so the relaunch window and the backoff are provable with a fake
 */
export function createWatchdog({
  engine,
  mac,
  log,
  now = Date.now,
  everyMs = WATCHDOG_DEFAULTS.everyMs,
  relaunchLimit = WATCHDOG_DEFAULTS.relaunchLimit,
  windowMs = WATCHDOG_DEFAULTS.windowMs,
  backoffMs = WATCHDOG_DEFAULTS.backoffMs,
  maxBackoffMs = WATCHDOG_DEFAULTS.maxBackoffMs,
  setInterval: startTimer = setInterval,
  clearInterval: stopTimer = clearInterval,
  restartEngine = () => engine.start(),
  engineReady = () => engine.info().ready,
}) {
  const settings = mac.settings;
  const relaunches = [];
  const counts = { ticks: 0, engineRestarts: 0, messagesRelaunches: 0, reports: 0 };
  let timer = null;
  let backoff = backoffMs;
  let lastRestartAt = -Infinity;

  /** One pass. It never throws: a check that failed leaves the watchdog to try again next minute. */
  async function tick() {
    counts.ticks += 1;
    const at = now();

    let ready;
    try {
      ready = Boolean(await engineReady());
    } catch {
      ready = false;
    }
    if (ready) {
      backoff = backoffMs;
    } else if (at - lastRestartAt >= backoff) {
      lastRestartAt = at;
      counts.engineRestarts += 1;
      log.emit('mac.restart', { what: 'engine' });
      try {
        await restartEngine();
      } catch (e) {
        log.emit('mac.refused', { what: 'engine', reason: message(e) });
      }
      backoff = Math.min(maxBackoffMs, backoff * 2);
    }

    let running;
    try {
      running = Boolean(await mac.messagesRunning());
    } catch {
      running = true;
    }
    if (!running) {
      const since = at - windowMs;
      while (relaunches.length && relaunches[0] <= since) relaunches.shift();
      if (settings.messages.managedBy) {
        counts.reports += 1;
        log.emit('mac.refused', { what: 'messages', reason: 'managed by ' + settings.messages.managedBy });
      } else if (!settings.messages.manage) {
        counts.reports += 1;
        log.emit('mac.refused', { what: 'messages', reason: 'managing Messages is off' });
      } else if (relaunches.length >= relaunchLimit) {
        counts.reports += 1;
        log.emit('mac.refused', { what: 'messages', reason: 'relaunched ' + relaunches.length + ' times in the last hour' });
      } else {
        relaunches.push(at);
        counts.messagesRelaunches += 1;
        log.emit('mac.relaunch', { reason: 'Messages was not running' });
        try {
          const r = await mac.relaunchMessages();
          if (r && r.launched === false) log.emit('mac.refused', { what: 'messages', reason: r.reason || 'the relaunch failed' });
        } catch (e) {
          log.emit('mac.refused', { what: 'messages', reason: message(e) });
        }
      }
    }
    return { ...counts };
  }

  return {
    tick,
    counts: () => ({ ...counts }),
    start() {
      if (!timer) {
        timer = startTimer(() => {
          tick().catch(() => {});
        }, everyMs);
        if (timer && typeof timer.unref === 'function') timer.unref();
      }
      return { everyMs };
    },
    stop() {
      if (timer) {
        stopTimer(timer);
        timer = null;
      }
    },
  };
}

/**
 * Restarts on request, for the Server screen and the command line. The caller holds the admin check; these only
 * perform the action, so a refusal is never silent and a restart is always one declared event.
 * - messages: open Messages again.
 * - engine: start the engine adapter again.
 * - server: exit cleanly, so the LaunchAgent starts the server again.
 */
export function createRestarts({ engine, mac, log, exit = (code) => process.exit(code) }) {
  return {
    async messages() {
      log.emit('mac.restart', { what: 'messages' });
      const r = await mac.relaunchMessages();
      const out = { restarted: Boolean(r && r.launched !== false) };
      if (r && r.reason) out.reason = r.reason;
      return out;
    },
    async engine() {
      log.emit('mac.restart', { what: 'engine' });
      await engine.start();
      return { restarted: true };
    },
    server() {
      log.emit('mac.restart', { what: 'server' });
      exit(0);
      return { restarted: true };
    },
  };
}
