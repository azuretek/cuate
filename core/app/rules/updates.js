// Pure: the update policy a client may act on, the words it shows while acting, and the check that stands between a
// download and an install. The shell owns the transport, the timer and the install; this module owns the decisions and
// the copy, so what a person sees during a download is the same on every platform and is tested with no network, no
// clock and no Electron. No clock, no I/O, no transport names.
import { channelOf, compareVersions } from '../../kit/rules/build.js';

export const INSTALL = 'install'; // take it and apply it on quit
export const MANUAL = 'manual'; // could install, but only when the person asks
export const NOTIFY = 'notify'; // tell the person, who replaces the app by hand
export const NONE = 'none'; // do not even check

// How long a transfer may produce nothing before the surface stops calling it progress. Measured from the last
// evidence of movement, never from the start, so a slow download re-arms it on every chunk and is never cut off.
export const STALL_MS = 45000;

const KB = 1024;
const MB = KB * KB;

// A byte count in the largest unit that still reads as a number, or null when there is nothing to show.
function size(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  const mb = bytes / MB;
  if (mb < 10) return mb.toFixed(1) + ' MB';
  if (mb < 1000) return Math.round(mb) + ' MB';
  return (mb / KB).toFixed(2) + ' GB';
}

// The job this build may do about a new version, decided by the platform and how the app was started, and nothing
// else. A source run has no release metadata, so it does not check at all rather than logging a fault on every start.
export function capability({ platform, packaged, appImage = false }) {
  if (!packaged) return { action: NONE, check: false, autoDownload: false, canInstall: false, reason: 'running from source' };
  if (platform === 'win32') return { action: INSTALL, check: true, autoDownload: true, canInstall: true, reason: 'the installer is verified against its published checksum' };
  if (platform === 'darwin') return { action: INSTALL, check: true, autoDownload: true, canInstall: true, reason: 'the build is signed and notarized, so an update can be installed' };
  if (platform === 'linux') {
    return appImage
      ? { action: INSTALL, check: true, autoDownload: true, canInstall: true, reason: 'an AppImage replaces itself in place' }
      : { action: NOTIFY, check: false, autoDownload: false, canInstall: false, reason: 'not running as an AppImage, so there is no file an update could replace' };
  }
  // The phones read the repository's public release feed (issue 192), the way the sibling app's iPhone build does: every
  // published test build passed the platforms gate, so it is in TestFlight and carries its signed APK. iOS cannot
  // install anything itself, so a newer build is offered through TestFlight; Android downloads the APK, verifies it
  // against the release's manifest and hands it to the system installer, which asks the person to confirm.
  if (platform === 'ios') return { action: NOTIFY, check: true, autoDownload: false, canInstall: false, via: 'testflight', reason: 'updates to this app install through TestFlight' };
  if (platform === 'android') return { action: MANUAL, check: true, autoDownload: false, canInstall: true, via: 'apk', reason: 'a newer APK from the release is verified, then installed by Android once you confirm' };
  return { action: NOTIFY, check: true, autoDownload: false, canInstall: false, reason: 'no install path on this platform' };
}

// What a shell answered to updates.check (issue 171), as the update state the page draws. The desktop answers the state
// the tray's own check reached, with its reason; a phone answers that it does not update itself and leaves the reason
// to this module, so the words for a platform live in one place. A state updateBanner does not know draws nothing.
export function checkAnswer(answer, platform) {
  if (!answer || typeof answer !== 'object' || !updateBanner(answer.state, { canInstall: true })) return null;
  const detail = answer.detail ?? (answer.state === 'unsupported' ? capability({ platform, packaged: true }).reason : null);
  const state = { state: answer.state, version: answer.version ?? null, percent: answer.percent ?? null, detail: detail ?? null, canInstall: Boolean(answer.canInstall) };
  return answer.via ? { ...state, via: answer.via } : state;
}

// A release version, or null. The comparison below throws on anything else, which is right for the server's updater;
// a feed is a document someone else wrote, so an entry that is not a release is skipped rather than fatal.
function releaseVersion(text) {
  const version = String(text || '').trim().replace(/^v/, '');
  try { compareVersions(version, version); return version; } catch { return null; }
}

// The versions a release feed names (GitHub's releases.atom: one <entry> per release, its tag at the end of the entry's
// <id>), in the order the feed lists them, skipping any entry that is not a release. Null when the body is not a feed
// at all, so a rate-limit page or a proxy's answer is never read as "no releases".
export function feedVersions(feed) {
  if (typeof feed !== 'string' || !/<feed[\s>]/.test(feed)) return null;
  const versions = [];
  for (const block of feed.split(/<entry[\s>]/).slice(1)) {
    const id = /<id>([^<]*)<\/id>/.exec(block);
    const version = id ? releaseVersion(id[1].split('/').pop()) : null;
    if (version) versions.push(version);
  }
  return versions;
}

