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
  // canInstall travels with every state, so the page knows whether to offer an action at all: a build with no
  // install path is told about a release by its notice alone, and a platform difference stays data.
  const emit = (state, extra = {}) => onState({ state, version: null, canInstall: plan.canInstall, ...extra });
  let availableVersion = null;
  let downloading = false;
  let ready = false;
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
    ready = false;
    emit('available', { version: availableVersion });
    if (plan.autoDownload) armStall();
  };
  const progress = (info) => {
    downloading = true;
    ready = false;
    armStall();
    emit('downloading', { version: availableVersion, percent: downloadProgress(info), detail: transferDetail(info) });
  };
  const downloaded = (info) => {
    downloading = false;
    ready = true;
    clearStall();
    const v = info && info.version ? String(info.version) : availableVersion;
    // Nothing reaches ready unverified: the check that ran is named on the state.
    emit('ready', { version: v, detail: check.name });
  };
  // A failure is stated, never silent: the page raises a notice and draws the banner, and the log says the same.
  const error = () => {
    downloading = false;
    ready = false;
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

  // An explicit download, asked for by the page. It is never blocked by the automatic-download setting: that preference
  // only decides whether a found release is fetched on its own, and a person asking for it is exactly what the setting
  // being off leaves them able to do. A platform that cannot install has no download to offer, so it refuses.
  const download = () => {
    if (!plan.canInstall || typeof updater.downloadUpdate !== 'function') return false;
    if (downloading) return true; // a transfer is already in flight; asking again must not start a second one
    downloading = true;
    ready = false;
    armStall();
    Promise.resolve(updater.downloadUpdate()).catch(() => error());
    return true;
  };

  // Install now: quit and apply the downloaded update. It is still an install on quit, so it never interrupts what a
  // person is doing until the install itself, and it is refused when there is nothing downloaded to apply.
  const install = () => {
    if (!plan.canInstall || !ready || typeof updater.quitAndInstall !== 'function') return false;
    updater.quitAndInstall();
    return true;
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
    download,
    install,
  };
}
