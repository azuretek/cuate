// Writes core/app/styles/tokens.css, and the iOS shell's accent colour set, from core/spec/tokens.json; --check fails
// when either is stale.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokensCss, accentColorset } from '../core/kit/rules/tokens.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(readFileSync(path.join(root, 'core/spec/tokens.json'), 'utf8'));
const { product } = JSON.parse(readFileSync(path.join(root, 'core/spec/naming.json'), 'utf8'));
const outputs = [
  ['core/app/styles/tokens.css', tokensCss(spec)],
  ['ios/' + product + '/Assets.xcassets/AccentColor.colorset/Contents.json', JSON.stringify(accentColorset(spec), null, 2) + '\n'],
];
if (process.argv.includes('--check')) {
  const stale = outputs.filter(([file, text]) => readFileSync(path.join(root, file), 'utf8') !== text).map(([file]) => file);
  if (stale.length) {
    console.error(stale.join(', ') + (stale.length > 1 ? ' are' : ' is') + ' stale: run pnpm run tokens');
    process.exit(1);
  }
  console.log('the generated tokens are fresh');
} else {
  for (const [file, text] of outputs) {
    writeFileSync(path.join(root, file), text);
    console.log('wrote ' + file);
  }
}
