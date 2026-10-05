// The guard the logging standard is enforced by: no file under core/, server/src or desktop/src writes a line
// through the console or the process's own streams instead of the one logger (core/kit/log.js). A file that must
// write to the console is named in core/spec/log-allowlist.json with its reason, so the escape hatch is a reviewable
// change rather than a habit. The lint step carries the same ban for the shared app code, so a new console call
// fails locally and again here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SKIP = new Set(['node_modules', '.git', 'out', 'dist', 'vendor', 'build', 'test']);
const CODE = /\.(?:c|m)?js$/;
const SCOPES = ['core', 'server/src', 'desktop/src'];
const walk = (dir) => readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
  if (SKIP.has(e.name)) return [];
  const rel = dir === '.' ? e.name : dir + '/' + e.name;
  return e.isDirectory() ? walk(rel) : [rel];
});
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const sources = () => SCOPES.flatMap((s) => walk(s).filter((f) => CODE.test(f)));

const allowlist = JSON.parse(read('core/spec/log-allowlist.json'));
const allowed = (f) => allowlist.allow.some((a) => (a.path.endsWith('/') ? f.startsWith(a.path) : f === a.path));

// A call, not a mention: strip comments and string literals first, so a word inside one is not read as a call.
const codeOnly = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\/\/[^\n]*/g, ' ')
  .replace(/'(?:[^'\\]|\\.)*'/g, "''")
  .replace(/"(?:[^"\\]|\\.)*"/g, '""')
  .replace(/`(?:[^`\\]|\\.)*`/g, '``');
const OUTSIDE = /\bconsole\s*\.\s*(?:log|error|warn|info|debug|trace)\s*\(|\bprocess\s*\.\s*(?:stdout|stderr)\s*\.\s*write\s*\(/;

test('no code outside the one logger writes to the console or a stream', () => {
  const offenders = [];
  for (const f of sources()) {
    if (allowed(f)) continue;
    const m = OUTSIDE.exec(codeOnly(read(f)));
    if (m) offenders.push(f + ' uses ' + m[0].trim());
  }
  assert.deepEqual(offenders, [], 'these log outside the one logger. Route them through core/kit/log.js, or name the file in core/spec/log-allowlist.json with its reason:\n' + offenders.join('\n'));
});

test('the allowlist names a reason for every path, and every path it names exists', () => {
  const files = sources();
  assert.ok(allowlist.allow.length > 0, 'the allowlist is empty');
  for (const a of allowlist.allow) {
    assert.ok(a.path && typeof a.reason === 'string' && a.reason.length > 20, 'an allowlist entry needs a path and a real reason: ' + JSON.stringify(a));
    assert.ok(files.some((f) => (a.path.endsWith('/') ? f.startsWith(a.path) : f === a.path)), 'the allowlist names a path with no file: ' + a.path);
  }
});

test('the one logger is the kit logger, and it writes through its injected sink', () => {
  assert.match(read('core/kit/log.js'), /export function createLogger/, 'the kit holds the one logger');
  assert.ok(!OUTSIDE.test(codeOnly(read('core/kit/log.js'))), 'the logger itself must not write to a stream; its sink is injected');
});
