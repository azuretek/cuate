// The engine bundle is what a shell runs core from with no page on screen: iOS
// through JavaScriptCore, Android through its embedded engine. One bundle, so
// there is no second implementation to drift. These tests hold the committed
// file fresh and prove it answers exactly as the source modules do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import { bundleEngine, OUT } from '../../scripts/gen-engine-bundle.mjs';
import { scrub } from '../kit/rules/scrub.js';
import { formatTraceparent, parseTraceparent } from '../kit/rules/trace.js';
import { orderChats, chatTitle } from '../app/rules/chats.js';
import { connectionSentence } from '../app/rules/connection.js';
import * as entry from '../app/engine.js';

const code = readFileSync(OUT, 'utf8');
const engine = () => vm.runInNewContext(code + '\nengine;', {});

test('the committed engine bundle is fresh', async () => {
  assert.equal(code, await bundleEngine(), 'core/build/engine.js is stale: run pnpm run engine');
});

test('the bundle defines the engine global and carries every name the entry exports', () => {
  assert.deepEqual(Object.keys(engine()).sort(), Object.keys(entry).sort());
});

test('the bundle answers exactly as core does, on the same fixtures', () => {
  const e = engine();
  assert.equal(e.scrub('card 4012 8888 8888 1881 ok'), scrub('card 4012 8888 8888 1881 ok'));
  const trace = { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) };
  assert.equal(e.formatTraceparent(trace), formatTraceparent(trace));
  // ★ Compared as JSON: a value out of the bundle carries the vm context's own
  // Object.prototype, so a strict deep compare fails on the realm alone.
  assert.equal(
    JSON.stringify(e.parseTraceparent(formatTraceparent(trace))),
    JSON.stringify(parseTraceparent(formatTraceparent(trace))),
  );
  const chats = [
    { id: '1', name: 'A', participants: [], lastMessageAt: '2026-01-01T00:00:00.000Z' },
    { id: '2', name: '', participants: ['x@example.com', 'y@example.com'], lastMessageAt: '2026-01-03T00:00:00.000Z' },
    { id: '3', name: 'C', participants: [], lastMessageAt: null },
  ];
  assert.equal(JSON.stringify(e.orderChats(chats)), JSON.stringify(orderChats(chats)));
  assert.equal(e.chatTitle(chats[1]), chatTitle(chats[1]));
  assert.equal(e.connectionSentence('offline'), connectionSentence('offline'));
});

test('every rule module is named by the engine entry, so none is left out of a shell', () => {
  const src = readFileSync(new URL('../app/engine.js', import.meta.url), 'utf8');
  const named = (dir, prefix) => readdirSync(new URL(dir, import.meta.url))
    .filter((f) => f.endsWith('.js'))
    .map((f) => prefix + f);
  for (const spec of [...named('../kit/rules/', '../kit/rules/'), ...named('../app/rules/', './rules/')]) {
    assert.ok(src.includes(spec), 'core/app/engine.js does not name ' + spec);
  }
});

// Only the code: comments and string/template literals removed, so a word that is data (an emoji name or
// keyword such as 'window' or 'fetch') is not read as a reference to the DOM or the network. The node-builtin
// check reads the source itself, because there the specifier is a string.
const codeOnly = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\/\/[^\n]*/g, ' ')
  .replace(/'(?:[^'\\]|\\.)*'/g, "''")
  .replace(/"(?:[^"\\]|\\.)*"/g, '""')
  .replace(/`(?:[^`\\]|\\.)*`/g, '``');

test('the bundle runs with no page, so it needs no DOM and no node builtin', () => {
  assert.ok(!/\b(document|window|localStorage|indexedDB|require\()/.test(codeOnly(code)));
  assert.ok(!/from\s*['"]node:/.test(code));
});
