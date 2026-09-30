// The settings store: every user setting lives on the server so each device looks and behaves the same. Values are
// JSON keyed by name, the last write to a key wins, and a key or a value that is not a plain, bounded JSON setting
// is refused. Which keys are meaningful is the schema's job, landing with the settings screen.
const KEY = /^[a-z][A-Za-z0-9._-]{0,63}$/;
const MAX_KEYS = 256;
const MAX_BYTES = 65536;

const refuse = (code, message, status = 400) => Object.assign(new Error(message), { status, code });

export function createSettings({ store }) {
  return {
    all() {
      return store.getAllSettings();
    },
    // Stores the given keys and returns the ones that changed, or null when there was nothing to change.
    set(values) {
      const entries = Object.entries(values);
      if (entries.length === 0) return null;
      for (const [k] of entries) if (!KEY.test(k)) throw refuse('bad_setting', 'Not a setting key: ' + k);
      const merged = { ...store.getAllSettings(), ...values };
      if (Object.keys(merged).length > MAX_KEYS) throw refuse('bad_setting', 'Too many settings');
      if (Buffer.byteLength(JSON.stringify(merged)) > MAX_BYTES) throw refuse('too_large', 'Settings are too large', 413);
      store.putSettings(values);
      return values;
    },
  };
}
