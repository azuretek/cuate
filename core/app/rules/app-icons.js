// Pure: the app icon chosen in Settings (issues 167, 189 and 246). The choices are core/spec/app-icons.json, mirrored
// for the page in app-icons-spec.js by the icon pipeline (desktop/scripts/icons.mjs), so the page, the desktop, the
// iPhone and Android read one list. Every colour is one family with two variants: a paper variant (Light) and the
// bright one (Dark), each a fixed palette of the tokens the icon reads (rules/icon.js) drawn through the same palette
// and renderer as the theme's, so a variant is the same glyph in other colours and never a second drawing. Follow theme
// is not a colour of its own: it picks the offered variant nearest the theme's accent (issue 337), switching when the
// theme or the appearance does. The value is held by the server under appearance.appIcon
// like any other setting, so a choice made on one device reaches every device; each shell applies it where its platform
// can (the bridge's app.icon), and docs/FEATURES.md says where a platform cannot.
import { APP_ICONS } from './app-icons-spec.js';
import { cssColour, colourDistance, hueDistance, chroma, SATURATED } from './icon.js';

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

// The words under a variant's tile: the colour's name alone, "Rosa" (issues 246 and 254). Which variant it is lives in
// the tile's accessible name and in the swatch itself (a paper Light one or a bright Dark one), never as extra text
// beside the name.
export function appIconChoiceLabel(variant) {
  return variant.familyLabel;
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

// Follow theme picks one of the icons Settings offers (issue 337). The families are told apart by hue, so the family
// is the one whose bright colour lies nearest the theme's accent around the hue circle; then, of that family's two
// variants, the one whose tile colour (its accent) is nearer in OKLab, so a pale accent takes the paper variant. An
// accent with too little colour to have a hue is matched in OKLab across every variant, and the first in the spec's
// order wins a tie. A phone cannot recolour an installed icon, so following the theme means choosing among the icons
// every platform already holds. An accent that does not read as a colour picks the default.
export function themeMatch(accent, spec = APP_ICONS) {
  if (!cssColour(accent)) return spec.default;
  const nearest = (items, distance) => items.reduce((best, item) => (distance(item) < distance(best) ? item : best));
  if (chroma(accent) < SATURATED) return nearest(appIconVariants(spec), (v) => colourDistance(accent, v.colors.accent)).id;
  const family = nearest(spec.families, (f) => hueDistance(accent, f.variants.dark.colors.accent));
  return nearest([family.variants.dark, family.variants.light], (v) => colourDistance(accent, v.colors.accent)).id;
}

// The icon actually drawn: the fixed variant chosen, or under Follow theme the variant nearest the theme's accent.
export function iconInForce(values, accent = null, spec = APP_ICONS) {
  const id = appIconFor(values, spec);
  return id === FOLLOW_THEME ? themeMatch(accent, spec) : id;
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
export function iconToApply(applied, values, accent = null, spec = APP_ICONS) {
  const next = iconInForce(values, accent, spec);
  return next === applied ? null : next;
}
