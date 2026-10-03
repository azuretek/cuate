import { existsSync } from 'node:fs';
import { configPath, loadConfig } from '../config.js';

export default {
  name: 'service',
  async run({ dataDir, flags, sub, die, doctorReport }) {
    const acts = ['install', 'status', 'restart', 'update', 'remove'];
    if (!acts.includes(sub)) die('usage: service ' + acts.join('|'));
    const service = await import('../service.js');
    const installRoot = typeof flags['install-root'] === 'string' ? flags['install-root'] : null;
    // A pause is a line in the install's state file, so it works wherever the install is, with or without launchd.
    if (sub === 'update' && (flags.pause === true || flags.resume === true)) {
      if (flags.pause === true && flags.resume === true) die('pass --pause or --resume, not both');
      try {
        await service.update({ pause: flags.pause === true, resume: flags.resume === true, installRoot });
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
