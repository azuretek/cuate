// The engine link's shape, proven against the rule that decides readiness and restart (server/src/engine/link.js)
// and against the adapter's own supervision, not a mock of the whole process. The failing states are the ones a real
// server met: a child killed mid-request, an engine that never becomes ready, a bridge that is not connected, a
// request that hangs, a link that flaps, and a child replaced while a request is in flight.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../src/engine/index.js';
import { isReady, nextDelay, RESTART_MIN_MS, RESTART_MAX_MS, STABLE_MS } from '../src/engine/link.js';
import { createLogger } from '../../core/kit/log.js';
import { logSpec } from '../src/paths.js';
import { boot, waitFor } from './helpers.js';

// A transport a test drives. It answers the methods it is told to, can be made to hang on one, and can be made to
// exit on demand. Every transport an engine spawns is kept, so a test can count children and reach the current one.
function script({ status = 'ok', databaseReady = true, subscribe = 'ok', subscribeCode = null, hang = [] } = {}) {
  const made = [];
  const makeTransport = () => {
    const lineCbs = new Set();
    const exitCbs = new Set();
    let dead = false;
    const send = (o) => { const s = JSON.stringify(o); setImmediate(() => { if (!dead) for (const cb of lineCbs) cb(s); }); };
    const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
    const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
    const t = {
      requests: [],
      write(s) {
        const req = JSON.parse(s);
        t.requests.push(req.method);
        if (hang.includes(req.method)) return; // never answers
        if (req.method === 'status') return status === 'hang' ? undefined : reply(req.id, { version: 'test-1', database: { ready: databaseReady }, methods: [], capabilities: { features: {} } });
        if (req.method === 'watch.subscribe') {
          if (subscribeCode !== null) return fail(req.id, subscribeCode, 'no watch method');
          if (subscribe === 'hang') return undefined;
          return reply(req.id, { subscription: 1 });
        }
        return reply(req.id, { ok: true });
      },
      onLine(cb) { lineCbs.add(cb); },
      onExit(cb) { exitCbs.add(cb); },
      exit(info = { code: 1, signal: null }) { if (dead) return; dead = true; for (const cb of exitCbs) cb(info); },
      close() { t.exit({ code: 0, signal: null }); return Promise.resolve(); },
    };
    made.push(t);
    return t;
  };
  return { made, makeTransport };
}

function mk(s, opts = {}) {
  const lines = [];
  const log = createLogger({ spec: logSpec, app: 'test', run: 'test', sink: (l) => lines.push(l), now: Date.now, level: 'debug', strict: true });
  const engine = createEngine({ kind: 'fake', makeTransport: s.makeTransport, log: log.child('engine'), attachmentId: () => 'att', timeoutMs: 400, ...opts });
  return { engine, lines, log };
}

test('readiness needs a live child, a readable database and a subscribed watch', () => {
  assert.equal(isReady({ alive: true, databaseReady: true, subscribed: true }), true);
  assert.equal(isReady({ alive: false, databaseReady: true, subscribed: true }), false, 'a dead child is not connected');
  assert.equal(isReady({ alive: true, databaseReady: false, subscribed: true }), false, 'an unreadable database is not connected');
  assert.equal(isReady({ alive: true, databaseReady: true, subscribed: false }), false, 'an unsubscribed watch is not connected');
  assert.equal(isReady({ alive: true, databaseReady: true, subscribed: false, subscribeUnsupported: true }), true, 'an engine too old for the watch method is still connected');
});

test('the backoff doubles while the link cannot stay up and resets only after it has stayed ready', () => {
  assert.equal(nextDelay(0, { readyForMs: 0 }), RESTART_MIN_MS);
  assert.equal(nextDelay(RESTART_MIN_MS, { readyForMs: 0 }), 2 * RESTART_MIN_MS);
  assert.equal(nextDelay(2 * RESTART_MIN_MS, { readyForMs: 0 }), 4 * RESTART_MIN_MS);
  assert.equal(nextDelay(RESTART_MAX_MS, { readyForMs: 0 }), RESTART_MAX_MS, 'capped');
  assert.equal(nextDelay(RESTART_MAX_MS, { readyForMs: STABLE_MS - 1 }), RESTART_MAX_MS, 'a flap does not reset it');
  assert.equal(nextDelay(RESTART_MAX_MS, { readyForMs: STABLE_MS }), RESTART_MIN_MS, 'a link that stayed ready resets it');
});

