// What changed since a cursor (issue 441): a client that kept its messages asks the server only for what changed after
// the mark it holds, rather than reading whole pages again. The marks are the Messages store's own (new rows, edits,
// unsends and read receipts), so a change made while no client was connected, or while the server was down, still
// reaches the next client that asks, and a cursor the server cannot honour is answered with reset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers.js';
import { apiSpec } from '../src/paths.js';
import { validate } from '../../core/kit/rules/schema.js';

const conforms = (v, type) => assert.deepEqual(validate(v, type, apiSpec.models), []);
const changes = async (s, query = '') => {
  const r = await s.get('/api/v1/changes' + query, s.tokens.device);
  const body = await r.json();
  return { status: r.status, body };
};

test('a client asking with its old cursor gets every change made since: new messages, reactions, edits, unsends and read receipts', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  // A client with nothing held asks for the head: no history, only the mark to start from.
  const head = await changes(s);
  assert.equal(head.status, 200);
  conforms(head.body, 'ChangeList');
  assert.equal(head.body.reset, true, 'a client with no cursor starts from the head');
  assert.deepEqual([head.body.messages, head.body.reactions, head.body.unsent, head.body.reads], [[], [], [], []]);

  // Then, with no client connected, the Messages store changes in every way a conversation can.
  const fresh = s.world.incoming(1, 'Synthetic arrival while away');
  s.world.react(1, 'FAKE-0013', 'like', '+15555550100');
  s.world.editElsewhere('FAKE-0008', 'Synthetic edited words');
  s.world.unsendElsewhere('FAKE-0010');
  s.world.readByRecipient('FAKE-0012');

  const next = await changes(s, '?since=' + encodeURIComponent(head.body.cursor));
  assert.equal(next.status, 200);
  conforms(next.body, 'ChangeList');
  assert.equal(next.body.reset, undefined);
  assert.equal(next.body.more, false);
  const byId = new Map(next.body.messages.map((m) => [m.id, m]));
  assert.equal(byId.get(fresh.guid)?.text, 'Synthetic arrival while away', 'the new message arrives whole');
  assert.equal(byId.get('FAKE-0008')?.text, 'Synthetic edited words', 'the edit arrives with its new words');
  assert.equal(byId.get('FAKE-0008')?.edited, true, 'and the mark');
  assert.deepEqual(next.body.reactions.map((r) => [r.chatId, r.targetId, r.type, r.add]), [['1', 'FAKE-0013', 'like', true]]);
  assert.deepEqual(next.body.unsent, [{ id: 'FAKE-0010', chatId: '1' }]);
  assert.deepEqual(next.body.reads.map((r) => [r.id, r.chatId]), [['FAKE-0012', '1']]);
  assert.ok(Number.isFinite(Date.parse(next.body.reads[0].readAt)));
  assert.equal(byId.has('FAKE-0010'), false, 'an unsent message is never served as a message');
  assert.notEqual(next.body.cursor, head.body.cursor);

  // Nothing changed since: the answer is empty and the cursor holds.
  const quiet = await changes(s, '?since=' + encodeURIComponent(next.body.cursor));
  assert.deepEqual([quiet.body.messages, quiet.body.reactions, quiet.body.unsent, quiet.body.reads, quiet.body.more], [[], [], [], [], false]);
  assert.equal(quiet.body.cursor, next.body.cursor);
});

test('changes come in bounded pages, and a client that follows more reads every one exactly once', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const { body: head } = await changes(s);
  const sent = [];
  for (let i = 0; i < 5; i += 1) sent.push(s.world.incoming(2, 'Synthetic page ' + i, 'jordan@example.com').guid);
  const got = [];
  let cursor = head.cursor;
  for (let pass = 0; pass < 10; pass += 1) {
    const { body } = await changes(s, '?limit=2&since=' + encodeURIComponent(cursor));
    got.push(...body.messages.map((m) => m.id));
    cursor = body.cursor;
    if (!body.more) break;
  }
  assert.deepEqual(got, sent);
});

test('a client can ask only about the conversations it holds', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const { body: head } = await changes(s);
  s.world.incoming(1, 'Synthetic for one');
  const other = s.world.incoming(2, 'Synthetic for two', 'jordan@example.com');
  s.world.unsendElsewhere('FAKE-0011');
  const { body } = await changes(s, '?chats=2&since=' + encodeURIComponent(head.cursor));
  assert.deepEqual(body.messages.map((m) => m.id), [other.guid]);
  assert.deepEqual(body.unsent, [], 'an unsend in a conversation not asked about is left out');
});

test('a cursor the server cannot honour answers reset, and one that is not a cursor is refused', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const { body: head } = await changes(s);
  // A cursor past anything this store holds names a different store (a new Mac, a rebuilt history): start again.
  const ahead = head.cursor.replace(/^v1\.\d+/, 'v1.99999999');
  const r = await changes(s, '?since=' + encodeURIComponent(ahead));
  assert.equal(r.status, 200);
  assert.equal(r.body.reset, true);
  assert.equal(r.body.cursor, head.cursor);
  const bad = await changes(s, '?since=not-a-cursor');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'bad_cursor');
});
