import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { CONTACTS_JXA } from '../src/contacts.js';
const array = (items) => ({count:items.length, objectAtIndex:i=>items[i]});
test('native reader visits containers and deduplicates unified contacts instead of requesting no identifiers', () => {
  const row = {identifier:'synthetic', givenName:'Ada', familyName:'Example', phones:[], phoneNumbers:array([]), emailAddresses:array([])};
  const visited = [];
  const store = {
    containersMatchingPredicateError:()=>array([{identifier:'one'},{identifier:'two'}]),
    unifiedContactsMatchingPredicateKeysToFetchError:(pred)=>{ visited.push(pred); return array([row]); },
  };
  const $ = {CNContactStore:{alloc:{init:store}, authorizationStatusForEntityType:()=>3}, CNContact:{predicateForContactsInContainerWithIdentifier:id=>id}};
  const answer = JSON.parse(vm.runInNewContext(CONTACTS_JXA, {$,ObjC:{import:()=>{},unwrap:x=>x},Ref:()=>({})}));
  assert.deepEqual(visited,['one','two']);
  assert.equal(answer.contacts.length,1);
  assert.equal(answer.contacts[0].given,'Ada');
});
