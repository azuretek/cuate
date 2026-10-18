// Which waiting loads start next (issue 425). Everything the page fetches to decorate what is drawn (a picture, a
// video's still, a link card's preview, an avatar) loads in the order the person sees it: what is on screen first, in
// the order it came into view; what is within a screen of the view only once nothing on screen is still waiting or
// loading; and nothing further out at all. A load in flight whose element has gone out of reach is cancelled and waits
// again for its element to come back; one a screen away is put back in line whenever something on screen is waiting.
//
// A load is { place, order, running }: place is 'seen' (on screen), 'near' (within a screen), 'away', or 'unknown' for
// one the page has not yet said is on screen or not, which starts nothing and holds back what is a screen away until
// it is known; order is when it came into view, the earlier first. limit is how many may be in flight at once, so
// pictures never take every connection the page holds to the server and a read of the conversation's own messages is
// never queued behind them.
export const LOAD_LIMIT = 4;

export function planLoads(loads, { limit = LOAD_LIMIT } = {}) {
  const waiting = loads.filter((l) => !l.running);
  const byOrder = (a, b) => a.order - b.order;
  const seen = waiting.filter((l) => l.place === 'seen').sort(byOrder);
  // Something on screen waiting puts a load a screen away back in line too, so it never holds a slot the screen needs.
  const yields = (l) => l.place === 'away' || (l.place === 'near' && seen.length > 0);
  const cancel = loads.filter((l) => l.running && yields(l));
  const running = loads.filter((l) => l.running && !yields(l));
  const busyOnScreen = seen.length > 0 || running.some((l) => l.place === 'seen') || waiting.some((l) => l.place === 'unknown');
  const near = busyOnScreen ? [] : waiting.filter((l) => l.place === 'near').sort(byOrder);
  const room = Math.max(0, limit - running.length);
  return { start: [...seen, ...near].slice(0, room), cancel };
}
