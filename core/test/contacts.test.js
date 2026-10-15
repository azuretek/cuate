import test from 'node:test';
import assert from 'node:assert/strict';
import { handleKey, contactFor, contactName, contactIndex } from '../app/rules/contacts.js';

// Synthetic records only (server/test/fixtures.test.js holds the same rule for captures).

test('a handle matches a contact by its last ten digits or its lower cased email (issue 393)', () => {
  assert.equal(handleKey('+1 (555) 010-1234'), '5550101234');
  assert.equal(handleKey('555-010-1234'), '5550101234');
  assert.equal(handleKey('Ada@Example.com '), 'ada@example.com');
  assert.equal(handleKey(''), '');
  assert.equal(handleKey(null), '');
  assert.equal(handleKey('123'), '123');
});

test('a short string is compared as text, never by a slice that would match every short handle', () => {
  assert.equal(handleKey('12'), '12');
  assert.notEqual(handleKey('12'), handleKey('34'));
});

test('the chat finds the record of the first of its own handles the store knows (issue 393)', () => {
  const index = contactIndex([
    { given: 'Ada', family: 'Lovelace', phones: ['+1 555 010 1234'], emails: [] },
    { given: 'Grace', family: 'Hopper', phones: [], emails: ['Grace@Example.com'] },
  ]);
  assert.equal(contactFor(['5550109999', '555-010-1234'], index).given, 'Ada');
  assert.equal(contactFor(['grace@example.com'], index).given, 'Grace');
  assert.equal(contactFor(['nobody@example.com'], index), null);
  assert.equal(contactFor(['5550101234'], null), null);
});

test('a record draws its nickname first, then given and family, then its organisation (issue 393)', () => {
  assert.equal(contactName({ given: 'Ada', family: 'Lovelace' }), 'Ada Lovelace');
  assert.equal(contactName({ given: 'Ada', middle: 'B', family: 'Lovelace' }), 'Ada B Lovelace');
  assert.equal(contactName({ nickname: 'Enchantress', given: 'Ada', family: 'Lovelace' }), 'Enchantress');
  assert.equal(contactName({ organization: 'Analytical Engines' }), 'Analytical Engines');
  assert.equal(contactName({}), '');
  assert.equal(contactName(null), '');
});

test('two records that share a key keep the first, so a key never flips between them', () => {
  const index = contactIndex([
    { given: 'Ada', phones: ['5550101234'] },
    { given: 'Augusta', phones: ['5550101234'] },
  ]);
  assert.equal(index.get('5550101234').given, 'Ada');
  assert.equal(contactIndex(null).size, 0);
});
