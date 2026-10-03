// The app icon, Flor de muerto (issue 189): one master glyph and its small-size simplification, every colour derived
// from the active theme's tokens by one pure function, and every platform's image drawn by one renderer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { iconPalette, iconColours, parseGlyph, renderIcon, onGroup, cssColour, contrast, hueDistance, chroma, unreadTotal, badgeLabel, ICON_TOKENS, GLYPH_FLOOR, BADGE_HUE_GAP, SATURATED, TRAY_BADGE, TRAY_CROP } from '../app/rules/icon.js';
import { importTheme } from '../app/rules/theme.js';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const tokens = JSON.parse(read('core/spec/tokens.json'));
const masters = { full: parseGlyph(read('core/spec/icon/flor-de-muerto.svg')), small: parseGlyph(read('core/spec/icon/flor-de-muerto-small.svg')) };
const elegant = importTheme(read('core/fixtures/themes/elegant-luxury.json')).theme;

// The tokens one theme gives the icon in one scheme: the theme's own over the defaults, as the page resolves them.
const themed = (theme, scheme) => iconColours(tokens.color[scheme], { ...tokens.color[scheme], ...((theme && theme.color && theme.color[scheme]) || {}) });
const THEMES = { default: null, 'elegant-luxury': elegant };

test('the palette derives every colour from the theme, and the glyph meets its contrast floor in both schemes', () => {
  for (const [name, theme] of Object.entries(THEMES)) {
    for (const scheme of ['light', 'dark']) {
      const colours = themed(theme, scheme);
      const p = iconPalette(colours, scheme);
      const tile = scheme === 'light' ? colours.accent : colours['bg-raised'];
      const ratio = contrast(p.glyph, tile);
      assert.ok(ratio >= GLYPH_FLOOR[scheme], name + ' ' + scheme + ': the glyph ' + p.glyph + ' reads at ' + ratio.toFixed(2) + ':1 on ' + tile + ', under its ' + GLYPH_FLOOR[scheme] + ':1 floor');
      assert.equal(p.back, scheme === 'light' ? 0.5 : 0.45, 'the back bubble is the glyph at 50% in light and 45% in dark');
      if (scheme === 'dark') assert.ok(Math.abs(hueDistance(p.glyph, colours.accent)) < 3 || chroma(colours.accent) < SATURATED, name + ': the dark glyph keeps the accent hue');
      if (scheme === 'light') assert.equal(p.glyph, contrast(colours['accent-fg'], colours.accent) >= 2.6 ? cssHex(colours['accent-fg']) : cssHex(colours.fg));
    }
  }
});

test('the badge never lands within 40 degrees of hue of the tile, and the default theme gets the neutral badge', () => {
  for (const [name, theme] of Object.entries(THEMES)) {
    for (const scheme of ['light', 'dark']) {
      const colours = themed(theme, scheme);
      const p = iconPalette(colours, scheme);
      const clashes = chroma(p.badge.fill) >= SATURATED && chroma(colours.accent) >= SATURATED && hueDistance(p.badge.fill, colours.accent) < BADGE_HUE_GAP;
      assert.ok(!clashes, name + ' ' + scheme + ': the badge ' + p.badge.fill + ' sits within ' + BADGE_HUE_GAP + ' degrees of the accent ' + colours.accent);
      assert.ok(contrast(p.badge.text, p.badge.fill) >= 3, name + ' ' + scheme + ': the count reads on its badge');
      assert.equal(p.badge.ring, cssHex(colours.bg), 'the ring is the surrounding background');
    }
  }
  const light = iconPalette(themed(null, 'light'), 'light');
  assert.equal(light.badge.neutral, true, 'accent #bd4531 and danger #b91c1c clash, so the default badge is the neutral one');
  assert.equal(light.badge.fill, tokens.color.light.fg);
  assert.equal(light.badge.text, tokens.color.light.bg);
  const blue = iconPalette({ ...tokens.color.light, accent: '#0a84ff' }, 'light');
  assert.equal(blue.badge.neutral, false, 'an accent far from danger keeps the danger badge');
  assert.equal(blue.badge.fill, tokens.color.light.danger);
});

