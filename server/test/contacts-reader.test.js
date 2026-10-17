import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { CONTACTS_JXA, createContacts } from '../src/contacts.js';

// The Mac's program run against a fake Contacts framework, so the read is proven off a Mac. Synthetic people only.
const array = (items) => ({ count: items.length, objectAtIndex: (i) => items[i] });
const bridged = (items) => ({ bridged: true, items });
const framework = ({ status = 3, people = [], read = true } = {}) => {
  const seen = { request: null, containersAsked: 0 };
  const store = {
    containersMatchingPredicateError: () => { seen.containersAsked += 1; return array([]); },
    unifiedContactsMatchingPredicateKeysToFetchError: () => array([]),
    enumerateContactsWithFetchRequestErrorUsingBlock: (request, _err, block) => {
      seen.request = request;
      for (const p of people) block(p, {});
      return read;
    },
  };
  const $ = Object.assign((v) => bridged(v), {
    CNContactFormatter: { descriptorForRequiredKeysForStyle: () => 'formatter-keys', stringFromContactStyle: (c) => [c.givenName, c.familyName].filter(Boolean).join(' ') },
    CNContactStore: { alloc: { init: store }, authorizationStatusForEntityType: () => status },
    CNContactFetchRequest: { alloc: { initWithKeysToFetch: (keys) => ({ keys, unifyResults: false }) } },
    CNContactIdentifierKey: 'identifier', CNContactGivenNameKey: 'givenName', CNContactMiddleNameKey: 'middleName', CNContactFamilyNameKey: 'familyName',
    CNContactNicknameKey: 'nickname', CNContactOrganizationNameKey: 'organizationName', CNContactPhoneNumbersKey: 'phoneNumbers',
    CNContactEmailAddressesKey: 'emailAddresses', CNContactThumbnailImageDataKey: 'thumbnailImageData',
  });
  const run = () => JSON.parse(vm.runInNewContext(CONTACTS_JXA, { $, ObjC: { import: () => {}, unwrap: (x) => x }, Ref: () => ({}) }));
  return { run, seen };
};
const person = (over = {}) => ({
  identifier: 'synthetic-1', givenName: 'Ada', middleName: 'B', familyName: 'Example', nickname: 'Ace', organizationName: 'Example Co',
  phoneNumbers: array([{ value: { stringValue: '+15550100' } }]), emailAddresses: array([{ value: 'ada@example.com' }]),
  thumbnailImageData: { base64EncodedStringWithOptions: () => 'AAAA' }, ...over,
});

test('native reader enumerates one unified fetch request, with its keys bridged as an array, not by container', () => {
  const { run, seen } = framework({ people: [person(), person({ identifier: 'synthetic-2', givenName: 'Grace', phoneNumbers: array([]), emailAddresses: array([]), thumbnailImageData: null })] });
  const answer = run();
  assert.equal(answer.authorized, true);
  assert.equal(answer.status, 3);
  assert.equal(seen.containersAsked, 0);
  assert.equal(seen.request.unifyResults, true);
  assert.equal(seen.request.keys.bridged, true);
  assert.ok(Array.isArray(seen.request.keys.items));
  assert.ok(seen.request.keys.items.includes('formatter-keys'));
  assert.equal(answer.contacts.length, 2);
  assert.deepEqual(answer.contacts[0], {
    given: 'Ada', middle: 'B', family: 'Example', nickname: 'Ace', organization: 'Example Co', displayName: 'Ada Example',
    phones: ['+15550100'], emails: ['ada@example.com'], photo: 'AAAA',
  });
  assert.equal(answer.contacts[1].displayName, 'Grace Example');
  assert.deepEqual(answer.contacts[1].phones, []);
  assert.equal('photo' in answer.contacts[1], false);
});

test('native reader keeps one record per identifier', () => {
  const { run } = framework({ people: [person(), person()] });
  assert.equal(run().contacts.length, 1);
});

test('native reader reports a refusal with the state macOS gave and reads nobody', () => {
  const { run, seen } = framework({ status: 2, people: [person()] });
  assert.deepEqual(run(), { authorized: false, status: 2 });
  assert.equal(seen.request, null);
});

test('native reader fails loudly when the enumeration fails rather than answering an empty store', () => {
  const { run } = framework({ people: [], read: false });
  assert.throws(run, /Contacts could not be read/);
});

// What the bridge hands back for an NSString: an object whose own string form is the bridge's label, with the text
// itself only behind .js. Reading the base64 picture with String() alone turned every picture into that label.
const nsString = (s) => ({ js: s, toString: () => '[id NSString]' });
// A synthetic 1x1 PNG, so the server's own picture path can be run on what the reader produced.
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5c50000000049454e44ae426082', 'hex').toString('base64');

test('native reader unwraps the picture the bridge returns, so the server serves it as an image (issue 393)', async () => {
  const { run } = framework({ people: [person({ thumbnailImageData: { base64EncodedStringWithOptions: () => nsString(PNG) } })] });
  const answer = run();
  assert.equal(answer.contacts[0].photo, PNG);
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'contacts-photo-'));
  try {
    const contacts = createContacts({ run: async () => JSON.stringify(answer), dataDir, watchDir: null });
    await contacts.load();
    const pic = await contacts.photo(contacts.records[0]);
    assert.ok(pic, 'the picture is served');
    assert.equal(pic.mime, 'image/png');
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
