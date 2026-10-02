// The hook endpoints, added and removed without a code change or a hand edit. Every change goes through saveConfig, so
// it is validated exactly as a config is at load, and a service running from this data folder is told to read its
// endpoints again (SIGHUP) rather than restarted, so no client is dropped. A secret and a key are printed once, when
// they are made, for the receiver to store; neither is ever logged or listed.
import { loadConfig, saveConfig } from '../config.js';
import { ALL_EVENTS, DEFAULT_EVENTS, eventNames, isLoopback, newKeyMaterial } from '../webhooks.js';

const USAGE = 'usage: hooks list | add ID URL [--events a,b|*] [--plaintext] | remove ID | enable ID | disable ID | rotate ID [--retire]';
const newKid = () => 'k' + Date.now().toString(36);

export default {
  name: 'hooks',
  async run({ dataDir, pos, sub, flags, die, print = console.log }) {
    const id = pos[2];
    const config = loadConfig(dataDir);
    const list = config.webhooks.endpoints;
    const find = () => {
      if (!id) die(USAGE);
      const e = list.find((x) => x.id === id);
      if (!e) die('no hook ' + id + ': hooks list names them');
      return e;
    };
    // Written, and so validated, before anything is printed, so a secret is never shown for a hook that was refused.
    const commit = () => {
      try {
        saveConfig(dataDir, config);
      } catch (e) {
        die(e.message);
      }
    };
    const reload = async (what) => {
      const { reloadIfInstalled } = await import('../service.js');
      const seen = await reloadIfInstalled({ dataDir }).catch((e) => die(what + ' in the config, but the running service did not take it: ' + e.message));
      print(seen ? 'the running service reloaded its hooks: ' + seen.active + ' of ' + seen.endpoints + ' active' : 'it takes effect when the server next starts');
    };
    const shown = (secret, key) => {
      print('secret ' + secret);
      if (key) print('key    ' + key.kid + ' ' + key.key);
    };

    if (sub === 'list' || sub === undefined) {
      if (!list.length) print('no hooks: add one with hooks add ID URL');
      for (const e of list) {
        const why = [e.disabledReason, e.disabledAt && 'at ' + e.disabledAt, e.lastError && 'last error ' + e.lastError].filter(Boolean).join(', ');
        const state = e.active ? 'active' : 'disabled' + (why ? ' (' + why + ')' : '');
        print([e.id, state, e.url, 'events ' + e.events.join(','), e.encrypt ? 'encrypted, key ' + e.keys[0].kid : 'plaintext (loopback)', e.secrets.length > 1 ? 'two secrets (rotating)' : 'one secret'].join('  '));
      }
      return;
    }
    if (sub === 'add') {
      const url = pos[3];
      if (!id || !url) die(USAGE);
      if (list.some((x) => x.id === id)) die('a hook called ' + id + ' already exists');
      const events = flags.events === undefined || flags.events === true ? DEFAULT_EVENTS.slice() : String(flags.events).split(',').map((s) => s.trim()).filter(Boolean);
      const plaintext = Boolean(flags.plaintext);
      if (plaintext && !isLoopback(url)) die('--plaintext is for a loopback url only; every other hook is encrypted');
      const secret = newKeyMaterial();
      const key = plaintext ? null : { kid: newKid(), key: newKeyMaterial() };
      list.push({ id, url, events, secrets: [secret], encrypt: !plaintext, ...(key ? { keys: [key] } : {}), active: true });
      commit();
      const every = events.includes(ALL_EVENTS) ? ' (every event: ' + eventNames().join(', ') + ')' : '';
      print('hook ' + id + ' added for ' + events.join(',') + every + '. These are shown once; store them with the receiver now:');
      shown(secret, key);
      return reload('hook ' + id + ' is added');
    }
    if (sub === 'remove') {
      list.splice(list.indexOf(find()), 1);
      commit();
      print('hook ' + id + ' removed');
      return reload('hook ' + id + ' is removed');
    }
    if (sub === 'enable' || sub === 'disable') {
      const e = find();
      e.active = sub === 'enable';
      if (e.active) for (const k of ['disabledAt', 'disabledReason', 'lastError']) delete e[k];
      else Object.assign(e, { disabledAt: new Date().toISOString(), disabledReason: 'by hand' });
      commit();
      print('hook ' + id + ' ' + sub + 'd');
      return reload('hook ' + id + ' is ' + sub + 'd');
    }
    if (sub === 'rotate') {
      const e = find();
      if (flags.retire) {
        if (e.secrets.length < 2 && !(e.keys && e.keys.length > 1)) die('hook ' + id + ' has no previous secret or key to retire');
        e.secrets = e.secrets.slice(0, 1);
        if (e.keys) e.keys = e.keys.slice(0, 1);
        commit();
        print('hook ' + id + ': the previous secret and key are retired; only the current ones sign and encrypt');
        return reload('hook ' + id + ' is retired');
      }
      const secret = newKeyMaterial();
      const key = e.encrypt ? { kid: newKid(), key: newKeyMaterial() } : null;
      e.secrets = [secret, e.secrets[0]];
      if (key) e.keys = [key, e.keys[0]];
      commit();
      print('hook ' + id + ' rotated. Deliveries are signed with the new and the previous secret, and encrypted with the new key, until hooks rotate ' + id + ' --retire. These are shown once; store them with the receiver now:');
      shown(secret, key);
      return reload('hook ' + id + ' is rotated');
    }
    die(USAGE);
  },
};