test('the palette reads any CSS colour a theme carries, oklch() included, and works on the parsed colour', () => {
  assert.deepEqual(cssColour('#bd4531').map((c) => Math.round(c * 255)), [189, 69, 49]);
  assert.deepEqual(cssColour('rgb(189 69 49 / 50%)').map((c) => Math.round(c * 255)), [189, 69, 49]);
  assert.deepEqual(cssColour('hsl(0 0% 100%)'), [1, 1, 1]);
  assert.ok(Math.abs(contrast('oklch(1 0 0)', 'oklch(0 0 0)') - 21) < 0.01);
  assert.equal(cssColour('var(--x)'), null);
  const oklch = iconPalette({ ...tokens.color.light, accent: 'oklch(0.4650 0.1470 24.9381)' }, 'light');
  const hex = iconPalette({ ...tokens.color.light, accent: '#' + cssColour('oklch(0.4650 0.1470 24.9381)').map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('') }, 'light');
  assert.equal(oklch.tile.top, hex.tile.top, 'an oklch accent and its hex give the same tile');
  assert.deepEqual(iconColours(tokens.color.light, { accent: 'color-mix(in srgb, red, blue)' }).accent, tokens.color.light.accent, 'a value the icon cannot read falls back to the token');
  for (const k of ICON_TOKENS) assert.ok(tokens.color.light[k] && tokens.color.dark[k], 'the tokens carry ' + k + ' in both schemes');
});

test('the masters are true cut-outs: eyes, nose, teeth and the gap between the bubbles are transparency', () => {
  const { full, small } = masters;
  const on = (g, x, y) => onGroup(g, x, y);
  // The skull: the front bubble's body is solid, its eyes and nose are holes, the eye's centre is an island.
  assert.ok(on(full.front, 41, 40), 'the front skull is solid above the eyes');
  assert.ok(!on(full.front, 32, 49.5) && !on(full.front, 50, 49.5), 'the marigold eyes cut through');
  assert.ok(on(full.front, 32, 54) && on(full.front, 50, 54), 'each marigold keeps its centre');
  assert.ok(!on(full.front, 41, 65), 'the heart nose cuts through');
  assert.ok(!on(full.front, 33, 72.7) && on(full.front, 35, 72.7), 'the teeth are cut, the stitches between them kept');
  assert.ok(!on(full.front, 27, 63) && !on(full.front, 55, 63), 'the cheeks cut through');
  assert.ok(!on(full.back, 62, 25) && !on(full.back, 70.5, 41), 'the back skull has its eyes and nose');
  // The gap: between the bubbles, inside the back bubble's outline, there is neither.
  for (const g of [full, small]) {
    const [fx, fy, fr] = [41, 58, 26];
    const [dx, dy] = [62 - fx, 38 - fy].map((v) => v / Math.hypot(62 - fx, 38 - fy));
    const gap = [fx + dx * (fr + 2.5), fy + dy * (fr + 2.5)];
    assert.ok(!on(g.front, ...gap) && !on(g.back, ...gap), 'a knocked-out gap separates the back bubble from the front');
    const beyond = [fx + dx * (fr + 7), fy + dy * (fr + 7)];
    assert.ok(on(g.back, ...beyond), 'the back bubble resumes past the gap');
  }
  // The small master: plain round eye holes, the nose, and no teeth, cheeks or back nose.
  assert.ok(!on(small.front, 32, 55) && !on(small.front, 50, 55), 'the small eyes are plain round holes');
  assert.ok(!on(small.front, 41, 66), 'the small skull keeps its nose');
  assert.ok(on(small.front, 33, 72.7) && on(small.front, 27, 63), 'the small skull drops the teeth and the cheeks');
  assert.ok(on(small.back, 70.5, 41), 'the small back skull drops its nose');
  assert.deepEqual(small.viewBox, TRAY_CROP, 'the small master is the tight crop');
});

const alpha = (img, x, y) => img.data[(y * img.width + x) * 4 + 3];
const px = (u, S) => Math.floor(((u - TRAY_CROP[0]) / TRAY_CROP[2]) * S);
const py = (u, S) => Math.floor(((u - TRAY_CROP[1]) / TRAY_CROP[3]) * S);