test('an engine whose database is not readable is never reported ready', async () => {
  const s = script({ databaseReady: false });
  const { engine, lines } = mk(s);
  await engine.start();
  assert.equal(engine.info().ready, false);
  assert.ok(lines.some((l) => l.event === 'engine.start' && l.ready === false));
  assert.equal(lines.some((l) => l.event === 'engine.ready' && l.ready === true), false);
  await engine.stop();
});

test('a link whose watch never subscribes is not ready, and the failure is logged', async () => {
  const s = script({ subscribe: 'hang' });
  const { engine, lines } = mk(s, { timeoutMs: 150 });
  await engine.start();
  assert.equal(engine.info().ready, false);
  await waitFor(() => lines.some((l) => l.event === 'engine.error' && l.method === 'watch.subscribe'));
  await engine.stop();
});

test('an engine too old to know watch.subscribe is still connected', async () => {
  const s = script({ subscribeCode: -32601 });
  const { engine } = mk(s);
  await engine.start();
  assert.equal(engine.info().ready, true);
  await engine.stop();
});

test('a request in flight when the child exits is answered with engine_exit, not dropped', async () => {
  const s = script({ hang: ['chats.list'] });
  const { engine, lines } = mk(s, { timeoutMs: 5000 });
  await engine.start();
  const p = engine.chats({ limit: 5 });
  s.made[0].exit({ code: null, signal: 'SIGKILL' });
  await assert.rejects(p, (e) => e.code === 'engine_exit');
  assert.ok(lines.some((l) => l.event === 'engine.error' && l.method === 'chats.list'), 'the failure left no engine.error line');
  await waitFor(() => lines.some((l) => l.event === 'engine.exit'));
  const exit = lines.find((l) => l.event === 'engine.exit');
  assert.equal(exit.signal, 'SIGKILL');
  assert.equal(typeof exit.uptime_ms, 'number');
  assert.equal(exit.method, 'chats.list', 'the exit names what it was restarting away from');
  await engine.stop();
});

test('a request that hangs times out with a code the caller can act on', async () => {
  const s = script({ hang: ['chats.list'] });
  const { engine } = mk(s, { timeoutMs: 120 });
  await engine.start();
  await assert.rejects(engine.chats({ limit: 5 }), (e) => e.code === 'timeout');
  await engine.stop();
});

test('two starts at once spawn one child, and ensure leaves a connected child alone', async () => {
  const s = script();
  const { engine } = mk(s);
  await Promise.all([engine.start(), engine.start()]);
  assert.equal(s.made.length, 1, 'a second start joined the first rather than spawning a twin');
  await engine.ensure();
  assert.equal(s.made.length, 1, 'ensure did not replace a connected child');
  await engine.restart();
  assert.equal(s.made.length, 2, 'an explicit restart replaces the child');
  await engine.stop();
});

test('an engine failure is surfaced as a refusal and a log line, never swallowed', async () => {
  const s = await boot();
  try {
    s.world.crashAll();
    await new Promise((r) => setTimeout(r, 20)); // let the exit settle
    const r = await s.get('/api/v1/chats/1/messages', s.tokens.device);
    assert.equal(r.status, 503, 'a read against a dead engine is refused');
    assert.ok(s.lines.some((l) => l.event === 'engine.error'), 'the engine failure left no engine.error line');
    assert.ok(s.lines.some((l) => l.event === 'http.error' && l.route === 'messages'), 'the refusal was not logged as an http.error');
  } finally {
    await s.close();
  }
});

test('a replaced child loses no in-flight request silently', async () => {
  const s = script({ hang: ['chats.list'] });
  const { engine } = mk(s, { timeoutMs: 5000 });
  await engine.start();
  const p = engine.chats({ limit: 5 });
  const asserted = assert.rejects(p, (e) => e.code === 'engine_exit'); // attach before it rejects
  await engine.restart(); // replaces the child while the request is in flight
  await asserted;
  await engine.stop();
});
