// The one queue every decorating fetch on the page goes through (issue 425), so what is on screen is fetched first,
// what is a screen away next, and nothing further out; the order itself is rules/load-order.js.
//
//   const ticket = loadQueue().request(element, (signal) => fetchIt(signal));
//   ticket.cancel();   // the element left the page or no longer wants it
//
// Each element is watched twice. The screen's own observer says whether it is on screen, clipped by every scrolled
// view it sits in. A second observer, rooted at the scrolled view the element is in, says whether it is within a screen
// of that view's visible part: a margin on the screen's observer never reaches past the scrolled view's clip, so a row
// a screen above the conversation's view read as away and nothing was ever fetched ahead of a scroll. The scrolled
// view itself is watched by the screen's observer, so a view off screen (the chat list behind an open conversation on
// a phone) holds nothing within reach.
//
// The task is started when the rule says so and given a signal the queue aborts if the element is scrolled out of
// reach first; an aborted task waits again and is started afresh when its element comes back. A task that finishes, or
// fails, leaves the queue. The observers report after layout, so nothing here stands between a render and its first
// paint. With no observer (a test with no page, an old engine) a task starts at once, which is how the page fetched
// before.
import { planLoads, LOAD_LIMIT } from './rules/load-order.js';

export const NEAR_MARGIN = '100% 0px';

// The scrolled view an element sits in: its nearest ancestor that scrolls, or null for the page itself.
export function scrollRootOf(el, style = globalThis.getComputedStyle) {
  if (typeof style !== 'function') return null;
  for (let n = el?.parentElement; n; n = n.parentElement) {
    const s = style(n);
    if (s && /(auto|scroll|overlay)/.test(String(s.overflowY))) return n;
  }
  return null;
}

// Whether an element shows on screen at this moment, read from the layout as it is now: a box of some size inside the
// window and inside the scrolled view it sits in, edges touching counted as the observers count them. Null where there
// is no layout to read or the element draws no box, so the observers' word stands.
export function showsNow(el, view, win = globalThis) {
  if (typeof el?.getBoundingClientRect !== 'function' || !(win?.innerHeight > 0)) return null;
  const b = el.getBoundingClientRect();
  if (!(b.width > 0 && b.height > 0)) return null;
  const area = { top: 0, left: 0, bottom: win.innerHeight, right: win.innerWidth > 0 ? win.innerWidth : Infinity };
  if (typeof view?.getBoundingClientRect === 'function') {
    const r = view.getBoundingClientRect();
    area.top = Math.max(area.top, r.top);
    area.left = Math.max(area.left, r.left);
    area.bottom = Math.min(area.bottom, r.bottom);
    area.right = Math.min(area.right, r.right);
  }
  return b.bottom >= area.top && b.top <= area.bottom && b.right >= area.left && b.left <= area.right;
}

