import { existsSync } from 'node:fs';
import { configPath, loadConfig } from '../config.js';

export default {
  name: 'service',
  async run({ dataDir, flags, sub, die, doctorReport }) {
    if (process.platform !== 'darwin') die('service looks after a macOS LaunchAgent; elsewhere, run "run" under your own service manager');
    const acts = ['install', 'status', 'restart', 'update', 'remove'];
    if (!acts.includes(sub)) die('usage: service ' + acts.join('|'));
    const service = await import('../service.js');
    const config = sub === 'remove' && !existsSync(configPath(dataDir)) ? null : loadConfig(dataDir);
    try {
      const ok = await service[sub]({
        dataDir, config, tailscale: flags.tailscale === true, node: typeof flags.node === 'string' ? flags.node : null,
        doctor: () => doctorReport(config),
      });
      return ok === false ? 1 : 0;
    } catch (e) {
      die('fail  ' + e.message);
    }
  },
};
