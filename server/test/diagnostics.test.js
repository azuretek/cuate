// The diagnostics registry: the counters a person reads during a problem are derived from the log stream, so
// they cannot disagree with it, and the last error is the most recent error line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDiagnostics } from '../src/diagnostics.js';
import { apiSpec } from '../src/paths.js';
import { validate } from '../../core/kit/rules/schema.js';
import { boot } from './helpers.js';

const line = (event, level, extra = {}) => ({ ts: '2026-01-01T00:00:00.000Z', level, event, msg: event, ...extra });

test('each mapped failure event moves its counter, and the successes move nothing', () => {
  const d = createDiagnostics();
  d.observe(line('send.failed', 'error'));
  d.observe(line('send.failed', 'error'));
  d.observe(line('send.uncertain', 'warn'));
  d.observe(line('engine.exit', 'warn', { restart_ms: 1000 }));
  d.observe(line('ws.refused', 'notice'));
  d.observe(line('http.request', 'debug', { route: 'chats', status: 200, ms: 3 }));
  d.observe(line('server.ready', 'notice'));
  assert.deepEqual(d.snapshot().counters, { sends_failed: 2, sends_uncertain: 1, engine_restarts: 1, ws_refused: 1 });
});

test('an unknown event invents no counter', () => {
  const d = createDiagnostics();
  d.observe(line('not.a.real.event', 'error'));
  assert.deepEqual(d.snapshot().counters, {});
});

test('the last error is the most recent error or fatal line, with the event and message', () => {
  const d = createDiagnostics();
  d.observe(line('send.uncertain', 'warn', { code: 'timeout' }));
  d.observe(line('engine.error', 'error', { error: 'engine exited' }));
  d.observe(line('auth.refused', 'notice', { reason: 'no_token' }));
  const last = d.snapshot().lastError;
  assert.equal(last.event, 'engine.error');
  assert.equal(last.message, 'engine exited');
  assert.equal(last.at, '2026-01-01T00:00:00.000Z');
  assert.equal(d.snapshot().counters.engine_errors, 1);
});

test('a fatal crash line is an error too, and names its message', () => {
  const d = createDiagnostics();
  d.observe(line('server.crash', 'fatal', { error: 'boom' }));
  assert.equal(d.snapshot().lastError.event, 'server.crash');
  assert.equal(d.snapshot().lastError.message, 'boom');
  assert.equal(d.snapshot().counters.crashes, 1);
});

test('uptime is measured from the injected clock', () => {
  let t = 1000;
  const d = createDiagnostics({ now: () => t });
  t = 4500;
  const snap = d.snapshot();
  assert.equal(snap.uptimeMs, 3500);
  assert.equal(snap.startedAt, new Date(1000).toISOString());
});

test('a line that is not an object is ignored rather than throwing', () => {
  const d = createDiagnostics();
  assert.equal(d.observe(null), undefined);
  assert.equal(d.observe('a string'), undefined);
  assert.deepEqual(d.snapshot().counters, {});
});

test('docs/observability.md records what is deliberately not measured', () => {
  const doc = readFileSync(new URL('../../docs/observability.md', import.meta.url), 'utf8');
  assert.match(doc, /Deliberately not measured/);
  for (const omitted of ['A metrics or tracing backend', 'The success path', 'Per-action client latency']) {
    assert.ok(doc.includes(omitted), 'the omissions list does not name ' + omitted);
  }
});

test('the diagnostics route reports the build stamp, the engine link and the database', async () => {
  const s = await boot();
  try {
    const r = await s.get('/api/v1/diagnostics', s.tokens.device);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.deepEqual(validate(body, 'Diagnostics', apiSpec.models), []);
    assert.equal(body.engine.ready, true);
    assert.equal(body.database.ready, true);
    assert.equal(body.sending, s.config.sending.enabled);
    assert.equal(typeof body.uptimeMs, 'number');
  } finally {
    await s.close();
  }
});