// The newest release on one channel, by version and never by where the feed put it. A stable build is offered only a
// stable release and a test build only a test build, the same split the desktop updater makes.
export function newestRelease(versions, channel) {
  const mine = (versions || []).filter((v) => channelOf(v) === channel);
  return mine.reduce((best, v) => (best === null || compareVersions(v, best) > 0 ? v : best), null);
}

// What a phone's check found (issue 192), as the update state the page draws: the release feed's newest build on this
// build's channel against the build that is running. The feed is the public one every published build is listed in,
// and a build is published only once its TestFlight build is installable and its signed APK is attached, so "newer in
// the feed" is "newer in TestFlight" without a credential in the app.
export function phoneUpdate({ platform, current, feed }) {
  const cap = capability({ platform, packaged: true });
  const how = { canInstall: Boolean(cap.canInstall), via: cap.via };
  if (!releaseVersion(current)) return { state: 'unsupported', detail: 'this build carries no release version to compare', ...how };
  const versions = feedVersions(feed);
  if (versions === null) return { state: 'error', detail: 'the release list could not be read', ...how };
  const newest = newestRelease(versions, channelOf(current));
  if (newest && compareVersions(newest, current) > 0) return { state: 'available', version: newest, ...how };
  return { state: 'current', version: current, ...how };
}

// A template from core/spec/releases.json with its {names} filled in. A name the values do not carry throws, so a
// half-filled address is never fetched.
export function fillTemplate(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) => {
    if (!Object.hasOwn(values, key) || values[key] === undefined || values[key] === null) throw new Error('the template names a missing value: ' + key);
    return String(values[key]);
  });
}

// Where a release's Android assets are, from core/spec/releases.json and the naming spec. The release pipeline names
// what it publishes with the same function, and the Android shell fills the same templates, so the three agree.
export function releaseAssets(spec, naming, version) {
  if (!releaseVersion(version) || releaseVersion(version) !== version) throw new Error('not a release version: ' + version);
  const values = { repo: naming.repo, slug: naming.slug, version };
  const asset = (template) => {
    const name = fillTemplate(template, values);
    return { name, url: fillTemplate(spec.asset, { ...values, name }) };
  };
  return { feed: fillTemplate(spec.feed, values), apk: asset(spec.android.apk), manifest: asset(spec.android.manifest) };
}

// What is wrong with an Android release manifest, or null when it is sound. The manifest names the APK, its size, its
// SHA-256 and the SHA-256 of the certificate that signed it; the shell checks the downloaded bytes against the digest
// and the APK's signer against both the manifest and the installed app before anything reaches the installer.
export function apkManifestProblem(manifest, { version, slug }) {
  if (!manifest || typeof manifest !== 'object') return 'the manifest is not an object';
  if (manifest.version !== version) return 'the manifest names another version: ' + manifest.version;
  // A test build's version names its commit, so the two must agree; a stable version names none to compare.
  const commit = String(manifest.commit);
  if (!/^[a-f0-9]{40}$/.test(commit) || (channelOf(version) === 'dev' && !String(version).endsWith('.' + commit.slice(0, 10)))) return 'the manifest\'s commit is not the one the version names';
  if (manifest.file !== slug + '-android-' + version + '.apk') return 'the manifest names an unexpected file: ' + manifest.file;
  if (!Number.isInteger(manifest.size) || manifest.size <= 0) return 'the manifest carries no size';
  if (!/^[a-f0-9]{64}$/.test(String(manifest.sha256))) return 'the manifest carries no SHA-256 digest';
  if (!/^[a-f0-9]{64}$/.test(String(manifest.signer))) return 'the manifest names no signer certificate';
  return null;
}

// What to do given what the platform allows and what the person asked for. The preference only narrows the platform's
// answer: turning automatic downloads off cannot make a build that could not install start installing, and it does not
// stop the check, because knowing a release exists is what makes the manual install possible at all.
export function policy({ autoDownload = false, ...opts }) {
  const base = capability(opts);
  if (!base.canInstall) return base;
  if (autoDownload) return { ...base, autoDownload: true };
  return { action: MANUAL, check: true, autoDownload: false, canInstall: true, reason: 'automatic downloads are turned off in Settings' };
}

