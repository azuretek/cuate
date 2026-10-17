import test from 'node:test';
import assert from 'node:assert/strict';
import { digitsOf, phoneKey, nationalKey, handleKey, contactFor, contactName, contactIndex } from '../app/rules/contacts.js';

// Synthetic records only.

const ONE = { given: 'Ada', family: 'Lovelace', phones: ['+1 555 010 1234'], emails: ['ada@example.com'] };
const SAME_TAIL = { given: 'Grace', family: 'Hopper', phones: ['+44 5550 101234'], emails: [] };

test('a phone keeps its country code, and a short string is never treated as a phone (issue 393)', () => {
  assert.equal(phoneKey('+1 (555) 010-1234'), '+15550101234');
  assert.equal(phoneKey('0044 5550 101234'), '+445550101234');
  assert.equal(phoneKey('555-010-1234'), '5550101234');
  assert.equal(nationalKey('+15550101234'), '5550101234');
  assert.equal(nationalKey('101234'), '');
  assert.equal(handleKey('Ada@Example.com '), 'ada@example.com');
  assert.equal(handleKey(''), '');
  assert.equal(digitsOf(null), '');
});

test('an address is matched in its international form with its country code (issue 393)', () => {
  const index = contactIndex([ONE]);
  assert.equal(contactFor(['+15550101234'], index).given, 'Ada');
  assert.equal(contactFor(['ada@example.com'], index).given, 'Ada');
});

test('a national number meets a contact through the last ten digits only when one record claims that tail (issue 393)', () => {
  const index = contactIndex([ONE]);
  assert.equal(contactFor(['5550101234'], index).given, 'Ada');
  assert.equal(contactFor(['101234'], index), null);
});

test('two numbers that share their last ten digits in different countries never draw each other person (issue 393)', () => {
  const index = contactIndex([ONE, SAME_TAIL]);
  // The tail is claimed twice, so it names nobody; each full number still names its own person.
  assert.equal(contactFor(['5550101234'], index), null);
  assert.equal(contactFor(['+15550101234'], index).given, 'Ada');
  assert.equal(contactFor(['+445550101234'], index).given, 'Grace');
});

test('a key two records claim is an ambiguity, and a chat with no matching address names nobody (issue 393)', () => {
  const shared = [{ given: 'Ada', phones: [], emails: ['house@example.com'] }, { given: 'Grace', phones: [], emails: ['house@example.com'] }];
  const index = contactIndex(shared);
  assert.equal(contactFor(['house@example.com'], index), null);
  assert.equal(contactFor(['nobody@example.com'], index), null);
  assert.equal(contactFor([], index), null);
  assert.equal(contactFor(['5550101234'], null), null);
});

test('a record uses only the Apple-formatted display name (issue 393)', () => {
  assert.equal(contactName({displayName:'Lovelace Ada', given:'Ada', family:'Lovelace', nickname:'Enchantress'}), 'Lovelace Ada');
  assert.equal(contactName({displayName:'Ada Lovelace'}), 'Ada Lovelace');
  assert.equal(contactName({nickname:'Enchantress', given:'Ada', family:'Lovelace'}), '');
  assert.equal(contactName(null), '');
});

test('a record held twice still answers once, and its own two numbers never collide with each other (issue 393)', () => {
  const index = contactIndex([{ given: 'Ada', phones: ['+15550101234', '+15550101234'] }]);
  assert.equal(contactFor(['5550101234'], index).given, 'Ada');
  assert.equal(contactIndex(null).exact.size, 0);
});

test('an explicit foreign country and digits inside an email never fall back to a phone', () => {
  const index = contactIndex([ONE]);
  assert.equal(contactFor(['+445550101234'], index), null);
  assert.equal(contactFor(['5550101234@example.com'], index), null);
});
