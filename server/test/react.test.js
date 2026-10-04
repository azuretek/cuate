// The reaction send path as the engine advertises it (issue 188). A stock engine sends the six classic tapbacks and
// refuses any other emoji; one that advertises tapback.emoji sends any emoji as itself. The HTTP side is here; the
// route and the client are pinned in api.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers.js';

const at = (id) => '/api/v1/chats/1/messages/' + id + '/reactions';
const PARTY = '\u{1F389}';
const HEART = '\u2764\uFE0F';

test('an arbitrary emoji is sent as a reaction where the engine advertises tapback.emoji.safe', async (t) => {
  const s = await boot({ features: ['tapback.emoji', 'tapback.emoji.safe'] });
  t.after(() => s.close());
  const r = await s.post(at('FAKE-0013'), s.tokens.device, { emoji: PARTY });
  assert.equal(r.status, 201);
  const body = await r.json();
  assert.equal(body.status, 'sent');
  assert.equal(body.type, 'emoji');
  assert.equal(body.emoji, PARTY);
  assert.equal(s.world.tapbacks.length, 1);
  assert.equal(s.world.tapbacks[0].emoji, PARTY);
});

test('an arbitrary emoji is refused on an engine without the capability, and the bridge is never asked', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const r = await s.post(at('FAKE-0013'), s.tokens.device, { emoji: PARTY });
  assert.equal(r.status, 422);
  assert.equal((await r.json()).error.code, 'reaction_unsupported');
  assert.equal(s.world.tapbacks.length, 0);
  assert.equal(s.world.requests.filter((m) => m === 'tapback').length, 0, 'a refused emoji never reaches the bridge');
});

test('a classic emoji still sends as a classic tapback on an engine without the capability', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const r = await s.post(at('FAKE-0013'), s.tokens.device, { emoji: HEART });
  assert.equal(r.status, 201);
  const body = await r.json();
  assert.equal(body.type, 'love');
  assert.equal(s.world.tapbacks.length, 1);
  assert.equal(s.world.tapbacks[0].kind, 'love');
});

test('an engine advertising only the crashy tapback.emoji is refused an arbitrary emoji, never reached, and never downgraded', async (t) => {
  const s = await boot({ features: ['tapback.emoji'] });
  t.after(() => s.close());
  const r = await s.post(at('FAKE-0013'), s.tokens.device, { emoji: PARTY });
  assert.equal(r.status, 422);
  assert.equal((await r.json()).error.code, 'reaction_unsupported');
  assert.equal(s.world.tapbacks.length, 0, 'a build known to crash on an emoji reaction is never reached');
  assert.equal(s.world.requests.filter((m) => m === 'tapback').length, 0);
});

test('an arbitrary emoji can be taken off again where the engine sends it', async (t) => {
  const s = await boot({ features: ['tapback.emoji', 'tapback.emoji.safe'] });
  t.after(() => s.close());
  assert.equal((await s.post(at('FAKE-0013'), s.tokens.device, { emoji: PARTY })).status, 201);
  const r = await s.post(at('FAKE-0013'), s.tokens.device, { emoji: PARTY, remove: true });
  assert.equal(r.status, 201);
  assert.equal((await r.json()).add, false);
  assert.equal(s.world.tapbacks.at(-1).remove, true);
});
