// Issue 192: the phones learn of a newer build from the repository's public release feed (every published test build
// passed the platforms gate, so it is in TestFlight and, from this change, carries its signed APK), compare it with the
// running build, and act: iOS sends the reader to TestFlight, Android downloads the APK, verifies it against the
// release's manifest and hands it to the system installer. The decisions are pure and live here, so both shells and
// the release pipeline reach the same answer from one place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  feedVersions, newestRelease, phoneUpdate, capability, updateBanner, aboutUpdate, fillTemplate, releaseAssets, apkManifestProblem, checkAnswer,
} from '../app/rules/updates.js';
import { appUpdateNotice } from '../app/rules/app-notices.js';

const read = (rel) => readFileSync(new URL('../../' + rel, import.meta.url), 'utf8');
const releases = JSON.parse(read('core/spec/releases.json'));
const naming = JSON.parse(read('core/spec/naming.json'));

// A feed in the shape GitHub serves (releases.atom): newest first, the tag at the end of each entry's <id>.
const entry = (tag) => '<entry>\n<id>tag:github.com,2008:Repository/1/' + tag + '</id>\n<title>' + tag + '</title>\n<content type="html">Test build.</content>\n</entry>';
const feed = (...tags) => '<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">\n<id>tag:github.com,2008:https://github.com/owner/app/releases</id>\n' + tags.map(entry).join('\n') + '\n</feed>';
const DEV_97 = '0.0.1-dev.97.370d8cc7a0';
const DEV_98 = '0.0.1-dev.98.7699911abc';
const DEV_100 = '0.0.2-dev.100.0123456789';
const escape = (s) => s.replaceAll('.', '\\.');

test('the feed is read as the release versions it names, skipping what is not a release', () => {
  assert.deepEqual(feedVersions(feed('v' + DEV_98, 'v' + DEV_97, 'not-a-release', 'v1.0.0')), [DEV_98, DEV_97, '1.0.0']);
  assert.deepEqual(feedVersions(feed()), [], 'a feed with no releases names none');
  assert.equal(feedVersions('<html>rate limited</html>'), null, 'a body that is not a feed is not read as an empty one');
  assert.equal(feedVersions(null), null);
  assert.equal(feedVersions(''), null);
});

test('the newest release is chosen by version on the build\'s own channel, never by feed position', () => {
  assert.equal(newestRelease([DEV_97, DEV_100, DEV_98], 'dev'), DEV_100);
  assert.equal(newestRelease([DEV_97, '1.0.0'], 'stable'), '1.0.0');
  assert.equal(newestRelease([DEV_97], 'stable'), null, 'a stable build is never offered a test build');
  assert.equal(newestRelease([], 'dev'), null);
});

test('version comparison: a newer build is offered, the same or an older one is not', () => {
  assert.deepEqual(phoneUpdate({ platform: 'ios', current: DEV_97, feed: feed('v' + DEV_98, 'v' + DEV_97) }), { state: 'available', version: DEV_98, canInstall: false, via: 'testflight' });
  assert.deepEqual(phoneUpdate({ platform: 'android', current: DEV_97, feed: feed('v' + DEV_98) }), { state: 'available', version: DEV_98, canInstall: true, via: 'apk' });
  assert.deepEqual(phoneUpdate({ platform: 'ios', current: DEV_98, feed: feed('v' + DEV_98, 'v' + DEV_97) }), { state: 'current', version: DEV_98, canInstall: false, via: 'testflight' });
  assert.equal(phoneUpdate({ platform: 'ios', current: DEV_100, feed: feed('v' + DEV_98) }).state, 'current', 'a build newer than every release is current');
  // The count is compared as a number, not as text: dev.100 is newer than dev.98 although '1' sorts before '9'.
  assert.equal(phoneUpdate({ platform: 'android', current: '0.0.2-dev.98.aaaaaaaaaa', feed: feed('v' + DEV_100) }).version, DEV_100);
});

