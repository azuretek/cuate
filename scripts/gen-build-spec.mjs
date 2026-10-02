// Writes core/app/rules/build-spec.js from core/spec/build.json, the one owner of the build report's fields. The page
// reads the generated mirror and the server reads the spec itself, so what each half reports is described once.
// --check fails when the mirror is stale.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const spec = readFileSync(path.join(root, 'core/spec/build.json'), 'utf8');
const out = path.join(root, 'core/app/rules/build-spec.js');
const doc = '// Generated from core/spec/build.json by scripts/gen-build-spec.mjs. Edit the spec, not this file.\n'
  + 'export const BUILD_SPEC = ' + JSON.stringify(JSON.parse(spec), null, 2) + ';\n';
if (process.argv.includes('--check')) {
  if (readFileSync(out, 'utf8') !== doc) {
    console.error('core/app/rules/build-spec.js is stale: run pnpm run build-spec');
    process.exit(1);
  }
  console.log('build-spec.js is fresh');
} else {
  writeFileSync(out, doc);
  console.log('wrote core/app/rules/build-spec.js');
}
