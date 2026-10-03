// The post-switch half of an installed server's update: the running server starts this, detached, from its own version
// folder after repointing current, and this restarts the service, decides from the health route whether the new
// version stays, and rolls back if it does not (server/src/updater.js, finishSwitch). It is not meant to be run by hand;
// `service update --release` is how a person asks for an update.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config.js';
import { installLayout, installRootOf } from '../install.js';
import { ROOT, logSpec, naming, serverVersion } from '../paths.js';

export default {
  name: 'update',
  async run({ dataDir, flags, sub, die }) {
    if (!['finish', 'recover'].includes(sub)) die('usage: update finish [--install-root DIR]   (the installed server runs this itself after a switch)');
    const root = typeof flags['install-root'] === 'string' ? path.resolve(flags['install-root']) : installRootOf(ROOT);
    if (!root) die('update finish runs from an installed release, or with --install-root');
    if (process.platform !== 'darwin') die('update finish restarts a macOS LaunchAgent; elsewhere, restart the server under your own service manager');
    const { createLogger } = await import('../../../core/kit/log.js');
    const log = createLogger({ spec: logSpec, app: naming.slug + '-server', version: serverVersion, run: randomUUID().slice(0, 8), pid: process.pid, sink: (line) => process.stdout.write(JSON.stringify(line) + '\n'), now: Date.now, level: 'info' }).child('update');
    const { finishSwitch } = await import('../updater.js');
    const { launchdControl } = await import('../service.js');
    const config = loadConfig(dataDir);
    // The label follows the install root, so a second install on this Mac restarts its own LaunchAgent, never another.
    const L = installLayout(root);
    const outcome = await finishSwitch({ L, dataDir, port: config.port, service: launchdControl({ L }), log, recover: sub === 'recover' });
    return !outcome || outcome.state === 'healthy' ? 0 : 1;
  },
};
