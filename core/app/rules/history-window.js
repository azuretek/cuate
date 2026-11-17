import { mergeMessages } from './messages.js';

// Three server pages: the visible page and one overscan page each way. Outside those pages
// only counts and aggregate heights survive, never message objects or a per-message height map.
export const HISTORY_PAGE_SIZE = 50;
export const HISTORY_MAX_MESSAGES = HISTORY_PAGE_SIZE * 3;
export const HISTORY_CACHED_CHATS = 3;

// How many loaded messages the reader is kept from either edge of the window, so the next page is asked for while they
// are still about a page away and is in the window before they reach it. A page is fifty messages, but the window holds
// three, so the lead leaves room for what is on screen and for the page that lands: once an older page lands and the
// newest one is evicted, what is left below the screen is still at least the lead, so landing a page never asks for
// the other side and the window never swings back and forth. Counted in messages, never pixels, so a picture or a text
// size cannot change it.
export function historyLead(visibleRows = 0) {
  const room = Math.floor((HISTORY_MAX_MESSAGES - HISTORY_PAGE_SIZE - Math.max(0, visibleRows)) / 2);
  return Math.max(1, Math.min(HISTORY_PAGE_SIZE, room));
}

// The page to ask for next, given where the reader is in the window: rowsAbove and rowsBelow are the loaded messages
// wholly above and below the screen, visibleRows those on it, and asking the directions already being asked for, each of
// which is asked for at most once at a time. A side with more history and fewer loaded messages than the lead is short;
// when both are, the nearer edge goes first. null when the reader has a lead both ways.
export function prefetchDirection(state, { rowsAbove = 0, rowsBelow = 0, visibleRows = 0, asking = [] } = {}) {
  if (!state) return null;
  const lead = historyLead(visibleRows);
  const older = Boolean(state.hasOlder) && rowsAbove < lead && !asking.includes('older');
  const newer = Boolean(state.hasNewer) && rowsBelow < lead && !asking.includes('newer');
  if (older && newer) return rowsAbove <= rowsBelow ? 'older' : 'newer';
  return older ? 'older' : newer ? 'newer' : null;
}

export function initialWindow(messages, { totalCount = messages.length, hasMore = false, estimate = 1 } = {}) {
  const held = messages.slice(-HISTORY_MAX_MESSAGES);
  const beforeCount = Math.max(hasMore ? HISTORY_PAGE_SIZE : 0, totalCount - held.length);
  return { messages: held, beforeCount, afterCount: 0, beforeHeight: beforeCount * estimate, afterHeight: 0, estimate, hasOlder: hasMore, hasNewer: false };
}

// The live messages counted past the newer edge (id to the order each was counted in) after a newer page lands (issue
// 537). One the window now holds is no longer counted, and so is one counted before the page was asked (`since`), which
// the server already had when it answered. One counted while the page was on its way is still to come: the page may have
// answered that nothing is newer, so the window keeps Load newer, counting it, until a page brings it.
export function keepCounted(state, counted, since = 0) {
  const held = new Set(state.messages.map((m) => m.id));
  const left = new Map([...counted].filter(([id, n]) => n > since && !held.has(id)));
  if (!left.size || (state.hasNewer && state.afterCount >= left.size)) return { state, counted: left };
  const afterCount = Math.max(state.afterCount, left.size);
  return { state: { ...state, hasNewer: true, afterCount, afterHeight: state.afterHeight + (afterCount - state.afterCount) * state.estimate }, counted: left };
}

export function shiftWindow(state, incoming, { direction, hasMore, heights = [] } = {}) {
  const measured = new Map(heights);
  const ids = new Set(state.messages.map((m) => m.id));
  const added = incoming.filter((m) => !ids.has(m.id)).length;
  const next = { ...state, messages: mergeMessages(state.messages, incoming) };
  const side = direction === 'older' ? 'before' : 'after';
  const oldCount = state[side + 'Count'];
  next[side + 'Count'] = Math.max(0, oldCount - added);
  next[side + 'Height'] = oldCount ? state[side + 'Height'] * next[side + 'Count'] / oldCount : 0;
  if (hasMore !== undefined) {
    next[direction === 'older' ? 'hasOlder' : 'hasNewer'] = hasMore;
    if (!hasMore) { next[side + 'Count'] = 0; next[side + 'Height'] = 0; }
    else if (!next[side + 'Count']) { next[side + 'Count'] = HISTORY_PAGE_SIZE; next[side + 'Height'] = HISTORY_PAGE_SIZE * state.estimate; }
  }
  const excess = Math.max(0, next.messages.length - HISTORY_MAX_MESSAGES);
  if (excess) {
    const removed = direction === 'older' ? next.messages.splice(-excess) : next.messages.splice(0, excess);
    const opposite = direction === 'older' ? 'after' : 'before';
    next[opposite + 'Count'] += removed.length;
    next[opposite + 'Height'] += removed.reduce((sum, m) => sum + (measured.get(m.id) || state.estimate), 0);
    next[direction === 'older' ? 'hasNewer' : 'hasOlder'] = true;
  }
  return next;
}
