// Pure: the settings page's rules. The schema declares every setting the page shows, its label, its control, its
// group and its default. The server holds the values (server/src/settings.js stores any key it is given), so the page
// reads and writes them there rather than keeping local state, and a key the schema does not declare is left for a
// later item. The groups give the page its sections, so there is no second list to keep in step.
export const SETTINGS_SCHEMA = {
  groups: [
    { id: 'appearance', label: 'Appearance' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'updates', label: 'Updates' },
  ],
  keys: {
    'appearance.skin': { group: 'appearance', label: 'Appearance', type: 'choice', options: ['system', 'light', 'dark'], default: 'system' },
    'appearance.textSize': { group: 'appearance', label: 'Text size', type: 'number', min: 11, max: 20, step: 1, default: 14 },
    'appearance.density': { group: 'appearance', label: 'Density', type: 'choice', options: ['comfortable', 'compact'], default: 'comfortable' },
    // Every notice the client can raise, each on its own switch. Turning one off silences only that notice.
    'notifications.newMessage': { group: 'notifications', label: 'New messages', type: 'toggle', default: true },
    'notifications.updateAvailable': { group: 'notifications', label: 'Update available', type: 'toggle', default: true },
    'notifications.updateReady': { group: 'notifications', label: 'Update ready to install', type: 'toggle', default: true },
    'notifications.errors': { group: 'notifications', label: 'Update errors', type: 'toggle', default: true },
    // Whether a release a check finds is fetched and applied with no further prompt. Off until someone turns it on: a
    // download nobody asked for spends someone's bandwidth, and the setting is how they asked. The check still runs
    // with it off, because knowing a release exists is what makes installing by hand possible.
    'updates.autoDownload': { group: 'updates', label: 'Download updates automatically', type: 'toggle', default: false },
  },
};

export function settingsFields(schema = SETTINGS_SCHEMA) {
  return Object.entries(schema.keys).map(([key, spec]) => ({ key, ...spec }));
}

// The fields grouped for the page, in the schema's group order. A field with no group falls into the first group.
export function settingsGroups(schema = SETTINGS_SCHEMA) {
  const fields = settingsFields(schema);
  const groups = schema.groups || [];
  const fallback = groups.length ? groups[0].id : null;
  return groups.map((g) => ({ id: g.id, label: g.label, fields: fields.filter((f) => (f.group || fallback) === g.id) }));
}

// The value to show for a key: what the server holds, else the schema's default.
export function settingValue(field, values) {
  return values && Object.hasOwn(values, field.key) ? values[field.key] : field.default;
}

export function coerceSetting(field, raw) {
  if (field.type === 'number') return Number(raw);
  if (field.type === 'toggle') return raw === true || raw === 'true';
  return String(raw);
}

// What a write settles for the keys it named, and only those. A write's answer is the whole store as the server held it
// at that write, so it can be older than a change the event stream delivered while the write was in flight: taking the
// answer whole put a key another device had just changed back to its old value, and the page then drew the old value
// for good. The same holds for a refused write's rollback. Every other key keeps what the page holds, and the stream
// keeps that current. A key the source does not hold is dropped, so the schema default shows for it.
export function settleWrite(current, keys, source) {
  if (!source) return current;
  const out = { ...current };
  for (const key of keys) {
    if (Object.hasOwn(source, key)) out[key] = source[key];
    else delete out[key];
  }
  return out;
}

export function mergeSettings(values = {}, schema = SETTINGS_SCHEMA) {
  const out = {};
  for (const field of settingsFields(schema)) out[field.key] = settingValue(field, values);
  return out;
}
