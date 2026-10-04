// Pure: the app icon chosen in Settings (issues 167, 189 and 246). The choices are core/spec/app-icons.json, mirrored
// for the page in app-icons-spec.js by the icon pipeline (desktop/scripts/icons.mjs), so the page, the desktop, the
// iPhone and Android read one list. Every colour is one family with two variants: a paper variant (Light) and the
// bright one (Dark), each a fixed palette of the tokens the icon reads (rules/icon.js) drawn through the same palette
// and renderer as the theme's, so a variant is the same glyph in other colours and never a second drawing. Follow theme
// is not a colour: it draws the icon from the active theme's tokens and takes the Light or Dark rendering from the
// appearance in force, switching when the appearance does. The value is held by the server under appearance.appIcon
// like any other setting, so a choice made on one device reaches every device; each shell applies it where its platform
// can (the bridge's app.icon), and docs/features.md says where a platform cannot.
import { APP_ICONS } from './app-icons-spec.js';

export const APP_ICON_KEY = 'appearance.appIcon';
// The choice that has no colours of its own: the icon follows the theme and the appearance in force.
export const FOLLOW_THEME = 'theme';

// Every variant the spec holds, family by family in the spec's order, as { id, label, family, familyLabel, scheme,
// colors } (issue 246): a family is one colour, its variants are the paper Light one and the bright Dark one.
export function appIconVariants(spec = APP_ICONS) {
  return spec.families.flatMap((family) => ['light', 'dark'].map((key) => {
    const variant = family.variants[key];
    return { id: variant.id, label: variant.label, family: family.id, familyLabel: family.label, scheme: variant.scheme, colors: variant.colors };
  }));
}

// The words under a variant's tile: the colour and which variant it is, "Naranja Light" (issue 246).
export function appIconChoiceLabel(variant) {
  return variant.familyLabel + ' ' + variant.label;
}

// The icon to draw: the one the server holds, else the default. An id the spec does not hold (a choice from a newer
// build, say) draws the default rather than nothing.
export function appIconFor(values, spec = APP_ICONS) {
  const id = values && values[APP_ICON_KEY];
  const known = id === FOLLOW_THEME || appIconVariants(spec).some((v) => v.id === id);
  return known ? id : spec.default;
}

// The palette a fixed variant draws in, { scheme, colors }, or null for Follow theme (or an id the spec does not hold),
// which takes its colours from the theme and its rendering from the appearance.
export function fixedPalette(id, spec = APP_ICONS) {
  const variant = appIconVariants(spec).find((v) => v.id === id);
  return variant && variant.colors ? { scheme: variant.scheme === 'dark' ? 'dark' : 'light', colors: { ...variant.colors } } : null;
}

// The choices Settings draws, in the spec's order (each colour's Light then Dark, then Follow theme), each with its
// picture and the one in force marked. A fixed variant's picture is generated (core/app/assets/app-icons); Follow
// theme's is the icon in the theme in force, which the page draws and passes as themePicture, and until it has, the
// default theme's (assets/app-icon.png).
export function appIconChoices(values, { themePicture = null } = {}, spec = APP_ICONS) {
  const current = appIconFor(values, spec);
  const choices = appIconVariants(spec).map((v) => ({
    id: v.id,
    label: appIconChoiceLabel(v),
    family: v.family,
    familyLabel: v.familyLabel,
    variantLabel: v.label,
    src: 'assets/app-icons/' + v.id + '.png',
    selected: v.id === current,
  }));
  choices.push({
    id: FOLLOW_THEME,
    label: spec.followTheme.label,
    family: null,
    familyLabel: null,
    variantLabel: null,
    src: themePicture || 'assets/app-icon.png',
    selected: current === FOLLOW_THEME,
  });
  return choices;
}

// What to ask the shell for, given what it last applied: the icon in force when it differs, else null, so a settings
// change that leaves the icon alone never asks again (iOS confirms every change with an alert of its own).
export function iconToApply(applied, values, spec = APP_ICONS) {
  const next = appIconFor(values, spec);
  return next === applied ? null : next;
}
