// Theme import from a tweakcn page URL (issue 132): the editor page, a shared theme's page and the registry JSON all
// import the same theme, its whole design language (colour, type, radius, spacing, shadows, letter spacing) and its
// fonts; a page that is not a theme says what to paste instead. The network is a stub; the theme is a fixture copy of
// tweakcn's Elegant Luxury registry item.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importThemeFromUrl, registryUrl, NOT_A_THEME } from '../src/themes.js';
import { createThemeFonts, fontFaces, leadFamily } from '../src/theme-fonts.js';
import { themeVars, contrastRatio } from '../../core/app/rules/theme.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const elegant = readFileSync(path.join(root, 'core/fixtures/themes/elegant-luxury.json'), 'utf8');
const GSTATIC = 'https://fonts.gstatic.com/s/fixture/';
const fontCss = (family) => ['/* latin-ext */', '@font-face { font-family: \'' + family + '\'; font-style: normal; font-weight: 400; src: url(' + GSTATIC + family.replace(/ /g, '') + '-ext.woff2) format(\'woff2\'); }',
  '/* latin */', '@font-face { font-family: \'' + family + '\'; font-style: normal; font-weight: 400; src: url(' + GSTATIC + family.replace(/ /g, '') + '-400.woff2) format(\'woff2\'); }',
  '/* latin */', '@font-face { font-family: \'' + family + '\'; font-style: normal; font-weight: 700; src: url(' + GSTATIC + family.replace(/ /g, '') + '-700.woff2) format(\'woff2\'); }'].join('\n');

// A stand-in for the network: tweakcn's registry answers the theme, its pages answer HTML, Google Fonts answers a
// stylesheet and the font files. Every URL asked is recorded.
function network({ fonts = true } = {}) {
  const asked = [];
  const answer = (status, body, type) => new Response(body, { status, headers: { 'content-type': type } });
  const fetchImpl = async (href) => {
    asked.push(href);
    const u = new URL(href);
    if (u.hostname === 'tweakcn.com' && u.pathname === '/r/themes/elegant-luxury.json') return answer(200, elegant, 'application/json');
    if (u.hostname === 'tweakcn.com' && u.pathname === '/r/themes/cm-shared-123.json') return answer(200, elegant, 'application/json');
    if (u.hostname === 'tweakcn.com') return answer(200, '<!doctype html><html><body>tweakcn</body></html>', 'text/html; charset=utf-8');
    if (u.hostname === 'fonts.googleapis.com') {
      if (!fonts) throw new TypeError('fetch failed');
      const family = u.searchParams.get('family').split(':')[0];
      return answer(200, fontCss(family), 'text/css');
    }
    if (href.startsWith(GSTATIC)) return answer(200, 'wOF2 fixture bytes for ' + u.pathname, 'font/woff2');
    return answer(404, 'not found', 'text/plain');
  };
  return { fetchImpl, asked };
}

test('a tweakcn page URL is read from its registry, and anything else is fetched as given', () => {
  const r = (s) => registryUrl(new URL(s))?.href ?? null;
  assert.equal(r('https://tweakcn.com/editor/theme?theme=elegant-luxury'), 'https://tweakcn.com/r/themes/elegant-luxury.json');
  assert.equal(r('https://tweakcn.com/editor/theme/cm-shared-123'), 'https://tweakcn.com/r/themes/cm-shared-123.json');
  assert.equal(r('https://tweakcn.com/themes/cm-shared-123'), 'https://tweakcn.com/r/themes/cm-shared-123.json');
  assert.equal(r('http://127.0.0.1:4000/editor/theme?theme=elegant-luxury'), 'http://127.0.0.1:4000/r/themes/elegant-luxury.json', 'by path, so a self-hosted tweakcn works too');
  assert.equal(r('https://tweakcn.com/r/themes/elegant-luxury.json'), null, 'the registry itself is fetched as given');
  assert.equal(r('https://tweakcn.com/editor/theme'), null, 'an editor page naming no theme is not rewritten');
  assert.equal(r('https://tweakcn.com/editor/theme?theme=../../etc'), null);
  assert.equal(r('https://example.com/themes/rust.css'), null, 'a file under /themes is not a page');
});

