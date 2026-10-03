import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sanitizeText, sanitizeState, smokeStateExpression, retainSmokeFailure } from '../src/smoke-failure.js';

const scratch = () => mkdtempSync(join(tmpdir(), 'smoke-failure-'));

test('sanitizeText redacts secrets and person-specific paths', () => {
  const out = sanitizeText('token=gho_abcdefghijklmnopqrstuv path /Users/runner/work/project and /home/runner/x Bearer abcdefghijklmnop');
  assert.ok(!out.includes('gho_'), out);
  assert.ok(!out.includes('/Users/runner'), out);
  assert.ok(!out.includes('/home/runner'), out);
  assert.ok(!out.includes('abcdefghijklmnop'), out);
  assert.ok(out.includes('<hidden>'), out);
});

test('sanitizeText removes a passed secret verbatim', () => {
  const out = sanitizeText('url http://127.0.0.1:4123 and SMOKE_TOKEN_SECRET', ['SMOKE_TOKEN_SECRET', 'http://127.0.0.1:4123']);
  assert.ok(!out.includes('SMOKE_TOKEN_SECRET'), out);
  assert.ok(!out.includes('http://127.0.0.1:4123'), out);
});

test('sanitizeState bounds array breadth and object depth', () => {
  assert.equal(sanitizeState(Array.from({ length: 100 }, (_, i) => i)).length, 50);
  let deep = 'leaf';
  for (let i = 0; i < 20; i += 1) deep = { child: deep };
  let node = sanitizeState(deep);
  let depth = 0;
  while (node && typeof node === 'object' && node.child !== undefined) { node = node.child; depth += 1; }
  assert.ok(depth <= 9, 'depth ' + depth);
});

test('the renderer state expression compiles', () => {
  const expr = smokeStateExpression();
  assert.match(expr, /sheetPresent/);
  assert.match(expr, /bannerText/);
  assert.doesNotThrow(() => new Function('return ' + expr));
});

test('retainSmokeFailure writes a sanitized dump and bounded screenshot, only on failure', async () => {
  const dir = scratch();
  try {
    const evidence = await retainSmokeFailure({
      evaluate: async () => ({ phase: 'ready', view: 'settings', sheetPresent: true, sheetLeaving: true, sheetAnimation: 'surface-sheet-out 0.2s running', bannerText: 'This build does not update itself.', url: 'app://bundle/app/index.html', dialogs: ['Settings'] }),
      capture: async () => Buffer.from([137, 80, 78, 71]),
      write: (name, data) => writeFileSync(join(dir, name), data),
      error: new Error('timed out waiting for no sheet and the update banner'),
      now: () => '2026-10-03T00:00:00.000Z',
    });
    const json = JSON.parse(readFileSync(join(dir, 'failure.json'), 'utf8'));
    assert.equal(json.at, '2026-10-03T00:00:00.000Z');
    assert.equal(json.error, 'timed out waiting for no sheet and the update banner');
    assert.equal(json.renderer.sheetPresent, true);
    assert.equal(json.renderer.sheetAnimation, 'surface-sheet-out 0.2s running');
    assert.equal(evidence.renderer.bannerText, 'This build does not update itself.');
    assert.equal(readFileSync(join(dir, 'failure.png')).length, 4);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('retainSmokeFailure bounds a renderer that never answers and still writes', async () => {
  const dir = scratch();
  try {
    await retainSmokeFailure({
      evaluate: () => new Promise(() => {}),
      capture: async () => Buffer.from([1]),
      write: (name, data) => writeFileSync(join(dir, name), data),
      error: new Error('boom'),
      boundMs: 50,
    });
    const json = JSON.parse(readFileSync(join(dir, 'failure.json'), 'utf8'));
    assert.match(json.renderer.error, /did not answer within 50ms/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('retainSmokeFailure records a renderer error and a capture failure without throwing', async () => {
  const dir = scratch();
  try {
    const evidence = await retainSmokeFailure({
      evaluate: async () => { throw new Error('renderer gone'); },
      capture: async () => { throw new Error('no capture tool'); },
      write: (name, data) => writeFileSync(join(dir, name), data),
      error: new Error('the real failure'),
    });
    assert.equal(evidence.renderer.error, 'renderer gone');
    assert.equal(evidence.screenshot, 'failed: no capture tool');
    assert.equal(JSON.parse(readFileSync(join(dir, 'failure.json'), 'utf8')).renderer.error, 'renderer gone');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the smoke retains failure state only on its failure path', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const start = main.indexOf('runSmoke(win).catch');
  const catchBlock = main.slice(start, main.indexOf('app.exit(1);', start));
  assert.ok(catchBlock.includes('retainSmokeFailure('), 'retention must run inside the smoke failure path');
  assert.ok(!main.includes('SMOKE && retainSmokeFailure'), 'retention must not run on the success path');
});