// How far a download has got, as a fraction 0 to 1, or null when that is not knowable. The value is read defensively:
// an unknown or absent report must not throw inside an event handler, which would lose the notice already on screen.
export function downloadProgress(info) {
  const percent = info ? info.percent : null;
  if (!Number.isFinite(percent)) return null;
  return Math.min(1, Math.max(0, percent / 100));
}

// The line under the progress bar: how much has arrived, and how fast. Every part is optional, because the transport
// promises neither a total nor a rate; a sentence that leaves a part out is better than one that says "0 MB of 0 MB".
export function transferDetail(info) {
  const { transferred = 0, total = 0, bytesPerSecond = 0 } = info || {};
  const arrived = size(transferred);
  const whole = size(total);
  const rate = size(bytesPerSecond);
  const parts = [];
  if (arrived && whole) parts.push(arrived + ' of ' + whole);
  else if (arrived) parts.push(arrived);
  if (rate) parts.push(rate + '/s');
  return parts.length ? parts.join(', ') : null;
}

// The banner the app draws while an update is arriving, where the platform has no notice that can update itself. The
// version is optional so the copy stays true when the transport has not named it yet.
export function downloadingNotice({ version = null, transfer = null } = {}) {
  const what = version ? 'version ' + version : 'the update';
  return { message: 'Downloading ' + what + '.', detail: transfer || 'Starting the download.' };
}

// The banner when a download has produced nothing for the stall window. Nothing is cancelled when this is reached, so
// the copy says so rather than claiming a failure: a card that lied about a live transfer would be worse than silence.
export function stalledNotice({ version = null, stallMs = STALL_MS } = {}) {
  const what = version ? 'version ' + version : 'the update';
  const seconds = Math.max(1, Math.round(stallMs / 1000));
  return { message: 'Downloading ' + what + ' has stopped making progress.', detail: 'Nothing has arrived for ' + seconds + ' seconds. It has not been cancelled, so it may still finish on its own.' };
}

// The named check that stands between a download and an install. Nothing is installed unverified, and the name lives
// here so the design note and the code cannot disagree about which check it was.
export function verificationCheck({ platform }) {
  if (platform === 'win32') return { name: 'publisher signature', detail: 'the installer is checked against the publisher name in the release metadata' };
  if (platform === 'darwin') return { name: 'code signature and checksum', detail: 'the archive is checked against the checksum in the release metadata, and the installed build is signed' };
  return { name: 'sha512 checksum', detail: 'the artifact is checked against the checksum in the release metadata' };
}

// Whether a downloaded artifact's checksum matches the one the release published. This is the one decision that stands
// between a corrupt or tampered download and an install, so a missing or different value refuses rather than passes.
export function checksumMatches(expected, actual) {
  if (typeof expected !== 'string' || typeof actual !== 'string') return false;
  const a = expected.trim().toLowerCase();
  const b = actual.trim().toLowerCase();
  return a.length > 0 && a === b;
}

// The install policy, named, so the design note and the code agree: a downloaded update is applied when the app quits,
// never by interrupting what someone is doing.
export function installPolicy() {
  return { on: 'quit', why: 'the download is applied when the app next quits, so an update never interrupts what a person is doing' };
}

// The banner when a release is found and this build can install it. It carries the action that starts the download, so
// a person can go from seeing the release to installing it without leaving the app, whatever the automatic-download
// setting says. The version is optional so the copy stays true when the transport has not named it yet.
export function availableBanner({ version = null } = {}) {
  const what = version ? 'Version ' + version : 'An update';
  return { message: what + ' is available.', detail: 'Download it now, or turn on automatic downloads and it is fetched on its own.' };
}

// The banner once the download has landed: the update is on disk and is applied when the app quits.
export function readyBanner({ version = null } = {}) {
  const what = version ? 'Version ' + version : 'The update';
  return { message: what + ' is ready to install.', detail: 'Restart the app to install it, or it installs the next time the app quits.' };
}

// The banner when the download failed. The reason is optional and is already scrubbed by the shell; the copy never
// pretends nothing happened, so a person sees the failure rather than an update that silently did nothing.
export function failedBanner({ detail = null } = {}) {
  return { message: 'The update could not be downloaded.', detail: detail || 'Nothing was installed. You can try again.' };
}

// The action that only clears the banner. It names no bridge command: the page handles it itself.
export const DISMISS = 'dismiss';

// The banner when a check someone asked for found nothing newer than this build.
export function currentBanner({ version = null } = {}) {
  return { message: 'You are on the latest version.', detail: version ? 'Version ' + version + ' is the newest release.' : 'There is no newer release.' };
}

