import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { channelOf, startUpdates } from '../src/updates.js';

// The states the shell may send are the bridge spec's. Every state an update raises here is checked against that
// list, so a state renamed on one side fails a test rather than going quiet on the page.
const DECLARED_STATES = JSON.parse(readFileSync(new URL('../../core/spec/host-bridge.json', import.meta.url), 'utf8')).events['update.state'].states;
test('prereleases follow dev and stable builds follow latest', () => {
  assert.equal(channelOf('1.0.1-dev.10.abcdef0123'), 'dev');
  assert.equal(channelOf('1.0.0'), 'latest');
});
test('checks at boot and every four hours, reports available and ready, and stops cleanly', async () => {
  const updater = new EventEmitter();
  let checks = 0; let callback; const states = []; let cleared;
  updater.checkForUpdates = async () => { checks++; };
  const stop = startUpdates({ updater, version: '1.0.1-dev.3.abc', onState: (s) => states.push(s), logError: assert.fail, setTimer: (fn, ms) => { callback = fn; assert.equal(ms, 14400000); return 42; }, clearTimer: (id) => { cleared = id; } });
  await Promise.resolve();
  assert.equal(checks, 1);
  await callback();
  assert.equal(checks, 2);
  assert.equal(updater.autoDownload, true);
  assert.equal(updater.autoInstallOnAppQuit, true);
  assert.equal(updater.allowDowngrade, false);
  assert.equal(updater.allowPrerelease, true);
  updater.emit('update-available', { version: '1.0.1-dev.4.def' });
  assert.deepEqual(states.at(-1), { state: 'available', version: '1.0.1-dev.4.def' });
  updater.emit('update-downloaded', { version: '1.0.1-dev.4.def' });
  assert.deepEqual(states.at(-1), { state: 'ready', version: '1.0.1-dev.4.def' });
  for (const s of states) assert.ok(DECLARED_STATES.includes(s.state), s.state + ' is declared in the bridge spec');
  stop();
  assert.equal(cleared, 42);
  assert.equal(updater.listenerCount('update-available'), 0);
  assert.equal(updater.listenerCount('update-downloaded'), 0);
  assert.equal(updater.listenerCount('error'), 0);
});
test('network failure is contained, reported as an error state, and the next check can retry', async () => {
  const updater = new EventEmitter(); let errors = 0; let callback; const states = [];
  updater.checkForUpdates = async () => { throw new Error('private transport details'); };
  const stop = startUpdates({ updater, version: '1.0.0', onState: (s) => states.push(s), logError: (message) => { errors++; assert.ok(!message.includes('private')); }, setTimer: (fn) => { callback = fn; }, clearTimer: () => {} });
  await Promise.resolve(); await Promise.resolve(); await callback();
  assert.equal(errors, 2);
  assert.equal(states.filter((s) => s.state === 'error').length, 2, 'each failure is reported as an error state');
  for (const s of states) assert.ok(DECLARED_STATES.includes(s.state), s.state + ' is declared in the bridge spec');
  assert.equal(updater.allowPrerelease, false);
  stop();
});
