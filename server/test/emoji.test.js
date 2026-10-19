// Emoji favourites live on the server, keyed to the person (issue 494), in the same store the settings use. A
// favourite set on one device is read back on another, two devices writing at once converge without either losing its
// favourite, and a replayed change is applied once. Every test runs against the real server over the fake engine, in a
// temporary folder: no live service.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { boot, waitFor, openSocket } from './helpers.js';
import { openStore } from '../src/store.js';
import { apiSpec } from '../src/paths.js';
import { validate } from '../../core/kit/rules/schema.js';

const conforms = (value, type) => assert.deepEqual(validate(value, type, apiSpec.models), []);
const list = async (s, token) => (await (await s.get('/api/v1/emoji/favourites', token)).json()).favourites;
let clears = 0;
const clear = async (s, token) => {
  const now = await list(s, token);
  if (now.length) await s.post('/api/v1/emoji/favourites', token, { op: 'clear-' + (++clears), remove: now });
};

let s;
before(async () => { s = await boot(); });
after(async () => { await s.close(); });

test('the store keeps each person\'s favourites apart, in the same store the settings use', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'emoji-store-'));
  const store = openStore(path.join(dir, 'state.db'));
  try {
    store.applyEmojiFavourites('one', { op: 'one-1', add: ['\u{1F600}'] });
    store.applyEmojiFavourites('two', { op: 'two-1', add: ['\u{1F389}'] });
    assert.deepEqual(store.getEmojiFavourites('one').map((r) => r.char), ['\u{1F600}']);
    assert.deepEqual(store.getEmojiFavourites('two').map((r) => r.char), ['\u{1F389}']);
    assert.deepEqual(store.getEmojiFavourites('three'), []);
    // A setting written to the same file is untouched, which is what beside the settings means.
    store.putSettings({ 'appearance.skin': 'dark' });
    assert.equal(store.getAllSettings()['appearance.skin'], 'dark');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the list starts empty, and a favourite set on one device is read back on another', async () => {
  const a = s.store.createToken('device', 'emoji device a').token;
  const b = s.store.createToken('device', 'emoji device b').token;
  await clear(s, a);
  assert.deepEqual(await list(s, b), []);
  const write = await s.post('/api/v1/emoji/favourites', a, { op: 'add-a-1', add: ['\u{1F600}'] });
  assert.equal(write.status, 200);
  conforms(await write.json(), 'EmojiFavourites');
  assert.deepEqual(await list(s, b), ['\u{1F600}'], 'the second device reads the favourite the first set');
});

test('a removal on one device is read back on the other', async () => {
  const a = s.store.createToken('device', 'remove device a').token;
  const b = s.store.createToken('device', 'remove device b').token;
  await clear(s, a);
  await s.post('/api/v1/emoji/favourites', a, { op: 'add-r-1', add: ['\u{1F600}', '\u{1F389}'] });
  assert.deepEqual(await list(s, a), ['\u{1F389}', '\u{1F600}'], 'most recently used first');
  const removed = await s.post('/api/v1/emoji/favourites', b, { op: 'remove-r-1', remove: ['\u{1F389}'] });
  assert.equal(removed.status, 200);
  assert.deepEqual(await list(s, a), ['\u{1F600}'], 'the other device sees the removal');
});

test('two devices writing at once converge on one list, and neither drops the other\'s favourite', async () => {
  const a = s.store.createToken('device', 'race device a').token;
  const b = s.store.createToken('device', 'race device b').token;
  await clear(s, a);
  await Promise.all([
    s.post('/api/v1/emoji/favourites', a, { op: 'race-a-1', add: ['\u{1F600}'] }),
    s.post('/api/v1/emoji/favourites', b, { op: 'race-b-1', add: ['\u{1F389}'] }),
  ]);
  const [fromA, fromB] = await Promise.all([list(s, a), list(s, b)]);
  assert.deepEqual(fromA, fromB, 'both devices read one value');
  assert.deepEqual([...fromA].sort(), ['\u{1F389}', '\u{1F600}'].sort(), 'both favourites are there');
});

