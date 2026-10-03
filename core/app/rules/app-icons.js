// Pure: the app icon chosen in Settings (issue 167). The choices are core/spec/app-icons.json, mirrored for the page in
// app-icons-spec.js by the icon pipeline (desktop/scripts/icons.mjs), so the page, the desktop, the iPhone and Android
// read one list. The value is held by the server under appearance.appIcon like any other setting, so a choice made on
// one device reaches every device; each shell applies it where its platform can (the bridge's app.icon), and
// docs/features.md says where a platform cannot.
import { APP_ICONS } from './app-icons-spec.js';

export const APP_ICON_KEY = 'appearance.appIcon';

// The icon to draw: the one the server holds, else the default. An id the spec does not hold (a choice from a newer
// build, say) draws the default rather than nothing.
export function appIconFor(values, spec = APP_ICONS) {
  const id = values && values[APP_ICON_KEY];
  return spec.icons.some((i) => i.id === id) ? id : spec.default;
}

// The choices Settings draws, in the spec's order, each with its picture (core/app/assets/app-icons) and the one in
// force marked.
export function appIconChoices(values, spec = APP_ICONS) {
  const current = appIconFor(values, spec);
  return spec.icons.map((i) => ({ id: i.id, label: i.label, src: 'assets/app-icons/' + i.id + '.png', selected: i.id === current }));
}

// What to ask the shell for, given what it last applied: the icon in force when it differs, else null, so a settings
// change that leaves the icon alone never asks again (iOS confirms every change with an alert of its own).
export function iconToApply(applied, values, spec = APP_ICONS) {
  const next = appIconFor(values, spec);
  return next === applied ? null : next;
}
