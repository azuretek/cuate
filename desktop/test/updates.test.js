import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
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
// The states the shell may send are the bridge spec's, so a state renamed on one side fails here rather than going
// quiet on the page.
const DECLARED_STATES = JSON.parse(readFileSync(new URL('../../core/spec/host-bridge.json', import.meta.url), 'utf8')).events['update.state'].states;

test('prereleases follow dev and stable builds follow latest', () => {
  assert.equal(channelOf('1.0.1-dev.10.abcdef0123'), 'dev');
  assert.equal(channelOf('1.0.0'), 'latest');
});

test('every state the shell emits is declared in the bridge spec', async () => {
  const updater = make();
  const { states, onState } = collect();
  const ctl = startUpdates({ updater, version: '1.0.0', platform: 'darwin', packaged: true, autoDownload: true, onState, ...quiet });
  await Promise.resolve();
  updater.emit('update-available', { version: '1.2.3' });
  updater.emit('download-progress', { percent: 10, transferred: 1, total: 10, bytesPerSecond: 1 });
  updater.emit('update-downloaded', { version: '1.2.3' });
  for (const s of states) {
    assert.ok(DECLARED_STATES.includes(s.state), s.state + ' is declared in the bridge spec');
    assert.equal(typeof s.canInstall, 'boolean', s.state + ' says whether the build can install, so the page offers no action it cannot take');
  }
  ctl.stop();
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

test('an explicit download runs even when automatic downloads are off, and install applies it on quit', async () => {
  const updater = make();
  updater.quitAndInstall = () => { updater.installs = (updater.installs || 0) + 1; };
  const { states, onState } = collect();
  const ctl = startUpdates({ updater, version: '1.0.0', platform: 'darwin', packaged: true, autoDownload: false, onState, ...quiet });
  await Promise.resolve();
  updater.emit('update-available', { version: '1.2.3' });
  assert.equal(states.at(-1).canInstall, true, 'the page is told the build can install, so it offers the action');
  // The setting off means nothing is fetched on its own, but an explicit download is never blocked by it.
  assert.equal(updater.downloads, undefined);
  assert.equal(ctl.download(), true);
  await Promise.resolve();
  assert.equal(updater.downloads, 1);
  // A second request while the transfer is still running starts no second transfer.
  assert.equal(ctl.download(), true);
  assert.equal(updater.downloads, 1);
  // Nothing is installed before the download has landed and been verified.
  assert.equal(ctl.install(), false);
  updater.emit('update-downloaded', { version: '1.2.3' });
  assert.equal(states.at(-1).state, 'ready');
  assert.equal(ctl.install(), true);
  assert.equal(updater.installs, 1);
  ctl.stop();
});

test('a build that cannot install refuses the download and the install', async () => {
  const updater = make();
  updater.quitAndInstall = () => { updater.installs = (updater.installs || 0) + 1; };
  const { states, onState } = collect();
  const ctl = startUpdates({ updater, version: '1.0.0', platform: 'linux', packaged: true, appImage: false, autoDownload: true, onState, ...quiet });
  await Promise.resolve();
  updater.emit('update-available', { version: '1.2.3' });
  assert.equal(states.at(-1).canInstall, false);
  assert.equal(ctl.download(), false);
  assert.equal(ctl.install(), false);
  assert.equal(updater.downloads, undefined);
  assert.equal(updater.installs, undefined);
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

test('the check runs at start, before the interval, and the interval keeps its own cadence', async () => {
  const updater = make(); let checks = 0; const timers = [];
  updater.checkForUpdates = async () => { checks++; updater.emit('update-available', { version: '1.2.3' }); };
  const { states, onState } = collect();
  const ctl = startUpdates({ updater, version: '1.0.0', platform: 'darwin', packaged: true, autoDownload: false, onState, logError: assert.fail, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {} });
  await Promise.resolve();
  assert.equal(checks, 1, 'opening the app checks at once rather than waiting for the first tick');
  assert.equal(states.at(-1).state, 'available', 'and a newer release is reported from that check');
  const interval = timers.find((t) => t.ms >= 60 * 60 * 1000);
  assert.ok(interval, 'an interval is still armed for an app left open');
  await interval.fn();
  assert.equal(checks, 2, 'the interval checks on its own cadence');
  // Both checks report the same release; the page's notice key is what keeps that to one notice.
  assert.deepEqual(states.filter((s) => s.state === 'available').map((s) => s.version), ['1.2.3', '1.2.3']);
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

test('a check someone asked for says it is checking, then that this build is current when nothing is newer', async () => {
  const updater = make(); let checks = 0; updater.checkForUpdates = async () => { checks++; };
  const { states, onState } = collect();
  const ctl = startUpdates({ updater, version: '1.0.0', platform: 'darwin', packaged: true, autoDownload: true, onState, ...quiet });
  await Promise.resolve();
  updater.emit('update-not-available', { version: '1.0.0' });
  assert.equal(states.length, 0, 'the scheduled check stays quiet when nothing is newer');
  assert.equal(ctl.check(), true);
  assert.equal(states.at(-1).state, 'checking');
  await Promise.resolve();
  assert.equal(checks, 2, 'the same check the schedule runs');
  updater.emit('update-not-available', { version: '1.0.0' });
  assert.deepEqual(states.at(-1), { state: 'current', version: '1.0.0', canInstall: true });
  for (const s of states) assert.ok(DECLARED_STATES.includes(s.state), s.state + ' is declared in the bridge spec');
  ctl.stop();
});

test('a check someone asked for that finds a release reports it as the schedule does', async () => {
  const updater = make();
  const { states, onState } = collect();
  const ctl = startUpdates({ updater, version: '1.0.0', platform: 'darwin', packaged: true, autoDownload: false, onState, ...quiet });
  await Promise.resolve();
  ctl.check();
  updater.emit('update-available', { version: '1.2.3' });
  updater.emit('update-not-available', {});
  assert.deepEqual(states.map((s) => s.state), ['checking', 'available'], 'a found release ends the asked-for check');
  ctl.stop();
});

test('a check asked for once an update is downloaded says it is ready rather than checking again', async () => {
  const updater = make(); let checks = 0; updater.checkForUpdates = async () => { checks++; };
  const { states, onState } = collect();
  const ctl = startUpdates({ updater, version: '1.0.0', platform: 'darwin', packaged: true, autoDownload: true, onState, ...quiet });
  await Promise.resolve();
  updater.emit('update-downloaded', { version: '1.2.3' });
  const before = checks;
  ctl.check();
  assert.equal(checks, before);
  assert.equal(states.at(-1).state, 'ready');
  assert.equal(states.at(-1).version, '1.2.3');
  ctl.stop();
});

test('a build that cannot check answers a check with why, instead of doing nothing', () => {
  const updater = make();
  const { states, onState } = collect();
  const ctl = startUpdates({ updater, version: '1.0.0', platform: 'linux', packaged: true, appImage: false, onState, ...quiet });
  assert.equal(ctl.check(), false);
  assert.equal(states.at(-1).state, 'unsupported');
  assert.match(states.at(-1).detail, /AppImage/);
  ctl.stop();
});

test('install tells the shell it is quitting before the restart, so a window that hides on close lets it through', async () => {
  const updater = make();
  const order = [];
  updater.quitAndInstall = () => order.push('quitAndInstall');
  const { onState } = collect();
  const ctl = startUpdates({ updater, version: '1.0.0', platform: 'darwin', packaged: true, autoDownload: true, onState, onQuit: () => order.push('onQuit'), ...quiet });
  await Promise.resolve();
  assert.equal(ctl.install(), false, 'nothing downloaded, nothing installed');
  assert.deepEqual(order, [], 'a refused install does not mark the app quitting');
  updater.emit('update-downloaded', { version: '1.2.3' });
  assert.equal(ctl.install(), true);
  assert.deepEqual(order, ['onQuit', 'quitAndInstall']);
  ctl.stop();
});
