// Pure: the app's theme model. tokens.css carries the default palette; a theme is a partial override of the same token
// set that the server holds under appearance.theme, so a theme chosen once reaches every client without a rebuild and
// light and dark both come from the theme. A tweakcn theme is converted into this shape by importTweakcn, which names
// every token it accepts and every one it refuses rather than dropping what it does not understand (issue 59).

export const SCHEMES = ['light', 'dark'];
// The groups a theme may override. Colour is per scheme; the rest do not vary with it.
export const THEME_GROUPS = ['space', 'radius', 'font', 'size', 'motion', 'shadow'];

// The scheme to draw: an explicit choice wins, otherwise the system's. A value the schema does not know is treated as
// system rather than refused, so a newer client's choice never leaves an older one unable to draw.
export function resolveScheme(preference, systemDark) {
  if (preference === 'light' || preference === 'dark') return preference;
  return systemDark ? 'dark' : 'light';
}

// The CSS custom property name tokens.css defines for a group's key.
export function cssVarName(group, key) {
  return group === 'color' ? `--color-${key}` : `--${group}-${key}`;
}

// Every declaration a theme writes for one scheme: the groups that do not depend on it, then what the theme sets for
// that scheme alone (theme.schemes, a shadow a dark block draws differently), then the colour group for the scheme. A
// value the theme leaves out is simply not written, so tokens.css's own value stands for it.
export function themeVars(theme, scheme = 'light') {
  const out = new Map();
  if (!theme || typeof theme !== 'object') return [];
  const put = (group, values) => {
    if (!values || typeof values !== 'object') return;
    for (const [key, value] of Object.entries(values)) if (value !== null && value !== undefined && safeValue(value)) out.set(cssVarName(group, key), String(value));
  };
  for (const group of THEME_GROUPS) put(group, theme[group]);
  const own = theme.schemes && typeof theme.schemes === 'object' ? theme.schemes[scheme] : null;
  if (own && typeof own === 'object') for (const group of THEME_GROUPS) put(group, own[group]);
  put('color', theme.color && theme.color[scheme]);
  return [...out];
}

// The font files a theme carries (fetched by the server at import, server/src/theme-fonts.js), each checked before a
// page hands it to the FontFace API: a family name, a 64-hex id, a weight and a style, nothing else.
export function themeFonts(theme) {
  const list = theme && typeof theme === 'object' && Array.isArray(theme.fonts) ? theme.fonts : [];
  return list.filter((f) => f && typeof f === 'object' && /^[A-Za-z0-9][A-Za-z0-9 ]{0,59}$/.test(String(f.family)) && /^[a-f0-9]{64}$/.test(String(f.id)) && /^[1-9]00$/.test(String(f.weight)))
    .map((f) => ({ family: f.family, id: f.id, weight: String(f.weight), style: f.style === 'italic' ? 'italic' : 'normal' }));
}

// The theme's name for a settings row, or empty when the server holds none.
export function themeName(theme) {
  return theme && typeof theme === 'object' && typeof theme.name === 'string' ? theme.name : '';
}

// --- tweakcn import ---------------------------------------------------------------------------------------------
// A tweakcn theme is the shadcn CSS-variable export: one ':root' block and one '.dark' block, each a list of
// --name: value pairs. The names below are mapped onto this app's tokens; a name that is not here is refused and
// reported, so what a theme could not say is visible rather than silently lost.

// target is [group, key]; a colour name is read from the block that carries it, so ':root' fills light and '.dark'
// fills dark. A neutral target (radius, font) is scheme independent.
const MAP = {
  background: ['color', 'bg'],
  foreground: ['color', 'fg'],
  card: ['color', 'bg-raised'],
  muted: ['color', 'bg-sunken'],
  'muted-foreground': ['color', 'fg-muted'],
  border: ['color', 'border'],
  input: ['color', 'border'],
  primary: ['color', 'accent'],
  'primary-foreground': ['color', 'accent-fg'],
  secondary: ['color', 'bubble-them'],
  'secondary-foreground': ['color', 'bubble-them-fg'],
  destructive: ['color', 'danger'],
  'destructive-foreground': ['color', 'danger-fg'],
  accent: ['color', 'selection'],
  radius: ['radius', 'md'],
  'font-sans': ['font', 'family'],
  'font-mono': ['font', 'mono'],
  'letter-spacing': ['font', 'tracking'],
  'tracking-normal': ['font', 'tracking'],
  spacing: ['space', '1'],
  'shadow-sm': ['shadow', 'sm'],
  'shadow-md': ['shadow', 'md'],
  'shadow-lg': ['shadow', 'lg'],
};

