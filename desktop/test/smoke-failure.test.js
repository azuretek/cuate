import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sanitizeText, sanitizeState, smokeStateExpression, smokeTraceInstaller, retainSmokeFailure, TRACE_LIMIT } from '../src/smoke-failure.js';

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

// A page stand-in with just what the installer touches: listeners on the document, the body's class list and one
// MutationObserver. Enough to drive the installer as the page would, without a browser.
function fakePage() {
  const listeners = {};
  const classes = new Set();
  let observer = null;
  const document = {
    visibilityState: 'visible',
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    body: { classList: { contains: (c) => classes.has(c) } },
  };
  const el = (cls) => ({ classList: { contains: (c) => c === cls } });
  const window = {};
  const page = new Function('window', 'document', 'performance', 'MutationObserver', 'return ' + smokeTraceInstaller());
  const run = () => page(window, document, { now: () => 1234.4 }, class { constructor(fn) { observer = fn; } observe() {} });
  const fire = (type, target, extra = {}) => (listeners[type] || []).forEach((fn) => fn({ target, ...extra }));
  const setLeaving = (on) => { if (on) classes.add('surface--leaving'); else classes.delete('surface--leaving'); observer(); };
  return { window, document, run, fire, setLeaving, sheet: el('sheet'), scrim: el('sheet-scrim'), other: el('bubble') };
}

test('the sheet trace records whether a departure started, ended or was cancelled, and the page visibility', () => {
  const p = fakePage();
  assert.equal(p.run(), true);
  p.setLeaving(true);
  p.document.visibilityState = 'hidden';
  p.fire('visibilitychange', p.document);
  p.fire('animationstart', p.sheet, { animationName: 'surface-sheet-out' });
  p.fire('animationstart', p.other, { animationName: 'press' });
  p.fire('animationcancel', p.scrim, { animationName: 'surface-scrim-out' });
  assert.deepEqual(p.window.__smokeTrace.map((x) => [x.e, x.who, x.anim, x.vis]), [
    ['leaving-on', undefined, undefined, 'visible'],
    ['visibility', undefined, undefined, 'hidden'],
    ['animationstart', 'sheet', 'surface-sheet-out', 'hidden'],
    ['animationcancel', 'scrim', 'surface-scrim-out', 'hidden'],
  ]);
  assert.equal(p.window.__smokeTrace[0].t, 1234);
  // Installing again (the smoke reinstalls on every load) keeps the one trace rather than doubling its listeners.
  assert.equal(p.run(), true);
  p.fire('animationend', p.sheet, { animationName: 'surface-sheet-out' });
  assert.equal(p.window.__smokeTrace.filter((x) => x.e === 'animationend').length, 1);
});

test('the sheet trace is bounded', () => {
  const p = fakePage();
  p.run();
  for (let i = 0; i < TRACE_LIMIT * 3; i += 1) p.fire('animationstart', p.sheet, { animationName: 'a' + i });
  assert.equal(p.window.__smokeTrace.length, TRACE_LIMIT);
  assert.equal(p.window.__smokeTrace.at(-1).anim, 'a' + (TRACE_LIMIT * 3 - 1));
  assert.match(smokeStateExpression(), /__smokeTrace/);
});

test('retainSmokeFailure records what the shell knows about the window, and survives a shell that throws', async () => {
  const dir = scratch();
  try {
    const shown = await retainSmokeFailure({
      evaluate: async () => ({}), capture: async () => null, write: (name, data) => writeFileSync(join(dir, name), data),
      error: new Error('x'), shell: () => ({ visible: false, minimized: false, focused: false, throttled: true }),
    });
    assert.deepEqual(shown.shell, { visible: false, minimized: false, focused: false, throttled: true });
    const broken = await retainSmokeFailure({
      evaluate: async () => ({}), capture: async () => null, write: () => {}, error: new Error('x'),
      shell: () => { throw new Error('window destroyed'); },
    });
    assert.equal(broken.shell.error, 'window destroyed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
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
