// The Mac care wired to the server, proven with fakes so the suite still needs no Mac: the status route, the
// restart route and its admin gate, the wiring that holds sleep off and locks only once the engine is ready, and
// the config the command line writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boot } from './helpers.js';
import { apiSpec, logSpec } from '../src/paths.js';
import { validate } from '../../core/kit/rules/schema.js';
import { createLogger } from '../../core/kit/log.js';
import { macConfig } from '../src/mac.js';
import { startMacCare } from '../src/mac-care.js';

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/main.js');
const run = (dir, ...args) => execFileSync(process.execPath, [cli, ...args, '--data', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const conforms = (v, type) => assert.deepEqual(validate(v, type, apiSpec.models), []);

/** The Mac control with every effect faked, so a route or the wiring is provable without a Mac. */
const fakeMac = (settings = {}, over = {}) => {
  const s = macConfig(settings);
  return {
    settings: s,
    state: () => ({ awake: true, locked: false, lockEnabled: s.lock.enabled, lockMethod: s.lock.method, managedBy: s.messages.managedBy }),
    messagesRunning: async () => true,
    holdAwake: async () => ({ held: true }),
    releaseAwake: () => ({ held: false }),
    lockScreen: async () => ({ locked: true }),
    relaunchMessages: async () => ({ launched: true }),
    ...over,
  };
};
const fakeRestarts = () => {
  const calls = [];
  return {
    calls,
    messages: async () => { calls.push('messages'); return { restarted: true }; },
    engine: async () => { calls.push('engine'); return { restarted: true }; },
    server: () => { calls.push('server'); return { restarted: true }; },
  };
};

test('the Mac status route reports what the server is holding, and conforms', async (t) => {
  const mac = fakeMac({ lock: { enabled: true, method: 'displaySleep' }, messages: { managedBy: 'bluebubbles' } });
  const s = await boot({ mac });
  t.after(() => s.close());
  const r = await s.get('/api/v1/mac', s.tokens.device);
  assert.equal(r.status, 200);
  const b = await r.json();
  conforms(b, 'MacState');
  assert.equal(b.awake, true);
  assert.equal(b.lockEnabled, true);
  assert.equal(b.lockMethod, 'displaySleep');
  assert.equal(b.messagesRunning, true);
  assert.equal(b.managedBy, 'bluebubbles');
});

test('the Mac status route says so plainly when the server is not looking after the Mac', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const r = await s.get('/api/v1/mac', s.tokens.device);
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error.code, 'mac_unavailable');
});

test('a restart needs an admin token, and each action is one request', async (t) => {
  const restarts = fakeRestarts();
  const s = await boot({ mac: fakeMac(), restarts });
  t.after(() => s.close());
  for (const what of ['messages', 'engine']) {
    const r = await s.post('/api/v1/mac/restart', s.tokens.admin, { what });
    assert.equal(r.status, 200);
    const b = await r.json();
    conforms(b, 'MacRestartResult');
    assert.equal(b.what, what);
    assert.equal(b.restarted, true);
  }
  assert.deepEqual(restarts.calls, ['messages', 'engine']);
  // A device or tooling token is refused before anything is done; the server's own restart answers first.
  for (const tok of [s.tokens.device, s.tokens.tooling]) assert.equal((await s.post('/api/v1/mac/restart', tok, { what: 'messages' })).status, 403);
  const srv = await s.post('/api/v1/mac/restart', s.tokens.admin, { what: 'server' });
  assert.equal(srv.status, 200);
  assert.equal((await srv.json()).what, 'server');
  assert.deepEqual(restarts.calls, ['messages', 'engine', 'server']);
});

test('a restart request with an unknown action or field is refused', async (t) => {
  const s = await boot({ mac: fakeMac(), restarts: fakeRestarts() });
  t.after(() => s.close());
  assert.equal((await s.post('/api/v1/mac/restart', s.tokens.admin, { what: 'everything' })).status, 400);
  assert.equal((await s.post('/api/v1/mac/restart', s.tokens.admin, { what: 'messages', extra: 1 })).status, 400);
});

