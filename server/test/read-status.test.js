import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../src/engine/index.js';
import { deliveryLabel } from '../../core/app/rules/messages.js';

const at = '2026-01-15T11:00:00.000Z';
function fixture({ supported = true, result = {}, error = null } = {}) {
  let receive;
  const calls = [];
  const rows = [
    { id: 1, guid: 'incoming', chat_id: 1, is_from_me: false, is_read: true, date_read: at },
    { id: 2, guid: 'outgoing', chat_id: 1, is_from_me: true },
  ].map((m) => ({ ...m, created_at: m.id === 1 ? '2026-01-15T09:00:00Z' : '2026-01-15T10:00:00Z', text: 'Hello' }));
  const transport = {
    onLine(cb) { receive = cb; }, onExit() {}, close() {},
    write(line) {
      const req = JSON.parse(line);
      calls.push(req);
      let value = {};
      if (req.method === 'status') value = { database: { ready: true }, methods: supported ? ['message.send_status'] : [] };
      if (req.method === 'messages.history') value = { messages: rows };
      if (req.method === 'message.send_status') value = { ok: true, guid: req.params.guid, ...result };
      receive(JSON.stringify({ id: req.id, ...(error && req.method === 'message.send_status' ? { error } : { result: value }) }));
    },
  };
  return { calls, engine: createEngine({ kind: 'fake', makeTransport: () => transport, log: { emit() {} }, attachmentId: () => 'a' }) };
}

test('history reads an outgoing receipt from its exact GUID, never inbound read state', async () => {
  const f = fixture({ result: { status_fields: { date_read: at } } });
  await f.engine.start();
  try {
    const { messages } = await f.engine.messages('1');
    assert.equal(messages[0].readAt ?? null, null);
    assert.equal(messages[1].readAt, at);
    assert.deepEqual(f.calls.filter((r) => r.method === 'message.send_status').map((r) => r.params), [{ guid: 'outgoing' }]);
    assert.equal(deliveryLabel(messages[1]), 'Read ' + at);
  } finally { await f.engine.stop(); }
});

test('unsupported status is not polled and never becomes read', async () => {
  const f = fixture({ supported: false });
  await f.engine.start();
  try {
    const { messages } = await f.engine.messages('1');
    assert.equal(messages[1].readAt ?? null, null);
    assert.equal(f.calls.some((r) => r.method === 'message.send_status'), false);
  } finally { await f.engine.stop(); }
});

for (const result of [{}, { status_fields: { date_read: '2020-01-01T00:00:00Z' } }, { status_fields: null }, { status_fields: { date_read: 'invalid' } }, { guid: 'different', status_fields: { date_read: at } }, { ok: false, status_fields: { date_read: at } }]) {
  test('absent, invalid or mismatched evidence stays unknown: ' + JSON.stringify(result), async () => {
    const f = fixture({ result });
    await f.engine.start();
    try {
      const { messages } = await f.engine.messages('1');
      assert.equal(messages[1].readAt ?? null, null);
      assert.equal(deliveryLabel(messages[1]), 'Sent');
    } finally { await f.engine.stop(); }
  });
}

test('a status refusal preserves history, and no notification is invented', async () => {
  const f = fixture({ error: { code: -32601, message: 'unsupported' } });
  const events = [];
  f.engine.on((...event) => events.push(event));
  await f.engine.start();
  try {
    assert.equal((await f.engine.messages('1')).messages.length, 2);
    assert.equal((await f.engine.messages('1')).messages.length, 2);
    assert.equal(f.calls.filter((r) => r.method === 'message.send_status').length, 1);
    assert.deepEqual(events, []);
  } finally { await f.engine.stop(); }
});
