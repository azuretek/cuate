// The fixtures every engine answers, run here against the source modules. This
// is the Node half of the parity: a shell's own engine is held to the same
// answer in its own suite (android/ in the embedded engine, ios/ in
// JavaScriptCore), and core/test/engine-bundle.test.js holds the committed
// bundle to the same names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixtures, OUT } from '../../scripts/gen-engine-fixtures.mjs';
import * as engine from '../app/engine.js';

const committed = JSON.parse(readFileSync(OUT, 'utf8'));

test('the committed fixture file is fresh', () => {
  assert.deepEqual(committed, fixtures(), 'core/fixtures/engine-cases.json is stale: run pnpm run fixtures');
});

test('every fixture case answers through the source modules', () => {
  assert.ok(committed.cases.length > 0);
  for (const c of committed.cases) {
    assert.equal(typeof engine[c.call], 'function', c.id + ' names an unknown rule');
    assert.equal(JSON.stringify(engine[c.call](...c.args)), c.expect, c.id);
  }
});

test('the fixture file holds synthetic inputs only', () => {
  const text = readFileSync(OUT, 'utf8');
  for (const [email] of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
    assert.ok(email.endsWith('@example.com'), email);
  }
  for (const [number] of text.matchAll(/\+\d[\d ().-]{7,}\d/g)) {
    assert.ok(number.includes('555-01'), number);
  }
});
