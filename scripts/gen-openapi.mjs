// Writes core/spec/openapi.json from core/spec/api.json; --check fails when the file is stale.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openapiDocument } from '../core/kit/rules/openapi.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = (p) => JSON.parse(readFileSync(path.join(root, p), 'utf8'));
const out = path.join(root, 'core/spec/openapi.json');
const doc = JSON.stringify(openapiDocument(json('core/spec/api.json'), json('core/spec/naming.json')), null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (readFileSync(out, 'utf8') !== doc) {
    console.error('core/spec/openapi.json is stale: run pnpm run openapi');
    process.exit(1);
  }
  console.log('openapi.json is fresh');
} else {
  writeFileSync(out, doc);
  console.log('wrote core/spec/openapi.json');
}
