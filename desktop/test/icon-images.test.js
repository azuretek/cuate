// The shell's own icons follow the active theme, the scheme and the unread count (issue 189).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { loadMasters, shellIcons, encodePng, TRAY_SIZES } from '../src/icon-images.js';
import { importTheme } from '../../core/app/rules/theme.js';
import { renderIcon, iconPalette, onGroup } from '../../core/app/rules/icon.js';

const CORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'core');
const tokens = JSON.parse(readFileSync(path.join(CORE, 'spec', 'tokens.json'), 'utf8')).color;
const masters = loadMasters(CORE);
const elegant = importTheme(readFileSync(path.join(CORE, 'fixtures', 'themes', 'elegant-luxury.json'), 'utf8')).theme;
const bytes = (out) => Buffer.concat(out.tray.reps.map((r) => Buffer.from(r.image.data)));

test('the tray image changes when the theme or the scheme changes, and when the count crosses 0, 1 and 10', () => {
  for (const platform of ['darwin', 'win32', 'linux']) {
    const at = (o) => shellIcons({ platform, masters, tokens, ...o });
    const base = at({ scheme: 'light' });
    const imported = at({ scheme: 'light', colors: elegant.color.light });
    const dark = at({ scheme: 'dark' });
    if (platform !== 'darwin') {
      assert.notDeepEqual(bytes(imported), bytes(base), platform + ': an imported theme redraws the tray');
      assert.notDeepEqual(bytes(dark), bytes(base), platform + ': the dark scheme redraws the tray');
      assert.notEqual(imported.key, base.key);
    } else {
      // A template image is a silhouette the menu bar recolours, so a theme changes nothing in it; the count does.
      assert.deepEqual(bytes(imported), bytes(base), 'macOS: the template is the silhouette whatever the theme');
    }
    const counts = [0, 1, 9, 10].map((unread) => at({ scheme: 'light', unread }));
    assert.notDeepEqual(bytes(counts[1]), bytes(counts[0]), platform + ': the first unread message draws the badge');
    assert.notDeepEqual(bytes(counts[3]), bytes(counts[2]), platform + ': ten unread reads 9+, not 9');
    for (let i = 1; i < counts.length; i += 1) assert.notEqual(counts[i].key, counts[i - 1].key);
    assert.deepEqual(base.tray.reps.map((r) => [r.image.width, r.scale]), TRAY_SIZES[platform]);
    assert.equal(base.tray.template, platform === 'darwin', 'macOS takes a template image');
  }
});

test('Windows carries the count on a taskbar overlay and Windows and Linux redraw the window icon from the theme', () => {
  const none = shellIcons({ platform: 'win32', masters, tokens, unread: 0 });
  assert.equal(none.overlay, null, 'no count, no overlay');
  const three = shellIcons({ platform: 'win32', masters, tokens, unread: 3 });
  const twelve = shellIcons({ platform: 'win32', masters, tokens, unread: 12 });
  assert.ok(three.overlay && twelve.overlay);
  assert.notDeepEqual(Buffer.from(three.overlay.data), Buffer.from(twelve.overlay.data), '3 and 9+ differ');
  assert.equal(three.description, '3 unread messages');
  for (const platform of ['win32', 'linux']) {
    const a = shellIcons({ platform, masters, tokens, scheme: 'light' });
    const b = shellIcons({ platform, masters, tokens, scheme: 'light', colors: elegant.color.light });
    assert.equal(a.window.width, 256);
    assert.notDeepEqual(Buffer.from(a.window.data), Buffer.from(b.window.data), platform + ': the window icon follows the theme');
  }
  assert.equal(shellIcons({ platform: 'darwin', masters, tokens }).window, null, 'macOS keeps its bundle icon in the Dock');
});

test('a fixed palette chosen in Settings draws every image whatever the theme and the scheme the page reports (issue 167)', () => {
  const spec = JSON.parse(readFileSync(path.join(CORE, 'spec', 'app-icons.json'), 'utf8'));
  const [first, second] = spec.icons.filter((i) => i.colors);
  for (const platform of ['win32', 'linux']) {
    const at = (o) => shellIcons({ platform, masters, tokens, ...o });
    const fixed = { scheme: first.scheme, colors: first.colors };
    const light = at({ scheme: 'light', fixed });
    assert.deepEqual(at({ scheme: 'dark', colors: elegant.color.dark, fixed }).palette, light.palette, platform + ': the theme no longer colours it');
    assert.deepEqual(light.palette, iconPalette(first.colors, first.scheme), platform + ': the palette is the spec\'s, through the one function');
    assert.notDeepEqual(at({ scheme: 'light', fixed: { scheme: second.scheme, colors: second.colors } }).palette, light.palette);
    assert.notDeepEqual(at({ scheme: 'light', fixed: null }).palette, light.palette, platform + ': no fixed palette follows the theme again');
    assert.equal(at({ scheme: 'light', fixed, unread: 3 }).badgeCount, 3, 'the count still shows');
  }
});

test('the PNG the shell hands to Electron decodes to exactly the pixels drawn', async () => {
  const image = renderIcon({ masters, palette: iconPalette(tokens.light, 'light'), kind: 'tray', size: 24, unread: 3 });
  const { data, info } = await sharp(encodePng(image)).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height, info.channels], [24, 24, 4]);
  assert.deepEqual(Buffer.from(data), Buffer.from(image.data));
});

test('the renderer reads the masters as an SVG renderer does', async () => {
  // librsvg (through sharp) draws each master as the SVG it is; the shapes the renderer reads must cover the same
  // pixels, to within anti-aliasing, so the generator and the shell draw the issue's glyph and not a lookalike.
  for (const [name, glyph] of [['flor-de-muerto.svg', masters.full], ['flor-de-muerto-small.svg', masters.small]]) {
    const S = 128;
    const [vx, vy, vw] = glyph.viewBox;
    const ref = await sharp(readFileSync(path.join(CORE, 'spec', 'icon', name)), { density: 72 * (S / vw) }).resize(S, S).ensureAlpha().raw().toBuffer();
    let diff = 0;
    let off = 0;
    for (let y = 0; y < S; y += 1) for (let x = 0; x < S; x += 1) {
      let n = 0;
      for (let j = 0; j < 4; j += 1) for (let i = 0; i < 4; i += 1) {
        const gx = vx + ((x + (i + 0.5) / 4) / S) * vw;
        const gy = vy + ((y + (j + 0.5) / 4) / S) * vw;
        if (onGroup(glyph.front, gx, gy) || onGroup(glyph.back, gx, gy)) n += 1;
      }
      const d = Math.abs(ref[(y * S + x) * 4 + 3] - Math.round((n / 16) * 255));
      diff += d;
      if (d > 128) off += 1;
    }
    assert.ok(diff / (S * S) < 3, name + ': mean alpha difference ' + (diff / (S * S)).toFixed(2));
    assert.ok(off < S / 4, name + ': ' + off + ' pixels disagree outright');
  }
});
