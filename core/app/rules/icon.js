// Pure: the app icon, Flor de muerto (issue 189). Two speech bubbles leaning on each other, each a sugar skull, drawn
// from two masters (core/spec/icon/flor-de-muerto.svg, and flor-de-muerto-small.svg for 32 px and under) whose every
// detail is a true cut-out, so the shape survives grayscale and single-colour rendering. Nothing here holds a colour:
// iconPalette derives every one from the active theme's tokens and the scheme, and every platform's generator
// (desktop/scripts/icons.mjs) and the desktop shell (desktop/src/icon-images.js) draw through renderIcon, so a size, a
// theme and a platform cannot each grow their own drawing.

// The colour tokens the icon reads, the only ones it may.
export const ICON_TOKENS = ['accent', 'accent-fg', 'fg', 'bg', 'bg-raised', 'danger', 'danger-fg'];

// The floors the glyph keeps: against the accent tile in light, against the raised surface in dark.
export const GLYPH_FLOOR = { light: 2.6, dark: 4 };
// Hue closer than this to the accent, on a saturated accent, and a danger badge would vanish into the tile.
export const BADGE_HUE_GAP = 40;
// A colour whose OKLCH chroma is below this reads as a neutral, with no hue to clash.
export const SATURATED = 0.06;

// --- colour ---------------------------------------------------------------------------------------------------------
// Theme colours may be any CSS colour, the oklch() a tweakcn import carries included, so the derivation works on parsed
// colours: sRGB channels from 0 to 1. Alpha is dropped, since a token the icon reads is a solid colour.

const NAMED = { black: [0, 0, 0], white: [1, 1, 1], red: [1, 0, 0], green: [0, 128 / 255, 0], blue: [0, 0, 1], gray: [128 / 255, 128 / 255, 128 / 255], grey: [128 / 255, 128 / 255, 128 / 255] };
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const args = (body) => body.replace(/\//g, ' ').split(/[\s,]+/).filter(Boolean);
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
// A number, or a percentage of 'whole'.
const part = (s, whole) => (String(s).endsWith('%') ? (parseFloat(s) / 100) * whole : parseFloat(s));

function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map((n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)));
}

function oklabToLinear(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

// A CSS colour as sRGB channels, or null for one this cannot read (a var(), a color-mix(), a keyword it does not know).
export function cssColour(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (NAMED[v]) return [...NAMED[v]];
  let m = v.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) return [0, 1, 2].map((i) => parseInt(h[i] + h[i], 16) / 255);
    if (h.length === 6 || h.length === 8) return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    return null;
  }
  m = v.match(/^(rgba?|hsla?|oklch|oklab)\(([^()]*)\)$/);
  if (!m) return null;
  const p = args(m[2]).map((x) => (x === 'none' ? '0' : x.replace(/deg$/, '')));
  if (p.length < 3 || p.slice(0, 3).some((x) => !/^-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?%?$/.test(x))) return null;
  if (m[1].startsWith('rgb')) return p.slice(0, 3).map((x) => clamp01(x.endsWith('%') ? parseFloat(x) / 100 : parseFloat(x) / 255));
  if (m[1].startsWith('hsl')) return hslToRgb(((parseFloat(p[0]) % 360) + 360) % 360, clamp01(parseFloat(p[1]) / 100), clamp01(parseFloat(p[2]) / 100)).map(clamp01);
  const L = part(p[0], 1);
  let a;
  let b;
  if (m[1] === 'oklch') {
    const C = part(p[1], 0.4);
    const h = (parseFloat(p[2]) * Math.PI) / 180;
    a = C * Math.cos(h);
    b = C * Math.sin(h);
  } else {
    a = part(p[1], 0.4);
    b = part(p[2], 0.4);
  }
  return oklabToLinear(L, a, b).map((c) => toGamma(clamp01(c)));
}

const channels = (x) => (Array.isArray(x) ? x : cssColour(x));