test('pasting the Elegant Luxury editor URL imports its whole design language, light and dark, with its fonts', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'theme-fonts-test-'));
  try {
    const net = network();
    const fonts = createThemeFonts({ dataDir: dir, fetchImpl: net.fetchImpl });
    const out = await importThemeFromUrl({ url: 'https://tweakcn.com/editor/theme?theme=elegant-luxury', held: [], fetchImpl: net.fetchImpl, fonts });
    assert.equal(net.asked[0], 'https://tweakcn.com/r/themes/elegant-luxury.json', 'the page is never fetched; its registry is');
    const t = out.theme;
    assert.equal(t.name, 'Elegant Luxury', 'named as the theme page names it');
    assert.equal(t.id, 'elegant-luxury');
    assert.equal(t.url, 'https://tweakcn.com/editor/theme?theme=elegant-luxury', 'the URL pasted is the one remembered');
    assert.equal(t.color.light.bg, 'oklch(0.9779 0.0042 56.3756)');
    assert.equal(t.color.light.accent, 'oklch(0.4650 0.1470 24.9381)');
    assert.equal(t.color.light['accent-fg'], 'oklch(1.0000 0 0)');
    assert.equal(t.color.dark.bg, 'oklch(0.2161 0.0061 56.0434)');
    assert.equal(t.color.dark.accent, 'oklch(0.5054 0.1905 27.5181)');
    assert.equal(t.color.light['danger-fg'], 'oklch(1.0000 0 0)', 'destructive-foreground is carried');
    assert.equal(t.font.family, 'Poppins, sans-serif');
    assert.equal(t.font.mono, 'IBM Plex Mono, monospace');
    assert.equal(t.font.tracking, '0em');
    assert.deepEqual(t.radius, { md: '0.375rem', sm: 'calc(0.375rem * 0.6)', lg: 'calc(0.375rem * 1.4)' });
    assert.equal(t.space['1'], '0.25rem');
    assert.equal(t.space['5'], 'calc(0.25rem * 6)');
    assert.match(t.shadow.md, /^1px 1px 16px -2px hsl\(0 63% 18% \/ 0\.12\)/);
    assert.equal(t.schemes, undefined, 'dark repeats light for every neutral value, so nothing is held for dark alone');
    for (const name of ['font-serif', 'sidebar-primary', 'shadow-color', 'shadow-2xl', 'tracking-tight']) assert.ok(out.refused.includes(name), name + ' is named as refused');
    // The type: Poppins and IBM Plex Mono, latin only, written under the data folder by digest.
    assert.deepEqual(t.fonts.map((f) => [f.family, f.weight]), [['Poppins', '400'], ['Poppins', '700'], ['IBM Plex Mono', '400'], ['IBM Plex Mono', '700']]);
    assert.ok(t.fonts.every((f) => /^[a-f0-9]{64}$/.test(f.id)));
    assert.equal(readdirSync(fonts.root).length, 4);
    assert.ok(await fonts.file(t.fonts[0].id));
    assert.equal(await fonts.file('../../etc/passwd'), null);
    assert.ok(!net.asked.some((u) => u.includes('latin-ext') || u.endsWith('-ext.woff2')), 'only the latin subset is fetched');
    // What the page writes: light and dark each take their own colours over the same type, radius and shadows.
    const light = Object.fromEntries(themeVars(t, 'light'));
    const dark = Object.fromEntries(themeVars(t, 'dark'));
    assert.equal(light['--font-family'], 'Poppins, sans-serif');
    assert.equal(dark['--radius-md'], '0.375rem');
    assert.equal(dark['--shadow-lg'], light['--shadow-lg']);
    assert.equal(dark['--color-accent'], 'oklch(0.5054 0.1905 27.5181)');
    // The switch's pairs hold 4.5:1 in this theme too (issue 135).
    for (const c of [t.color.light, t.color.dark]) {
      assert.ok(contrastRatio(c['accent-fg'], c.accent) >= 4.5);
      assert.ok(contrastRatio(c['fg-muted'], c.bg) >= 4.5);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a shared theme id URL and the registry JSON URL import the same theme as the editor URL', async () => {
  const net = network();
  const editor = await importThemeFromUrl({ url: 'https://tweakcn.com/editor/theme?theme=elegant-luxury', held: [], fetchImpl: net.fetchImpl });
  const shared = await importThemeFromUrl({ url: 'https://tweakcn.com/themes/cm-shared-123', held: [], fetchImpl: net.fetchImpl });
  const json = await importThemeFromUrl({ url: 'https://tweakcn.com/r/themes/elegant-luxury.json', held: [], fetchImpl: net.fetchImpl });
  assert.ok(net.asked.includes('https://tweakcn.com/r/themes/cm-shared-123.json'));
  for (const other of [shared, json]) {
    assert.deepEqual(other.theme.color, editor.theme.color);
    assert.deepEqual(other.theme.font, editor.theme.font);
    assert.deepEqual(other.theme.shadow, editor.theme.shadow);
  }
  assert.equal(editor.theme.fonts, undefined, 'with no font store, a theme names its type and fetches none');
});

