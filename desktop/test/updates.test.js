import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { channelOf, startUpdates } from '../src/updates.js';
test('prereleases follow dev and stable builds follow latest', () => {
  assert.equal(channelOf('1.0.1-dev.10.abcdef0123'), 'dev');
  assert.equal(channelOf('1.0.0'), 'latest');
});
test('checks at boot and every four hours, downloads, notifies and installs only on restart', async () => {
  const updater = new EventEmitter();
  let checks = 0; let callback; let notice; let cleared;
  updater.checkForUpdates = async () => { checks++; };
  const stop = startUpdates({ updater, version: '1.0.1-dev.3.abc', notify: (...args) => { notice = args; }, logError: assert.fail, setTimer: (fn, ms) => { callback = fn; assert.equal(ms, 14400000); return 42; }, clearTimer: (id) => { cleared = id; } });
  await Promise.resolve();
  assert.equal(checks, 1);
  await callback();
  assert.equal(checks, 2);
  assert.equal(updater.autoDownload, true);
  assert.equal(updater.autoInstallOnAppQuit, true);
  assert.equal(updater.allowDowngrade, false);
  assert.equal(updater.allowPrerelease, true);
  updater.emit('update-downloaded');
  assert.match(notice[1], /Restart/);
  stop(); assert.equal(cleared, 42); assert.equal(updater.listenerCount('error'), 0);
});
test('network failure is contained and the next check can retry', async () => {
  const updater = new EventEmitter(); let errors = 0; let callback;
  updater.checkForUpdates = async () => { throw new Error('private transport details'); };
  const stop = startUpdates({ updater, version: '1.0.0', notify: assert.fail, logError: (message) => { errors++; assert.ok(!message.includes('private')); }, setTimer: (fn) => { callback = fn; }, clearTimer: () => {} });
  await Promise.resolve(); await Promise.resolve(); await callback();
  assert.equal(errors, 2); assert.equal(updater.allowPrerelease, false); stop();
});
