// Pure: turns core/spec/tokens.json into the token stylesheet. scripts/gen-tokens.mjs writes it; a test checks freshness.
// Light is the default; a client that follows the system's dark mode takes the dark block from the media query, and a
// client whose skin is an explicit choice sets data-scheme on the root, which wins in both directions (issue 59).
const GROUPS = ['space', 'radius', 'font', 'size', 'motion', 'shadow'];

export function tokensCss(spec) {
  const flat = (prefix, obj, indent) => Object.entries(obj).map(([k, v]) => `${indent}--${prefix}-${k}: ${v};`);
  const lines = ['/* Generated from core/spec/tokens.json by scripts/gen-tokens.mjs. Do not edit. */', ':root {', '  color-scheme: light dark;'];
  for (const g of GROUPS) lines.push(...flat(g, spec[g], '  '));
  const colours = (obj, indent) => flat('color', obj, indent);
  lines.push(...colours(spec.color.light, '  '), '}');
  lines.push('@media (prefers-color-scheme: dark) {', '  :root:not([data-scheme="light"]) {');
  lines.push(...colours(spec.color.dark, '    '), '  }', '}');
  lines.push(':root[data-scheme="dark"] {', '  color-scheme: dark;', ...colours(spec.color.dark, '  '), '}');
  lines.push(':root[data-scheme="light"] {', '  color-scheme: light;', '}', '');
  return lines.join('\n');
}
