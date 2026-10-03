// The server holds no copy of code core/ owns (issue 117): a server module that defines a function with the same name and
// body as one in core/, or a longer function whose body is a core function's under another name, fails here, so the
// server and the clients that run core/ stay on one implementation. The fix is always the same: export the core
// function and import it. Bodies are compared as token streams, so whitespace and comments do not hide a copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// core/build is generated from core and core/kit/vendor is a pinned third-party build: neither is code core owns by hand.
const SKIP = new Set(['node_modules', 'test', 'build', 'vendor']);
const walk = (dir) => readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
  if (SKIP.has(e.name)) return [];
  const rel = dir + '/' + e.name;
  return e.isDirectory() ? walk(rel) : /\.js$/.test(e.name) ? [rel] : [];
});
// A function this long or longer is a copy whatever it is called; a shorter one counts only under the same name, so a
// one-line callback such as `(e) => e.id` that both sides happen to write is not mistaken for shared code.
const RENAMED_MIN_TOKENS = 20;

// Every function in one source: its name where it has one (a declaration, a const, a property or a method), where it
// starts, and its parameters and body as tokens.
function functionsIn(file, src) {
  const linter = new Linter();
  const fatal = linter.verify(src, { languageOptions: { ecmaVersion: 2024, sourceType: 'module' } }).filter((m) => m.fatal);
  assert.deepEqual(fatal, [], file + ' does not parse');
  const code = linter.getSourceCode();
  const found = [];
  const visit = (node, name) => {
    if (!node || typeof node.type !== 'string') return;
    if (/Function/.test(node.type)) {
      const tokens = code.getTokens(node).map((t) => t.value);
      // From the parameters on, so `function f`, `async function` and `const f = function` compare by what they do.
      const from = node.type === 'ArrowFunctionExpression' ? (tokens[0] === 'async' ? 1 : 0) : tokens.indexOf('(');
      found.push({ file, line: node.loc.start.line, name: (node.id && node.id.name) || name, tokens: tokens.slice(from) });
    }
    for (const key of code.visitorKeys[node.type] || []) {
      const child = node[key];
      let childName;
      if (node.type === 'VariableDeclarator' && key === 'init' && node.id.type === 'Identifier') childName = node.id.name;
      if (/^(?:Property|MethodDefinition|PropertyDefinition)$/.test(node.type) && key === 'value' && !node.computed) childName = node.key.name || node.key.value;
      if (Array.isArray(child)) for (const c of child) visit(c, undefined);
      else visit(child, childName);
    }
  };
  visit(code.ast);
  return found;
}

// Each server function that copies a core one, as `server:line name = core:line name`.
function copiesOf(core, server) {
  const byBody = new Map();
  for (const f of core) {
    const key = f.tokens.join(' ');
    byBody.set(key, [...(byBody.get(key) || []), f]);
  }
  const copies = [];
  for (const s of server) {
    for (const c of byBody.get(s.tokens.join(' ')) || []) {
      const sameName = Boolean(s.name) && s.name === c.name;
      if (sameName || s.tokens.length >= RENAMED_MIN_TOKENS) copies.push(s.file + ':' + s.line + ' ' + (s.name || '(anonymous)') + ' = ' + c.file + ':' + c.line + ' ' + (c.name || '(anonymous)'));
    }
  }
  return copies;
}

const scan = (dir) => walk(dir).flatMap((f) => functionsIn(f, readFileSync(path.join(ROOT, f), 'utf8')));

test('the server keeps no copy of a function core/ owns', () => {
  const core = scan('core');
  const server = scan('server/src');
  // The scan has to see the code it guards, or an empty walk would pass.
  for (const dir of ['core/app/rules/', 'core/kit/rules/']) assert.ok(core.some((f) => f.file.startsWith(dir)), 'no functions read from ' + dir);
  assert.ok(server.length > 100, 'only ' + server.length + ' server functions read');
  assert.deepEqual(copiesOf(core, server), [], 'export the core function and import it in the server');
});

test('a copy is found through whitespace, comments and the way it is declared', () => {
  const core = functionsIn('core/a.js', 'export const pathParams = (p) => [...p.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1]);');
  const server = functionsIn('server/b.js', [
    'function pathParams(p) { return 1; }',
    'const pathParams2 = (p) =>',
    '  // a comment does not hide it',
    '  [ ...p.matchAll( /:([A-Za-z]+)/g ) ].map((m)   => m[1]);',
    'export const routes = { pathParams: (p) => [...p.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1]) };',
  ].join('\n'));
  assert.deepEqual(copiesOf(core, server), [
    'server/b.js:2 pathParams2 = core/a.js:1 pathParams',
    'server/b.js:5 pathParams = core/a.js:1 pathParams',
  ]);
});

test('a short body is a copy only under the same name', () => {
  const core = functionsIn('core/a.js', 'export function idOf(x) { return x.id; }\nexport const list = (xs) => xs.map((x) => x.id);');
  const server = functionsIn('server/b.js', 'export function idOf(x) { return x.id; }\nfunction keyOf(x) { return x.id; }\nconst idOf2 = (x) => x.ids;');
  assert.deepEqual(copiesOf(core, server), ['server/b.js:1 idOf = core/a.js:1 idOf']);
});

test('the same name with a different body is not a copy', () => {
  const core = functionsIn('core/a.js', 'const iso = (s) => { const t = Date.parse(s); return Number.isFinite(t) ? new Date(t).toISOString() : null; };');
  const server = functionsIn('server/b.js', 'const iso = (t) => new Date(t).toISOString();');
  assert.deepEqual(copiesOf(core, server), []);
});
