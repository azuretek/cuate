import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse, stringify } from 'yaml';
export function collect(input, output) {
  mkdirSync(output, { recursive: true });
  const metadata = new Map();
  const assets = new Set();
  for (const leg of readdirSync(input)) {
    for (const name of readdirSync(path.join(input, leg))) {
      const file = path.join(input, leg, name);
      if (name.endsWith('.yml')) {
        const doc = parse(readFileSync(file, 'utf8'));
        const previous = metadata.get(name);
        if (previous) {
          if (previous.version !== doc.version) throw new Error('Versions differ across legs');
          previous.files.push(...doc.files);
        } else metadata.set(name, doc);
      } else {
        if (assets.has(name)) throw new Error('Duplicate asset: ' + name);
        assets.add(name);
        copyFileSync(file, path.join(output, name));
      }
    }
  }
  for (const [name, doc] of metadata) writeFileSync(path.join(output, name), stringify(doc));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) collect(process.argv[2], process.argv[3]);
