// Push notifications (issue 347): a phone registers through the relay, a new message reaches it sealed with its own key,
// and nothing the relay sees can be read. The relay is a fake here, so the tests never reach Google.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, randomBytes } from 'node:crypto';
import { boot, waitFor } from './helpers.js';
import { createPush, notice, seal, readRegistration, BODY_MAX, PUSH_RELAY } from '../src/push.js';
import { normalizeConfig } from '../src/config.js';

const RELAY = 'https://relay.example.com/relay';
const PUSH_TOKEN = 'fake-push-token:synthetic-0001';

function open(key, sealed) {
  const b = Buffer.from(sealed, 'base64url');
  const d = createDecipheriv('aes-256-gcm', Buffer.from(key, 'base64url'), b.subarray(0, 12));
  d.setAuthTag(b.subarray(b.length - 16));
  return JSON.parse(Buffer.concat([d.update(b.subarray(12, b.length - 16)), d.final()]).toString('utf8'));
}

// A relay that answers the two routes the way ours does, and remembers every call.
function fakeRelay({ register = 200, send = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    const route = url.slice(RELAY.length);
    const status = route === '/register' ? register : send;
    const data = route === '/register' && status === 200 ? { ticket: 'v1.synthetic-ticket' } : status === 200 ? { ok: true } : { error: 'x' };
    return { status, json: async () => data };
  };
  return { calls, fetchImpl, sends: () => calls.filter((c) => c.url.endsWith('/send')) };
}

const key = () => randomBytes(32).toString('base64url');

test('a phone registers through the relay, and a new message reaches it sealed with its own key', async () => {
  const relay = fakeRelay();
  const s = await boot({ push: { relay: RELAY }, pushFetch: relay.fetchImpl });
  try {
    const k = key();
    const r = await s.post('/api/v1/push', s.tokens.device, { token: PUSH_TOKEN, platform: 'ios', key: k });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { registered: true });
    assert.deepEqual(relay.calls[0].body, { token: PUSH_TOKEN, platform: 'ios' }, 'the relay never sees the key');
    s.world.incoming(1, 'Synthetic push text');
    await waitFor(() => relay.sends().length === 1);
    const sent = relay.sends()[0].body;
    assert.equal(sent.token, PUSH_TOKEN);
    assert.equal(sent.ticket, 'v1.synthetic-ticket');
    assert.equal(JSON.stringify(sent).includes('Synthetic push text'), false, 'nothing readable leaves the server');
    const n = open(k, sent.sealed);
    assert.equal(n.body, 'Synthetic push text');
    assert.equal(n.chatId, '1');
    assert.ok(n.messageId && n.title);
  } finally {
    await s.close();
  }
});

test('a token the relay reports gone is refused at registration and forgotten when a send finds it gone', async () => {
  const refused = fakeRelay({ register: 410 });
  const a = await boot({ push: { relay: RELAY }, pushFetch: refused.fetchImpl });
  try {
    const r = await a.post('/api/v1/push', a.tokens.device, { token: PUSH_TOKEN, platform: 'android', key: key() });
    assert.equal(r.status, 400);
    assert.equal(a.store.listPushDevices().length, 0);
  } finally {
    await a.close();
  }
  const gone = fakeRelay({ send: 410 });
  const b = await boot({ push: { relay: RELAY }, pushFetch: gone.fetchImpl });
  try {
    await b.post('/api/v1/push', b.tokens.device, { token: PUSH_TOKEN, platform: 'android', key: key() });
    assert.equal(b.store.listPushDevices().length, 1);
    b.world.incoming(1, 'Synthetic to a gone phone');
    await waitFor(() => b.store.listPushDevices().length === 0);
  } finally {
    await b.close();
  }
});

test('no push when the person switched new message notices off', async () => {
  const relay = fakeRelay();
  const s = await boot({ push: { relay: RELAY }, pushFetch: relay.fetchImpl });
  try {
    await s.post('/api/v1/push', s.tokens.device, { token: PUSH_TOKEN, platform: 'ios', key: key() });
    s.store.putSettings({ 'notifications.newMessage': false });
    s.world.incoming(1, 'Synthetic while switched off');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(relay.sends().length, 0);
  } finally {
    await s.close();
  }
});