test('a check that cannot be answered says why rather than claiming the build is current', () => {
  const unread = phoneUpdate({ platform: 'ios', current: DEV_97, feed: '<html></html>' });
  assert.equal(unread.state, 'error');
  assert.match(unread.detail, /release list/);
  const source = phoneUpdate({ platform: 'android', current: 'local', feed: feed('v' + DEV_98) });
  assert.equal(source.state, 'unsupported');
  assert.match(source.detail, /release version/);
  const stable = phoneUpdate({ platform: 'ios', current: '0.0.1', feed: feed('v' + DEV_98) });
  assert.equal(stable.state, 'current', 'a stable build with no stable release is on the newest one it may take');
});

test('the phones now check: iOS through TestFlight, Android by installing a verified APK', () => {
  const ios = capability({ platform: 'ios', packaged: true });
  assert.equal(ios.check, true);
  assert.equal(ios.canInstall, false);
  assert.equal(ios.via, 'testflight');
  assert.match(ios.reason, /TestFlight/);
  const android = capability({ platform: 'android', packaged: true });
  assert.equal(android.check, true);
  assert.equal(android.canInstall, true);
  assert.equal(android.via, 'apk');
  assert.match(android.reason, /APK/);
  assert.equal(capability({ platform: 'darwin', packaged: true }).via, undefined, 'the desktop keeps its own updater');
});

test('TestFlight link: an iOS release is offered with the action that opens TestFlight', () => {
  const banner = updateBanner('available', { version: DEV_98, canInstall: false, via: 'testflight' });
  assert.match(banner.message, new RegExp(escape(DEV_98)));
  assert.match(banner.message, /TestFlight/);
  assert.deepEqual(banner.action, { command: 'updates.install', label: 'Open TestFlight' });
  assert.equal(releases.testflight.app, 'itms-beta://', 'TestFlight\'s own scheme opens the app the reader was told to update');
  assert.match(releases.testflight.store, /^https:\/\/apps\.apple\.com\/app\/testflight\/id\d+$/, 'and its App Store page is the fallback');
  const notice = appUpdateNotice({ state: 'available', version: DEV_98, canInstall: false, via: 'testflight' });
  assert.equal(notice.action.label, 'Open TestFlight');
  assert.equal(notice.tone, 'info');
});

test('Android: available offers the download, ready offers the system installer, and the copy says Android confirms', () => {
  const available = updateBanner('available', { version: DEV_98, canInstall: true, via: 'apk' });
  assert.deepEqual(available.action, { command: 'updates.download', label: 'Download' });
  assert.doesNotMatch(available.detail, /automatic/, 'a phone has no automatic download to point at');
  const ready = updateBanner('ready', { version: DEV_98, canInstall: true, via: 'apk' });
  assert.deepEqual(ready.action, { command: 'updates.install', label: 'Install' });
  assert.match(ready.message, /verified/);
  assert.match(ready.detail, /Android/);
  assert.doesNotMatch(ready.detail, /quit/, 'nothing installs on quit on a phone');
  const failed = updateBanner('error', { detail: 'the APK is signed by a different key than this app', canInstall: true, via: 'apk' });
  assert.deepEqual(failed.action, { command: 'updates.download', label: 'Try again' });
});

test('About\'s Check for updates button reports the same progress and offers the same next step as the notice', () => {
  assert.deepEqual(aboutUpdate(null), { label: 'Check for updates', command: null, line: null, percent: null });
  assert.deepEqual(aboutUpdate({ state: 'current', version: DEV_98 }), { label: 'Check for updates', command: null, line: 'You are on the latest version.', percent: null });
  const ios = aboutUpdate({ state: 'available', version: DEV_98, via: 'testflight' });
  assert.equal(ios.label, 'Open TestFlight');
  assert.equal(ios.command, 'updates.install');
  assert.match(ios.line, /available/);
  assert.equal(aboutUpdate({ state: 'available', version: DEV_98, canInstall: true, via: 'apk' }).label, 'Download');
  const going = aboutUpdate({ state: 'downloading', version: DEV_98, percent: 0.42, canInstall: true, via: 'apk', detail: '5.0 MB of 12 MB' });
  assert.equal(going.label, 'Check for updates', 'the button never writes its own busy label');
  assert.equal(going.command, null);
  assert.equal(going.percent, 0.42);
  assert.match(going.line, /Downloading/);
  const ready = aboutUpdate({ state: 'ready', version: DEV_98, canInstall: true, via: 'apk' });
  assert.equal(ready.label, 'Install');
  assert.equal(ready.command, 'updates.install');
});

