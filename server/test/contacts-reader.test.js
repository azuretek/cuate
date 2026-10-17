import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { CONTACTS_JXA } from '../src/contacts.js';

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
