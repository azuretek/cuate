import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { channelOf, startUpdates } from '../src/updates.js';
import { checksumMatches, installPolicy } from '../../core/app/rules/updates.js';

const make = () => {
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => {};
  updater.downloadUpdate = async () => { updater.downloads = (updater.downloads || 0) + 1; };
  return updater;
};
const collect = () => { const states = []; return { states, onState: (s) => states.push(s) }; };
const quiet = { logError: assert.fail, setTimer: () => 0, clearTimer: () => {} };

test('prereleases follow dev and stable builds follow latest', () => {
  assert.equal(channelOf('1.0.1-dev.10.abcdef0123'), 'dev');
  assert.equal(channelOf('1.0.0'), 'latest');
});

test('a source run does not check at all', async () => {
  const updater = make(); let checks = 0; updater.checkForUpdates = async () => { checks++; };
  const { onState } = collect();
  const ctl = startUpdates({ updater, version: '1.0.0', platform: 'darwin', packaged: false, onState, ...quiet });
  await Promise.resolve();
  assert.equal(checks, 0);
  assert.equal(updater.autoDownload, false);
  ctl.stop();
});

test('automatic download off: a found release is announced and nothing is fetched', async () => {
  const updater = make();
  const { states, onState } = collect();
  const ctl = startUpdates({ updater, version: '1.0.0', platform: 'darwin', packaged: true, autoDownload: false, onState, ...quiet });
  assert.equal(updater.autoDownload, false, 'the setting narrows the platform answer');
  assert.equal(updater.autoInstallOnAppQuit, true, 'the install policy is applied on quit');
  await Promise.resolve();
  updater.emit('update-available', { version: '1.2.3' });
  assert.equal(states.at(-1).state, 'available');
  assert.equal(updater.downloads, undefined, 'nothing was fetched on its own');
  ctl.stop();
});

test('automatic download on: the release is fetched, progress reaches the surface, and ready names the check', async () => {
  const updater = make();
  const { states, onState } = collect();
  const ctl = startUpdates({ updater, version: '1.0.0', platform: 'darwin', packaged: true, autoDownload: true, onState, ...quiet });
  assert.equal(updater.autoDownload, true);
  await Promise.resolve();
  updater.emit('update-available', { version: '1.2.3' });
  updater.emit('download-progress', { percent: 42.5, transferred: 5 * 1024 * 1024, total: 12 * 1024 * 1024, bytesPerSecond: 1024 * 1024 });
  const p = states.at(-1);
  assert.equal(p.state, 'downloading');
  assert.equal(p.version, '1.2.3');
  assert.ok(Math.abs(p.percent - 0.425) < 1e-9);
  assert.match(p.detail, /5.0 MB of 12 MB/);
  updater.emit('update-downloaded', { version: '1.2.3' });
  assert.equal(states.at(-1).state, 'ready');
  assert.equal(states.at(-1).detail, 'code signature and checksum');
  ctl.stop();
});

test('turning the setting on later fetches a release the check already found', async () => {
  const updater = make();
  const { onState } = collect();
  const ctl = startUpdates({ updater, version: '1.0.0', platform: 'win32', packaged: true, autoDownload: false, onState, ...quiet });
  await Promise.resolve();
  updater.emit('update-available', { version: '1.2.3' });
  assert.equal(updater.downloads, undefined);
  assert.equal(ctl.setAutoDownload(true), true);
  await Promise.resolve();
  assert.equal(updater.downloads, 1);
  ctl.stop();
});

test('a failure is reported and the next check can retry', async () => {
  const updater = make(); let errors = 0; let callback;
  updater.checkForUpdates = async () => { throw new Error('private transport details'); };
  const { states, onState } = collect();
  const ctl = startUpdates({ updater, version: '1.0.0', platform: 'win32', packaged: true, autoDownload: true, onState, logError: (m) => { errors++; assert.ok(!m.includes('private')); }, setTimer: (fn) => { callback = fn; return 1; }, clearTimer: () => {} });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(errors, 1);
  assert.equal(states.at(-1).state, 'error');
  await callback();
  assert.equal(errors, 2);
  ctl.stop();
});

test('nothing is installed unverified: a mismatched checksum refuses', () => {
  assert.equal(checksumMatches('abc123', 'abc123'), true);
  assert.equal(checksumMatches('abc123', 'def456'), false);
  assert.equal(checksumMatches('abc123', null), false);
  assert.equal(checksumMatches('', ''), false);
});

test('the install policy applies an update on quit', () => {
  assert.equal(installPolicy().on, 'quit');
});
