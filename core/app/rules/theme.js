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

// Every declaration a theme writes for one scheme: the colour group for that scheme, then the groups that do not
// depend on it. A value the theme leaves out is simply not written, so tokens.css's own value stands for it.
export function themeVars(theme, scheme = 'light') {
  const out = [];
  if (!theme || typeof theme !== 'object') return out;
  for (const group of THEME_GROUPS) {
    const values = theme[group];
    if (!values || typeof values !== 'object') continue;
    for (const [key, value] of Object.entries(values)) if (value !== null && value !== undefined) out.push([cssVarName(group, key), String(value)]);
  }
  const colours = theme.color && theme.color[scheme];
  if (colours && typeof colours === 'object') for (const [key, value] of Object.entries(colours)) if (value !== null && value !== undefined) out.push([cssVarName('color', key), String(value)]);
  return out;
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
  accent: ['color', 'selection'],
  radius: ['radius', 'md'],
  'font-sans': ['font', 'family'],
  'font-mono': ['font', 'mono'],
};

// A name the export carries that has no app token, with the reason it is left out.
const REFUSE = {
  popover: 'the app draws no popover surface',
  'popover-foreground': 'the app draws no popover surface',
  'card-foreground': 'the app takes its words from fg, not a per-surface foreground',
  'accent-foreground': 'the app has no colour on the selection highlight',
  ring: 'the app derives its focus ring from accent',
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

// Which scheme a block fills: ':root' is light, '.dark' is dark, anything else is neutral (radius and the font).
function schemeOf(selector) {
  if (/(^|[\s,])[^,]*\.dark\b/.test(selector)) return 'dark';
  if (/:(:?root)\b|\bhtml\b|\bbody\b/.test(selector)) return 'light';
  return null;
}

// Convert a tweakcn export into this app's theme and a report of what was accepted and refused. Never throws on
// unrecognised input: an export with no tokens at all comes back as a theme with no overrides and every name refused.
export function importTweakcn(text, { name = 'tweakcn' } = {}) {
  const accepted = [];
  const refused = [];
  const theme = { name, source: 'tweakcn', color: { light: {}, dark: {} } };
  for (const block of parseBlocks(text)) {
    const scheme = schemeOf(block.selector);
    for (const [raw, value] of Object.entries(block.vars)) {
      if (Object.hasOwn(REFUSE, raw)) { refused.push(raw); continue; }
      const target = MAP[raw];
      if (!target) { refused.push(raw); continue; }
      const [group, key] = target;
      if (group === 'color' && !scheme) { refused.push(raw); continue; }
      if (group === 'color') theme.color[scheme][key] = value;
      else (theme[group] ??= {})[key] = value;
      accepted.push(raw);
      for (const [extra] of DERIVE[raw] ?? []) {
        if (group !== 'color') break;
        theme.color[scheme][extra] = value;
        accepted.push(raw + ' -> ' + extra);
      }
    }
  }
  return { theme, accepted, refused };
}