test('the release assets a phone fetches are named once, in core/spec/releases.json', () => {
  assert.equal(fillTemplate('{a}-{b}-{a}', { a: 'x', b: 'y' }), 'x-y-x');
  assert.throws(() => fillTemplate('{missing}', {}), /missing/);
  const assets = releaseAssets(releases, naming, DEV_98);
  assert.equal(assets.feed, 'https://github.com/' + naming.repo + '/releases.atom');
  assert.equal(assets.apk.name, naming.slug + '-android-' + DEV_98 + '.apk');
  assert.equal(assets.manifest.name, naming.slug + '-android-' + DEV_98 + '.manifest.json');
  assert.equal(assets.apk.url, 'https://github.com/' + naming.repo + '/releases/download/v' + DEV_98 + '/' + assets.apk.name);
  assert.equal(assets.manifest.url, 'https://github.com/' + naming.repo + '/releases/download/v' + DEV_98 + '/' + assets.manifest.name);
  assert.throws(() => releaseAssets(releases, naming, '../../etc'), /release version/, 'a version that is not one never becomes a path');
});

test('APK download and verification: the manifest the release carries is checked before an APK is trusted', () => {
  const sha = 'a'.repeat(64);
  const signer = 'b'.repeat(64);
  const want = { version: DEV_98, slug: naming.slug };
  const good = { version: DEV_98, commit: '7699911abc' + '0'.repeat(30), file: naming.slug + '-android-' + DEV_98 + '.apk', size: 1024, sha256: sha, signer };
  assert.equal(apkManifestProblem(good, want), null);
  assert.match(apkManifestProblem({ ...good, version: DEV_97 }, want), /version/);
  assert.match(apkManifestProblem({ ...good, file: '../evil.apk' }, want), /file/);
  assert.match(apkManifestProblem({ ...good, sha256: 'xyz' }, want), /digest/);
  assert.match(apkManifestProblem({ ...good, signer: '' }, want), /signer/);
  assert.match(apkManifestProblem({ ...good, size: 0 }, want), /size/);
  assert.match(apkManifestProblem({ ...good, commit: 'nope' }, want), /commit/);
  assert.match(apkManifestProblem({ ...good, commit: 'f'.repeat(40) }, want), /commit/, 'the commit is the one the version names');
  assert.match(apkManifestProblem(null, want), /manifest/);
  assert.equal(apkManifestProblem({ ...good, version: '1.0.0', file: naming.slug + '-android-1.0.0.apk', commit: 'f'.repeat(40) }, { version: '1.0.0', slug: naming.slug }), null, 'a stable version names no commit to compare');
});

test('the phone shells read the feed and report their build through the bridge the spec declares', () => {
  const spec = JSON.parse(read('core/spec/host-bridge.json'));
  assert.ok(spec.commands['updates.releases'], 'the bridge declares the release feed read');
  assert.equal(spec.commands['updates.download'].args.version, 'string?', 'a phone is told which release to fetch');
  const ios = read('ios/' + naming.product + '/HostBridge.swift');
  const android = read('android/app/src/main/kotlin/' + naming.ids.android.replaceAll('.', '/') + '/HostBridge.kt');
  for (const shell of [ios, android]) assert.match(shell, /updates\.releases/);
  assert.doesNotMatch(ios, /"state": "unsupported"/, 'iOS no longer answers that it does not update itself');
  assert.doesNotMatch(android, /put\("state", "unsupported"\)/, 'nor does Android');
  // A phone build reports its channel and build number, so About shows neither as Unknown (issue 192 comment).
  assert.match(ios, /"channel":/);
  assert.match(ios, /"build":/);
  assert.match(android, /put\("channel"/);
  assert.match(android, /put\("build"/);
});

test('a phone\'s answer is drawn with how it installs, and the desktop\'s is unchanged', () => {
  assert.equal(checkAnswer({ state: 'available', version: DEV_98, via: 'testflight' }, 'ios').via, 'testflight');
  assert.equal(checkAnswer({ state: 'current', version: DEV_98 }, 'darwin').via, undefined);
});
