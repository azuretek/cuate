// Writes core/app/styles/tokens.css from core/spec/tokens.json; --check fails when the file is stale.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokensCss } from '../core/kit/rules/tokens.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(readFileSync(path.join(root, 'core/spec/tokens.json'), 'utf8'));
const out = path.join(root, 'core/app/styles/tokens.css');
const css = tokensCss(spec);
if (process.argv.includes('--check')) {
  if (readFileSync(out, 'utf8') !== css) {
    console.error('core/app/styles/tokens.css is stale: run pnpm run tokens');
    process.exit(1);
  }
  console.log('tokens.css is fresh');
} else {
  writeFileSync(out, css);
  console.log('wrote core/app/styles/tokens.css');
}
