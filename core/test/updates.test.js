import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  capability, policy, downloadProgress, transferDetail, downloadingNotice, stalledNotice,
  verificationCheck, checksumMatches, installPolicy, updateBanner, availableBanner, readyBanner, failedBanner,
  INSTALL, MANUAL, NOTIFY, NONE, STALL_MS,
} from '../app/rules/updates.js';

test('the platform decides what a build may do about an update', () => {
  assert.equal(capability({ platform: 'win32', packaged: true }).action, INSTALL);
  assert.equal(capability({ platform: 'darwin', packaged: true }).action, INSTALL);
  assert.equal(capability({ platform: 'linux', packaged: true, appImage: true }).action, INSTALL);
  assert.equal(capability({ platform: 'linux', packaged: true, appImage: false }).action, NOTIFY);
  assert.equal(capability({ platform: 'linux', packaged: true, appImage: false }).check, false);
  assert.equal(capability({ platform: 'ios', packaged: true }).action, NOTIFY);
  assert.equal(capability({ platform: 'darwin', packaged: false }).action, NONE);
});

test('the download preference narrows the platform answer, both ways', () => {
  const on = policy({ platform: 'win32', packaged: true, autoDownload: true });
  assert.equal(on.action, INSTALL);
  assert.equal(on.autoDownload, true);
  const off = policy({ platform: 'win32', packaged: true, autoDownload: false });
  assert.equal(off.action, MANUAL);
  assert.equal(off.autoDownload, false);
  assert.equal(off.check, true, 'it still looks, so installing by hand is possible');
  const phone = policy({ platform: 'ios', packaged: true, autoDownload: true });
  assert.equal(phone.action, NOTIFY);
  assert.equal(phone.canInstall, false);
  assert.equal(phone.autoDownload, false, 'a build that cannot install is not made to by the preference');
});

test('progress arrives as a fraction, and an unknown report never throws', () => {
  assert.equal(downloadProgress({ percent: 0 }), 0);
  assert.equal(downloadProgress({ percent: 100 }), 1);
  assert.ok(Math.abs(downloadProgress({ percent: 42.5 }) - 0.425) < 1e-9);
  assert.equal(downloadProgress({ percent: 250 }), 1, 'clamped above');
  assert.equal(downloadProgress({ percent: -10 }), 0, 'clamped below');
  assert.equal(downloadProgress({}), null);
  assert.equal(downloadProgress(null), null);
});

test('the transfer line leaves out what the transport has not said', () => {
  assert.equal(transferDetail({ transferred: 5 * 1024 * 1024, total: 12 * 1024 * 1024, bytesPerSecond: 1024 * 1024 }), '5.0 MB of 12 MB, 1.0 MB/s');
  assert.equal(transferDetail({ transferred: 3 * 1024 * 1024 }), '3.0 MB');
  assert.equal(transferDetail({}), null);
  assert.equal(transferDetail(null), null);
});

test('the download and stall banners say what is true at that moment', () => {
  assert.deepEqual(downloadingNotice({ version: '1.2.3', transfer: '5.0 MB of 12 MB' }), { message: 'Downloading version 1.2.3.', detail: '5.0 MB of 12 MB' });
  assert.equal(downloadingNotice({}).detail, 'Starting the download.');
  assert.match(stalledNotice({ version: '1.2.3', stallMs: 45000 }).detail, /45 seconds/);
  assert.equal(updateBanner('downloading', { version: '1.2.3', percent: 0.5 }).percent, 0.5);
  assert.equal(updateBanner('stalled', { version: '1.2.3' }).percent, null);
  assert.equal(updateBanner('checking', {}), null);
});

test('the banner carries the action that takes a person from seeing a release to installing it', () => {
  // An available state offers the download, and the action names the bridge command the page must call.
  const available = updateBanner('available', { version: '1.2.3', canInstall: true });
  assert.equal(available.action.command, 'updates.download');
  assert.equal(available.percent, null);
  assert.match(available.message, /1\.2\.3/);
  // A platform that cannot install is told about the release by its notice alone, so it draws no banner and no action.
  assert.equal(updateBanner('available', { version: '1.2.3', canInstall: false }), null);
  // Ready offers the restart, which is the install command, and names the version it is about to apply.
  const ready = updateBanner('ready', { version: '1.2.3', canInstall: true });
  assert.equal(ready.action.command, 'updates.install');
  assert.equal(ready.percent, null);
  assert.match(ready.message, /1\.2\.3/);
  // A failure says so rather than doing nothing, and offers another download where the platform can install.
  const failed = updateBanner('error', { detail: 'the mirror went away', canInstall: true });
  assert.match(failed.message, /could not be downloaded/);
  assert.equal(failed.detail, 'the mirror went away');
  assert.equal(failed.action.command, 'updates.download');
  assert.equal(updateBanner('error', { canInstall: false }).action, null);
  // A stall is not a failure, so it carries no action and never pretends one happened.
  assert.equal(updateBanner('stalled', { version: '1.2.3', canInstall: true }).action, null);
  // The copy a caller can use on its own reads the same as the banner builds it.
  assert.equal(availableBanner({ version: '1.2.3' }).message, available.message);
  assert.equal(readyBanner({ version: '1.2.3' }).message, ready.message);
  assert.equal(failedBanner({}).detail, 'Nothing was installed. You can try again.');
});

test('the verification check is named per platform, and a checksum refuses a bad artifact', () => {
  assert.equal(verificationCheck({ platform: 'win32' }).name, 'publisher signature');
  assert.match(verificationCheck({ platform: 'darwin' }).name, /signature/);
  assert.match(verificationCheck({ platform: 'linux' }).name, /checksum/);
  assert.equal(checksumMatches('A1B2', 'a1b2'), true, 'case does not matter');
  assert.equal(checksumMatches('a1b2', 'a1b3'), false);
  assert.equal(checksumMatches('a1b2', ''), false);
  assert.equal(checksumMatches(null, null), false);
});

test('an update is applied on quit, and the stall window is named', () => {
  assert.equal(installPolicy().on, 'quit');
  assert.equal(STALL_MS, 45000);
});
