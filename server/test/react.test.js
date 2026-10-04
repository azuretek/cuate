// The reaction send path as the engine advertises it (issue 188). A stock engine sends the six classic tapbacks and
// refuses any other emoji; one whose capability block reports `tapback.emoji` at version 2 sends any emoji as
// itself, and an engine that reports an older version is treated as one that crashes on an emoji reaction and is
// refused before the bridge. The HTTP side is here; the route and the client are pinned in api.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers.js';

const at = (id) => '/api/v1/chats/1/messages/' + id + '/reactions';
// A capability block in the shape imsg reports: the engine's own build identity beside the named, versioned
// features. No version means a build that predates the block; 1 is the first emoji path, which crashed Messages.
const caps = (version) => ({
  engine: { version: 'test', commit: 'test', built_at: '2026-01-01T00:00:00Z' },
  features: version ? { 'tapback.emoji': version } : {},
});
const PARTY = '\u{1F389}';
const HEART = '\u2764\uFE0F';

test('an arbitrary emoji is sent as a reaction where the engine advertises tapback.emoji version 2', async (t) => {
  const s = await boot({ capabilities: caps(2) });
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

test('an arbitrary emoji is refused on an engine with no capability, and the bridge is never asked', async (t) => {
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

test('an engine advertising an older tapback.emoji version is refused an arbitrary emoji, never reached, and never downgraded', async (t) => {
  const s = await boot({ capabilities: caps(1) });
  t.after(() => s.close());
  const r = await s.post(at('FAKE-0013'), s.tokens.device, { emoji: PARTY });
  assert.equal(r.status, 422);
  assert.equal((await r.json()).error.code, 'reaction_unsupported');
  assert.equal(s.world.tapbacks.length, 0, 'a build known to crash on an emoji reaction is never reached');
  assert.equal(s.world.requests.filter((m) => m === 'tapback').length, 0);
});

test('an arbitrary emoji can be taken off again where the engine sends it', async (t) => {
  const s = await boot({ capabilities: caps(2) });
  t.after(() => s.close());
  assert.equal((await s.post(at('FAKE-0013'), s.tokens.device, { emoji: PARTY })).status, 201);
  const r = await s.post(at('FAKE-0013'), s.tokens.device, { emoji: PARTY, remove: true });
  assert.equal(r.status, 201);
  assert.equal((await r.json()).add, false);
  assert.equal(s.world.tapbacks.at(-1).remove, true);
});

test('the refusal names the limit, the version the engine would need, and the engine that answered', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const r = await s.post(at('FAKE-0013'), s.tokens.device, { emoji: PARTY });
  assert.equal(r.status, 422);
  const body = await r.json();
  assert.equal(body.error.code, 'reaction_unsupported');
  assert.match(body.error.message, /six classic reactions, not arbitrary emoji/, 'the limit is named honestly');
  assert.match(body.error.message, /tapback\.emoji version 2/, 'the version the engine would need is named');
  assert.match(body.error.message, /fake/, 'the engine that answered is named, not the app');
  assert.equal(s.world.tapbacks.length, 0, 'and nothing is sent');
});

test('an engine advertising an older version names it too, and still sends the classic six', async (t) => {
  const s = await boot({ capabilities: caps(1) });
  t.after(() => s.close());
  const refused = await s.post(at('FAKE-0013'), s.tokens.device, { emoji: PARTY });
  assert.equal(refused.status, 422);
  assert.match((await refused.json()).error.message, /six classic reactions, not arbitrary emoji/);
  const classic = await s.post(at('FAKE-0013'), s.tokens.device, { emoji: HEART });
  assert.equal(classic.status, 201);
  assert.equal((await classic.json()).type, 'love');
  assert.equal(s.world.tapbacks.length, 1, 'only the refused emoji did not send; the classic six still do');
});
