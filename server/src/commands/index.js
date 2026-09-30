// The command seam. Every module in this directory default-exports { name, run } and is dispatched by name from
// main.js, so a command is a file and nothing has to be edited to add one. Two modules claiming one name is refused.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));

export async function loadCommands() {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.js') && f !== 'index.js').sort();
  const commands = new Map();
  for (const f of files) {
    const mod = await import(pathToFileURL(path.join(DIR, f)).href);
    const c = mod.default;
    if (!c || typeof c.name !== 'string' || typeof c.run !== 'function') throw new Error('command module ' + f + ' must default-export { name, run }');
    if (commands.has(c.name)) throw new Error('two command modules claim ' + c.name);
    commands.set(c.name, c);
  }
  return commands;
}
