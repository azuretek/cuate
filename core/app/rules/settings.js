// Pure: the settings page's rules. The schema declares every setting the page shows, its label, its control and its
// default. The server holds the values (server/src/settings.js stores any key it is given), so the page reads and
// writes them there rather than keeping local state, and a key the schema does not declare is left for a later item.
export const SETTINGS_SCHEMA = {
  keys: {
    'appearance.skin': { label: 'Appearance', type: 'choice', options: ['system', 'light', 'dark'], default: 'system' },
    'appearance.textSize': { label: 'Text size', type: 'number', min: 11, max: 20, step: 1, default: 14 },
    'appearance.density': { label: 'Density', type: 'choice', options: ['comfortable', 'compact'], default: 'comfortable' },
  },
};

export function settingsFields(schema = SETTINGS_SCHEMA) {
  return Object.entries(schema.keys).map(([key, spec]) => ({ key, ...spec }));
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

export function mergeSettings(values = {}, schema = SETTINGS_SCHEMA) {
  const out = {};
  for (const field of settingsFields(schema)) out[field.key] = settingValue(field, values);
  return out;
}
