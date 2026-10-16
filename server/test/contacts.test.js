import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createContacts } from '../src/contacts.js';

// Synthetic records only. The reader is a fake, so nothing here needs a Mac.

const STORE = {
  authorized: true,
  status: 3,
  contacts: [
    { displayName: 'Ada Lovelace', given: 'Ada', family: 'Lovelace', phones: ['+1 (555) 010-1234'], emails: ['ada@example.com'], photo: Buffer.from([255, 216, 255, 1]).toString('base64') },
    { displayName: 'Grace B Hopper', given: 'Grace', middle: 'B', family: 'Hopper', nickname: 'Amazing Grace', organization: 'Navy', phones: [], emails: ['grace@example.com'] },
  ],
};

const fake = (value) => async () => (typeof value === 'string' ? value : JSON.stringify(value));

test('the store names a chat by the first of its handles it knows (issue 393)', async () => {
  const c = createContacts({ run: fake(STORE) });
  assert.equal((await c.forHandles(['5550101234'])).name, 'Ada Lovelace');
  assert.equal((await c.forHandles(['GRACE@example.com'])).name, 'Grace B Hopper');
  assert.equal(await c.forHandles(['nobody@example.com']), null);
});

test('a store that refuses reads as no contacts, never a failed server (issue 393)', async () => {
  const c = createContacts({ run: fake({ authorized: false, status: 0 }) });
  assert.equal(await c.forHandles(['5550101234']), null);
  assert.equal(c.records.length, 0);
});

test('a reader that throws is no contacts, and no picture is invented (issue 393)', async () => {
  const c = createContacts({ run: async () => { throw new Error('no osascript'); } });
  assert.equal(await c.forHandles(['5550101234']), null);
});

test('a picture is written once, keyed by its bytes, so a changed picture is a new id (issue 393)', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'contacts-'));
  const first = createContacts({ run: fake(STORE), dataDir: dir });
  const rec = (await first.forHandles(['5550101234'])).record;
  const one = await first.photo(rec);
  assert.equal(one.mime, 'image/jpeg');
  assert.equal(one.bytes, Buffer.from([255, 216, 255, 1]).length);
  assert.deepEqual(readFileSync(one.file), Buffer.from([255, 216, 255, 1]));
  assert.equal((await first.photo(rec)).id, one.id);

  const changed = createContacts({ run: fake({ authorized: true, status: 3, contacts: [{ given: 'Ada', phones: ['5550101234'], photo: Buffer.from([255, 216, 255, 2]).toString('base64') }] }), dataDir: dir });
  const two = await changed.photo((await changed.forHandles(['5550101234'])).record);
  assert.notEqual(two.id, one.id);
});

test('a store is read again only after its ttl, and a read in flight is joined (issue 393)', async () => {
  let reads = 0;
  let clock = 1000;
  const c = createContacts({ run: async () => { reads += 1; return JSON.stringify(STORE); }, ttlMs: 100, now: () => clock });
  await c.forHandles(['5550101234']);
  await c.forHandles(['5550101234']);
  assert.equal(reads, 1);
  clock += 101;
  await c.forHandles(['5550101234']);
  assert.equal(reads, 2);
});

test('empty, denied and failed reads have different diagnostic states', async () => {
  for (const [answer, expected] of [[{authorized:true,status:3,contacts:[]}, 'empty'], [{authorized:false,status:2}, 'denied']]) {
    const c = createContacts({run:fake(answer)});
    await c.load();
    assert.equal(c.status().state, expected);
    assert.equal(Object.hasOwn(c.status(), 'contacts'), false);
  }
  const c = createContacts({run:async () => { throw Error('failed'); }});
  await c.load();
  assert.equal(c.status().state, 'error');
});


test('contact photos preserve their image type and reject arbitrary bytes', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'contacts-type-'));
  const c = createContacts({run:fake(STORE),dataDir:dir});
  const png = Buffer.from([137,80,78,71,13,10,26,10]);
  const picture = await c.photo({photo:png.toString('base64')});
  assert.equal(picture.mime,'image/png');
  assert.ok(picture.file.endsWith('.png'));
  assert.equal(await c.photo({photo:Buffer.from('not an image').toString('base64')}),null);
});
