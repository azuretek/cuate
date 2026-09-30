// What the server does about the Mac while it runs, in one place so the ORDER is provable: it holds sleep off
// for as long as the server runs, locks the screen once Messages and the engine are ready after a login, and
// starts the watchdog. Every effect is injected, so this is proven with fakes and nothing here needs a Mac.
import { createWatchdog } from './watchdog.js';

/**
 * @param mac the control from createMac
 * @param engine the engine adapter, for the ready state the lock waits for
 * @param log the structured Mac logger, the same one the Mac control and the watchdog log through, so a hold, a
 *   lock, a relaunch and a restart are each one declared event and the run path can send each on as an event too
 * @param everyMs the watchdog's tick, overridable so a test never waits a minute
 */
export function startMacCare({ mac, engine, log, everyMs } = {}) {
  let stopped = false;
  let locked = false;

  // Lock once, after the engine is ready and Messages is running. Messages only runs in a logged-in session, so
  // the Mac logs itself in after a restart and would otherwise sit unlocked. An engine that needs the screen keeps
  // it: lockScreen refuses with a reason rather than half applying.
  const lockAfterReady = async () => {
    if (stopped || locked || !mac.settings.lock.enabled) return;
    try {
      if (!(await mac.messagesRunning())) return;
      const r = await mac.lockScreen();
      if (r && r.locked) locked = true;
    } catch (e) {
      log.emit('mac.refused', { what: 'lock', reason: e && e.message ? e.message : String(e) });
    }
  };

  const watchdog = createWatchdog({ engine, mac, log, ...(everyMs === undefined ? {} : { everyMs }) });

  return {
    watchdog,
    /** Hold sleep off, register the lock for the moment the engine is ready, and start the watchdog. */
    async start() {
      const held = await mac.holdAwake();
      engine.onState((s) => {
        if (s && s.ready) lockAfterReady();
      });
      if (engine.info().ready) await lockAfterReady();
      watchdog.start();
      return { held: Boolean(held && held.held) };
    },
    /** Stop the watchdog and let the sleep hold go. The hold also ends by itself when the process exits. */
    stop() {
      if (stopped) return;
      stopped = true;
      watchdog.stop();
      mac.releaseAwake();
    },
  };
}