test('the Mac care holds sleep off, locks once the engine is ready, and lets the hold go on stop', async () => {
  const lines = [];
  const log = createLogger({ spec: logSpec, app: 'test', run: 'test', sink: (l) => lines.push(l), now: Date.now, level: 'debug', strict: true });
  const cbs = [];
  const state = { ready: false };
  const calls = [];
  const engine = { info: () => ({ ready: state.ready }), start: async () => {}, onState: (cb) => cbs.push(cb) };
  // The fakes log exactly as the real control does, so the test also proves the events the wiring sends.
  const mac = fakeMac({ lock: { enabled: true } }, {
    holdAwake: async () => { calls.push('hold'); log.emit('mac.awake', { on: true }); return { held: true }; },
    releaseAwake: () => { calls.push('release'); log.emit('mac.awake', { on: false }); return { held: false }; },
    lockScreen: async () => { calls.push('lock'); log.emit('mac.lock', { method: 'displaySleep', locked: true }); return { locked: true }; },
  });
  const care = startMacCare({ mac, engine, log, everyMs: 60 * 60 * 1000 });
  await care.start();
  assert.deepEqual(calls, ['hold'], 'the hold starts with the care, and nothing is locked before the engine is ready');
  state.ready = true;
  for (const cb of cbs) cb({ ready: true });
  for (let i = 0; i < 5 && !calls.includes('lock'); i++) await new Promise((r) => setImmediate(r));
  assert.ok(calls.includes('lock'), 'the lock follows the engine becoming ready');
  care.stop();
  assert.equal(calls.at(-1), 'release');
  assert.deepEqual(lines.filter((l) => l.event === 'mac.awake').map((l) => l.on), [true, false]);
  assert.ok(lines.some((l) => l.event === 'mac.lock' && l.locked === true));
});

test('the Mac care leaves the screen alone when locking is off, even once the engine is ready', async () => {
  const lines = [];
  const log = createLogger({ spec: logSpec, app: 'test', run: 'test', sink: (l) => lines.push(l), now: Date.now, level: 'debug', strict: true });
  const calls = [];
  const engine = { info: () => ({ ready: true }), start: async () => {}, onState: () => {} };
  const mac = fakeMac({ lock: { enabled: false } }, { lockScreen: async () => { calls.push('lock'); return { locked: true }; } });
  const care = startMacCare({ mac, engine, log, everyMs: 60 * 60 * 1000 });
  await care.start();
  assert.deepEqual(calls, []);
  care.stop();
});

test('the mac command reads and writes the Mac care in the config', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'srv-mac-cli-'));
  try {
    run(dir, 'init', '--engine', 'fake');
    const read = () => JSON.parse(readFileSync(path.join(dir, 'config.json'), 'utf8'));
    assert.equal(read().mac.awake, true);
    assert.match(run(dir, 'mac', 'status'), /awake +on/);
    assert.match(run(dir, 'mac', 'awake', 'off'), /awake is off/);
    assert.equal(read().mac.awake, false);
    assert.match(run(dir, 'mac', 'lock', 'on'), /lock is on/);
    assert.equal(read().mac.lock.enabled, true);
    assert.match(run(dir, 'mac', 'lock', 'method', 'loginFramework'), /loginFramework/);
    assert.equal(read().mac.lock.method, 'loginFramework');
    assert.throws(() => run(dir, 'mac', 'lock', 'method', 'telepathy'), /method must be one of/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('turning the lock on with an engine that needs the screen is refused, not half applied', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'srv-mac-cli-'));
  try {
    run(dir, 'init', '--engine', 'fake');
    const file = path.join(dir, 'config.json');
    const cfg = JSON.parse(readFileSync(file, 'utf8'));
    cfg.engine.needsScreen = true;
    writeFileSync(file, JSON.stringify(cfg, null, 2));
    assert.throws(() => run(dir, 'mac', 'lock', 'on'), /needs the screen unlocked/);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).mac.lock.enabled, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