// The banner when this build cannot update itself, so a check someone asked for has nothing to run. The reason is the
// capability's own, so the page says why rather than pretending a check ran.
export function unsupportedBanner({ detail = null } = {}) {
  const why = detail ? String(detail) : 'this build has no update path';
  return { message: 'This build does not update itself.', detail: why.charAt(0).toUpperCase() + why.slice(1) + '.' };
}

// The banner an update state draws in the app, or null for a state that draws none. 'available', 'ready' and 'error'
// also raise a native notice, through the same path the message notices use; the banner is what carries the action, so
// the notice announces and the banner is where a person acts. 'downloading' and 'stalled' draw only the banner, because
// a native notice cannot show a moving bar. The action names the bridge command the page calls, so what the button does
// is decided here and tested with no shell, no network and no Electron.
export function updateBanner(state, { version = null, percent = null, detail = null, canInstall = false, via = null } = {}) {
  // A check someone asked for from the tray: it says it is looking, then how it ended. The two answers that end it with
  // nothing to do carry a dismiss rather than a bridge command, because there is nothing for the shell to do.
  if (state === 'checking') return { message: 'Checking for updates.', detail: '', percent: null, action: null };
  if (state === 'current') {
    return { ...currentBanner({ version }), percent: null, action: { command: DISMISS, label: 'OK' } };
  }
  if (state === 'unsupported') {
    return { ...unsupportedBanner({ detail }), percent: null, action: { command: DISMISS, label: 'OK' } };
  }
  if (state === 'available') {
    // iOS installs nothing itself: the release is offered where it is installed, and the action opens TestFlight.
    if (via === 'testflight') return { ...testFlightBanner({ version }), percent: null, action: { command: 'updates.install', label: 'Open TestFlight' } };
    if (!canInstall) return null; // a platform that cannot install is told about the release by its notice alone
    const banner = via === 'apk' ? apkAvailableBanner({ version }) : availableBanner({ version });
    return { ...banner, percent: null, action: { command: 'updates.download', label: 'Download' } };
  }
  if (state === 'downloading') {
    const n = downloadingNotice({ version, transfer: detail });
    return { message: n.message, detail: n.detail, percent, action: null };
  }
  if (state === 'stalled') {
    const n = stalledNotice({ version });
    return { message: n.message, detail: n.detail, percent: null, action: null };
  }
  if (state === 'ready') {
    if (via === 'apk') return { ...apkReadyBanner({ version }), percent: null, action: { command: 'updates.install', label: 'Install' } };
    return { ...readyBanner({ version }), percent: null, action: { command: 'updates.install', label: 'Restart and install' } };
  }
  if (state === 'error') {
    return { ...failedBanner({ detail }), percent: null, action: canInstall ? { command: 'updates.download', label: 'Try again' } : null };
  }
  return null;
}

// The iOS banner when TestFlight holds a newer build. It names no download and no restart, because the phone can do
// neither: the honest offer is to send the reader to where the build is.
export function testFlightBanner({ version = null } = {}) {
  const what = version ? 'Version ' + version : 'A newer build';
  return { message: what + ' is available in TestFlight.', detail: 'Open TestFlight to install it.' };
}

// The Android banners: a release whose signed APK can be fetched, and one that has been fetched and verified. Android
// asks the person to confirm every install, so the copy says so rather than promising an install on quit.
export function apkAvailableBanner({ version = null } = {}) {
  const what = version ? 'Version ' + version : 'An update';
  return { message: what + ' is available.', detail: 'Download it here; Android asks you to confirm before it installs.' };
}

export function apkReadyBanner({ version = null } = {}) {
  const what = version ? 'Version ' + version : 'The update';
  return { message: what + ' is downloaded and verified.', detail: 'Install hands it to Android, which asks you to confirm.' };
}

// About's Check for updates (issue 192): the button follows the same update state the notice draws, so the page that
// was pressed offers the step the notice offers. While a step is offered (open TestFlight, download, install, try again)
// the button is that step, labelled as the notice's action is; otherwise it checks. The outcome itself is reported in
// ONE place, the notice banner, never beside the control (PR 257): this returns the button's label and the bridge
// command it runs, and nothing the page would print under it. The button never writes its own busy label either: a
// check in progress is the kit press's pending state, and the disabled beat after it.
export function aboutUpdate(status) {
  const idle = { label: 'Check for updates', command: null };
  if (!status || !status.state) return idle;
  const banner = updateBanner(status.state, status);
  if (!banner) return idle;
  const action = banner.action && banner.action.command !== DISMISS ? banner.action : null;
  return {
    label: action ? action.label : idle.label,
    command: action ? action.command : null,
  };
}
