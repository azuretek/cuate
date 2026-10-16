import { mergeMessages } from './messages.js';

// Three server pages: the visible page and one overscan page each way. Outside those pages
// only counts and aggregate heights survive, never message objects or a per-message height map.
export const HISTORY_PAGE_SIZE = 50;
export const HISTORY_MAX_MESSAGES = HISTORY_PAGE_SIZE * 3;
export const HISTORY_CACHED_CHATS = 3;

export function initialWindow(messages, { totalCount = messages.length, hasMore = false, estimate = 1 } = {}) {
  const held = messages.slice(-HISTORY_MAX_MESSAGES);
  const beforeCount = Math.max(hasMore ? HISTORY_PAGE_SIZE : 0, totalCount - held.length);
  return { messages: held, beforeCount, afterCount: 0, beforeHeight: beforeCount * estimate, afterHeight: 0, estimate, hasOlder: hasMore, hasNewer: false };
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
