import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MediaPages } from '../app/media-pages.js';

const item = (id) => ({ id: String(id), historyCursor: '1:' + id });
const number = (cursor) => Number(cursor.split(':')[1]);

test('viewer metadata crosses history pages both ways and evicts distant pages', async () => {
  const calls = [];
  const client = { async media(chat, options) {
    calls.push(options);
    const older = Boolean(options.beforeCursor);
    const at = number(options.beforeCursor || options.afterCursor);
    const ids = older ? [at - 1, at - 2, at - 3] : [at + 1, at + 2, at + 3];
    const valid = ids.filter((id) => id >= 1 && id <= 1000);
    const items = valid.map(item).sort((a, b) => Number(b.id) - Number(a.id));
    return { items, nextCursor: valid.length ? '1:' + valid.at(-1) : null, hasMore: valid.length === 3 };
  } };
  const pages = new MediaPages({ client, chatId: '1', items: [item(500)], beforeCursor: '1:500', afterCursor: '1:500' });
  let selected = '500';
  while (Number(selected) > 350) {
    await pages.extend('prev', selected);
    const list = pages.items;
    const at = list.findIndex((entry) => entry.id === selected);
    assert.ok(at > 0);
    selected = list[at - 1].id;
    assert.ok(pages.pages.length <= 5);
    assert.ok(list.length <= 15);
  }
  const backwards = selected;
  while (Number(selected) < 550) {
    const list = pages.items;
    const at = list.findIndex((entry) => entry.id === selected);
    if (at === list.length - 1) await pages.extend('next', selected);
    const next = pages.items;
    selected = next[next.findIndex((entry) => entry.id === selected) + 1].id;
    assert.ok(pages.pages.length <= 5);
    assert.ok(next.length <= 15);
  }
  assert.equal(backwards, '350');
  assert.equal(selected, '550');
  assert.ok(calls.some((call) => call.afterCursor));
});

test('empty media pages continue, duplicate requests join, and closing ignores late pages', async () => {
  let resolve;
  let calls = 0;
  const client = { media: async () => { calls++; return new Promise((done) => { resolve = done; }); } };
  const pages = new MediaPages({ client, chatId: '1', items: [item(10)], beforeCursor: '1:10' });
  const a = pages.extend('prev', '10');
  const b = pages.extend('prev', '10');
  assert.equal(calls, 1);
  pages.close();
  resolve({ items: [item(9)], nextCursor: '1:9', hasMore: true });
  await Promise.all([a, b]);
  assert.deepEqual(pages.items, []);

  const sparse = new MediaPages({ client: { async media(chat, options) {
    const id = number(options.beforeCursor);
    return { items: id === 2 ? [item(1)] : [], nextCursor: '1:' + (id - 1), hasMore: id > 2 };
  } }, chatId: '1', items: [item(5)], beforeCursor: '1:5' });
  await sparse.extend('prev', '5');
  assert.deepEqual(sparse.items.map((entry) => entry.id), ['1', '5']);
});


test('the same attachment in two messages remains two browsable occurrences', async () => {
  const first = { id: 'shared-file', attachmentId: 'shared-file', messageId: 'message-1', historyCursor: '1:1' };
  const second = { ...first, messageId: 'message-2', historyCursor: '1:2' };
  const pages = new MediaPages({ client: { media: async () => ({ items: [second], nextCursor: '1:2', hasMore: false }) }, chatId: '1', items: [first], beforeCursor: '1:1', afterCursor: '1:1' });
  await pages.extend('next', pages.items[0].id);
  assert.deepEqual(pages.items.map((entry) => entry.messageId), ['message-1', 'message-2']);
  assert.equal(new Set(pages.items.map((entry) => entry.id)).size, 2);
});
