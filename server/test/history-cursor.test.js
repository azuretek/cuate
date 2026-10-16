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
