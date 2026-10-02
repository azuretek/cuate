// The shell's side of updating. The host owns the transport, the timer and the install; the decisions and the words
// come from core/app/rules/updates.js, so what a person sees while a download runs is the same on every platform and
// the rules are tested without Electron. Every state it reaches is told to onState, and the page decides whether that
// becomes a native notice or an in-app banner, so updates use the same path the message notices use.
import {
  policy, downloadProgress, transferDetail, verificationCheck, installPolicy, STALL_MS,
} from '../../core/app/rules/updates.js';

export const channelOf = (version) => version.includes('-') ? 'dev' : 'latest';

export function startUpdates({
  updater, version, platform, packaged, appImage = false, autoDownload = false,
  onState, logError, setTimer = setInterval, clearTimer = clearInterval,
}) {
  updater.channel = channelOf(version);
  updater.allowPrerelease = updater.channel === 'dev';
  updater.allowDowngrade = false;
  // The install policy is named in core (applied on quit) so the copy and the code cannot disagree about when an
  // update lands.
  updater.autoInstallOnAppQuit = installPolicy().on === 'quit';
  const plan = policy({ platform, packaged, appImage, autoDownload });
  updater.autoDownload = plan.autoDownload;

  // The check that stands between a download and an install, named on the ready state.
  const check = verificationCheck({ platform });
  const emit = (state, extra = {}) => onState({ state, version: null, ...extra });
  let availableVersion = null;
  let downloading = false;
  let stallTimer = null;

  const clearStall = () => { if (stallTimer) { clearTimer(stallTimer); stallTimer = null; } };
  // The stall window is measured from the last evidence of movement, so a slow transfer re-arms it on every chunk.
  const armStall = () => {
    clearStall();
    stallTimer = setTimer(() => {
      stallTimer = null;
      if (downloading) emit('stalled', { version: availableVersion });
    }, STALL_MS);
    stallTimer?.unref?.();
  };

  const available = (info) => {
    availableVersion = info && info.version ? String(info.version) : null;
    emit('available', { version: availableVersion });
    if (plan.autoDownload) armStall();
  };
  const progress = (info) => {
    downloading = true;
    armStall();
    emit('downloading', { version: availableVersion, percent: downloadProgress(info), detail: transferDetail(info) });
  };
  const downloaded = (info) => {
    downloading = false;
    clearStall();
    const v = info && info.version ? String(info.version) : availableVersion;
    // Nothing reaches ready unverified: the check that ran is named on the state.
    emit('ready', { version: v, detail: check.name });
  };
  // A failure is stated, never silent: the page raises a notice, and the log says the same thing.
  const error = () => {
    downloading = false;
    clearStall();
    logError('Update check or download failed');
    emit('error', { detail: 'The update could not be downloaded.' });
  };

  updater.on('update-available', available);
  updater.on('download-progress', progress);
  updater.on('update-downloaded', downloaded);
  updater.on('error', error);

  let pending = false;
  const run = async () => {
    if (pending) return;
    pending = true;
    try { await updater.checkForUpdates(); } catch { error(); } finally { pending = false; }
  };
  if (plan.check) void run();
  const timer = plan.check ? setTimer(run, 4 * 60 * 60 * 1000) : null;
  timer?.unref?.();

  // The page tells the shell when the setting changes. Turning it on here fetches a release the check already found;
  // turning it off stops the next fetch but never throws away a download already in flight.
  const setAutoDownload = (on) => {
    const wanted = Boolean(on);
    updater.autoDownload = wanted;
    if (wanted && availableVersion && !downloading && typeof updater.downloadUpdate === 'function') {
      Promise.resolve(updater.downloadUpdate()).catch(() => {});
    }
    return updater.autoDownload;
  };

  return {
    stop() {
      clearStall();
      if (timer) clearTimer(timer);
      updater.removeListener('update-available', available);
      updater.removeListener('download-progress', progress);
      updater.removeListener('update-downloaded', downloaded);
      updater.removeListener('error', error);
    },
    setAutoDownload,
  };
}