// The tokens one tweakcn value fills besides its own, as [key, value] in the same group. tweakcn gives one radius and
// one spacing unit and derives the rest from them; the app keeps a small scale, so the scale is derived the same way,
// in proportion, which leaves the app's own scale exactly as it is at tweakcn's default radius (0.625rem) and unit
// (0.25rem), and a radius of 0 square everywhere.
const SCALE = {
  radius: (v) => [['sm', 'calc(' + v + ' * 0.6)'], ['lg', 'calc(' + v + ' * 1.4)']],
  spacing: (v) => [['2', 'calc(' + v + ' * 2)'], ['3', 'calc(' + v + ' * 3)'], ['4', 'calc(' + v + ' * 4)'], ['5', 'calc(' + v + ' * 6)'], ['6', 'calc(' + v + ' * 8)']],
};

// A name the export carries that has no app token, with the reason it is left out.
const REFUSE = {
  popover: 'the app draws no popover surface',
  'popover-foreground': 'the app draws no popover surface',
  'card-foreground': 'the app takes its words from fg, not a per-surface foreground',
  'accent-foreground': 'the app has no colour on the selection highlight',
  ring: 'the app derives its focus ring from accent',
  'font-serif': 'the app sets no serif type',
  'tracking-tighter': 'the app has one letter spacing, tracking-normal',
  'tracking-tight': 'the app has one letter spacing, tracking-normal',
  'tracking-wide': 'the app has one letter spacing, tracking-normal',
  'tracking-wider': 'the app has one letter spacing, tracking-normal',
  'tracking-widest': 'the app has one letter spacing, tracking-normal',
  'shadow-2xs': 'the app has three elevations, shadow-sm, shadow-md and shadow-lg',
  'shadow-xs': 'the app has three elevations, shadow-sm, shadow-md and shadow-lg',
  shadow: 'the app has three elevations, shadow-sm, shadow-md and shadow-lg',
  'shadow-xl': 'the app has three elevations, shadow-sm, shadow-md and shadow-lg',
  'shadow-2xl': 'the app has three elevations, shadow-sm, shadow-md and shadow-lg',
  'shadow-color': 'already composed into the shadow-* values the app takes',
  'shadow-opacity': 'already composed into the shadow-* values the app takes',
  'shadow-blur': 'already composed into the shadow-* values the app takes',
  'shadow-spread': 'already composed into the shadow-* values the app takes',
  'shadow-offset-x': 'already composed into the shadow-* values the app takes',
  'shadow-offset-y': 'already composed into the shadow-* values the app takes',
  sidebar: 'the app draws no sidebar block',
  'chart-1': 'the app draws no charts',
  'chart-2': 'the app draws no charts',
  'chart-3': 'the app draws no charts',
  'chart-4': 'the app draws no charts',
  'chart-5': 'the app draws no charts',
  'sidebar-background': 'the app draws no sidebar block',
  'sidebar-foreground': 'the app draws no sidebar block',
  'sidebar-primary': 'the app draws no sidebar block',
  'sidebar-primary-foreground': 'the app draws no sidebar block',
  'sidebar-accent': 'the app draws no sidebar block',
  'sidebar-accent-foreground': 'the app draws no sidebar block',
  'sidebar-border': 'the app draws no sidebar block',
  'sidebar-ring': 'the app draws no sidebar block',
};

// The pairs a theme sets from one tweakcn colour when it names no token of its own for them. Keyed by the tweakcn
// name, not the token it maps onto, so primary fills the sent bubble and the unread mark as well as the accent.
const DERIVE = {
  primary: [['bubble-me'], ['unread']],
  'primary-foreground': [['bubble-me-fg']],
};

