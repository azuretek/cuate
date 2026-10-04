import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contrastRatio, parseColour, importTheme, themeVars } from '../app/rules/theme.js';

// A design direction is one remapping of the surface roles (core/app/styles/roles.css). This holds the rule that
// matters most for a role: the text drawn on it reads at 4.5:1, in both schemes of the default palette and of an
// imported theme (issue 217). It reads the shipped stylesheet, resolves every role to a colour the way the browser
// does (var(), color-mix() in oklab, oklch(from ...) lightness), and checks the pairs the direction draws.

const ROOT = new URL('../..', import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), 'utf8');

// --- the colour maths the stylesheet's expressions use ----------------------------------------------------------
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
function rgbToOklab(rgb) {
  const [r, g, b] = rgb.map(toLin);
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const [l_, m_, s_] = [l, m, s].map(Math.cbrt);
  return [0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_, 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_, 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_];
}
function oklabToRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return lin.map((c) => toSrgb(Math.min(1, Math.max(0, c))));
}
const rgb = (v) => (Array.isArray(v) ? v : parseColour(v));

// --- read the roles the stylesheet declares --------------------------------------------------------------------
const css = read('core/app/styles/roles.css').replace(/\/\*[\s\S]*?\*\//g, '');
function declarations(block) {
  const out = {};
  for (const m of block.matchAll(/--role-([a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const baseBlock = /:root\s*\{([^}]*)\}/.exec(css)[1];
const darkBlock = (/:root\[data-scheme="dark"\]\s*\{([^}]*)\}/.exec(css) || [null, ''])[1];
const BASE = declarations(baseBlock);
const DARK = declarations(darkBlock);
const avatarBlock = /--role-avatar\s*:\s*color-mix\(in oklab, var\(--color-chart-\d\) (\d+)%, var\(--color-sidebar\)\)/.exec(baseBlock);

// Resolve one role expression to an sRGB triple, with a palette of colour values in force.
function resolveExpr(expr, palette) {
  const e = expr.trim();
  let m = /^var\(--color-([a-z0-9-]+)\)$/.exec(e);
  if (m) return rgb(palette[m[1]]);
  m = /^color-mix\(in oklab,\s*(.+?)\s+(\d+)%,\s*(.+)\)$/.exec(e);
  if (m) {
    const a = rgbToOklab(resolveExpr(m[1], palette));
    const b = rgbToOklab(resolveExpr(m[3], palette));
    const t = Number(m[2]) / 100;
    return oklabToRgb([0, 1, 2].map((i) => a[i] * t + b[i] * (1 - t)));
  }
  m = /^oklch\(from\s+(.+?)\s+calc\(l\s*([+-])\s*([\d.]+)\)\s+c\s+h\)$/.exec(e);
  if (m) {
    const [L, a, b] = rgbToOklab(resolveExpr(m[1], palette));
    return oklabToRgb([L + (m[2] === '-' ? -1 : 1) * Number(m[3]), a, b]);
  }
  throw new Error('the test cannot read the role expression: ' + e);
}
function roleValues(palette, scheme) {
  const overrides = scheme === 'dark' ? DARK : {};
  const out = {};
  // A role may name something that is not a colour (the menu shadow); only the colour roles matter to a text pair.
  for (const [name, expr] of Object.entries(BASE)) {
    try { out[name] = resolveExpr(overrides[name] ?? expr, palette); } catch { /* not a colour role */ }
  }
  return out;
}

// --- the palettes in force: the default tokens, and an imported theme ------------------------------------------
const spec = JSON.parse(read('core/spec/tokens.json'));
function paletteFor(theme, scheme) {
  const p = { ...spec.color[scheme] };
  if (theme) for (const [k, v] of themeVars(theme, scheme)) { const m = /^--color-(.+)$/.exec(k); if (m) p[m[1]] = v; }
  return p;
}
const imported = importTheme(read('core/fixtures/themes/elegant-luxury.json')).theme;

// --- the pairs the direction draws: text on the surface it sits on ---------------------------------------------
const PAIRS = [
  ['page text', 'fg', 'page'], ['page muted text', 'page-muted', 'page'],
  ['chat name on sidebar', 'sidebar-fg', 'sidebar'], ['chat preview and time on sidebar', 'sidebar-muted', 'sidebar'],
  ['row hover: name', 'row-hover-fg', 'row-hover'], ['row hover: preview', 'row-hover-fg', 'row-hover'],
  ['row press: name', 'row-hover-fg', 'row-press'],
  ['selected row: name', 'row-selected-fg', 'row-selected'], ['selected row: preview', 'row-selected-muted', 'row-selected'],
  ['search text', 'search-fg', 'search'], ['search placeholder', 'placeholder', 'search'],
  ['conversation header name', 'page-fg', 'conv-head'],
  ['composer text', 'composer-field-fg', 'composer-field'], ['composer placeholder', 'placeholder', 'composer-field'],
  ['sent bubble', 'sent-fg', 'sent'], ['received bubble', 'received-fg', 'received'],
  ['notice text', 'notice-fg', 'notice'], ['notice detail and action', 'notice-muted', 'notice'], ['notice action hover', 'notice-action', 'notice-hover'],
  ['menu item', 'menu-fg', 'menu'], ['menu note', 'menu-muted', 'menu'], ['menu checked item', 'menu-checked', 'menu'],
  ['menu item hover', 'menu-hover-fg', 'menu-hover'], ['menu item press', 'menu-hover-fg', 'menu-press'],
  ['filter chip', 'chip-fg', 'chip'], ['filter chip hover', 'chip-fg', 'chip-hover'], ['filter chip on', 'chip-on-fg', 'chip-on'],
  ['header icon, open', 'head-icon-open-fg', 'head-icon-open'], ['header icon, hover', 'head-icon-hover-fg', 'head-icon-hover'],
  ['primary button', 'button-fg', 'button'], ['primary button hover', 'button-fg', 'button-hover'], ['primary button press', 'button-fg', 'button-press'],
];
const CHART_TINT = Number(avatarBlock[1]);

test('the surface roles keep every text pair at 4.5:1 in both schemes of the default palette and an imported theme', () => {
  for (const [themeName, theme] of [['default', null], ['elegant-luxury', imported]]) {
    for (const scheme of ['light', 'dark']) {
      const palette = paletteFor(theme, scheme);
      const roles = roleValues(palette, scheme);
      const col = (ref) => (roles[ref] ?? rgb(palette[ref]));
      for (const [label, fg, bg] of PAIRS) {
        const ratio = contrastRatio(col(fg), col(bg));
        assert.ok(ratio !== null && ratio >= 4.5, themeName + '/' + scheme + ' ' + label + ' is ' + (ratio === null ? 'unreadable' : ratio.toFixed(2)));
      }
      // The avatars cycle every chart colour (roles.css), so the initials read on all five, not only chart-1.
      for (let i = 1; i <= 5; i += 1) {
        const tint = resolveExpr('color-mix(in oklab, var(--color-chart-' + i + ') ' + CHART_TINT + '%, var(--color-sidebar))', palette);
        const ratio = contrastRatio(roles['avatar-fg'], tint);
        assert.ok(ratio >= 4.5, themeName + '/' + scheme + ' avatar initials on chart-' + i + ' is ' + ratio.toFixed(2));
      }
    }
  }
});
