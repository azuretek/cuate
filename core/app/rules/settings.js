// Pure: the settings page's rules. The schema declares every setting the page shows, its label, its control, its
// group and its default. The server holds the values (server/src/settings.js stores any key it is given), so the page
// reads and writes them there rather than keeping local state, and a key the schema does not declare is left for a
// later item. The groups give the page its sections, so there is no second list to keep in step.
//
// appearance.skin is a three-position switch (System, Light, Dark) rather than a dropdown, and text size is a
// percentage of the type tokens from TEXT_SCALES, held under its own key so a size stored under the old 11 to 20 field
// (appearance.textSize) is never read as a percentage. There is no density setting: it changed too little to be worth
// a control (issue 112), and a later item can bring one back.
//
// The groups also say where the two sections with no settings of their own sit: This device (the server, sign out)
// and About, which is always the LAST section (issue 134). A group's kind says how the page draws it: 'settings' draws
// its keys, 'device' and 'about' draw their own rows. About carries chela's full details inline rather than linking to
// a separate page, and aboutRows() below is the one owner of what it shows and in which order.
import { TEXT_SCALES } from './theme.js';
import { reportRows, UNKNOWN } from '../../kit/rules/build.js';
import { BUILD_SPEC } from './build-spec.js';

export const SETTINGS_SCHEMA = {
  groups: [
    { id: 'appearance', label: 'Appearance', description: 'How the app looks and how much text it shows.' },
    { id: 'notifications', label: 'Notifications', description: 'Which events raise a notice on this device.' },
    { id: 'updates', label: 'Updates', description: 'How a release this app finds is fetched.' },
    { id: 'device', kind: 'device', label: 'This device', description: 'The server this app talks to, and the way out of it.' },
    { id: 'about', kind: 'about', label: 'About', description: 'The build this device is running and the server it talks to. Select a value to copy it.' },
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
  },
};

export function settingsFields(schema = SETTINGS_SCHEMA) {
  return Object.entries(schema.keys).map(([key, spec]) => ({ key, ...spec }));
}

// The fields grouped for the page, in the schema's group order. A field with no group falls into the first group.
// A group with no kind is a settings group.
export function settingsGroups(schema = SETTINGS_SCHEMA) {
  const fields = settingsFields(schema);
  const groups = schema.groups || [];
  const fallback = groups.length ? groups[0].id : null;
  return groups.map((g) => ({ id: g.id, kind: g.kind || 'settings', label: g.label, description: g.description, fields: fields.filter((f) => (f.group || fallback) === g.id) }));
}

// The About section's rows, in the order chela's About reads: the app's name and version, its channel, build and
// commit, the server's version and commit, then what the client runs on (platform, architecture, Electron, Chromium,
// Node) and where it was installed from, with the rest of the build report after. Each entry names the half that owns
// the value; the labels and the values themselves come from core/spec/build.json through reportRows, so a value is
// still only ever read from its own half. core/test/rules.test.js holds this list to every field the spec declares,
// once each, so a field added to the spec cannot be left off the page.
export const ABOUT_ORDER = [
  ['client', 'product'],
  ['client', 'version'],
  ['client', 'channel'],
  ['client', 'build'],
  ['client', 'commit'],
  ['client', 'builtAt'],
  ['server', 'serverVersion'],
  ['server', 'serverCommit'],
  ['server', 'serverChannel'],
  ['server', 'serverBuild'],
  ['server', 'serverBuiltAt'],
  ['client', 'platform'],
  ['client', 'arch'],
  ['client', 'electron'],
  ['client', 'chromium'],
  ['client', 'node'],
  ['client', 'installSource'],
  ['client', 'packaged'],
  ['client', 'updateChannel'],
  ['server', 'serverPlatform'],
  ['server', 'engine.kind'],
  ['server', 'engine.version'],
  ['server', 'apiVersion'],
];

// The app's name is not a build field: the shell reports it beside its build, and the server names the same product.
const PRODUCT = { key: 'product', label: 'App' };

export function aboutRows(host, info, spec = BUILD_SPEC) {
  const halves = { client: reportRows(spec, 'client', host || {}), server: reportRows(spec, 'server', info || {}) };
  return ABOUT_ORDER.map(([half, key]) => {
    if (key === PRODUCT.key) {
      const name = (host && host.product) || (info && info.product);
      return { ...PRODUCT, value: name ? String(name) : UNKNOWN };
    }
    return halves[half].find((row) => row.key === key) || { key, label: key, value: UNKNOWN };
  });
}

// The About links, from the repository the server reports on its info route (core/spec/naming.json is the owner of
// the name, and the page carries none). Only an https address is linked; anything else draws no links rather than a
// link to somewhere unexpected.
export function aboutLinks(repository) {
  const base = typeof repository === 'string' ? repository.trim().replace(/\.git$/, '').replace(/\/+$/, '') : '';
  if (!/^https:\/\/[^\s/]+\/\S+$/.test(base)) return [];
  return [
    { key: 'source', label: 'Source code', href: base },
    { key: 'licence', label: 'Licence', href: base + '/blob/main/LICENSE' },
    { key: 'report', label: 'Report a problem', href: base + '/issues/new' },
  ];
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