test('the template image at 16 and 32 px keeps its eyes and nose fully transparent, and knocks a gap around the badge', () => {
  for (const S of [16, 32]) {
    const plain = renderIcon({ masters, kind: 'template', size: S });
    const counted = renderIcon({ masters, kind: 'template', size: S, unread: 3 });
    for (const img of [plain, counted]) {
      for (const [name, x, y] of [['left eye', 32, 55], ['right eye', 50, 55], ['nose', 41, 67]]) assert.equal(alpha(img, px(x, S), py(y, S)), 0, S + ' px: the ' + name + ' is fully transparent');
      assert.equal(alpha(img, px(41, S), py(42, S)), 255, S + ' px: the skull itself is solid');
    }
    // The gap: pixels whose centre is in the middle of the ring around the badge lost the glyph they had without it.
    const at = S >= 22 ? TRAY_BADGE.text : TRAY_BADGE.dot;
    const k = S / TRAY_CROP[2];
    const [cx, cy, r, g] = [(at.cx - TRAY_CROP[0]) * k, (at.cy - TRAY_CROP[1]) * k, at.r * k, TRAY_BADGE.gap * k];
    let cut = 0;
    for (let y = 0; y < S; y += 1) for (let x = 0; x < S; x += 1) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      // At 16 px the gap is about a pixel wide, so every pixel whose centre falls in it is cleared outright.
      const [lo, hi] = S <= 16 ? [r, r + g] : [r + g * 0.3, r + g * 0.7];
      if (d > lo && d < hi && alpha(plain, x, y) === 255) { assert.ok(alpha(counted, x, y) <= (S <= 16 ? 0 : 128), S + ' px: the ring around the badge is cut out of the glyph at ' + x + ',' + y); cut += 1; }
    }
    assert.ok(cut >= 2, S + ' px: the badge gap crosses the glyph (' + cut + ' pixels)');
    assert.equal(alpha(counted, Math.floor(cx), Math.floor(cy - r * 0.8)), 255, S + ' px: the badge itself is solid');
  }
  // The digit is knocked out of the badge from 22 px.
  const three = renderIcon({ masters, kind: 'template', size: 32, unread: 3 });
  const dot = renderIcon({ masters, kind: 'template', size: 32, unread: 0 });
  let holes = 0;
  const k = 32 / TRAY_CROP[2];
  const [cx, cy, r] = [(TRAY_BADGE.text.cx - TRAY_CROP[0]) * k, (TRAY_BADGE.text.cy - TRAY_CROP[1]) * k, TRAY_BADGE.text.r * k];
  for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < r - 1 && alpha(three, x, y) < 128) holes += 1;
  assert.ok(holes >= 3, 'the digit is knocked out of the badge (' + holes + ' pixels)');
  assert.notDeepEqual(three.data, dot.data);
});

test('the count is a dot at 16 px, one digit from 22 px and 9+ only from 32 px', () => {
  assert.equal(badgeLabel(0, 32), null);
  assert.equal(badgeLabel(3, 16), '');
  assert.equal(badgeLabel(3, 22), '3');
  assert.equal(badgeLabel(12, 22), '', 'ten and more under 32 px is the dot, never a wrong digit');
  assert.equal(badgeLabel(12, 32), '9+');
  assert.equal(badgeLabel(9, 32), '9');
  assert.equal(unreadTotal([{ unread: 2 }, { unread: 0 }, { unread: 5 }, {}]), 7);
});

test('every kind of image is drawn from the palette, and a tile is opaque where a platform needs it', () => {
  const light = iconPalette(themed(null, 'light'), 'light');
  const dark = iconPalette(themed(null, 'dark'), 'dark');
  const ios = renderIcon({ masters, palette: light, kind: 'ios', size: 64 });
  assert.ok([...Array(64 * 64).keys()].every((i) => ios.data[i * 4 + 3] === 255), 'the iOS icon has no transparency');
  const at = (img, x, y) => '#' + [0, 1, 2].map((c) => img.data[(y * img.width + x) * 4 + c].toString(16).padStart(2, '0')).join('');
  assert.equal(at(ios, 32, 26), light.glyph, 'the skull is the glyph colour');
  const darkIos = renderIcon({ masters, palette: dark, kind: 'ios', size: 64 });
  assert.equal(at(darkIos, 32, 26), dark.glyph);
  const app = renderIcon({ masters, palette: light, kind: 'app', size: 64 });
  assert.equal(alpha(app, 0, 0), 0, 'the desktop tile keeps its margin and rounded corners');
  const mono = renderIcon({ masters, kind: 'monochrome', size: 108 });
  assert.equal(alpha(mono, 0, 0), 0, 'the Android monochrome layer is the glyph alone');
  assert.equal(alpha(mono, 47, 46), 255, 'the front skull is fully opaque');
  assert.equal(alpha(mono, 62, 32), 128, 'the back bubble is half alpha');
});

function cssHex(v) {
  return '#' + cssColour(v).map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
}

test('the Android About test looks for the default tile as the palette draws it', () => {
  const top = iconPalette(themed(null, 'light'), 'light').tile.top;
  const want = 'Color.rgb(' + [1, 3, 5].map((i) => '0x' + top.slice(i, i + 2)).join(', ') + ')';
  const file = readdirSync(new URL('../../android/app/src/androidTest', import.meta.url), { recursive: true }).find((f) => String(f).endsWith('AboutPageTest.kt'));
  assert.ok(read('android/app/src/androidTest/' + file).includes(want), 'AboutPageTest.kt looks for ' + want);
});

test('the old chat bubble is gone: no fixed teal, and no hand-drawn per-size file', () => {
  for (const f of ['desktop/build/icon.svg', 'desktop/build/tray-template.svg', 'android/app/src/main/res/drawable/ic_launcher_foreground.xml']) assert.ok(!existsSync(new URL('../../' + f, import.meta.url)), f + ' is gone');
  for (const f of ['core/app/rules/icon.js', 'desktop/scripts/icons.mjs', 'desktop/src/icon-images.js']) assert.ok(!/#[0-9a-f]{6}\b/i.test(read(f)), f + ' writes no colour of its own; every one comes from the tokens');
});
