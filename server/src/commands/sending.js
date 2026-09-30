import { loadConfig, saveConfig } from '../config.js';

export default {
  name: 'sending',
  async run({ dataDir, sub, die }) {
    if (sub !== 'on' && sub !== 'off') die('usage: sending on|off');
    const config = loadConfig(dataDir);
    config.sending.enabled = sub === 'on';
    saveConfig(dataDir, config);
    // The server reads its config when it starts, so a service running from this data folder is restarted, and the
    // switch is read back from the new run's own start line.
    const { applyIfInstalled } = await import('../service.js');
    const started = await applyIfInstalled({ dataDir, config }).catch((e) => die('sending is ' + sub + ' in the config, but restarting the service failed: ' + e.message));
    if (!started) console.log('sending is ' + sub + '; it takes effect when the server next starts');
    else if (started.sending === undefined) console.log('sending is ' + sub + ', and the service was restarted');
    else if (started.sending === config.sending.enabled) console.log('sending is ' + sub + ', and the restarted server started with it ' + sub);
    else die('sending is ' + sub + ' in the config, but the restarted server started with it ' + (started.sending ? 'on' : 'off'));
  },
};
