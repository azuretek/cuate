import { loadConfig, saveConfig } from '../config.js';
import { LOCK_METHODS, macConfig } from '../mac.js';

const WHATS = ['messages', 'engine', 'server'];
const USAGE = [
  'usage: mac status',
  '       mac awake on|off',
  '       mac lock on|off',
  '       mac lock method ' + LOCK_METHODS.join('|'),
  '       mac restart ' + WHATS.join('|') + '   (an admin token on standard input)',
].join('\n');

/** Write the Mac-care config and, when a service runs from this data folder, restart it so the change applies. */
const apply = async (dataDir, config, line, die) => {
  saveConfig(dataDir, config);
  const { applyIfInstalled } = await import('../service.js');
  const started = await applyIfInstalled({ dataDir, config }).catch((e) => die(line + ', but restarting the service failed: ' + e.message));
  console.log(line + (started ? ', and the service was restarted' : '; it takes effect when the server next starts'));
};

export default {
  name: 'mac',
  async run({ dataDir, pos, sub, die }) {
    const config = loadConfig(dataDir);
    const mac = macConfig(config.mac);
    if (sub === 'status') {
      console.log('awake     ' + (mac.awake ? 'on: the server holds sleep off while it runs' : 'off'));
      console.log('lock      ' + (mac.lock.enabled ? 'on, method ' + mac.lock.method : 'off'));
      console.log('messages  ' + (mac.messages.managedBy ? 'managed by ' + mac.messages.managedBy + ': the server only reports' : mac.messages.manage ? 'the server relaunches it when it quits, at most three times an hour' : 'the server leaves it alone'));
      if (process.platform !== 'darwin') console.log('note      this is not macOS, so none of it is applied here');
      return;
    }
    if (sub === 'awake') {
      if (pos[2] !== 'on' && pos[2] !== 'off') die(USAGE);
      config.mac = { ...config.mac, awake: pos[2] === 'on' };
      return apply(dataDir, config, 'awake is ' + pos[2], die);
    }
    if (sub === 'lock') {
      if (pos[2] === 'on' || pos[2] === 'off') {
        // Turning it on with an engine that needs the screen is refused here with a reason, not half applied.
        if (pos[2] === 'on' && config.engine.needsScreen) die('the ' + config.engine.kind + ' engine needs the screen unlocked, so the lock cannot be applied and was not turned on');
        config.mac = { ...config.mac, lock: { ...config.mac.lock, enabled: pos[2] === 'on' } };
        return apply(dataDir, config, 'lock is ' + pos[2], die);
      }
      if (pos[2] === 'method') {
        if (!LOCK_METHODS.includes(pos[3])) die('method must be one of ' + LOCK_METHODS.join(', '));
        config.mac = { ...config.mac, lock: { ...config.mac.lock, method: pos[3] } };
        return apply(dataDir, config, 'the lock method is ' + pos[3], die);
      }
      die(USAGE);
    }
    if (sub === 'restart') {
      const what = pos[2];
      if (!WHATS.includes(what)) die(USAGE);
      // The action belongs to the running server, so it is asked over its own API with an admin token, read from
      // standard input, never from an argument or the URL, exactly as \`check\` reads its token.
      if (process.stdin.isTTY) die('pipe an admin token on standard input; it never goes in a URL or an argument');
      const chunks = [];
      for await (const c of process.stdin) chunks.push(c);
      const token = Buffer.concat(chunks).toString('utf8').split('\n')[0].trim();
      if (!token) die('no token on standard input');
      const url = 'http://127.0.0.1:' + config.port + '/api/v1/mac/restart';
      const res = await fetch(url, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ what }) }).catch((e) => die('the server did not answer: ' + e.message));
      const body = await res.json().catch(() => ({}));
      if (res.status !== 200) die('the server refused: ' + ((body.error && body.error.message) || res.status));
      console.log('done  the server restarted ' + what + (body.reason ? ' (' + body.reason + ')' : ''));
      return;
    }
    die(USAGE);
  },
};
