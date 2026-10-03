// Pure: the update policy a client may act on, the words it shows while acting, and the check that stands between a
// download and an install. The shell owns the transport, the timer and the install; this module owns the decisions and
// the copy, so what a person sees during a download is the same on every platform and is tested with no network, no
// clock and no Electron. No clock, no I/O, no transport names.

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
  // The phones have no self-updater: a new build reaches them through the platform's own channel, so they never check,
  // and a check someone asks for (About's Check for updates) says how this build is updated instead (issue 171).
  if (platform === 'ios') return { action: NOTIFY, check: false, autoDownload: false, canInstall: false, reason: 'updates to this app arrive through TestFlight' };
  if (platform === 'android') return { action: NOTIFY, check: false, autoDownload: false, canInstall: false, reason: 'updates to this app are installed from a newer APK' };
  return { action: NOTIFY, check: true, autoDownload: false, canInstall: false, reason: 'no install path on this platform' };
}

// What a shell answered to updates.check (issue 171), as the update state the page draws. The desktop answers the state
// the tray's own check reached, with its reason; a phone answers that it does not update itself and leaves the reason
// to this module, so the words for a platform live in one place. A state updateBanner does not know draws nothing.
export function checkAnswer(answer, platform) {
  if (!answer || typeof answer !== 'object' || !updateBanner(answer.state, { canInstall: true })) return null;
  const detail = answer.detail ?? (answer.state === 'unsupported' ? capability({ platform, packaged: true }).reason : null);
  return { state: answer.state, version: answer.version ?? null, percent: answer.percent ?? null, detail: detail ?? null, canInstall: Boolean(answer.canInstall) };
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
export function updateBanner(state, { version = null, percent = null, detail = null, canInstall = false } = {}) {
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
    if (!canInstall) return null; // a platform that cannot install is told about the release by its notice alone
    return { ...availableBanner({ version }), percent: null, action: { command: 'updates.download', label: 'Download' } };
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
    return { ...readyBanner({ version }), percent: null, action: { command: 'updates.install', label: 'Restart and install' } };
  }
  if (state === 'error') {
    return { ...failedBanner({ detail }), percent: null, action: canInstall ? { command: 'updates.download', label: 'Try again' } : null };
  }
  return null;
}
