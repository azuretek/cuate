// A bridge in Messages that stops answering must not hold the sends (2026-11-13). The engine answers one request
// at a time, so typing and read receipts that wait out their timeouts on a dead bridge put every send behind them: on
// a real server a send took minutes and came back uncertain. Once a bridge request fails that way, the adapter refuses
// every bridge request at once until a status read finds the bridge ready again, and a plain send is never refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../src/engine/index.js';
import { createLogger } from '../../core/kit/log.js';
import { logSpec } from '../src/paths.js';

function bridgeEngine({ read = 'fail' } = {}) {
  const world = { bridgeReady: true, requests: [] };
  const makeTransport = () => {
    const lineCbs = new Set();
    const send = (o) => { const s = JSON.stringify(o); setImmediate(() => { for (const cb of lineCbs) cb(s); }); };
    const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
    const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
    return {
      write(s) {
        const req = JSON.parse(s);
        world.requests.push(req.method);
        if (req.method === 'status') {
          const bridge = world.bridgeReady ? { ready: true, bridge_version: 2, v2_ready: true } : { ready: false, error: 'The existing bridge did not answer a non-launching status probe.' };
          return reply(req.id, { version: 't', database: { ready: true }, bridge, methods: world.bridgeReady ? ['typing', 'message.edit'] : [], capabilities: { features: {} } });
        }
        if (req.method === 'watch.subscribe') return reply(req.id, { subscription: 1 });
        if (req.method === 'send') return reply(req.id, { ok: true, guid: 'g-' + world.requests.length });
        if (!world.bridgeReady && ['read', 'typing', 'tapback'].includes(req.method)) {
          if (read === 'hang') return undefined;
          return fail(req.id, -32603, 'Delivery failed before dispatch');
        }
        return reply(req.id, { ok: true });
      },
      onLine(cb) { lineCbs.add(cb); },
      onExit() {},
      close() { return Promise.resolve(); },
    };
  };
  const lines = [];
  const log = createLogger({ spec: logSpec, app: 'test', run: 'test', sink: (l) => lines.push(l), now: Date.now, level: 'debug', strict: true });
  const engine = createEngine({ kind: 'imsg', makeTransport, log: log.child('engine'), attachmentId: () => 'att', timeoutMs: 300 });
  return { engine, world, lines };
}

for (const read of ['fail', 'hang']) {
  test(`a bridge that stops answering (${read === 'fail' ? 'failed before dispatch' : 'timed out'}) is refused at once until it is ready again`, async () => {
    const { engine, world, lines } = bridgeEngine({ read });
    await engine.start();
    assert.deepEqual(engine.bridge(), { known: true, ready: true, error: null });
    assert.equal(engine.canType(), true);
    world.bridgeReady = false;
    await assert.rejects(engine.read('1'));
    assert.equal(engine.bridge().ready, false, 'the failed bridge request marks the bridge down');
    assert.ok(lines.find((l) => l.event === 'engine.bridge' && l.ready === false && l.method === 'read'));
    const before = world.requests.length;
    const t0 = Date.now();
    await assert.rejects(engine.read('1'), (e) => e.code === 'bridge_down');
    assert.equal(await engine.typing('1', true), false);
    assert.deepEqual(await engine.react('1', 'g1', { type: 'like' }), { ok: false, uncertain: false, unsupported: true, code: 'bridge_down' });
    assert.deepEqual(await engine.sendText('1', 'reply', { replyTo: 'g0' }), { ok: false, uncertain: false, unsupported: true, code: 'bridge_down' });
    assert.ok(Date.now() - t0 < 100, 'nothing waits on the dead bridge');
    assert.equal(world.requests.length, before, 'and nothing is queued in the engine in front of a send');
    const sent = await engine.sendText('1', 'hello');
    assert.equal(sent.ok, true, 'a plain send still goes, straight away');
    world.bridgeReady = true;
    assert.deepEqual(await engine.checkBridge(), { known: true, ready: true, error: null });
    assert.equal(engine.canType(), true, 'a bridge that answers again gets its requests back');
    assert.deepEqual(await engine.read('1'), { ok: true });
    await engine.stop();
  });
}

test('an engine whose status names no bridge is asked as before', async () => {
  const { engine } = bridgeEngine();
  await engine.start();
  await engine.stop();
  const lines = [];
  const log = createLogger({ spec: logSpec, app: 'test', run: 'test', sink: (l) => lines.push(l), now: Date.now, level: 'debug', strict: true });
  const t = { cbs: new Set() };
  const plain = createEngine({ kind: 'fake', log: log.child('engine'), attachmentId: () => 'a', timeoutMs: 300, makeTransport: () => ({
    write(s) { const req = JSON.parse(s); const result = req.method === 'status' ? { version: 't', database: { ready: true }, methods: [] } : req.method === 'watch.subscribe' ? { subscription: 1 } : { ok: true }; setImmediate(() => { for (const cb of t.cbs) cb(JSON.stringify({ jsonrpc: '2.0', id: req.id, result })); }); },
    onLine(cb) { t.cbs.add(cb); }, onExit() {}, close: () => Promise.resolve(),
  }) });
  await plain.start();
  assert.equal(plain.bridge().known, false);
  assert.deepEqual(await plain.read('1'), { ok: true });
  assert.equal(lines.filter((l) => l.event === 'engine.bridge').length, 0);
  await plain.stop();
});
