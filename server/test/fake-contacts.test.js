import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTACTS, SYNTHETIC_HANDLE } from '../src/engine/fixtures.js';
import { createContacts } from '../src/contacts.js';

test('fake mode supplies deterministic Contacts names without reading the host store', async () => {
  const contacts = createContacts({run: async () => JSON.stringify({authorized:true,status:3,contacts:CONTACTS}),watchDir:null});
  assert.equal((await contacts.forHandles(['+15555550100'])).name, 'Avery Quinn');
  assert.equal((await contacts.forHandles(['jordan@example.com'])).name, 'Jordan Lee');
  assert.equal(await contacts.forHandles(['+15555550142']), null);
  for(const record of CONTACTS) for(const handle of [...record.phones,...record.emails]) assert.match(handle,SYNTHETIC_HANDLE);
});
