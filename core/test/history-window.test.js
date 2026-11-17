import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialWindow, shiftWindow, historyLead, prefetchDirection, HISTORY_MAX_MESSAGES, HISTORY_PAGE_SIZE } from '../app/rules/history-window.js';
import { anchorFrom, scrollFor } from '../kit/rules/scroll.js';

const message = (index) => ({ id: 'm' + index, historyCursor: '800000000000000000:' + (index + 1), sentAt: '2026-01-01T00:00:00.000Z', text: 'Synthetic message ' + index });
const page = (start, size = 50) => Array.from({ length: size }, (_, i) => message(start + i));

test('a hundred-thousand-message history retains only three pages and scalar spacer metadata', () => {
  const total = 100000;
  let state = initialWindow(page(total - 50), { totalCount: total, hasMore: true, estimate: 80 });
  let oldest = total - 50;
  let largest = 0;
  while (oldest > 0) {
    oldest -= 50;
    state = shiftWindow(state, page(oldest), { direction: 'older', hasMore: oldest > 0 });
    assert.ok(state.messages.length <= HISTORY_MAX_MESSAGES);
    assert.equal(state.beforeCount + state.messages.length + state.afterCount, total);
    assert.equal(Object.keys(state).length, 8, 'no growing per-message metadata table');
    largest = Math.max(largest, JSON.stringify(state).length);
  }
  assert.equal(state.messages[0].id, 'm0');
  assert.ok(largest < HISTORY_MAX_MESSAGES * 250, 'retained serialized state has a fixed byte bound');
  let newest = 149;
  while (newest < total - 1) {
    state = shiftWindow(state, page(newest + 1), { direction: 'newer', hasMore: newest + 50 < total - 1 });
    newest += 50;
    assert.equal(state.messages.length, HISTORY_MAX_MESSAGES);
    assert.equal(state.beforeCount + state.messages.length + state.afterCount, total);
  }
  assert.equal(state.messages.at(-1).id, 'm99999');
  assert.equal(state.afterHeight, 0);
});

test('measured eviction and replacement preserve the same scroll anchor', () => {
  let state = initialWindow(page(200, 150), { totalCount: 350, hasMore: true, estimate: 80 });
  const measure = (window, top) => {
    let y = window.beforeHeight - top;
    const items = window.messages.map((m) => { const height = 60 + Number(m.id.slice(1)) % 3 * 20; const row = { key: m.id, top: y, bottom: y + height }; y += height; return row; });
    return { items, scrollTop: top, clientHeight: 400, scrollHeight: y + top + window.afterHeight };
  };
  const before = measure(state, state.beforeHeight + 100);
  const anchor = anchorFrom(before);
  const heights = before.items.map((row) => [row.key, row.bottom - row.top]);
  state = shiftWindow(state, page(150), { direction: 'older', hasMore: true, heights });
  assert.ok(state.afterHeight > 0);
  const proposed = measure(state, before.scrollTop);
  const top = scrollFor(anchor, proposed);
  const actual = measure(state, top).items.find((row) => row.key === anchor.key);
  assert.equal(actual.top, anchor.offset);
  assert.equal(state.messages.length, HISTORY_MAX_MESSAGES);
});

test('the next page each way is asked for while the reader is still about a page from that edge', () => {
  const lead = historyLead(12);
  assert.ok(lead >= 40 && lead <= HISTORY_PAGE_SIZE, 'about a page of messages: ' + lead);
  const middle = { hasOlder: true, hasNewer: true };
  // A page and more loaded beyond the screen both ways: nothing is asked for.
  assert.equal(prefetchDirection(middle, { rowsAbove: 60, rowsBelow: 78, visibleRows: 12 }), null);
  // Fewer than the lead above: the older page, long before the top is reached.
  assert.equal(prefetchDirection(middle, { rowsAbove: lead - 1, rowsBelow: 150 - 12 - lead + 1, visibleRows: 12 }), 'older');
  assert.equal(prefetchDirection(middle, { rowsAbove: lead, rowsBelow: 150 - 12 - lead, visibleRows: 12 }), null);
  // The same below, which is how the newer pages evicted on the way up come back on the way down.
  assert.equal(prefetchDirection(middle, { rowsAbove: 150 - 12 - lead + 1, rowsBelow: lead - 1, visibleRows: 12 }), 'newer');
  // No more history that way, nothing to ask for, however near the edge.
  assert.equal(prefetchDirection({ hasOlder: false, hasNewer: false }, { rowsAbove: 0, rowsBelow: 0, visibleRows: 12 }), null);
  assert.equal(prefetchDirection(null, { rowsAbove: 0 }), null);
});

