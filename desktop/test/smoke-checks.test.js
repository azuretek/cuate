// The smoke's check evaluation: a check must report the value it read and the bound it enforced, and a
// missing or unreadable value must fail rather than pass or throw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateChecks, formatFailures } from '../src/smoke-checks.js';

const CHECKS = [
  { key: 'chats', bound: 'at least 3', value: (report) => report.chats, test: (v) => v >= 3 },
  { key: 'bubbles', bound: 'more than 0', value: (report) => report.bubbles, test: (v) => v > 0 },
  { key: 'live', bound: 'true', value: (report) => report.live, test: (v) => v === true },
];

test('every check passes and carries the value it read', () => {
  const result = evaluateChecks(CHECKS, { chats: 4, bubbles: 12, live: true });
  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.results.map((r) => [r.key, r.measured, r.ok]), [['chats', 4, true], ['bubbles', 12, true], ['live', true, true]]);
});

test('a count below its bound fails and reports the number and the bound', () => {
  const result = evaluateChecks(CHECKS, { chats: 1, bubbles: 12, live: true });
  assert.equal(result.ok, false);
  assert.deepEqual(result.failures.map((f) => f.key), ['chats']);
  assert.deepEqual(formatFailures(result.results), ['check chats: measured 1, required at least 3']);
});

test('a boolean false fails and reports false, not a count', () => {
  const result = evaluateChecks(CHECKS, { chats: 4, bubbles: 12, live: false });
  assert.deepEqual(formatFailures(result.results), ['check live: measured false, required true']);
});

test('a missing key reads as null and fails, rather than passing', () => {
  const result = evaluateChecks(CHECKS, {});
  assert.deepEqual(result.failures.map((f) => f.key), ['chats', 'bubbles', 'live']);
  assert.deepEqual(result.failures.map((f) => f.measured), [null, null, null]);
});

test('a missing report fails every check instead of throwing', () => {
  const result = evaluateChecks(CHECKS, null);
  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 3);
});

test('a throwing value or test fails the check rather than crashing the run', () => {
  const checks = [
    { key: 'value-throws', bound: 'writable', value: () => { throw new Error('no'); }, test: () => true },
    { key: 'test-throws', bound: 'a bound', value: () => 1, test: () => { throw new Error('no'); } },
  ];
  const result = evaluateChecks(checks, {});
  assert.equal(result.ok, false);
  assert.deepEqual(result.failures.map((f) => f.key), ['value-throws', 'test-throws']);
});

test('a passing run retains every measured value for the record', () => {
  const result = evaluateChecks(CHECKS, { chats: 7, bubbles: 3, live: true });
  assert.deepEqual(result.results.map((r) => r.measured), [7, 3, true]);
});
