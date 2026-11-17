import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers.js';
import { createApiClient } from '../../core/kit/api.js';
import { validate } from '../../core/kit/rules/schema.js';
import { apiSpec } from '../src/paths.js';

test('history cursors cross tied timestamp pages in both directions without gaps or duplicates', async (t) => {
  const server = await boot();
  t.after(() => server.close());
  const client = createApiClient({ baseUrl: server.base, token: server.tokens.device });
  // Declare synthetic rows directly in the fixture, not through the pagination code under test.
  server.world.messages.splice(0, server.world.messages.length, ...Array.from({ length: 137 }, (_, index) => ({
    id: index + 1, guid: 'SYNTHETIC-' + (index + 1), chat_id: 1, created_at: '2026-01-01T00:00:00.000Z',
    text: 'Synthetic tied message', is_from_me: false, sender: 'avery@example.com', attachments: [],
  })));
  let cursor;
  let more = true;
  const ids = [];
  while (more) {
    assert.ok(ids.length <= 137, 'cursor must advance');
    const page = await client.messages('1', { limit: 7, beforeCursor: cursor });
    assert.deepEqual(validate(page, 'MessageList', apiSpec.models), []);
    ids.push(...page.messages.toReversed().map((m) => m.id));
    more = page.hasMore;
    cursor = page.nextCursor;
  }
  assert.deepEqual(ids, Array.from({ length: 137 }, (_, i) => 'SYNTHETIC-' + (137 - i)));
  const newer = await client.messages('1', { limit: 7, afterCursor: cursor });
  assert.deepEqual(newer.messages.map((m) => m.id), Array.from({ length: 7 }, (_, i) => 'SYNTHETIC-' + (i + 2)));
});

test('the changes lane hands over rows with the same history cursor as a history page', async (t) => {
  const server = await boot();
  t.after(() => server.close());
  const client = createApiClient({ baseUrl: server.base, token: server.tokens.device });
  const rows = Array.from({ length: 137 }, (_, index) => ({
    id: index + 1, guid: 'SYNTHETIC-' + (index + 1), chat_id: 1, created_at: '2026-01-01T00:00:00.000Z',
    text: 'Synthetic tied message', is_from_me: false, sender: 'avery@example.com', attachments: [],
  }));
  server.world.replaceMessages(rows);
  const head = await client.changes();
  // Replacing the rows moves the change cursor with them, so a catch-up is handed nothing that was never a change.
  const caught = await client.changes({ since: head.cursor });
  assert.deepEqual(caught.messages, []);
  // A row that really arrives carries the cursor a history page uses, so a message learned from this lane can be
  // browsed past rather than stopping the conversation at the newest page it reached.
  const fresh = server.world.incoming(1, 'Synthetic arrival');
  const next = await client.changes({ since: head.cursor });
  const one = next.messages.find((m) => m.id === fresh.guid);
  assert.ok(one, 'the new message arrives as a change');
  assert.equal(typeof one.historyCursor, 'string');
  assert.deepEqual(validate(one, 'Message', apiSpec.models), []);
});

test('media paging continues through empty pages and never relies on loaded UI messages', async (t) => {
  const server = await boot();
  t.after(() => server.close());
  const client = createApiClient({ baseUrl: server.base, token: server.tokens.device });
  const all = await client.messages('1', { limit: 200 });
  const expected = all.messages.toReversed().flatMap((m) => m.attachments.filter((a) => !a.missing && !a.sticker && /^(image|video)\//.test(a.mime)).map((a) => a.id));
  let cursor;
  let more = true;
  let calls = 0;
  let emptyWithContinuation = false;
  const found = [];
  while (more) {
    assert.ok(calls++ < 100, 'media cursor must advance');
    const page = await client.media('1', { limit: 1, beforeCursor: cursor });
    assert.deepEqual(validate(page, 'MediaList', apiSpec.models), []);
    if (!page.items.length && page.hasMore) emptyWithContinuation = true;
    found.push(...page.items.map((m) => m.id));
    cursor = page.nextCursor;
    more = page.hasMore;
  }
  assert.ok(expected.length > 0);
  assert.ok(emptyWithContinuation);
  assert.deepEqual(found, expected);
});

test('cursor routes reject malformed, overflowing and contradictory bounds', async (t) => {
  const server = await boot();
  t.after(() => server.close());
  for (const endpoint of ['messages', 'media']) {
    for (const query of ['beforeCursor=no', 'afterCursor=1:0', 'beforeCursor=9223372036854775808:1', 'beforeCursor=1:1&afterCursor=1:2']) {
      const response = await server.get('/api/v1/chats/1/' + endpoint + '?' + query, server.tokens.device);
      assert.equal(response.status, 400);
    }
  }
});

// Issue 537: a message that reached the client by the live stream carried no history cursor, because imsg puts one only on
// a history page, so a window that ended on it could not page newer and showed the old-engine banner.
test('a live message carries the same history cursor a history page gives it (issue 537)', async (t) => {
  const server = await boot();
  t.after(() => server.close());
  const client = createApiClient({ baseUrl: server.base, token: server.tokens.device });
  const live = new Promise((resolve) => server.engine.on((name, data) => { if (name === 'message.new' && data.message.text === 'Synthetic live cursor') resolve(data.message); }));
  server.world.incoming(1, 'Synthetic live cursor');
  const message = await live;
  assert.match(String(message.historyCursor), /^-?\d+:\d+$/, 'the live message carries a history cursor');
  const page = await client.messages('1', { limit: 5 });
  const same = page.messages.find((m) => m.id === message.id);
  assert.equal(message.historyCursor, same.historyCursor, 'the same cursor a history page gives the same row');
});

// Issue 537: an engine older than history cursors pages by none, so the server gives its rows none from the store either,
// and its client says to update the engine rather than holding a cursor the engine would ignore.
test('an engine that does not page by cursor is given none from the store (issue 537)', async (t) => {
  const server = await boot();
  t.after(() => server.close());
  server.world.behavior.historyCursors = false;
  await server.engine.start({ force: true });
  const client = createApiClient({ baseUrl: server.base, token: server.tokens.device });
  const live = new Promise((resolve) => server.engine.on((name, data) => { if (name === 'message.new' && data.message.text === 'Synthetic old engine') resolve(data.message); }));
  server.world.incoming(1, 'Synthetic old engine');
  const message = await live;
  assert.equal(message.historyCursor ?? null, null, 'no cursor on the live message');
  const page = await client.messages('1', { limit: 5 });
  assert.ok(page.messages.length && page.messages.every((m) => (m.historyCursor ?? null) === null), 'none on a history page either');
});
