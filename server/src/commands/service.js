import { existsSync } from 'node:fs';
import { configPath, loadConfig } from '../config.js';

export default {
  name: 'service',
  async run({ dataDir, flags, sub, die, doctorReport }) {
    const acts = ['install', 'status', 'restart', 'update', 'remove'];
    if (!acts.includes(sub)) die('usage: service ' + acts.join('|'));
    const service = await import('../service.js');
    const installRoot = typeof flags['install-root'] === 'string' ? flags['install-root'] : null;
    // A pause, and a rollback drill, are files in the install root, so they work wherever the install is, with or
    // without launchd. --drill-rollback arms the drill for the next switch; --drill-rollback off disarms it.
    const drillFlag = flags['drill-rollback'];
    if (drillFlag !== undefined && drillFlag !== true && drillFlag !== 'off') die('pass --drill-rollback, or --drill-rollback off');
    if (sub === 'update' && (flags.pause === true || flags.resume === true || drillFlag !== undefined)) {
      if ([flags.pause === true, flags.resume === true, drillFlag !== undefined].filter(Boolean).length > 1) die('pass one of --pause, --resume or --drill-rollback');
      try {
        await service.update({ pause: flags.pause === true, resume: flags.resume === true, drill: drillFlag === undefined ? null : drillFlag === true, installRoot });
        return 0;
      } catch (e) {
        die('fail  ' + e.message);
      }
    }
    if (process.platform !== 'darwin') die('service looks after a macOS LaunchAgent; elsewhere, run "run" under your own service manager');
    const config = sub === 'remove' && !existsSync(configPath(dataDir)) ? null : loadConfig(dataDir);
    try {
      const ok = await service[sub]({
        dataDir, config, tailscale: flags.tailscale === true, node: typeof flags.node === 'string' ? flags.node : null,
        release: flags.release === true, installRoot, version: typeof flags.version === 'string' ? flags.version : null,
        doctor: () => doctorReport(config),
      });
      return ok === false ? 1 : 0;
    } catch (e) {
      die('fail  ' + e.message);
    }
  },
};