// sRGB to OKLCH: lightness 0 to 1, chroma, hue in degrees.
export function toOklch(colour) {
  const [R, G, B] = channels(colour).map(toLinear);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return [L, Math.hypot(a, b), h < 0 ? h + 360 : h];
}

// OKLCH to sRGB, bringing an out-of-gamut colour in by lowering its chroma while keeping its lightness and hue.
export function fromOklch([L, C, h]) {
  const at = (c) => oklabToLinear(clamp01(L), c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180));
  const fits = (lin) => lin.every((x) => x >= -1e-7 && x <= 1 + 1e-7);
  let lin = at(C);
  if (!fits(lin)) {
    let lo = 0;
    let hi = C;
    for (let step = 0; step < 24; step += 1) {
      const mid = (lo + hi) / 2;
      if (fits(at(mid))) lo = mid;
      else hi = mid;
    }
    lin = at(lo);
  }
  return lin.map((x) => toGamma(clamp01(x)));
}

export const toHex = (rgb) => '#' + rgb.map((c) => Math.round(clamp01(c) * 255).toString(16).padStart(2, '0')).join('');

function luminance(rgb) {
  const [r, g, b] = rgb.map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// WCAG contrast between two colours, each a CSS colour or channels; null when either cannot be read.
export function contrast(x, y) {
  const a = channels(x);
  const b = channels(y);
  if (!a || !b) return null;
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

// The angle between two colours' hues, 0 to 180.
export function hueDistance(x, y) {
  const d = Math.abs(toOklch(x)[2] - toOklch(y)[2]) % 360;
  return d > 180 ? 360 - d : d;
}

export const chroma = (x) => toOklch(x)[1];

// The tokens the icon reads for one scheme: what the theme or the page gives, where it reads as a colour, otherwise the
// default token, so an unreadable value never leaves the icon without a colour.
export function iconColours(defaults = {}, given = {}) {
  const out = {};
  for (const key of ICON_TOKENS) out[key] = given && cssColour(given[key]) ? String(given[key]).trim() : defaults[key];
  return out;
}

// The icon's palette from the theme's tokens for one scheme, the one derivation every platform shares. Every colour
// is hex; the back bubble's is the glyph's at the given opacity.
//
//   light: the tile is the accent as a gentle vertical gradient, lighter and nudged one way in hue at the top, darker
//          and nudged the other at the bottom. The glyph is accent-fg where it reads on the accent at 2.6:1, otherwise
//          fg; the back bubble is the glyph at 50%.
//   dark:  the tile is bg-raised (a little lighter at the top) down to bg. The glyph is the dark accent, lightened step
//          by step until it reads at 4:1 on bg-raised; the back bubble is the glyph at 45%.
//
// The mark is the glyph drawn with no tile behind it (the tray): the accent in light, the dark glyph in dark. The
// badge is danger with danger-fg text, unless the accent is saturated and within 40 degrees of danger's hue, where it
// would vanish into the tile: then it is the scheme's fg, its text whichever of bg and fg reads on it. Its ring, where
// it has one, is the scheme's bg.
export function iconPalette(colours, scheme = 'light') {
  const c = Object.fromEntries(ICON_TOKENS.map((k) => [k, cssColour(colours && colours[k])]));
  for (const k of ICON_TOKENS) if (!c[k]) throw new Error('the icon needs the ' + k + ' token as a colour');
  const dark = scheme === 'dark';
  const [L, C, h] = toOklch(c.accent);
  let tileTop;
  let tileBottom;
  let glyph;
  if (dark) {
    const [rL, rC, rh] = toOklch(c['bg-raised']);
    tileTop = fromOklch([rL + 0.04, rC, rh]);
    tileBottom = c.bg;
    glyph = c.accent;
    // Lightened a step at a time, so the glyph keeps the accent's hue and stops at the first lightness that reads.
    for (let next = L; contrast(glyph, c['bg-raised']) < GLYPH_FLOOR.dark && next < 1;) {
      next = Math.min(1, next + 0.02);
      glyph = fromOklch([next, C, h]);
    }
  } else {
    tileTop = fromOklch([L + 0.07, C, h - 4]);
    tileBottom = fromOklch([L - 0.07, C, h + 4]);
    glyph = contrast(c['accent-fg'], c.accent) >= GLYPH_FLOOR.light ? c['accent-fg'] : c.fg;
  }
  const clash = C >= SATURATED && hueDistance(c.accent, c.danger) < BADGE_HUE_GAP;
  const badgeFill = clash ? c.fg : c.danger;
  const badgeText = clash ? (contrast(c.bg, badgeFill) >= contrast(c.fg, badgeFill) ? c.bg : c.fg) : c['danger-fg'];
  return {
    scheme: dark ? 'dark' : 'light',
    tile: { top: toHex(tileTop), bottom: toHex(tileBottom), behind: toHex(dark ? c['bg-raised'] : c.accent) },
    glyph: toHex(glyph),
    back: dark ? 0.45 : 0.5,
    mark: toHex(dark ? glyph : c.accent),
    badge: { fill: toHex(badgeFill), text: toHex(badgeText), ring: toHex(c.bg), neutral: clash },
  };
}

// --- the masters ----------------------------------------------------------------------------------------------------
// A master is the SVG the issue gives, read as data: two groups (the back bubble, then the front), each a union of
// shapes under a mask whose white keeps and black cuts, painted in order. The subset is what the masters use: circle,
// rect (with rx) and path (M, L, Q, C, Z, absolute) under translate, rotate and scale, and a group stroke, which grows
// a shape by half its width (the knocked-out gap between the bubbles).

const attrsOf = (s) => Object.fromEntries([...s.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const nums = (s) => (String(s).match(/-?\d*\.?\d+(?:e-?\d+)?/gi) || []).map(Number);

function transformer(spec) {
  const ops = [...String(spec || '').matchAll(/(translate|rotate|scale)\(([^)]*)\)/g)].map((m) => [m[1], nums(m[2])]);
  return ([x, y]) => {
    let p = [x, y];
    for (let i = ops.length - 1; i >= 0; i -= 1) {
      const [op, n] = ops[i];
      if (op === 'translate') p = [p[0] + n[0], p[1] + (n[1] ?? 0)];
      else if (op === 'scale') p = [p[0] * n[0], p[1] * (n[1] ?? n[0])];
      else {
        const r = (n[0] * Math.PI) / 180;
        p = [p[0] * Math.cos(r) - p[1] * Math.sin(r), p[0] * Math.sin(r) + p[1] * Math.cos(r)];
      }
    }
    return p;
  };
}

// A path as polygons, curves flattened finely enough for any size the icon is drawn at.
function pathPolygons(d, transform) {
  const t = transformer(transform);
  const tokens = String(d).match(/[MLQCZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) || [];
  const polys = [];
  let poly = null;
  let at = [0, 0];
  let i = 0;
  const read = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const cmd = tokens[i++].toUpperCase();
    if (cmd === 'M') { at = [read(), read()]; poly = [at]; polys.push(poly); }
    else if (cmd === 'L') { at = [read(), read()]; poly.push(at); }
    else if (cmd === 'Q') {
      const c = [read(), read()];
      const e = [read(), read()];
      for (let k = 1; k <= 16; k += 1) { const u = k / 16; const v = 1 - u; poly.push([v * v * at[0] + 2 * v * u * c[0] + u * u * e[0], v * v * at[1] + 2 * v * u * c[1] + u * u * e[1]]); }
      at = e;
    } else if (cmd === 'C') {
      const c1 = [read(), read()];
      const c2 = [read(), read()];
      const e = [read(), read()];
      for (let k = 1; k <= 24; k += 1) { const u = k / 24; const v = 1 - u; poly.push([v ** 3 * at[0] + 3 * v * v * u * c1[0] + 3 * v * u * u * c2[0] + u ** 3 * e[0], v ** 3 * at[1] + 3 * v * v * u * c1[1] + 3 * v * u * u * c2[1] + u ** 3 * e[1]]); }
      at = e;
    } else if (cmd === 'Z') at = poly[0];
    else throw new Error('the icon masters use M, L, Q, C and Z only, not ' + cmd);
  }
  return polys.map((p) => p.map(t));
}

function bounds(points, grow) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0 - grow, y0 - grow, x1 + grow, y1 + grow];
}

const circle = (cx, cy, r) => ({ kind: 'circle', cx, cy, r, box: [cx - r, cy - r, cx + r, cy + r] });

// A shape as data the rasterizer tests a point against, with its bounds for a quick refusal.
function shapeOf(tag, a, grow) {
  if (tag === 'circle') return circle(Number(a.cx), Number(a.cy), Number(a.r) + grow);
  if (tag === 'rect') {
    const [x, y, w, h] = [Number(a.x) - grow, Number(a.y) - grow, Number(a.width) + 2 * grow, Number(a.height) + 2 * grow];
    const rx = Math.min(Number(a.rx || 0) + grow, w / 2, h / 2);
    return { kind: 'rect', x, y, w, h, rx, box: [x, y, x + w, y + h] };
  }
  const polys = pathPolygons(a.d, a.transform);
  return { kind: 'poly', polys, grow, box: bounds(polys.flat(), grow) };
}

// The master as { viewBox, back, front }, each group { shapes, mask: [{ shape, keep }] } in paint order.
export function parseGlyph(svg) {
  const text = String(svg);
  const viewBox = nums(attrsOf(/<svg\b([^>]*)>/.exec(text)?.[1] || '').viewBox);
  if (viewBox.length !== 4) throw new Error('an icon master names its viewBox');
  const masks = {};
  const groups = [];
  const stack = [{}];
  let mask = null;
  let group = null;
  for (const m of text.matchAll(/<(\/?)([a-z]+)\b([^>]*?)(\/?)>/gi)) {
    const [, close, tag, rest, selfClose] = m;
    const a = attrsOf(rest);
    if (close) {
      if (tag === 'mask') mask = null;
      if (tag === 'g' && stack.pop().owns) group = null;
      continue;
    }
    if (tag === 'mask') { mask = []; masks[a.id] = mask; continue; }
    if (tag === 'g') {
      const inherit = { ...stack[stack.length - 1], ...a, owns: false };
      if (a.mask) { group = { mask: /#([^)]+)/.exec(a.mask)[1], shapes: [] }; groups.push(group); inherit.owns = true; }
      if (!selfClose) stack.push(inherit);
      continue;
    }
    if (!['circle', 'rect', 'path'].includes(tag)) continue;
    const ctx = { ...stack[stack.length - 1], ...a };
    const grow = ctx.stroke && ctx.stroke !== 'none' ? Number(ctx['stroke-width'] || 1) / 2 : 0;
    if (mask) mask.push({ shape: shapeOf(tag, a, grow), keep: ctx.fill === 'white' });
    else if (group) group.shapes.push(shapeOf(tag, a, grow));
  }
  if (groups.length !== 2) throw new Error('an icon master has a back group and a front group');
  const [back, front] = groups.map((g) => ({ shapes: g.shapes, mask: masks[g.mask] || [] }));
  return { viewBox, back, front };
}

// --- geometry -------------------------------------------------------------------------------------------------------

function segDist2(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  const ex = ax + t * dx - px;
  const ey = ay + t * dy - py;
  return ex * ex + ey * ey;
}

function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function contains(s, x, y) {
  if (x < s.box[0] || x > s.box[2] || y < s.box[1] || y > s.box[3]) return false;
  if (s.kind === 'circle') return (x - s.cx) ** 2 + (y - s.cy) ** 2 <= s.r * s.r;
  if (s.kind === 'rect') {
    const qx = Math.max(Math.abs(x - (s.x + s.w / 2)) - (s.w / 2 - s.rx), 0);
    const qy = Math.max(Math.abs(y - (s.y + s.h / 2)) - (s.h / 2 - s.rx), 0);
    return qx * qx + qy * qy <= s.rx * s.rx;
  }
  if (s.kind === 'stroke') {
    for (const line of s.lines) for (let i = 1; i < line.length; i += 1) if (segDist2(x, y, line[i - 1], line[i]) <= s.r * s.r) return true;
    return false;
  }
  for (const poly of s.polys) if (inPoly(x, y, poly)) return true;
  if (s.grow > 0) for (const poly of s.polys) for (let i = 0; i < poly.length; i += 1) if (segDist2(x, y, poly[i], poly[(i + 1) % poly.length]) <= s.grow * s.grow) return true;
  return false;
}

// Where a point in the master's units falls on a group: 1 inside one of its shapes and kept by its mask (the last mask
// shape covering the point deciding, as SVG paints a mask), -1 inside a shape but cut out, 0 off the group.
function groupAt(g, x, y) {
  if (!g.shapes.some((s) => contains(s, x, y))) return 0;
  let keep = true;
  for (const op of g.mask) if (contains(op.shape, x, y)) keep = op.keep;
  return keep ? 1 : -1;
}

export const onGroup = (g, x, y) => groupAt(g, x, y) === 1;

// --- the unread count -----------------------------------------------------------------------------------------------

// The total the badge counts: every chat's unread messages.
export function unreadTotal(chats) {
  return (Array.isArray(chats) ? chats : []).reduce((sum, c) => sum + (Number.isFinite(c?.unread) && c.unread > 0 ? c.unread : 0), 0);
}

// The count as an image of 'size' px spells it: null for none, '' for a plain dot (16 px, or ten and more under
// 32 px, never a wrong digit), one digit from 22 px, and 9+ from 32 px.
export function badgeLabel(count, size) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (n === 0) return null;
  if (size < 22) return '';
  if (n <= 9) return String(n);
  return size >= 32 ? '9+' : '';
}

// The digits as strokes in a box one unit high and 0.6 wide, so a count knocks out of a badge at any size.
const oval = (cx, cy, rx, ry) => Array.from({ length: 25 }, (_, k) => [cx + rx * Math.sin((k / 24) * 2 * Math.PI), cy - ry * Math.cos((k / 24) * 2 * Math.PI)]);
const DIGITS = {
  0: [oval(0.3, 0.5, 0.25, 0.42)],
  1: [[[0.12, 0.24], [0.34, 0.08], [0.34, 0.92]]],
  2: [[[0.06, 0.26], [0.14, 0.12], [0.3, 0.08], [0.46, 0.12], [0.54, 0.26], [0.5, 0.42], [0.06, 0.92], [0.56, 0.92]]],
  3: [[[0.06, 0.16], [0.22, 0.08], [0.4, 0.09], [0.52, 0.2], [0.5, 0.36], [0.36, 0.46], [0.24, 0.47]], [[0.36, 0.47], [0.52, 0.58], [0.54, 0.76], [0.42, 0.89], [0.26, 0.92], [0.1, 0.88], [0.04, 0.8]]],
  4: [[[0.44, 0.92], [0.44, 0.08], [0.04, 0.66], [0.58, 0.66]]],
  5: [[[0.52, 0.08], [0.14, 0.08], [0.1, 0.44], [0.28, 0.4], [0.44, 0.44], [0.54, 0.58], [0.54, 0.76], [0.42, 0.89], [0.26, 0.92], [0.1, 0.88], [0.04, 0.8]]],
  6: [[[0.5, 0.1], [0.34, 0.07], [0.18, 0.14], [0.08, 0.34], [0.06, 0.6], [0.12, 0.84], [0.3, 0.93], [0.47, 0.87], [0.55, 0.7], [0.5, 0.53], [0.32, 0.46], [0.14, 0.52], [0.07, 0.62]]],
  7: [[[0.04, 0.08], [0.56, 0.08], [0.22, 0.92]]],
  8: [oval(0.3, 0.29, 0.2, 0.2), oval(0.3, 0.71, 0.24, 0.21)],
  '+': [[[0.3, 0.24], [0.3, 0.76]], [[0.04, 0.5], [0.56, 0.5]]],
};
DIGITS[9] = DIGITS[6].map((line) => line.map(([x, y]) => [0.6 - x, 1 - y]));

// A label's strokes, centred on (cx, cy), h high.
function labelStroke(label, cx, cy, h) {
  const advance = 0.72 * h;
  const width = advance * (label.length - 1) + 0.6 * h;
  const lines = [];
  [...label].forEach((ch, i) => {
    const x0 = cx - width / 2 + i * advance;
    for (const line of DIGITS[ch]) lines.push(line.map(([x, y]) => [x0 + x * h, cy - h / 2 + y * h]));
  });
  const r = 0.11 * h;
  return { kind: 'stroke', lines, r, box: bounds(lines.flat(), r) };
}

// Where the tray's badge sits, in the masters' units: the top right of the tight crop, with a gap knocked out of the
// glyph around it. A dot carries no digit, so it is smaller and tucked further into the corner.
export const TRAY_BADGE = { text: { cx: 73, cy: 30, r: 17 }, dot: { cx: 76, cy: 27, r: 14 }, gap: 5 };
// The tight crop every tray image draws, so the glyph fills the slot.
export const TRAY_CROP = [11, 13, 79, 79];
// The largest size the simplified master serves.
export const SMALL_MAX = 32;

// --- rendering ------------------------------------------------------------------------------------------------------
// Every image the platforms take, as RGBA rows with straight alpha:
//
//   app          the desktop app icon: a rounded tile with a margin, as macOS draws one and Windows and Linux show it
//   ios          the iOS icon in its scheme's colours: a full square the system rounds, with no transparency
//   tinted       the iOS tinted icon: the glyph alone in grays on black, which the system tints
//   foreground   the Android adaptive foreground: the glyph alone inside the safe zone, over the accent background
//   monochrome   the Android themed icon: the glyph's alpha alone
//   tray         the tray and notification area: the glyph in the theme's colours, its count knocked out of it
//   template     the macOS menu bar: the silhouette, its count knocked out of it, which macOS recolours
//   overlay      the Windows taskbar overlay: the count's badge alone, ringed in the scheme's background
//
// A slot of 32 px and under draws the simplified master (48 px for the app tile, whose glyph is smaller than its tile).
export const ICON_KINDS = ['app', 'ios', 'tinted', 'foreground', 'monochrome', 'tray', 'template', 'overlay'];

const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

const FRONT = 1;
const BACK = 2;
const TILE = 4;
const BADGE = 8;
const DIGIT = 16;
const GAP = 32;
const RING = 64;
const CUT = 128;
// At this size and under, a tray pixel whose centre falls in a cut-out (an eye, the nose, the gap, the digit) is clear,
// so each still reads as a hole when it is about one pixel across.
const HINT_MAX = 16;

// Where a kind puts the master's units, [x0, y0, pixels per unit], and its tile, if it has one.
function layout(kind, S) {
  if (kind === 'app') {
    const m = (S * 32) / 1024;
    const tile = { x: m, y: m, w: S - 2 * m, h: S - 2 * m, r: (S * 224) / 1024 };
    const box = tile.w * 0.94;
    return { tile, place: [m + (tile.w - box) / 2, m + (tile.h - box) / 2, box / 100] };
  }
  if (kind === 'ios' || kind === 'tinted') {
    const box = S * 0.86;
    return { tile: { x: 0, y: 0, w: S, h: S, r: 0 }, place: [(S - box) / 2, (S - box) / 2, box / 100] };
  }
  if (kind === 'foreground' || kind === 'monochrome') {
    // 108 dp with a 66 dp safe circle: the glyph's outline, centred on its own middle (50.5, 52.5), stays inside it.
    const box = S * 0.64;
    return { tile: null, place: [S / 2 - 50.5 * (box / 100), S / 2 - 52.5 * (box / 100), box / 100] };
  }
  if (kind === 'tray' || kind === 'template') {
    const [vx, vy, vw] = TRAY_CROP;
    return { tile: null, place: [(-vx * S) / vw, (-vy * S) / vw, S / vw] };
  }
  if (kind === 'overlay') return { tile: null, place: null };
  throw new Error('no icon kind "' + kind + '"');
}

export function renderIcon({ masters, palette, kind, size, unread = 0 }) {
  const S = Math.round(size);
  const { tile, place } = layout(kind, S);
  const small = kind === 'app' ? S <= 48 : S <= SMALL_MAX;
  const glyph = small ? masters.small : masters.full;
  const empty = { width: S, height: S, data: new Uint8ClampedArray(S * S * 4) };

  // The badge, in pixels.
  let badge = null;
  if (kind === 'overlay') {
    const label = badgeLabel(unread, 32);
    if (label === null) return empty;
    const ring = Math.max(1, S * 0.09);
    badge = { disk: circle(S / 2, S / 2, S / 2 - ring), ring: circle(S / 2, S / 2, S / 2), digit: label ? labelStroke(label, S / 2, S / 2, (S - 2 * ring) * (label.length > 1 ? 0.46 : 0.56)) : null };
  } else if (kind === 'tray' || kind === 'template') {
    const label = badgeLabel(unread, S);
    if (label !== null) {
      const at = label ? TRAY_BADGE.text : TRAY_BADGE.dot;
      const [px, py, k] = place;
      const [cx, cy, r] = [px + at.cx * k, py + at.cy * k, at.r * k];
      badge = { disk: circle(cx, cy, r), gap: circle(cx, cy, r + TRAY_BADGE.gap * k), digit: label ? labelStroke(label, cx, cy, 2 * r * (label.length > 1 ? 0.5 : 0.62)) : null };
    }
  }

  const tileShape = tile ? { kind: 'rect', x: tile.x, y: tile.y, w: tile.w, h: tile.h, rx: tile.r, box: [tile.x, tile.y, tile.x + tile.w, tile.y + tile.h] } : null;
  const flags = (x, y) => {
    let f = 0;
    if (tileShape && contains(tileShape, x, y)) f |= TILE;
    if (badge) {
      if (badge.ring && contains(badge.ring, x, y)) f |= RING;
      if (contains(badge.disk, x, y)) return f | BADGE | (badge.digit && contains(badge.digit, x, y) ? DIGIT : 0);
      if (badge.gap && contains(badge.gap, x, y)) return f | GAP;
    }
    if (place) {
      const gx = (x - place[0]) / place[2];
      const gy = (y - place[1]) / place[2];
      const front = groupAt(glyph.front, gx, gy);
      if (front === 1) f |= FRONT;
      else {
        const back = groupAt(glyph.back, gx, gy);
        if (back === 1) f |= BACK;
        else if (front === -1 || back === -1) f |= CUT;
      }
    }
    return f;
  };

  // The colour of one sample, [r, g, b, a] with straight alpha.
  const p = palette || {};
  const glyphRgb = p.glyph ? hexRgb(p.glyph) : [1, 1, 1];
  const markRgb = p.mark ? hexRgb(p.mark) : [0, 0, 0];
  const none = [0, 0, 0, 0];
  const colourOf = (f, y) => {
    if (kind === 'overlay') {
      if (f & DIGIT) return [...hexRgb(p.badge.text), 1];
      if (f & BADGE) return [...hexRgb(p.badge.fill), 1];
      return f & RING ? [...hexRgb(p.badge.ring), 1] : none;
    }
    if (kind === 'tray' || kind === 'template') {
      const ink = kind === 'template' ? [0, 0, 0] : markRgb;
      if (f & DIGIT || f & GAP) return none;
      if (f & BADGE) return kind === 'template' ? [0, 0, 0, 1] : [...hexRgb(p.badge.fill), 1];
      if (f & FRONT) return [...ink, 1];
      return f & BACK ? [...ink, kind === 'template' ? 1 : p.back] : none;
    }
    if (kind === 'monochrome') return f & FRONT ? [1, 1, 1, 1] : f & BACK ? [1, 1, 1, 0.5] : none;
    if (kind === 'foreground') return f & FRONT ? [...glyphRgb, 1] : f & BACK ? [...glyphRgb, p.back] : none;
    let base = none;
    if (f & TILE) base = kind === 'tinted' ? [0, 0, 0, 1] : [...mix(hexRgb(p.tile.top), hexRgb(p.tile.bottom), Math.min(1, Math.max(0, (y - tile.y) / tile.h))), 1];
    const ink = kind === 'tinted' ? [1, 1, 1] : glyphRgb;
    if (f & FRONT) return [...ink, 1];
    if (f & BACK) {
      const a = kind === 'tinted' ? 0.5 : p.back;
      return base[3] ? [...mix(base.slice(0, 3), ink, a), 1] : [...ink, a];
    }
    return base;
  };

  // Each pixel is the average of a 4 by 4 grid of samples. Above 64 px a pixel whose corners and centre all fall in
  // one region takes the centre's colour, which keeps a 1024 px tile quick and leaves every edge pixel sampled.
  const data = empty.data;
  const N = 4;
  const W = S + 1;
  const corners = S > 64 ? new Int32Array(W * W) : null;
  const hint = (kind === 'tray' || kind === 'template') && S <= HINT_MAX;
  if (corners) for (let y = 0; y <= S; y += 1) for (let x = 0; x <= S; x += 1) corners[y * W + x] = flags(x, y);
  for (let y = 0; y < S; y += 1) {
    for (let x = 0; x < S; x += 1) {
      const acc = [0, 0, 0, 0];
      const c = corners ? corners[y * W + x] : -1;
      if (corners && c === corners[y * W + x + 1] && c === corners[(y + 1) * W + x] && c === corners[(y + 1) * W + x + 1] && c === flags(x + 0.5, y + 0.5)) {
        const [r, g, b, a] = colourOf(c, y + 0.5);
        acc[0] = r * a; acc[1] = g * a; acc[2] = b * a; acc[3] = a;
      } else {
        for (let j = 0; j < N; j += 1) {
          const sy = y + (j + 0.5) / N;
          for (let i = 0; i < N; i += 1) {
            const [r, g, b, a] = colourOf(flags(x + (i + 0.5) / N, sy), sy);
            acc[0] += (r * a) / (N * N); acc[1] += (g * a) / (N * N); acc[2] += (b * a) / (N * N); acc[3] += a / (N * N);
          }
        }
      }
      if (hint && flags(x + 0.5, y + 0.5) & (CUT | GAP | DIGIT)) acc[3] = 0;
      const o = (y * S + x) * 4;
      const a = acc[3];
      data[o] = a ? Math.round((acc[0] / a) * 255) : 0;
      data[o + 1] = a ? Math.round((acc[1] / a) * 255) : 0;
      data[o + 2] = a ? Math.round((acc[2] / a) * 255) : 0;
      data[o + 3] = Math.round(a * 255);
    }
  }
  return { width: S, height: S, data };
}
