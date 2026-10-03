// Issue 186: the theme picker previews every held theme in that theme's own colours. The cards are drawn by app-sheet,
// which renders its body after the settings page has finished its own update, so a page that paints the cards only in
// its own updated() finds none on a fresh open and every card falls back to the default palette. The real component
// class is driven here with no browser, the way about-page.test.js drives app-root.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const defined = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { defined[name] = cls; }, get() { return undefined; } };
globalThis.document = { createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
await import('../app/components/app-settings.js');
const AppSettings = defined['app-settings'];
const { themeChoices } = await import('../app/rules/theme.js');

// A card as the page sees it: its theme id and an inline style that holds custom properties.
function card(id) {
  const props = new Map();
  const style = { setProperty: (n, v) => props.set(n, v), removeProperty: (n) => props.delete(n), getPropertyValue: (n) => props.get(n) || '', [Symbol.iterator]: () => props.keys() };
  return { dataset: { themeId: id }, style, props };
}

const theme = (name, light, dark) => ({ id: name.toLowerCase(), name, source: 'tweakcn', color: { light: { bg: light[0], accent: light[1] }, dark: { bg: dark[0], accent: dark[1] } } });
const held = [
  theme('Harbour', ['#f0f4ff', '#1d4ed8'], ['#0b1020', '#93c5fd']),
  theme('Rust', ['#fff7ed', '#8a3b12'], ['#1c0f05', '#e0a070']),
  theme('Moss', ['#f3faf3', '#2a6f4b'], ['#0a1a10', '#7fd6a8']),
  theme('Plum', ['#fbf5ff', '#6b2a8a'], ['#160a1c', '#d3a0f0']),
  theme('Slate', ['#f5f7fa', '#334155'], ['#0f172a', '#cbd5e1']),
];

// The page with its sheet: the cards exist only once the sheet has rendered, as in the browser.
function page(scheme) {
  const p = new AppSettings();
  p.values = { 'appearance.themes': held, 'appearance.theme': held[1] };
  p.scheme = scheme;
  const cards = themeChoices(p.values).map((c) => card(c.id));
  let rendered = false;
  const sheet = { updateComplete: Promise.resolve().then(() => { rendered = true; return true; }) };
  p.querySelector = (sel) => (sel === 'app-sheet' ? sheet : null);
  p.querySelectorAll = (sel) => (rendered && sel.startsWith('.theme-card') ? cards : []);
  return { p, cards, sheet };
}

for (const scheme of ['light', 'dark']) {
  test('every card previews its own theme once the sheet has drawn it, in ' + scheme, async () => {
    const { p, cards, sheet } = page(scheme);
    p.updated(new Map());
    await sheet.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(cards.length, held.length + 1, 'the default and every held theme');
    assert.deepEqual([...cards[0].props.keys()], [], 'the default card sets nothing, so the default palette shows');
    for (const [i, t] of held.entries()) {
      const c = cards[i + 1];
      assert.equal(c.dataset.themeId, t.id);
      assert.equal(c.style.getPropertyValue('--color-accent'), t.color[scheme].accent, t.name + ' shows its own accent');
      assert.equal(c.style.getPropertyValue('--color-bg'), t.color[scheme].bg, t.name + ' shows its own background');
    }
    const accents = cards.slice(1).map((c) => c.style.getPropertyValue('--color-accent'));
    assert.equal(new Set(accents).size, held.length, 'no two different themes show the same swatches');
  });
}

test('a scheme change repaints every card in the new scheme, and leaves no colour of the old one behind', async () => {
  const { p, cards, sheet } = page('light');
  p.updated(new Map());
  await sheet.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  cards[1].style.setProperty('--color-stale', '#000000');
  p.scheme = 'dark';
  p.updated(new Map([['scheme', 'light']]));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(cards[1].style.getPropertyValue('--color-accent'), held[0].color.dark.accent);
  assert.equal(cards[1].style.getPropertyValue('--color-stale'), '', 'a colour the theme does not set is cleared');
});
