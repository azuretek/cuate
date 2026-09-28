// Pure: turns core/spec/tokens.json into the token stylesheet. scripts/gen-tokens.mjs writes it; a test checks freshness.
const GROUPS = ['space', 'radius', 'font', 'size', 'motion'];

export function tokensCss(spec) {
  const flat = (prefix, obj, indent) => Object.entries(obj).map(([k, v]) => `${indent}--${prefix}-${k}: ${v};`);
  const lines = ['/* Generated from core/spec/tokens.json by scripts/gen-tokens.mjs. Do not edit. */', ':root {', '  color-scheme: light dark;'];
  for (const g of GROUPS) lines.push(...flat(g, spec[g], '  '));
  lines.push(...flat('color', spec.color.light, '  '), '}', '@media (prefers-color-scheme: dark) {', '  :root {');
  lines.push(...flat('color', spec.color.dark, '    '), '  }', '}', '');
  return lines.join('\n');
}
