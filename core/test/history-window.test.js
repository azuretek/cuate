import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialWindow, shiftWindow, HISTORY_MAX_MESSAGES } from '../app/rules/history-window.js';
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
