// The client data inventory (issue 494): every value a client keeps on the device, where it lives, whether the server
// owns it or the device does, and why. A row with no side or no reason fails, and so does a storage key the client uses
// that the inventory does not name, so the page cannot fall behind the code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const doc = read('../../docs/CLIENT-DATA.md');
const api = JSON.parse(read('../spec/api.json'));
const rows = doc.split('\n')
  .filter((line) => line.startsWith('|') && !/^\|\s*:?-+/.test(line) && !/^\|\s*Item\s*\|/.test(line))
  .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));

test('the inventory is a table, and every row names a side, a place and a reason', () => {
  assert.ok(rows.length >= 8, 'the inventory covers the devices\' own stores');
  for (const [item, where, status, why] of rows) {
    assert.ok(item && where && status && why, 'a row is incomplete: ' + item);
    assert.match(status, /^(Server-synced|Device local)/, item + ' says whether the server owns it');
    assert.ok(why.length > 40, item + ' says why');
  }
  const sides = rows.map(([, , status]) => status);
  assert.ok(sides.some((s) => s.startsWith('Server-synced')), 'the synced values are named');
  assert.ok(sides.some((s) => s.startsWith('Device local')), 'the deliberately local values are named');
});

test('every storage key a client uses is named in the inventory', () => {
  const keys = ['emoji.favourites', 'emoji.frequent', 'emoji.tones', 'server.url', 'server.token', 'message-store'];
  const sources = [
    '../app/favourites.js',
    '../app/components/app-root.js',
    '../app/components/app-emoji-picker.js',
    '../app/message-cache.js',
  ].map(read).join('\n');
  for (const key of keys) {
    assert.ok(doc.includes('\u0060' + key + '\u0060'), key + ' is named in the inventory');
    assert.ok(sources.includes("'" + key + "'"), key + ' is still a key the client uses');
  }
});

test('the emoji favourites are a server value with a route of its own', () => {
  for (const id of ['emoji-favourites', 'emoji-favourites-write']) {
    assert.ok(api.routes.some((r) => r.id === id), id + ' is declared in the API');
  }
  assert.ok(api.events['emoji.changed'], 'a change is an event the other devices hear');
  assert.match(doc, /Server-synced[^|]*\| The server holds one list/, 'the inventory says the server owns the list');
});
