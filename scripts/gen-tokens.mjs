// Writes core/app/styles/tokens.css, the iOS shell's accent and surface colour sets and the Android shell's surface
// colours, from core/spec/tokens.json; --check fails when any is stale.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokensCss, accentColorset, surfaceColorset, androidSurfaceColors } from '../core/kit/rules/tokens.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(readFileSync(path.join(root, 'core/spec/tokens.json'), 'utf8'));
const { product } = JSON.parse(readFileSync(path.join(root, 'core/spec/naming.json'), 'utf8'));
const outputs = [
  ['core/app/styles/tokens.css', tokensCss(spec)],
  ['ios/' + product + '/Assets.xcassets/AccentColor.colorset/Contents.json', JSON.stringify(accentColorset(spec), null, 2) + '\n'],
  ['ios/' + product + '/Assets.xcassets/Surface.colorset/Contents.json', JSON.stringify(surfaceColorset(spec), null, 2) + '\n'],
  ['android/app/src/main/res/values/surface.xml', androidSurfaceColors(spec, 'light')],
  ['android/app/src/main/res/values-night/surface.xml', androidSurfaceColors(spec, 'dark')],
];
if (process.argv.includes('--check')) {
  const stale = outputs.filter(([file, text]) => !existsSync(path.join(root, file)) || readFileSync(path.join(root, file), 'utf8') !== text).map(([file]) => file);
  if (stale.length) {
    console.error(stale.join(', ') + (stale.length > 1 ? ' are' : ' is') + ' stale: run pnpm run tokens');
    process.exit(1);
  }
  console.log('the generated tokens are fresh');
} else {
  for (const [file, text] of outputs) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
    console.log('wrote ' + file);
  }
}
