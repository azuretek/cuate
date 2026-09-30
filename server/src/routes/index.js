// The route seam. Every module in this directory default-exports { id, handle } and is mounted automatically by
// app.js, keyed by the id it declares in core/spec/api.json. A route module with no spec row, two modules claiming
// one id, or a spec route with no module is refused when the server starts, so the two cannot drift.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));

export async function loadRoutes(routes) {
  const declared = new Set(routes.map((r) => r.id));
  const files = readdirSync(DIR).filter((f) => f.endsWith('.js') && f !== 'index.js').sort();
  const handlers = new Map();
  for (const f of files) {
    const mod = await import(pathToFileURL(path.join(DIR, f)).href);
    const r = mod.default;
    if (!r || typeof r.id !== 'string' || typeof r.handle !== 'function') throw new Error('route module ' + f + ' must default-export { id, handle }');
    if (!declared.has(r.id)) throw new Error('route module ' + f + ' is not declared in core/spec/api.json as ' + r.id);
    if (handlers.has(r.id)) throw new Error('two route modules claim ' + r.id);
    handlers.set(r.id, r.handle);
  }
  return handlers;
}