test('a change replayed with the same operation id is applied once', async () => {
  const a = s.store.createToken('device', 'retry device a').token;
  await clear(s, a);
  await s.post('/api/v1/emoji/favourites', a, { op: 'retry-1', add: ['\u{1F600}'] });
  await s.post('/api/v1/emoji/favourites', a, { op: 'retry-1', add: ['\u{1F600}'] });
  await s.post('/api/v1/emoji/favourites', a, { op: 'retry-2', add: ['\u{1F389}'] });
  // A second use of the first emoji would put it back in front; the replay must not, so the order proves it counted once.
  assert.deepEqual(await list(s, a), ['\u{1F389}', '\u{1F600}']);
});

test('a change streams to the other device as the whole list', async () => {
  const sock = await openSocket(s.base);
  sock.ws.send(JSON.stringify({ type: 'auth', token: s.tokens.device }));
  await waitFor(() => sock.frames.some((f) => f.type === 'hello'));
  await s.post('/api/v1/emoji/favourites', s.tokens.device, { op: 'event-1', add: ['\u{1F389}'] });
  await waitFor(() => sock.frames.some((f) => f.type === 'event' && f.name === 'emoji.changed'));
  const event = sock.frames.find((f) => f.type === 'event' && f.name === 'emoji.changed');
  conforms(event.data, 'EmojiEvent');
  assert.ok(event.data.favourites.includes('\u{1F389}'));
  sock.ws.close();
});

test('a change that is not one valid operation is refused, and a tooling token cannot write', async () => {
  assert.equal((await s.post('/api/v1/emoji/favourites', s.tokens.device, { add: ['\u{1F600}'] })).status, 400, 'no operation id');
  assert.equal((await s.post('/api/v1/emoji/favourites', s.tokens.device, { op: 'bad-1' })).status, 400, 'nothing to change');
  assert.equal((await s.post('/api/v1/emoji/favourites', s.tokens.device, { op: 'bad-2', add: ['not an emoji'] })).status, 400);
  assert.equal((await s.post('/api/v1/emoji/favourites', s.tokens.device, { op: 'bad-3', add: ['\u{1F600}'], extra: 1 })).status, 400);
  assert.equal((await s.post('/api/v1/emoji/favourites', s.tokens.tooling, { op: 'bad-4', add: ['\u{1F600}'] })).status, 403, 'a tooling token cannot change the person\'s list');
  assert.equal((await s.get('/api/v1/emoji/favourites', s.tokens.tooling)).status, 200, 'but it can read it');
});

test('settings and the theme still round-trip on the server beside the favourites', async () => {
  const a = s.store.createToken('device', 'settings beside device a').token;
  const b = s.store.createToken('device', 'settings beside device b').token;
  const theme = { name: 'synthetic', source: 'test', color: { light: { accent: 'oklch(0.5 0.1 30)' }, dark: { accent: 'oklch(0.8 0.1 30)' } } };
  assert.equal((await s.put('/api/v1/settings', a, { values: { 'appearance.skin': 'dark', 'appearance.textScale': 150, 'appearance.theme': theme } })).status, 200);
  conforms(await (await s.get('/api/v1/settings', b)).json(), 'Settings');
  const values = (await (await s.get('/api/v1/settings', b)).json()).values;
  assert.equal(values['appearance.skin'], 'dark', 'a setting still round-trips');
  assert.equal(values['appearance.textScale'], 150);
  assert.deepEqual(values['appearance.theme'], theme, 'the theme the picker reads is still the server value');
  await s.put('/api/v1/settings', b, { values: { 'appearance.theme': null } });
  assert.equal((await (await s.get('/api/v1/settings', a)).json()).values['appearance.theme'], null);
});
