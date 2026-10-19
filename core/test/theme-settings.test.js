// Issue 492: the theme section sits above the app icon selector, a URL is the only import path, and a held theme can
// be deleted behind a confirm, falling back to the default when it was in use. The shared page is driven here without a
// browser, the way theme-picker.test.js drives it, and the settings fixture proves the same DOM on both phones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const defined = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { defined[name] = cls; }, get() { return undefined; } };
globalThis.document = { createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
const { html } = await import('../kit/lit.js');
await import('../app/components/app-settings.js');
const AppSettings = defined['app-settings'];
const { themeChoices, importTheme, swatchVars } = await import('../app/rules/theme.js');

const read = (rel) => readFileSync(new URL('../../' + rel, import.meta.url), 'utf8');

// A lit template result flattened in draw order: every string and every nested value, so the order a section renders
// can be read without a browser.
function flatten(node, out = []) {
  if (node === null || node === undefined) return out;
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const child of node) flatten(child, out); return out; }
  if (typeof node === 'object' && node.strings) {
    for (let i = 0; i < node.strings.length; i += 1) {
      out.push(node.strings[i]);
      if (i < node.values.length) flatten(node.values[i], out);
    }
  }
  return out;
}
const rendered = (...parts) => flatten(parts).join('');

const theme = (id, name) => ({ id, name, source: 'tweakcn', color: { light: { bg: '#f0f4ff', accent: '#1d4ed8' }, dark: { bg: '#0b1020', accent: '#93c5fd' } } });

test('the theme section is drawn immediately above the app icon selector (issue 492)', () => {
  const fake = { theme: () => html`<div class="theme-section" data-section="theme"></div>`, row: (field) => html`<div data-key=${field.key}></div>` };
  const out = rendered(AppSettings.prototype.sectionBody.call(fake, { id: 'appearance', fields: [
    { key: 'appearance.skin', type: 'segmented' },
    { key: 'appearance.appIcon', type: 'icon' },
  ] }));
  const skin = out.indexOf('appearance.skin');
  const section = out.indexOf('theme-section');
  const icon = out.indexOf('appearance.appIcon');
  assert.ok(skin >= 0 && section >= 0 && icon >= 0, 'every row is drawn');
  assert.ok(skin < section && section < icon, 'the theme section follows the skin and precedes the icon selector');
  assert.equal(out.slice(section, icon).includes('appearance.appIcon'), false, 'nothing but the theme section sits between them');
});

test('a URL is the only theme import path, and nothing in the client reads a local theme file (issue 492)', () => {
  const settings = read('core/app/components/app-settings.js');
  assert.match(settings, /theme-url-input/, 'the URL field stays');
  assert.match(settings, /data-action="theme-import-url"/, 'the URL import stays');
  for (const gone of ['theme-import-text', 'theme-import-name', 'theme-import-action', 'importText', 'importName', 'onImport(']) {
    assert.equal(settings.includes(gone), false, gone + ' is gone from the settings page');
  }
  assert.doesNotMatch(settings, /type="file"|FileReader|readAsText|showOpenFilePicker/, 'the page reads no local theme file');
  for (const rel of ['core/app/components/app-settings.js', 'core/app/rules/theme.js', 'desktop/src/main.js']) {
    assert.doesNotMatch(read(rel), /theme-import-text|theme-import-name ->|Paste the theme's CSS/, rel + ' carries no paste import');
  }
  // The refusal names what is wrong and which URL forms are accepted (the server owns the fetch).
  const server = read('server/src/themes.js');
  assert.match(server, /themes\/<id>/, 'a shared theme page is named as an accepted form');
  assert.match(server, /editor\/theme\?theme=/, 'the editor page is named');
  assert.match(server, /r\/themes\/<name>\.json/, 'the registry link is named');
});

test('a tweakcn fixture imports into a card that shows its own light and dark colours (issue 492)', () => {
  const result = importTheme(read('core/fixtures/themes/elegant-luxury.json'), { name: 'Elegant Luxury' });
  const held = { ...result.theme, id: 'elegant-luxury' };
  const card = themeChoices({ 'appearance.themes': [held] }).find((c) => c.id === 'elegant-luxury');
  assert.ok(card, 'the imported theme is a card in the picker');
  const light = Object.fromEntries(swatchVars(card.theme, 'light'));
  const dark = Object.fromEntries(swatchVars(card.theme, 'dark'));
  assert.equal(light['--color-accent'], result.theme.color.light.accent, 'the card shows the theme\'s light accent');
  assert.equal(dark['--color-accent'], result.theme.color.dark.accent, 'the card shows the theme\'s dark accent');
  assert.notEqual(light['--color-accent'], dark['--color-accent'], 'light and dark are the theme\'s own, not one palette twice');
});

test('deleting a theme asks first, and a cancel writes nothing (issue 492)', () => {
  const page = new AppSettings();
  const held = [theme('alpha', 'Alpha'), theme('beta', 'Beta')];
  page.values = { 'appearance.themes': held, 'appearance.theme': held[1] };
  const writes = [];
  page.fire = (name, detail) => { writes.push({ name, detail }); return true; };
  page.askDelete({ id: 'beta', name: 'Beta', theme: held[1] });
  assert.equal(page.confirmDelete, 'beta', 'the gate opens on the named theme');
  assert.equal(writes.length, 0, 'opening the gate deletes nothing');
  page.cancelDelete();
  assert.equal(page.confirmDelete, '', 'cancel closes the gate');
  assert.equal(writes.length, 0, 'cancel writes nothing');
  assert.equal(themeChoices(page.values).some((c) => c.id === 'beta'), true, 'the theme is still in the picker');
});

test('deleting a held theme removes it from the list, and deleting the one in use falls back to the default (issue 492)', () => {
  const page = new AppSettings();
  const alpha = theme('alpha', 'Alpha');
  const beta = theme('beta', 'Beta');
  page.values = { 'appearance.themes': [alpha, beta], 'appearance.theme': beta };
  const writes = [];
  page.fire = (name, detail) => { writes.push({ name, detail }); return true; };
  page.askDelete({ id: 'beta', name: 'Beta', theme: beta });
  page.confirmDeleteTheme();
  assert.deepEqual(writes[0], { name: 'settings', detail: { 'appearance.themes': [alpha], 'appearance.theme': null } });
  assert.match(page.themeNote, /Deleted Beta\. The default theme is now in use\./);
  const after = { 'appearance.themes': writes[0].detail['appearance.themes'], 'appearance.theme': writes[0].detail['appearance.theme'] };
  assert.deepEqual(themeChoices(after).map((c) => c.id), ['default', 'alpha'], 'the deleted theme is gone from the picker and the default is selected');
  assert.equal(themeChoices(after).find((c) => c.id === 'default').selected, true);

  // A theme that is not in use leaves the appearance alone, so no second key is written.
  page.values = { 'appearance.themes': [alpha, beta], 'appearance.theme': alpha };
  page.askDelete({ id: 'beta', name: 'Beta', theme: beta });
  page.confirmDeleteTheme();
  assert.deepEqual(writes[1], { name: 'settings', detail: { 'appearance.themes': [alpha] } });
  assert.match(page.themeNote, /Deleted Beta\./);
});
