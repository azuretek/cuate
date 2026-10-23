import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createPush } from '../src/push.js';

test('duplicate concurrent events send once per registered device and keep independent sealing keys', async () => {
  const sends = [];
  const devices = ['first', 'second'].map((tokenId) => ({ tokenId, platform: 'ios', pushToken: tokenId, ticket: 'synthetic', sealKey: randomBytes(32).toString('base64url') }));
  const push = createPush({ store: { listPushDevices: () => devices }, config: { push: { relay: 'https://relay.example.com' } }, log: { emit() {} }, fetchImpl: async (_url, init) => {
    sends.push(JSON.parse(init.body));
    await Promise.resolve();
    return { status: 200, json: async () => ({ ok: true }) };
  } });
  const message = { id: 'synthetic-1', chatId: 'chat-1', text: 'Synthetic race', fromMe: false };
  await Promise.all([push.notify(message), push.notify(message), push.notify(message)]);
  assert.equal(sends.length, 2);
  assert.deepEqual(sends.map((s) => s.token).sort(), ['first', 'second']);
  assert.notEqual(sends[0].sealed, sends[1].sealed);
  assert.equal(await push.notify(message), 0);
  assert.equal(await push.notify({ ...message, id: 'synthetic-2' }), 2);
  assert.equal(await push.notify({ ...message, chatId: 'chat-2' }), 2, 'message ids remain scoped to conversation');
});