export function createLoadQueue({ Observer = globalThis.IntersectionObserver, limit = LOAD_LIMIT, near = NEAR_MARGIN, rootOf = scrollRootOf, shows = showsNow } = {}) {
  const items = new Map();
  // Each scrolled view in use: its observer for what is within a screen of it, how many elements use it, and whether
  // the view itself is on screen.
  const roots = new Map();
  let seq = 0;
  // Until the screen's own observer has reported an element it is 'unknown': the observers report one after another,
  // and what is a screen away must never start in the gap before the screen has said what is on it.
  const placeOf = (item) => {
    if (item.seen === null) return 'unknown';
    if (item.seen) return 'seen';
    const root = item.root ? roots.get(item.root) : null;
    return item.near && (!item.root || root?.seen) ? 'near' : 'away';
  };

  const screenEntries = (entries) => {
    for (const e of entries) {
      const root = roots.get(e.target);
      if (root) root.seen = e.isIntersecting;
      const item = items.get(e.target);
      if (!item) continue;
      if (e.isIntersecting && !item.seen) item.order = seq += 1;
      item.seen = e.isIntersecting;
      item.doubted = null;
    }
  };
  const nearEntries = (entries) => {
    for (const e of entries) {
      const item = items.get(e.target);
      if (!item) continue;
      if (e.isIntersecting && !item.seen && !item.near) item.order = seq += 1;
      item.near = e.isIntersecting;
    }
  };
  const onScreen = typeof Observer === 'function'
    ? new Observer((entries) => {
      screenEntries(entries);
      pump();
    })
    : null;
  const onNear = (entries) => {
    nearEntries(entries);
    pump();
  };
  // What the browser has measured and not yet reported, taken before a plan so it is made from the latest layout.
  const takeRecords = () => {
    if (typeof onScreen?.takeRecords === 'function') screenEntries(onScreen.takeRecords());
    for (const root of roots.values()) if (typeof root.near.takeRecords === 'function') nearEntries(root.near.takeRecords());
  };
  // A picture that lands moves the page under every row, and the observers report that only after the browser has laid
  // it out. A load that finishes therefore starts only what is already known to be on screen; what is a screen away
  // waits for the page to be laid out again, so it never takes a slot from a row the landing just brought on screen.
  const nextFrame = typeof globalThis.requestAnimationFrame === 'function'
    ? (fn) => globalThis.requestAnimationFrame(() => setTimeout(fn, 0))
    : (fn) => setTimeout(fn, 0);
  let laidOut = false;
  let layouts = 0;
  const afterLayout = () => {
    if (laidOut) return;
    laidOut = true;
    nextFrame(() => {
      laidOut = false;
      layouts += 1;
      pump();
    });
  };
  // A row the observers last reported on screen may have been pushed off it since, by a picture landing above it, and
  // they report that only after the next layout. So a load is started only for a row that shows on screen now; one the
  // layout says has left is doubted, which makes it unknown until the observers report again: it starts nothing and
  // holds back what is a screen away. A doubt lasts one layout, so where the observers and the layout keep disagreeing
  // the observers' word stands rather than holding the queue.
  const doubts = (item) => (item.doubted ?? layouts) === layouts && shows(item.el, item.root) === false;

  function rootFor(view) {
    let root = roots.get(view);
    if (!root) {
      root = { users: 0, seen: false, near: new Observer(onNear, { root: view, rootMargin: near }) };
      roots.set(view, root);
      if (view) onScreen.observe(view);
    }
    root.users += 1;
    return root;
  }

  function leave(item) {
    if (items.get(item.el) !== item) return;
    items.delete(item.el);
    onScreen?.unobserve(item.el);
    const root = roots.get(item.root);
    if (!root) return;
    root.near.unobserve(item.el);
    root.users -= 1;
    if (root.users > 0) return;
    root.near.disconnect();
    roots.delete(item.root);
    if (item.root && !items.has(item.root)) onScreen.unobserve(item.root);
  }

  async function run(item) {
    const controller = new AbortController();
    item.controller = controller;
    try {
      await item.task(controller.signal);
    } catch {
      // The task owns its own failure; the queue only frees the slot.
    }
    if (item.controller !== controller) return;
    item.controller = null;
    if (!controller.signal.aborted) leave(item);
    pump({ onScreenOnly: true });
    afterLayout();
  }

  function pump({ onScreenOnly = false } = {}) {
    takeRecords();
    const list = [...items.values()];
    const doubted = new Set();
    let plan;
    for (;;) {
      plan = planLoads(list.map((item) => ({ item, place: doubted.has(item) ? 'unknown' : placeOf(item), order: item.order, running: Boolean(item.controller) })), { limit });
      const left = plan.start.filter((load) => load.place === 'seen' && doubts(load.item));
      if (!left.length) break;
      for (const { item } of left) {
        item.doubted ??= layouts;
        doubted.add(item);
      }
    }
    if (doubted.size) afterLayout();
    for (const { item } of plan.cancel) {
      const c = item.controller;
      item.controller = null;
      c.abort();
    }
    for (const load of plan.start) if (!onScreenOnly || load.place === 'seen') run(load.item);
    if (plan.cancel.length) pump({ onScreenOnly });
  }

  return {
    request(el, task) {
      const old = items.get(el);
      if (old) {
        old.controller?.abort();
        leave(old);
      }
      const item = { el, task, root: null, seen: null, near: false, order: 0, controller: null, doubted: null };
      const ticket = {
        cancel() {
          const c = item.controller;
          item.controller = null;
          leave(item);
          if (c) {
            c.abort();
            pump();
          }
        },
      };
      if (!onScreen) {
        try {
          task(new AbortController().signal)?.catch?.(() => {});
        } catch {
          // The task owns its own failure.
        }
        return ticket;
      }
      item.root = rootOf(el) || null;
      items.set(el, item);
      const root = rootFor(item.root);
      onScreen.observe(el);
      root.near.observe(el);
      return ticket;
    },
    // What the queue holds now, for a test or a fixture: each element's place and whether its load is in flight.
    state: () => [...items.values()].map((item) => ({ el: item.el, place: placeOf(item), running: Boolean(item.controller) })),
  };
}

let shared = null;
// The page's one queue, made the first time something asks for it.
export function loadQueue() {
  shared ??= createLoadQueue();
  return shared;
}
