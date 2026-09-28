// Guards that hold the framework's rules: they fail the build rather than rely on anyone remembering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokensCss } from '../kit/rules/tokens.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SKIP = new Set(['node_modules', '.git', 'out', 'dist', 'vendor']);
const walk = (dir) => readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
  if (SKIP.has(e.name)) return [];
  const rel = dir === '.' ? e.name : dir + '/' + e.name;
  return e.isDirectory() ? walk(rel) : [rel];
});
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const json = (f) => JSON.parse(read(f));
const importsOf = (src) => [...src.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1] || m[2] || m[3]);
const CODE = /\.(?:c|m)?js$/;

test('framework code in core/kit imports only from core/kit', () => {
  for (const f of walk('core/kit').filter((f) => CODE.test(f))) {
    for (const spec of importsOf(read(f))) {
      assert.ok(spec.startsWith('.'), f + ' imports ' + spec);
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(f), spec));
      assert.ok(target.startsWith('core/kit/'), f + ' reaches outside the kit: ' + spec);
    }
  }
});

test('rule modules do no I/O and read no clock', () => {
  const impure = /\b(?:fetch|WebSocket|XMLHttpRequest|localStorage|sessionStorage|indexedDB|setTimeout|setInterval|require)\b|performance\.now|Date\.now|process\.|new Date\(\s*\)|from\s+['"]node:/;
  for (const f of walk('core').filter((f) => /\/rules\/[^/]+\.js$/.test(f))) {
    const m = impure.exec(read(f));
    assert.equal(m, null, f + ' uses ' + (m && m[0]));
  }
});

test('every custom element is defined in core, named app- or kit-', () => {
  for (const f of [...walk('desktop'), ...walk('server'), ...walk('scripts')].filter((f) => CODE.test(f))) assert.ok(!/customElements\.define/.test(read(f)), f);
  const names = walk('core/app/components').map((f) => /customElements\.define\('([^']+)'/.exec(read(f))?.[1]).filter(Boolean);
  assert.ok(names.length > 0);
  assert.ok(names.every((n) => n.startsWith('app-') || n.startsWith('kit-')), names.join(', '));
});

test('component CSS carries no literal colours or lengths', () => {
  for (const f of walk('core/app/styles').filter((f) => f.endsWith('.css') && !f.endsWith('tokens.css'))) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.equal(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.exec(src), null, f + ' has a literal colour');
    const body = src.split('\n').filter((l) => !l.trim().startsWith('@media')).join('\n');
    const lengths = (body.match(/(?<![\w-])\d*\.?\d+(?:px|rem|em|ms|s|vh|vw)\b/g) || []).filter((v) => v !== '1px');
    assert.deepEqual(lengths, [], f + ' has literal lengths');
  }
});

test('the product name lives only where naming.json says', () => {
  const naming = json('core/spec/naming.json');
  const re = new RegExp(naming.slug, 'i');
  const files = [...walk('core'), ...walk('server'), ...walk('desktop'), ...walk('scripts')].filter((f) => CODE.test(f) || /\.(?:css|html)$/.test(f));
  for (const f of files) assert.ok(!re.test(read(f)), f + ' carries the product name');
  const pkg = json('package.json');
  assert.equal(pkg.name, naming.slug);
  assert.ok(pkg.repository.url.includes(naming.repo));
});

test('tokens.css is fresh', () => {
  assert.equal(read('core/app/styles/tokens.css'), tokensCss(json('core/spec/tokens.json')));
});

test('the vendored Lit build is the pinned one', () => {
  const h = createHash('sha256').update(readFileSync(path.join(ROOT, 'core/kit/vendor/lit-core.min.js'))).digest('hex');
  assert.equal(h, 'f607f470475d8ab790754cb70f72cdbe2390c4a57ab59df6cdb360eeb72bd87c');
});

test('the API spec is complete and consistent', () => {
  const api = json('core/spec/api.json');
  const known = new Set(['string', 'number', 'boolean', 'object', 'binary', ...Object.keys(api.models)]);
  const base = (t) => t.replace(/\?$/, '').replace(/\[\]$/, '');
  const scopes = new Set(Object.values(api.scopes).flat());
  for (const r of api.routes) {
    assert.ok(r.id && r.method && r.path && r.scope, JSON.stringify(r));
    assert.ok(r.scope === 'none' || r.scope === 'any' || scopes.has(r.scope), r.id + ' has an unknown scope');
    assert.ok(known.has(base(r.returns)), r.id + ' returns an unknown type');
    if (r.body) assert.ok(known.has(r.body), r.id + ' takes an unknown body');
  }
  for (const t of Object.values(api.events)) assert.ok(known.has(t), t);
  for (const [name, p] of Object.entries(api.paging)) assert.ok(Number.isInteger(p.default) && Number.isInteger(p.max) && p.default >= 1 && p.default <= p.max, 'paging for ' + name);
  for (const [name, fields] of Object.entries(api.models)) for (const t of Object.values(fields)) assert.ok(known.has(base(t)), name + ' uses ' + t);
});

test('every log event has a level, a message and typed fields', () => {
  const spec = json('core/spec/log-events.json');
  for (const [name, e] of Object.entries(spec.events)) {
    assert.ok(spec.levels.includes(e.level), name);
    assert.equal(typeof e.msg, 'string', name);
    for (const t of Object.values(e.fields)) assert.match(t, /^(?:string|number|boolean)\??$/, name);
  }
});

test('no em dash anywhere in the repository', () => {
  for (const f of walk('.').filter((f) => /\.(?:c|m)?js$|\.(?:json|md|css|html|ya?ml)$/.test(f))) assert.ok(!read(f).includes('\u2014'), f);
});
