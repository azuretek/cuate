import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { createLogger } from '../../core/kit/log.js';
import { logSpec } from '../src/paths.js';
import { createWebhooks } from '../src/webhooks.js';

function receiver(handler) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { const rec = { headers: req.headers, body }; requests.push(rec); handler(rec, res); });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    requests,
    url: 'http://127.0.0.1:' + server.address().port + '/hook',
    close: () => new Promise((r) => server.close(r)),
  })));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strictLog = (lines) => createLogger({ spec: logSpec, app: 'test', run: 'test', sink: (l) => lines.push(l), now: Date.now, level: 'debug', strict: true });

test('a live message is delivered signed, and a receiver can verify the signature', async (t) => {
  const r = await receiver((rec, res) => { res.writeHead(204); res.end(); });
  t.after(() => r.close());
  const lines = [];
  const engine = { listeners: new Set(), on(cb) { this.listeners.add(cb); }, fire(name, data) { for (const cb of this.listeners) cb(name, data); } };
  const hooks = createWebhooks({ engine, endpoints: [{ id: 'a', url: r.url, secret: 's3cret' }], log: strictLog(lines), retryDelaysMs: [5, 5], sleep });
  t.after(() => hooks.close());

  engine.fire('message.new', { message: { id: 'm1', text: 'hello' } });
  await hooks.drain();
  assert.equal(r.requests.length, 1);
  const rec = r.requests[0];
  assert.equal(rec.headers['x-webhook-signature'], 'sha256=' + createHmac('sha256', 's3cret').update(rec.body).digest('hex'));
  const payload = JSON.parse(rec.body);
  assert.equal(payload.event, 'message.new');
  assert.equal(payload.data.message.text, 'hello');
  assert.equal(hooks.stats.delivered, 1);
  assert.ok(!lines.some((l) => l.event === 'log.undeclared'));
});

test('a failing endpoint is retried with a backoff until it accepts', async (t) => {
  let attempts = 0;
  const r = await receiver((rec, res) => { attempts += 1; res.writeHead(attempts < 3 ? 500 : 200); res.end(); });
  t.after(() => r.close());
  const hooks = createWebhooks({ endpoints: [{ id: 'a', url: r.url, secret: 'k' }], retryDelaysMs: [5, 10], sleep });
  t.after(() => hooks.close());
  hooks.enqueue('message.new', { message: { id: 'm1' } });
  await hooks.drain();
  assert.equal(r.requests.length, 3);
  assert.equal(hooks.stats.delivered, 1);
  assert.equal(hooks.stats.gaveUp, 0);
});

test('an endpoint that never accepts is given up on after the last retry', async (t) => {
  const r = await receiver((rec, res) => { res.writeHead(503); res.end(); });
  t.after(() => r.close());
  const lines = [];
  const hooks = createWebhooks({ endpoints: [{ id: 'dead', url: r.url, secret: 'k' }], log: strictLog(lines), retryDelaysMs: [1, 1], sleep });
  t.after(() => hooks.close());
  hooks.enqueue('message.new', { message: { id: 'm1' } });
  await hooks.drain();
  assert.equal(r.requests.length, 3, 'one try and two retries');
  assert.equal(hooks.stats.gaveUp, 1);
  assert.ok(lines.some((l) => l.event === 'webhook.gaveup'));
});

test('an unreachable endpoint never holds its caller, and the next event still goes out', async (t) => {
  const hooks = createWebhooks({ endpoints: [{ id: 'dead', url: 'http://127.0.0.1:1/hook', secret: 'k' }], retryDelaysMs: [1], sleep });
  t.after(() => hooks.close());
  const t0 = Date.now();
  hooks.enqueue('message.new', { message: { id: 'a' } });
  hooks.enqueue('message.new', { message: { id: 'b' } });
  assert.ok(Date.now() - t0 < 50, 'queueing does not wait on the network');
  await hooks.drain();
  assert.equal(hooks.stats.queued, 2);
  assert.equal(hooks.stats.gaveUp, 2);
});

test('an event that is not a message is not delivered', async (t) => {
  const r = await receiver((rec, res) => { res.writeHead(204); res.end(); });
  t.after(() => r.close());
  const hooks = createWebhooks({ endpoints: [{ id: 'a', url: r.url, secret: 'k' }], retryDelaysMs: [1], sleep });
  t.after(() => hooks.close());
  hooks.enqueue('server.state', { engine: 'ready' });
  await hooks.drain();
  assert.equal(r.requests.length, 0);
});