function parseBlocks(text) {
  const css = String(text).replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].trim().replace(/\s+/g, ' ').toLowerCase();
    const vars = {};
    for (const decl of match[2].matchAll(/--([A-Za-z0-9-]+)\s*:\s*([^;]+);?/g)) vars[decl[1]] = decl[2].trim();
    blocks.push({ selector, vars });
  }
  return blocks;
}

// A value is written onto the page as a custom property, and a theme can now arrive from any URL, so a value that could
// end the declaration or reach the network (a semicolon, a brace, url(), @import) is refused rather than carried.
const UNSAFE = /[;{}<>\\]|url\s*\(|image(?:-set)?\s*\(|expression\s*\(|@import/i;
const MAX_VALUE = 200;
export function safeValue(value) {
  const v = String(value);
  return v.length > 0 && v.length <= MAX_VALUE && !UNSAFE.test(v);
}

// Which scheme a block fills: ':root' is light, '.dark' is dark, anything else is neutral (radius and the font).
function schemeOf(selector) {
  if (/(^|[\s,])[^,]*\.dark\b/.test(selector)) return 'dark';
  if (/:(:?root)\b|\bhtml\b|\bbody\b/.test(selector)) return 'light';
  return null;
}

// Convert a tweakcn export into this app's theme and a report of what was accepted and refused. Never throws on
// unrecognised input: an export with no tokens at all comes back as a theme with no overrides and every name refused.
// A value that does not vary with the scheme (radius, a shadow, the type) is read from the light and neutral blocks
// first; the dark block then sets it only where it says something different, and that difference is held for dark
// alone (theme.schemes.dark), so a theme whose dark shadows are deeper draws them in dark without changing light.
export function importTweakcn(text, { name = 'tweakcn' } = {}) {
  const accepted = [];
  const refused = [];
  const theme = { name, source: 'tweakcn', color: { light: {}, dark: {} } };
  const blocks = parseBlocks(text).map((b) => ({ ...b, scheme: schemeOf(b.selector) }));
  const ordered = [...blocks.filter((b) => b.scheme !== 'dark'), ...blocks.filter((b) => b.scheme === 'dark')];
  const neutral = (scheme, group, key, value) => {
    const held = theme[group] && theme[group][key];
    if (scheme === 'dark' && held !== undefined) {
      if (held !== value) (((theme.schemes ??= {}).dark ??= {})[group] ??= {})[key] = value;
      return;
    }
    (theme[group] ??= {})[key] = value;
  };
  for (const block of ordered) {
    const { scheme } = block;
    for (const [raw, value] of Object.entries(block.vars)) {
      if (Object.hasOwn(REFUSE, raw)) { refused.push(raw); continue; }
      const target = MAP[raw];
      if (!target) { refused.push(raw); continue; }
      const [group, key] = target;
      if (group === 'color' && !scheme) { refused.push(raw); continue; }
      if (!safeValue(value)) { refused.push(raw); continue; }
      if (group === 'color') theme.color[scheme][key] = value;
      else neutral(scheme, group, key, value);
      accepted.push(raw);
      for (const [extra, derived] of SCALE[raw] ? SCALE[raw](value) : []) {
        neutral(scheme, group, extra, derived);
        accepted.push(raw + ' -> ' + extra);
      }
      for (const [extra] of DERIVE[raw] ?? []) {
        if (group !== 'color') break;
        theme.color[scheme][extra] = value;
        accepted.push(raw + ' -> ' + extra);
      }
    }
  }
  return { theme, accepted, refused };
}

// What an import tells the person who ran it: how many names it carried and every name it refused, once each, so a
// theme that lost something says so on the page rather than only in a test. An import that carried nothing is not a
// theme, and is reported as such so it is never stored.
export function importSummary({ accepted = [], refused = [] } = {}) {
  const carried = new Set(accepted.filter((a) => !a.includes(' -> '))).size;
  const left = [...new Set(refused)];
  if (carried === 0) return { ok: false, text: 'Nothing in that text is a tweakcn theme this app can carry.' };
  const lead = 'Imported ' + carried + (carried === 1 ? ' value.' : ' values.');
  return { ok: true, text: left.length ? lead + ' Refused: ' + left.join(', ') + '.' : lead + ' Nothing refused.' };
}

// --- a theme given as text: the CSS export, or tweakcn's registry JSON --------------------------------------------
// A tweakcn theme's URL (https://tweakcn.com/r/themes/<name>.json) answers with a shadcn registry item whose cssVars
// carry the same names as the CSS export, split into theme (neutral), light and dark. It is turned back into the CSS
// export's two blocks and run through the one converter, so a URL and a paste can never disagree about a name.
function registryCss(item) {
  const vars = item && typeof item === 'object' && item.cssVars;
  if (!vars || typeof vars !== 'object') return null;
  const block = (selector, ...sources) => {
    const lines = [];
    for (const src of sources) {
      if (!src || typeof src !== 'object') continue;
      for (const [k, v] of Object.entries(src)) if (/^[A-Za-z0-9-]+$/.test(k) && (typeof v === 'string' || typeof v === 'number')) lines.push('--' + k + ': ' + v + ';');
    }
    return selector + ' { ' + lines.join(' ') + ' }';
  };
  return block(':root', vars.theme, vars.light) + '\n' + block('.dark', vars.dark);
}

// tweakcn's registry names a built-in theme by its slug (elegant-luxury) and gives no title; the picker shows it as
// the theme page does (Elegant Luxury). Anything that is not a plain slug is left for the caller to use as it is.
function slugTitle(name) {
  if (typeof name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(name)) return '';
  return name.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

// Convert whatever a theme URL or a paste carried. JSON with cssVars is read as a registry item and takes its title or
// name when none is given; anything else is read as the CSS export.
export function importTheme(text, { name } = {}) {
  const raw = String(text ?? '');
  let item = null;
  if (/^\s*\{/.test(raw)) { try { item = JSON.parse(raw); } catch { item = null; } }
  const css = registryCss(item);
  const given = typeof name === 'string' && name.trim() ? name.trim() : '';
  const fromItem = item && typeof item === 'object' ? [item.title, slugTitle(item.name), item.name].find((v) => typeof v === 'string' && v.trim()) : '';
  return importTweakcn(css ?? raw, { name: (given || fromItem || 'Imported theme').slice(0, 60) });
}

// --- the themes the server holds, and the picker --------------------------------------------------------------------
// Imported themes are held on the server as one list under appearance.themes, so every client offers the same ones;
// the theme in force stays appearance.theme, a copy of the chosen entry, so a client that predates the list still
// draws it. The list is bounded so it cannot crowd out the rest of the settings store.
export const MAX_THEMES = 24;

// A stable id from the name, so importing the same theme again replaces it rather than adding a twin.
export function themeId(name) {
  const slug = String(name ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return slug || 'theme';
}

// The held list with one theme added (or replaced by id). Refuses, with the reason, a list that would grow past the bound.
export function addTheme(list, theme) {
  const held = Array.isArray(list) ? list.filter((t) => t && typeof t === 'object') : [];
  const entry = { ...theme, id: theme.id || themeId(theme.name) };
  const at = held.findIndex((t) => t.id === entry.id);
  if (at >= 0) return { ok: true, themes: held.map((t, i) => (i === at ? entry : t)), theme: entry, replaced: true };
  if (held.length >= MAX_THEMES) return { ok: false, reason: 'The server already holds ' + MAX_THEMES + ' themes; remove one first.' };
  return { ok: true, themes: [...held, entry], theme: entry, replaced: false };
}

// The held list with one theme taken out.
export function removeTheme(list, id) {
  return (Array.isArray(list) ? list : []).filter((t) => t && t.id !== id);
}

// Whether two themes are the same entry: by id when both carry one, else by name and source (a theme pasted before the
// list existed carries no id).
export function sameTheme(a, b) {
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (a.id && b.id) return a.id === b.id;
  return a.name === b.name && a.source === b.source;
}

// The cards the picker draws: the default palette first, then every held theme, then the theme in force when it is not
// in the list (one chosen before the list existed), so the one in force is always on the page and always marked.
export function themeChoices(values = {}) {
  const held = Array.isArray(values['appearance.themes']) ? values['appearance.themes'].filter((t) => t && typeof t === 'object') : [];
  const current = values['appearance.theme'] && typeof values['appearance.theme'] === 'object' ? values['appearance.theme'] : null;
  const cards = [{ id: 'default', name: 'Default', theme: null, held: false, selected: !current }];
  for (const t of held) cards.push({ id: t.id || themeId(t.name), name: themeName(t) || 'Theme', theme: t, held: true, selected: sameTheme(t, current) });
  if (current && !cards.some((c) => c.selected)) cards.push({ id: current.id || 'current', name: themeName(current) || 'Custom', theme: current, held: false, selected: true });
  return cards;
}

// The colour tokens a card shows, in the order it shows them: the page, a raised surface, the words, the accent, and
// both bubbles. A card sets every colour the theme carries for the scheme in force, and the swatches read them back.
export const SWATCH_TOKENS = ['bg', 'bg-raised', 'fg', 'accent', 'bubble-me', 'bubble-them'];

// The custom properties a card sets on itself to draw a theme in a scheme: the theme's colours only, since the card
// shows colour and nothing else of the theme.
export function swatchVars(theme, scheme = 'light') {
  const colours = theme && theme.color && theme.color[scheme];
  if (!colours || typeof colours !== 'object') return [];
  return Object.entries(colours).filter(([, v]) => v !== null && v !== undefined && safeValue(v)).map(([k, v]) => [cssVarName('color', k), String(v)]);
}

// --- text size ----------------------------------------------------------------------------------------------------
// Text size is a percentage of the type tokens. 100 writes nothing, so it renders exactly what the tokens say; any
// other choice scales every type size the theme or the tokens resolve, and nothing else (the spacing and the avatar
// keep their size, so a larger text size reads larger rather than zooming the window).
export const TEXT_SCALES = [50, 75, 100, 125, 150, 200, 300];
export const TYPE_SIZE_VARS = ['--font-size-xs', '--font-size-sm', '--font-size-md', '--font-size-lg', '--font-size-xl'];

// The percentage in force: a value the choices do not hold reads as 100, so a stale or hand-written value never
// draws the page at a size no control can return it from.
export function textScale(value) {
  const n = Number(value);
  return TEXT_SCALES.includes(n) ? n : 100;
}

// The declarations a percentage writes, given what each type size resolves to before scaling.
export function textScaleVars(percent, base = {}) {
  const p = textScale(percent);
  if (p === 100) return [];
  const out = [];
  for (const name of TYPE_SIZE_VARS) {
    const value = String(base[name] ?? '').trim();
    if (value) out.push([name, 'calc(' + value + ' * ' + p / 100 + ')']);
  }
  return out;
}

// --- contrast -------------------------------------------------------------------------------------------------------
// WCAG contrast between two colours, so a check can hold a label to 4.5:1 against what it is drawn on. A colour is
// read from hex, rgb() or oklch() (tweakcn's own form); anything else is null, and a ratio with a null side is null.
export function parseColour(value) {
  const v = String(value ?? '').trim().toLowerCase();
  let m = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  }
  m = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (m) return [m[1], m[2], m[3]].map((n) => Math.min(1, Number(n) / 255));
  m = v.match(/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/);
  if (m) {
    const L = Number(m[1]) / (m[2] ? 100 : 1);
    const h = (Number(m[4]) * Math.PI) / 180;
    const a = Number(m[3]) * Math.cos(h);
    const b = Number(m[3]) * Math.sin(h);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const lin = [4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s];
    return lin.map((c) => { const x = Math.min(1, Math.max(0, c)); return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055; });
  }
  return null;
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
  const x = Array.isArray(a) ? a : parseColour(a);
  const y = Array.isArray(b) ? b : parseColour(b);
  if (!x || !y) return null;
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}
