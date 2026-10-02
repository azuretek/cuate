// The surface comparison is pure, so it is tested rather than trusted: a token the
// page resolved to the wrong value, or did not resolve at all, must be reported,
// and a value that differs only in case or surrounding whitespace must not be.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tokenMismatches, expectedTokens } from '../src/surface.js';

const spec = JSON.parse(readFileSync(new URL('../../core/spec/tokens.json', import.meta.url), 'utf8'));

test('a matching surface reports nothing', () => {
  const expected = expectedTokens(spec, 'dark');
  const resolved = {};
  for (const [name, value] of Object.entries(expected)) resolved[name] = '  ' + value.toUpperCase() + ' ';
  assert.deepEqual(tokenMismatches({ expected, resolved }), []);
});

test('a token resolved to the wrong value is reported, by name', () => {
  const expected = { '--color-accent': '#ff5c5c', '--color-bg': '#0e1015' };
  const bad = tokenMismatches({ expected, resolved: { '--color-accent': '#bd4531', '--color-bg': '#0e1015' } });
  assert.equal(bad.length, 1);
  assert.equal(bad[0].name, '--color-accent');
  assert.equal(bad[0].expected, '#ff5c5c');
  assert.equal(bad[0].got, '#bd4531');
});

test('a token the page never resolved is reported, not treated as a pass', () => {
  const bad = tokenMismatches({ expected: { '--color-bg': '#0e1015' }, resolved: {} });
  assert.equal(bad.length, 1);
  assert.equal(bad[0].name, '--color-bg');
  assert.equal(bad[0].got, null);
});

test('expectedTokens reads the named scheme, prefixed as the stylesheet writes it', () => {
  const light = expectedTokens(spec, 'light');
  const dark = expectedTokens(spec, 'dark');
  assert.equal(light['--color-bg'], spec.color.light.bg);
  assert.equal(dark['--color-bg'], spec.color.dark.bg);
  assert.notEqual(light['--color-bg'], dark['--color-bg']);
  assert.deepEqual(expectedTokens(spec, 'missing'), {});
});
