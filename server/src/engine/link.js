// The rule that decides whether an engine link is connected and how long to wait before the next start. Pure: the
// clock and every input are arguments, so each state the link can be in (a child that died mid-request, an engine
// that never became ready, a bridge that is not connected, a link that flaps) is a unit test rather than a live run.
//
// The shape this exists to stop, measured on a real server: a child is killed shortly after it is spawned, the
// adapter spawns another, and the two restart paths (the adapter's own and the watchdog's) race, so the link spends
// its life half-connected with overlapping children. Two rules close that: a readiness gate that is false unless the
// child is alive, the Messages database is readable and the watch is subscribed; and a backoff that resets only once
// the link has STAYED ready, so an engine that is up for a moment and then dies cannot be restarted every second.

// A restart never comes sooner than this, so a broken engine cannot be restarted in a tight loop.
export const RESTART_MIN_MS = 1000;
// Nor later: once the engine keeps failing, this is the slow retry.
export const RESTART_MAX_MS = 30000;
// An engine ready for this long counts as healthy, and only then does the delay return to the minimum.
export const STABLE_MS = 60000;

// Connected only when the child is alive, the engine answered status with a readable Messages database, and the
// watch is subscribed. An engine too old to know watch.subscribe is not held back by it: the method is reported
// unsupported and the link is still connected for reads and sends.
export function isReady({ alive, databaseReady, subscribed, subscribeUnsupported = false } = {}) {
  return Boolean(alive) && Boolean(databaseReady) && Boolean(subscribed || subscribeUnsupported);
}

// The delay before the next start: it doubles each failed attempt up to the maximum, and only an engine that stayed
// ready for stableMs resets it to the minimum. A single successful status does NOT reset it, which is what stops a
// link that is up for a moment and then dies from restarting every second.
export function nextDelay(previousMs, { readyForMs = 0, stableMs = STABLE_MS, minMs = RESTART_MIN_MS, maxMs = RESTART_MAX_MS } = {}) {
  if (readyForMs >= stableMs) return minMs;
  const base = Number.isFinite(previousMs) && previousMs > 0 ? previousMs : minMs / 2;
  return Math.min(maxMs, Math.max(minMs, base * 2));
}
