import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importTweakcn, themeVars } from '../app/rules/theme.js';

test('older themes inherit their own page foreground until an explicit surface foreground wins', () => {
  const vars = Object.fromEntries(themeVars({ color: { dark: { fg: '#fafafa', 'bg-raised-fg': '#abcdef' } } }, 'dark'));
  assert.equal(vars['--color-selection-fg'], '#fafafa');
  assert.equal(vars['--color-bg-raised-fg'], '#abcdef');
});

// Distinct surface pairs must survive an import, not silently inherit the page's words.
test('tweakcn preserves semantic foregrounds in both schemes', () => {
  const { theme, refused } = importTweakcn(':root { --card-foreground: #123456; --accent-foreground: #234567; } .dark { --card-foreground: #abcdef; --accent-foreground: #fedcba; }');
  assert.deepEqual(refused, []);
  assert.equal(theme.color.light['bg-raised-fg'], '#123456');
  assert.equal(theme.color.dark['bg-raised-fg'], '#abcdef');
  assert.equal(theme.color.light['selection-fg'], '#234567');
  assert.equal(theme.color.dark['selection-fg'], '#fedcba');
});