test('a page that is not a theme says what to paste instead, and a font that cannot be fetched never refuses the theme', async () => {
  const net = network({ fonts: false });
  for (const url of ['https://tweakcn.com/editor/theme', 'https://tweakcn.com/', 'https://tweakcn.com/editor/theme?theme=']) {
    await assert.rejects(importThemeFromUrl({ url, held: [], fetchImpl: net.fetchImpl }), (e) => e.code === 'bad_theme' && e.message === NOT_A_THEME && /editor\/theme\?theme=/.test(e.message), url);
  }
  // HTML served as text/plain is still a page, not a theme.
  const plain = async () => new Response('<html><body>hello</body></html>', { status: 200, headers: { 'content-type': 'text/plain' } });
  await assert.rejects(importThemeFromUrl({ url: 'https://example.com/x', held: [], fetchImpl: plain }), (e) => e.code === 'bad_theme' && e.message === NOT_A_THEME);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'theme-fonts-test-'));
  try {
    const out = await importThemeFromUrl({ url: 'https://tweakcn.com/editor/theme?theme=elegant-luxury', held: [], fetchImpl: net.fetchImpl, fonts: createThemeFonts({ dataDir: dir, fetchImpl: net.fetchImpl }) });
    assert.equal(out.theme.fonts, undefined);
    assert.ok(out.refused.includes('font Poppins (not fetched)'));
    assert.match(out.summary, /Fonts not fetched: Poppins, IBM Plex Mono\./);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a font stack names a family to fetch only when it leads with one, and only gstatic woff2 files are taken', () => {
  assert.equal(leadFamily('Poppins, sans-serif'), 'Poppins');
  assert.equal(leadFamily('"IBM Plex Mono", monospace'), 'IBM Plex Mono');
  for (const s of ['system-ui, sans-serif', 'ui-monospace, monospace', '', undefined, 'var(--x)', 'a;b']) assert.equal(leadFamily(s), null, String(s));
  assert.deepEqual(fontFaces(fontCss('Poppins')).map((f) => f.weight), ['400', '700']);
  assert.deepEqual(fontFaces('@font-face { font-weight: 400; src: url(https://evil.example/x.woff2) format(\'woff2\'); }'), []);
  assert.deepEqual(fontFaces('@font-face { font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/s/a/b.woff2) format(\'woff2\'); }').map((f) => f.url), ['https://fonts.gstatic.com/s/a/b.woff2'], 'a family with one subset is read whole');
});
