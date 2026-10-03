// Pure: the settings page's rules. The schema declares every setting the page shows, its label, its control, its
// group and its default. The server holds the values (server/src/settings.js stores any key it is given), so the page
// reads and writes them there rather than keeping local state, and a key the schema does not declare is left for a
// later item. The groups give the page its sections, so there is no second list to keep in step.
//
// appearance.skin is a three-position switch (System, Light, Dark) rather than a dropdown, and text size is a
// percentage of the type tokens from TEXT_SCALES, held under its own key so a size stored under the old 11 to 20 field
// (appearance.textSize) is never read as a percentage. There is no density setting: it changed too little to be worth
// a control (issue 112), and a later item can bring one back.
import { TEXT_SCALES } from './theme.js';

export const SETTINGS_SCHEMA = {
  groups: [
    { id: 'appearance', label: 'Appearance', description: 'How the app looks and how much text it shows.' },
    { id: 'notifications', label: 'Notifications', description: 'Which events raise a notice on this device.' },
    { id: 'updates', label: 'Updates', description: 'How a release this app finds is fetched.' },
  ],
  keys: {
    'appearance.skin': { group: 'appearance', label: 'Appearance', type: 'segmented', options: ['system', 'light', 'dark'], labels: { system: 'System', light: 'Light', dark: 'Dark' }, default: 'system' },
    'appearance.textScale': { group: 'appearance', label: 'Text size', type: 'scale', options: TEXT_SCALES, default: 100 },
    // Every notice the client can raise, each on its own switch. Turning one off silences only that notice.
    'notifications.newMessage': { group: 'notifications', label: 'New messages', type: 'toggle', default: true },
    'notifications.updateAvailable': { group: 'notifications', label: 'Update available', type: 'toggle', default: true },
    'notifications.updateReady': { group: 'notifications', label: 'Update ready to install', type: 'toggle', default: true },
    'notifications.errors': { group: 'notifications', label: 'Update errors', type: 'toggle', default: true },
    // Whether a release a check finds is fetched and applied with no further prompt. Off until someone turns it on: a
    // download nobody asked for spends someone's bandwidth, and the setting is how they asked. The check still runs
    // with it off, because knowing a release exists is what makes installing by hand possible.
    'updates.autoDownload': { group: 'updates', label: 'Download updates automatically', type: 'toggle', default: false },
    // Whether the installed server installs a verified release by itself. On by default for now (issue 117): every
    // install is verified, backed up, health checked and rolled back on failure. Off, the server still checks and
    // installs nothing; service update --pause on the Mac does the same from there.
    'updates.serverAuto': { group: 'updates', label: 'Update the server automatically', type: 'toggle', default: true },
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
  return groups.map((g) => ({ id: g.id, label: g.label, description: g.description, fields: fields.filter((f) => (f.group || fallback) === g.id) }));
}

// The words a choice is drawn with: the schema's label for it, a percentage for a scale, else the value itself.
export function optionLabel(field, option) {
  if (field.labels && Object.hasOwn(field.labels, option)) return field.labels[option];
  if (field.type === 'scale') return option + '%';
  return String(option);
}

// The value to show for a key: what the server holds, else the schema's default.
export function settingValue(field, values) {
  return values && Object.hasOwn(values, field.key) ? values[field.key] : field.default;
}

export function coerceSetting(field, raw) {
  if (field.type === 'number' || field.type === 'scale') return Number(raw);
  if (field.type === 'toggle') return raw === true || raw === 'true';
  return String(raw);
}

// A write's answer is the server's whole store at the moment it wrote, so it can be older than a change the event
// stream has already delivered: the answer and the event travel on separate connections and either can land first.
// Only the keys this write named are taken from the answer, and every other key keeps what the page already holds,
// so a slow answer never rolls a newer change back. The flake this fixes: the desktop smoke on macOS (run
// 37000805003) wrote one setting from the page, changed another at the server, and the page's own late answer put
// the old value of the second one back, so the page never showed the change.
export function settingsAfterWrite(current, patch, answer) {
  const out = { ...current };
  for (const key of Object.keys(patch || {})) {
    if (answer && Object.hasOwn(answer, key)) out[key] = answer[key];
  }
  return out;
}

// A refused write rolls back only the keys it named, to what they held before it, and keeps anything that arrived
// while it was in flight.
export function settingsAfterRefusal(current, before, patch) {
  const out = { ...current };
  for (const key of Object.keys(patch || {})) {
    if (before && Object.hasOwn(before, key)) out[key] = before[key];
    else delete out[key];
  }
  return out;
}

export function mergeSettings(values = {}, schema = SETTINGS_SCHEMA) {
  const out = {};
  for (const field of settingsFields(schema)) out[field.key] = settingValue(field, values);
  return out;
}
