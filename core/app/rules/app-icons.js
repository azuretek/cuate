// Pure: the app icon chosen in Settings (issues 167 and 189). The choices are core/spec/app-icons.json, mirrored for the
// page in app-icons-spec.js by the icon pipeline (desktop/scripts/icons.mjs), so the page, the desktop, the iPhone and
// Android read one list. Follow theme, the default, is the icon coloured from the active theme's tokens; every other
// choice is a fixed palette, the same masters through the same palette function (rules/icon.js) in colours the spec
// holds. The value is held by the server under appearance.appIcon like any other setting, so a choice made on one
// device reaches every device; each shell applies it where its platform can (the bridge's app.icon), and
// docs/features.md says where a platform cannot.
import { APP_ICONS } from './app-icons-spec.js';

export const APP_ICON_KEY = 'appearance.appIcon';
// The choice that has no colours of its own: the icon follows the theme in force.
export const FOLLOW_THEME = 'theme';

// The icon to draw: the one the server holds, else the default. An id the spec does not hold (a choice from a newer
// build, say) draws the default rather than nothing.
export function appIconFor(values, spec = APP_ICONS) {
  const id = values && values[APP_ICON_KEY];
  return spec.icons.some((i) => i.id === id) ? id : spec.default;
}

// The palette a fixed choice draws in, { scheme, colors }, or null for Follow theme (or an id the spec does not hold),
// which takes its colours from the theme.
export function fixedPalette(id, spec = APP_ICONS) {
  const icon = spec.icons.find((i) => i.id === id);
  return icon && icon.colors ? { scheme: icon.scheme === 'dark' ? 'dark' : 'light', colors: { ...icon.colors } } : null;
}

// The choices Settings draws, in the spec's order, each with its picture and the one in force marked. A fixed palette's
// picture is generated (core/app/assets/app-icons); Follow theme's is the icon in the theme in force, which the page
// draws and passes as themePicture, and until it has, the default theme's (assets/app-icon.png).
export function appIconChoices(values, { themePicture = null } = {}, spec = APP_ICONS) {
  const current = appIconFor(values, spec);
  return spec.icons.map((i) => ({
    id: i.id,
    label: i.label,
    src: i.colors ? 'assets/app-icons/' + i.id + '.png' : themePicture || 'assets/app-icon.png',
    selected: i.id === current,
  }));
}

// What to ask the shell for, given what it last applied: the icon in force when it differs, else null, so a settings
// change that leaves the icon alone never asks again (iOS confirms every change with an alert of its own).
export function iconToApply(applied, values, spec = APP_ICONS) {
  const next = appIconFor(values, spec);
  return next === applied ? null : next;
}
