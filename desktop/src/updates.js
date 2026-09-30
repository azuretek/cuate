// The host owns the timer and notifications; the updater owns transport, verification and installation.
export const channelOf = (version) => version.includes('-') ? 'dev' : 'latest';
export function startUpdates({ updater, version, notify, logError, setTimer = setInterval, clearTimer = clearInterval }) {
  updater.channel = channelOf(version);
  updater.allowPrerelease = updater.channel === 'dev';
  updater.allowDowngrade = false;
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  const downloaded = () => notify('Update ready', 'Restart the app to install the downloaded update.');
  const error = () => logError('Update check or download failed');
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
  return () => { clearTimer(timer); updater.removeListener('update-downloaded', downloaded); updater.removeListener('error', error); };
}