test('each direction has one page on its way at a time, and the nearer edge goes first', () => {
  const state = { hasOlder: true, hasNewer: true };
  const near = { rowsAbove: 5, rowsBelow: 20, visibleRows: 12 };
  assert.equal(prefetchDirection(state, near), 'older');
  assert.equal(prefetchDirection(state, { ...near, asking: ['older'] }), 'newer');
  assert.equal(prefetchDirection(state, { ...near, asking: ['older', 'newer'] }), null);
  assert.equal(prefetchDirection(state, { rowsAbove: 20, rowsBelow: 5, visibleRows: 12 }), 'newer');
});

test('a page that lands never makes the other side short, so the window never swings back', () => {
  // Walk a full window up and down through every place a screen of each size can sit, landing each page asked for
  // the way shiftWindow does (fifty in, fifty evicted from the other side), and check the other side is not then short.
  for (const visibleRows of [1, 6, 12, 25, 40]) {
    const lead = historyLead(visibleRows);
    for (let rowsAbove = 0; rowsAbove + visibleRows <= HISTORY_MAX_MESSAGES; rowsAbove += 1) {
      const rowsBelow = HISTORY_MAX_MESSAGES - visibleRows - rowsAbove;
      const state = { hasOlder: true, hasNewer: true };
      const direction = prefetchDirection(state, { rowsAbove, rowsBelow, visibleRows });
      if (!direction) continue;
      const landed = direction === 'older'
        ? { rowsAbove: rowsAbove + HISTORY_PAGE_SIZE, rowsBelow: rowsBelow - HISTORY_PAGE_SIZE }
        : { rowsAbove: rowsAbove - HISTORY_PAGE_SIZE, rowsBelow: rowsBelow + HISTORY_PAGE_SIZE };
      const other = direction === 'older' ? 'newer' : 'older';
      assert.notEqual(prefetchDirection(state, { ...landed, visibleRows }), other, JSON.stringify({ visibleRows, lead, rowsAbove, direction, landed }));
    }
  }
});

test('walking a long history up and back down by the rule keeps a lead, reloads the evicted pages and holds the cap', () => {
  // A reader moving one message at a time through ten thousand messages, with each page landing only once the reader has
  // moved another screen: the rule asks early enough that the message coming into view is always already loaded.
  const total = 10000;
  const visibleRows = 12;
  const screen = visibleRows;
  let state = initialWindow(page(total - 50), { totalCount: total, hasMore: true, estimate: 80 });
  let top = state.messages.length - visibleRows;
  const index = (id) => Number(id.slice(1));
  let inFlight = null;
  let asked = 0;
  const step = (delta) => {
    const firstIndex = index(state.messages[0].id);
    top += delta;
    const rowsAbove = top;
    const rowsBelow = state.messages.length - visibleRows - top;
    assert.ok(rowsAbove >= 0 && rowsBelow >= 0, 'the message coming into view was loaded before it was needed ' + JSON.stringify({ top, firstIndex }));
    if (inFlight && (inFlight.due -= Math.abs(delta)) <= 0) {
      const { direction } = inFlight;
      inFlight = null;
      const edge = direction === 'older' ? index(state.messages[0].id) : index(state.messages.at(-1).id);
      const from = direction === 'older' ? Math.max(0, edge - 50) : edge + 1;
      const to = direction === 'older' ? edge : Math.min(total, edge + 51);
      const incoming = page(from, to - from);
      const hasMore = direction === 'older' ? from > 0 : to < total;
      const before = state.messages[0].id;
      state = shiftWindow(state, incoming, { direction, hasMore });
      top += index(before) - index(state.messages[0].id);
      assert.ok(state.messages.length <= HISTORY_MAX_MESSAGES, 'cap holds');
    }
    if (!inFlight) {
      const direction = prefetchDirection(state, { rowsAbove: top, rowsBelow: state.messages.length - visibleRows - top, visibleRows });
      if (direction) { inFlight = { direction, due: screen }; asked += 1; }
    }
  };
  let guard = 0;
  while (index(state.messages[0].id) + top > 2000 && guard++ < 100000) step(-1);
  assert.ok(state.afterCount > 0, 'newer pages were evicted on the way up');
  while ((state.hasNewer || top + visibleRows < state.messages.length) && guard++ < 200000) step(1);
  assert.equal(state.messages.at(-1).id, 'm' + (total - 1));
  assert.equal(state.afterCount, 0);
  assert.ok(asked >= 2 * Math.floor((total - 2000) / 50) - 4, 'one page asked per page walked each way: ' + asked);
});
