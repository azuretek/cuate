// The push relay (issue 347): a send reaches only a phone that registered, its payload passes through unread, and the
// limits hold. Firebase is a fake here, so the tests never reach Google.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ticketFor, ticketValid, readSend, fcmMessage, rateLimiter, SEALED_MAX } from '../src/rules.js';
import { createHandler, LIMITS } from '../src/handler.js';

const SECRET = 'test-secret-not-real';
const TOKEN = 'fake-token:APA91b_synthetic.0123';

function fake({ fail } = {}) {
  const calls = [];
  const send = async (message, dryRun) => {
    calls.push({ message, dryRun });
    if (fail) { const e = new Error('upstream'); e.code = fail; throw e; }
    return 'projects/x/messages/1';
  };
  return { calls, send };
}

const post = (handle, path, body, ip = '198.51.100.7') => handle({ method: 'POST', path, ip, body });

test('a ticket is bound to its token and to the relay secret', () => {
  const t = ticketFor(SECRET, TOKEN);
  assert.ok(ticketValid(SECRET, TOKEN, t));
  assert.equal(ticketValid(SECRET, TOKEN + 'x', t), false, 'another token');
  assert.equal(ticketValid('other-secret', TOKEN, t), false, 'another relay');
  assert.equal(ticketValid(SECRET, TOKEN, 'v1.' + 'A'.repeat(43)), false, 'a forged mac');
  assert.equal(ticketValid(SECRET, TOKEN, 'v0.' + t.split('.')[1]), false, 'an unknown version');
});

test('registering checks the token with a dry run and answers its ticket', async () => {
  const f = fake();
  const handle = createHandler({ send: f.send, secret: SECRET });
  const out = await post(handle, '/register', { token: TOKEN, platform: 'ios' });
  assert.equal(out.status, 200);
  assert.ok(ticketValid(SECRET, TOKEN, out.body.ticket));
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].dryRun, true, 'nothing reaches the phone when it registers');
  assert.equal((await post(handle, '/register', { token: TOKEN, platform: 'web' })).status, 400);
});

test('a token Firebase no longer knows is reported gone, so the server forgets it', async () => {
  const handle = createHandler({ send: fake({ fail: 'messaging/registration-token-not-registered' }).send, secret: SECRET });
  assert.equal((await post(handle, '/register', { token: TOKEN, platform: 'android' })).status, 410);
  const ticket = ticketFor(SECRET, TOKEN);
  assert.equal((await post(handle, '/send', { token: TOKEN, ticket, sealed: 'abc' })).status, 410);
});

test('a send without the ticket for its token is refused and never reaches Firebase', async () => {
  const f = fake();
  const handle = createHandler({ send: f.send, secret: SECRET });
  const other = ticketFor(SECRET, 'fake-token:someone-else');
  assert.equal((await post(handle, '/send', { token: TOKEN, ticket: other, sealed: 'abc' })).status, 403);
  assert.equal(f.calls.length, 0);
});

test('the sealed payload passes through as it came, with a placeholder the phone replaces', async () => {
  const f = fake();
  const handle = createHandler({ send: f.send, secret: SECRET });
  const sealed = 'c2VhbGVkLWJ5dGVz_-';
  const out = await post(handle, '/send', { token: TOKEN, ticket: ticketFor(SECRET, TOKEN), sealed, badge: 3 });
  assert.equal(out.status, 200);
  const m = f.calls[0].message;
  assert.equal(f.calls[0].dryRun, false);
  assert.deepEqual(m.data, { v: '1', sealed });
  assert.equal(m.apns.payload.aps['mutable-content'], 1, 'the iPhone extension may replace the alert');
  assert.equal(m.apns.payload.aps.badge, 3);
  assert.equal(m.android.priority, 'high');
  assert.equal(JSON.stringify(m).includes('sender'), false, 'nothing readable is added');
});

test('a payload too large, or not base64url, is refused', () => {
  const ticket = ticketFor(SECRET, TOKEN);
  assert.equal(readSend({ token: TOKEN, ticket, sealed: 'a'.repeat(SEALED_MAX + 1) }).error, 'sealed');
  assert.equal(readSend({ token: TOKEN, ticket, sealed: 'not base64!' }).error, 'sealed');
  assert.equal(readSend({ token: TOKEN, ticket, sealed: 'ok', badge: -1 }).error, 'badge');
  assert.equal(fcmMessage({ token: TOKEN, sealed: 'ok', badge: null }).apns.payload.aps.badge, undefined);
});

test('sends and registrations are rate limited per phone and per caller', async () => {
  let t = 0;
  const f = fake();
  const handle = createHandler({ send: f.send, secret: SECRET, now: () => t });
  const ticket = ticketFor(SECRET, TOKEN);
  for (let i = 0; i < LIMITS.sendPerMinute; i += 1) assert.equal((await post(handle, '/send', { token: TOKEN, ticket, sealed: 'abc' })).status, 200);
  assert.equal((await post(handle, '/send', { token: TOKEN, ticket, sealed: 'abc' })).status, 429);
  t += 60000;
  assert.equal((await post(handle, '/send', { token: TOKEN, ticket, sealed: 'abc' })).status, 200, 'a new window opens');
  for (let i = 0; i < LIMITS.registerPerMinute; i += 1) await post(handle, '/register', { token: TOKEN, platform: 'ios' }, '203.0.113.9');
  assert.equal((await post(handle, '/register', { token: TOKEN, platform: 'ios' }, '203.0.113.9')).status, 429);
});

test('the limiter forgets old windows and stays bounded', () => {
  let t = 0;
  const allow = rateLimiter({ limit: 1, windowMs: 10, now: () => t, maxKeys: 2 });
  assert.equal(allow('a'), true);
  assert.equal(allow('a'), false);
  allow('b');
  allow('c');
  assert.equal(allow('a'), true, 'past its key cap the limiter starts over rather than growing');
});

test('only POST to the two routes', async () => {
  const handle = createHandler({ send: fake().send, secret: SECRET });
  assert.equal((await handle({ method: 'GET', path: '/send' })).status, 405);
  assert.equal((await post(handle, '/other', {})).status, 404);
});
