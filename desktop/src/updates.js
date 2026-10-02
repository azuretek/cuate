// The host owns the timer; the updater owns transport, verification and installation. Every state it reaches is told
// to onState, and the page decides whether that becomes a notice, so updates use the same notice path as messages.
export const channelOf = (version) => version.includes('-') ? 'dev' : 'latest';
export function startUpdates({ updater, version, onState, logError, setTimer = setInterval, clearTimer = clearInterval }) {
  updater.channel = channelOf(version);
  updater.allowPrerelease = updater.channel === 'dev';
  updater.allowDowngrade = false;
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  const state = (next, info) => onState({ state: next, version: info && info.version ? String(info.version) : null });
  const available = (info) => state('available', info);
  const downloaded = (info) => state('ready', info);
  const error = () => { state('error'); logError('Update check or download failed'); };
  updater.on('update-available', available);
  updater.on('update-downloaded', downloaded);
  updater.on('error', error);
  let pending = false;
  const check = async () => {
    if (pending) return;
    pending = true;
    try { await updater.checkForUpdates(); } catch { error(); } finally { pending = false; }
  };
  void check();
  const timer = setTimer(check, 4 * 60 * 60 * 1000);
  timer?.unref?.();
  return () => { clearTimer(timer); updater.removeListener('update-available', available); updater.removeListener('update-downloaded', downloaded); updater.removeListener('error', error); };
}