test('a phone that signs out, or unregisters, gets nothing more', async () => {
  const relay = fakeRelay();
  const s = await boot({ push: { relay: RELAY }, pushFetch: relay.fetchImpl });
  try {
    await s.post('/api/v1/push', s.tokens.device, { token: PUSH_TOKEN, platform: 'ios', key: key() });
    const del = await fetch(s.base + '/api/v1/push', { method: 'DELETE', headers: { authorization: 'Bearer ' + s.tokens.device } });
    assert.deepEqual(await del.json(), { registered: false });
    assert.equal(s.store.listPushDevices().length, 0);
    await s.post('/api/v1/push', s.tokens.device, { token: PUSH_TOKEN, platform: 'ios', key: key() });
    const id = s.store.listTokens().find((t) => t.scope === 'device').id;
    s.store.revokeToken(id);
    assert.equal(s.store.listPushDevices().length, 0, 'a revoked device is never listed');
  } finally {
    await s.close();
  }
});

test('with the relay switched off a phone is told so, and a bad registration is refused before the relay is asked', async () => {
  const relay = fakeRelay();
  const s = await boot({ push: { relay: null }, pushFetch: relay.fetchImpl });
  try {
    const off = await s.post('/api/v1/push', s.tokens.device, { token: PUSH_TOKEN, platform: 'ios', key: key() });
    assert.equal(off.status, 503);
    assert.equal(readRegistration({ token: PUSH_TOKEN, platform: 'web', key: key() }).error.startsWith('platform'), true);
    assert.equal(readRegistration({ token: PUSH_TOKEN, platform: 'ios', key: 'short' }).error.startsWith('key'), true);
    assert.equal(readRegistration({ token: PUSH_TOKEN, platform: 'ios', key: key(), extra: 1 }).error.startsWith('Unknown'), true);
    assert.equal(relay.calls.length, 0);
  } finally {
    await s.close();
  }
});

test('no push for our own messages, for an event row, or to a phone that has the app open', async () => {
  const relay = fakeRelay();
  const devices = [{ tokenId: 'open', platform: 'ios', pushToken: PUSH_TOKEN, ticket: 't', sealKey: key() }, { tokenId: 'closed', platform: 'android', pushToken: PUSH_TOKEN, ticket: 't', sealKey: key() }];
  const store = { listPushDevices: () => devices, deletePushDevice: () => true };
  const log = { emit: () => {} };
  const push = createPush({ store, config: { push: { relay: RELAY } }, log, fetchImpl: relay.fetchImpl, isConnected: (id) => id === 'open' });
  assert.equal(await push.notify({ id: 'a', chatId: 1, fromMe: true, text: 'mine', attachments: [] }), 0);
  assert.equal(await push.notify({ id: 'b', chatId: 1, fromMe: false, text: '', event: { kind: 'rename' }, attachments: [] }), 0);
  assert.equal(await push.notify({ id: 'c', chatId: 1, fromMe: false, text: 'theirs', attachments: [] }), 1, 'only the phone with no open connection');
  assert.equal(relay.sends().length, 1);
});

test('a notification carries the sender, a bounded text and where a tap goes, and fits the relay', () => {
  const long = notice({ id: 'm1', chatId: 7, text: 'x'.repeat(5000), senderName: 'Avery Quinn', attachments: [] });
  assert.equal(long.body.length, BODY_MAX);
  assert.equal(long.title, 'Avery Quinn');
  assert.deepEqual(Object.keys(long).sort(), ['body', 'chatId', 'messageId', 'title', 'v']);
  assert.equal(notice({ id: 'm2', chatId: 7, text: '', attachments: [{}] }).body, 'Sent an attachment');
  // The relay takes at most 3000 characters of sealed payload; the longest notice stays under it with room to spare.
  assert.ok(seal(key(), { ...long, title: 'y'.repeat(200), body: '\u{1F600}'.repeat(BODY_MAX / 2) }).length < 3000);
});

test('the relay defaults to ours, and the config accepts only https or null', () => {
  assert.equal(normalizeConfig({}).push.relay, PUSH_RELAY);
  assert.equal(normalizeConfig({ push: { relay: null } }).push.relay, null, 'null switches push off');
  assert.throws(() => normalizeConfig({ push: { relay: 'http://relay.example.com' } }), /push\.relay must be an https URL/);
});
