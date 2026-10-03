// Pure: turns core/spec/tokens.json into the token stylesheet. scripts/gen-tokens.mjs writes it; a test checks freshness.
// Light is the default; a client that follows the system's dark mode takes the dark block from the media query, and a
// client whose skin is an explicit choice sets data-scheme on the root, which wins in both directions (issue 59).
const GROUPS = ['space', 'radius', 'font', 'size', 'motion', 'shadow', 'icon'];

// One glyph of the icon set as the SVG document a mask draws: the Control UI's stroke attributes, the glyph's own
// weight where it names one, and its parts. The stroke colour is only the mask's alpha; the element's background,
// which is its text colour, is what shows, so one glyph serves both schemes and every theme.
export function iconSvg(glyph, icon) {
  const attrs = (o) => Object.entries(o).map(([k, v]) => ` ${k}="${v}"`).join('');
  const parts = glyph.svg.map(([tag, a]) => `<${tag}${attrs(a)}/>`).join('');
  const stroke = { viewBox: '0 0 24 24', xmlns: 'http://www.w3.org/2000/svg', fill: 'none', stroke: 'black', 'stroke-width': glyph['stroke-width'] || icon.stroke, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  return `<svg${attrs(stroke)}>${parts}</svg>`;
}

function iconRules(spec) {
  const glyphs = (spec.icons && spec.icons.glyphs) || {};
  return Object.entries(glyphs).map(([name, glyph]) => `.icon[data-icon="${name}"] { --icon-glyph: url("data:image/svg+xml,${encodeURIComponent(iconSvg(glyph, spec.icon))}"); }`);
}

// The iOS asset catalog's accent colour set, from the tokens' accent in each scheme. An empty set leaves iOS on its
// system blue, which the web view's caret, text selection and every native control draw in (issue 59), so the shell
// wears the tokens' accent instead. scripts/gen-tokens.mjs writes it; a guard fails when it is stale.
export function accentColorset(spec) {
  return colorset(spec, 'accent');
}

// The iOS asset catalog's surface colour set, from the tokens' page surface (bg) in each scheme: what the shell shows
// behind the page and under its loading cover before the page has painted, so the status bar and the home indicator
// never flash a system white or black that the page does not draw (issue 175).
export function surfaceColorset(spec) {
  return colorset(spec, 'bg');
}

// The Android shell's surface colour, the same token for one scheme, as a resource file: values/ for light and
// values-night/ for dark, read by the window background and the loading cover (issue 175).
export function androidSurfaceColors(spec, scheme) {
  const hex = rgbHex(spec.color[scheme].bg, 'bg');
  return ['<?xml version="1.0" encoding="utf-8"?>', '<!-- Generated from core/spec/tokens.json by scripts/gen-tokens.mjs. Do not edit. -->', '<resources>', '    <color name="surface">' + hex.toUpperCase() + '</color>', '</resources>', ''].join('\n');
}

function rgbHex(hex, name) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error('the ' + name + ' token must be a #rrggbb colour, not ' + hex);
  return hex;
}

function colorset(spec, token) {
  const srgb = (hex) => {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(rgbHex(hex, token));
    return { 'color-space': 'srgb', components: { alpha: '1.000', blue: '0x' + m[3].toUpperCase(), green: '0x' + m[2].toUpperCase(), red: '0x' + m[1].toUpperCase() } };
  };
  return {
    colors: [
      { color: srgb(spec.color.light[token]), idiom: 'universal' },
      { appearances: [{ appearance: 'luminosity', value: 'dark' }], color: srgb(spec.color.dark[token]), idiom: 'universal' },
    ],
    info: { author: 'xcode', version: 1 },
  };
}

export function tokensCss(spec) {
  const flat = (prefix, obj, indent) => Object.entries(obj).map(([k, v]) => `${indent}--${prefix}-${k}: ${v};`);
  const lines = ['/* Generated from core/spec/tokens.json by scripts/gen-tokens.mjs. Do not edit. */', ':root {', '  color-scheme: light dark;'];
  for (const g of GROUPS) lines.push(...flat(g, spec[g], '  '));
  const colours = (obj, indent) => flat('color', obj, indent);
  lines.push(...colours(spec.color.light, '  '), '}');
  lines.push('@media (prefers-color-scheme: dark) {', '  :root:not([data-scheme="light"]) {');
  lines.push(...colours(spec.color.dark, '    '), '  }', '}');
  lines.push(':root[data-scheme="dark"] {', '  color-scheme: dark;', ...colours(spec.color.dark, '  '), '}');
  lines.push(':root[data-scheme="light"] {', '  color-scheme: light;', '}');
  // The default palette again, on any element that asks for it with data-palette="default". The theme picker draws
  // each theme's colours on a card while a different theme is in force on the root, and a card's colours must fall
  // back to these defaults rather than to whatever the root inherited from the theme in force.
  lines.push('[data-palette="default"] {', ...colours(spec.color.light, '  '), '}');
  lines.push('@media (prefers-color-scheme: dark) {', '  :root:not([data-scheme="light"]) [data-palette="default"] {');
  lines.push(...colours(spec.color.dark, '    '), '  }', '}');
  lines.push(':root[data-scheme="dark"] [data-palette="default"] {', ...colours(spec.color.dark, '  '), '}');
  lines.push(...iconRules(spec), '');
  return lines.join('\n');
}
