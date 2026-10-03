import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createDecipheriv, createHmac, timingSafeEqual } from 'node:crypto';
import { spawn, execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createLogger } from '../../core/kit/log.js';
import { validate } from '../../core/kit/rules/schema.js';
import { apiSpec, logSpec } from '../src/paths.js';
import { createWebhooks, DISABLE_AFTER_GIVEUPS, DISABLE_AFTER_MS, eventNames, isLoopback, sampleData, TEST_EVENT } from '../src/webhooks.js';
import { loadConfig, normalizeConfig, saveConfig } from '../src/config.js';
import { runDoctor } from '../src/doctor.js';
import { boot, waitFor } from './helpers.js';

const SECRET = 'synthetic-secret-0123456789abcdef';
const OTHER_SECRET = 'synthetic-secret-fedcba9876543210';
const KEY = { kid: 'k1', key: Buffer.alloc(32, 7).toString('base64url') };
const WRONG_KEY = { kid: 'k1', key: Buffer.alloc(32, 9).toString('base64url') };
const endpoint = (url, extra = {}) => ({ id: 'a', url, secrets: [SECRET], keys: [KEY], ...extra });

// What a receiver does, written the way docs/server.md shows it: verify the signature over "t.body" within a window,
// then decrypt the JWE with its key.
function verify(header, body, secret, { nowS = Math.floor(Date.now() / 1000), windowS = 300 } = {}) {
  const parts = Object.groupBy(String(header).split(','), (p) => p.slice(0, p.indexOf('=')));
  const t = Number(parts.t && parts.t[0].slice(2));
  if (!Number.isInteger(t) || Math.abs(nowS - t) > windowS) return false;
  const want = createHmac('sha256', secret).update(t + '.' + body).digest();
  return (parts.v1 || []).some((p) => {
    const got = Buffer.from(p.slice(3), 'hex');
    return got.length === want.length && timingSafeEqual(got, want);
  });
}
function decrypt(jwe, { kid, key }) {
  const [h, ek, iv, ct, tag] = jwe.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
  assert.deepEqual(header, { alg: 'dir', enc: 'A256GCM', kid });
  assert.equal(ek, '', 'dir carries no encrypted key');
  const d = createDecipheriv('aes-256-gcm', Buffer.from(key, 'base64url'), Buffer.from(iv, 'base64url'));
  d.setAAD(Buffer.from(h, 'ascii'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8'));
}

function receiver(handler = (rec, res) => { res.writeHead(204); res.end(); }) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { const rec = { headers: req.headers, body }; requests.push(rec); handler(rec, res); });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    requests,
    url: 'http://127.0.0.1:' + server.address().port + '/hook',
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }),
  })));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strictLog = (lines) => createLogger({ spec: logSpec, app: 'test', run: 'test', sink: (l) => lines.push(l), now: Date.now, level: 'debug', strict: true });
const eventsOf = (r) => r.requests.map((q) => JSON.parse(q.body).event);

test('a delivery is encrypted as a JWE and signed over its timestamp and body, and a receiver can verify then decrypt it', async (t) => {
  const r = await receiver();
  t.after(() => r.close());
  const lines = [];
  const hooks = createWebhooks({ endpoints: [endpoint(r.url)], log: strictLog(lines), retryDelaysMs: [5, 5], sleep });
  t.after(() => hooks.close());

  hooks.enqueue('message.new', { message: { id: 'm1', text: 'Synthetic hello' } });
  await hooks.drain();
  assert.equal(r.requests.length, 1);
  const rec = r.requests[0];
  assert.ok(verify(rec.headers['x-webhook-signature'], rec.body, SECRET), 'the signature verifies over t.body');
  assert.ok(!verify(rec.headers['x-webhook-signature'], rec.body + ' ', SECRET), 'a changed body fails');
  assert.ok(!verify(rec.headers['x-webhook-signature'], rec.body, OTHER_SECRET), 'another secret fails');
  assert.ok(!verify(rec.headers['x-webhook-signature'], rec.body, SECRET, { nowS: Math.floor(Date.now() / 1000) + 600 }), 'an old timestamp fails');
  const payload = JSON.parse(rec.body);
  assert.deepEqual(Object.keys(payload).sort(), ['event', 'id', 'jwe', 'sentAt']);
  assert.equal(payload.event, 'message.new');
  assert.equal(rec.headers['x-webhook-event'], 'message.new');
  assert.equal(rec.headers['x-webhook-id'], payload.id);
  assert.ok(!rec.body.includes('Synthetic hello'), 'the message text is never in the clear');
  assert.equal(decrypt(payload.jwe, KEY).message.text, 'Synthetic hello');
  assert.throws(() => decrypt(payload.jwe, WRONG_KEY), 'the wrong key cannot decrypt it');
  assert.equal(hooks.stats.delivered, 1);
  assert.ok(!lines.some((l) => l.event === 'log.undeclared'));
});

test('while a secret rotates, the header carries a v1 for each, so a receiver on either one verifies', async (t) => {
  const r = await receiver();
  t.after(() => r.close());
  const hooks = createWebhooks({ endpoints: [endpoint(r.url, { secrets: [OTHER_SECRET, SECRET] })], retryDelaysMs: [], sleep });
  hooks.enqueue('message.new', { message: { id: 'm1' } });
  await hooks.drain();
  const rec = r.requests[0];
  assert.equal(rec.headers['x-webhook-signature'].split(',').filter((p) => p.startsWith('v1=')).length, 2);
  assert.ok(verify(rec.headers['x-webhook-signature'], rec.body, SECRET));
  assert.ok(verify(rec.headers['x-webhook-signature'], rec.body, OTHER_SECRET));
});

test('an endpoint hears each event it names, every event with *, and nothing it did not ask for', async (t) => {
  const r = await receiver();
  t.after(() => r.close());
  const names = Object.keys(apiSpec.events);
  const one = { id: 'each', url: r.url + '/each', secrets: [SECRET], keys: [KEY], events: ['chat.read', 'mac.state'] };
  const all = { id: 'all', url: r.url + '/all', secrets: [SECRET], keys: [KEY], events: ['*'] };
  const hooks = createWebhooks({ endpoints: [one, all], retryDelaysMs: [], sleep });
  for (const n of names) hooks.enqueue(n, { synthetic: n });
  await hooks.drain();
  assert.equal(r.requests.length, names.length + 2);
  assert.deepEqual(eventsOf(r).sort(), [...names, 'chat.read', 'mac.state'].sort());
  for (const q of r.requests) {
    const p = JSON.parse(q.body);
    assert.deepEqual(decrypt(p.jwe, KEY), { synthetic: p.event });
  }
});

test('a failing endpoint is retried with a backoff until it accepts', async (t) => {
  let attempts = 0;
  const r = await receiver((rec, res) => { attempts += 1; res.writeHead(attempts < 3 ? 500 : 200); res.end(); });
  t.after(() => r.close());
  const hooks = createWebhooks({ endpoints: [endpoint(r.url)], retryDelaysMs: [5, 10], sleep });
  hooks.enqueue('message.new', { message: { id: 'm1' } });
  await hooks.drain();
  assert.equal(r.requests.length, 3);
  assert.equal(hooks.stats.delivered, 1);
  assert.equal(hooks.stats.gaveUp, 0);
});

test('a refusal resending cannot change is not retried, but 408 and 429 are', async () => {
  for (const [status, tries] of [[400, 1], [401, 1], [404, 1], [408, 3], [429, 3], [503, 3]]) {
    const r = await receiver((rec, res) => { res.writeHead(status); res.end(); });
    const hooks = createWebhooks({ endpoints: [endpoint(r.url)], retryDelaysMs: [1, 1], sleep });
    hooks.enqueue('message.new', { message: { id: 'm1' } });
    await hooks.drain();
    await r.close();
    assert.equal(r.requests.length, tries, status + ' is tried ' + tries + ' time(s)');
    assert.equal(hooks.stats.gaveUp, 1);
  }
});

test('an endpoint that never accepts is given up on after the last retry', async (t) => {
  const r = await receiver((rec, res) => { res.writeHead(503); res.end(); });
  t.after(() => r.close());
  const lines = [];
  const hooks = createWebhooks({ endpoints: [endpoint(r.url, { id: 'dead' })], log: strictLog(lines), retryDelaysMs: [1, 1], sleep });
  hooks.enqueue('message.new', { message: { id: 'm1' } });
  await hooks.drain();
  assert.equal(r.requests.length, 3, 'one try and two retries');
  assert.equal(hooks.stats.gaveUp, 1);
  assert.ok(lines.some((l) => l.event === 'webhook.gaveup'));
});

test('an unreachable endpoint never holds its caller, and the next event still goes out', async () => {
  const hooks = createWebhooks({ endpoints: [endpoint('http://127.0.0.1:1/hook', { id: 'dead' })], retryDelaysMs: [1], sleep });
  const t0 = Date.now();
  hooks.enqueue('message.new', { message: { id: 'a' } });
  hooks.enqueue('message.new', { message: { id: 'b' } });
  assert.ok(Date.now() - t0 < 50, 'queueing does not wait on the network');
  await hooks.drain();
  assert.equal(hooks.stats.queued, 2);
  assert.equal(hooks.stats.gaveUp, 2);
});

test('an endpoint is switched off after ' + DISABLE_AFTER_GIVEUPS + ' give-ups in a row, and a delivery resets the count', async (t) => {
  let fail = true;
  const r = await receiver((rec, res) => { res.writeHead(fail ? 503 : 204); res.end(); });
  t.after(() => r.close());
  const lines = [];
  const off = [];
  const hooks = createWebhooks({ endpoints: [endpoint(r.url)], log: strictLog(lines), retryDelaysMs: [], sleep, onDisable: (id, info) => off.push({ id, ...info }) });
  for (let i = 0; i < DISABLE_AFTER_GIVEUPS - 1; i++) hooks.enqueue('message.new', { n: i });
  await hooks.drain();
  fail = false;
  hooks.enqueue('message.new', { n: 'ok' });
  await hooks.drain();
  fail = true;
  for (let i = 0; i < DISABLE_AFTER_GIVEUPS - 1; i++) hooks.enqueue('message.new', { n: i });
  await hooks.drain();
  assert.equal(off.length, 0, 'a delivery in between resets the count');
  hooks.enqueue('message.new', { n: 'last' });
  await hooks.drain();
  assert.equal(off.length, 1);
  assert.equal(off[0].id, 'a');
  assert.equal(off[0].reason, 'give_ups');
  assert.equal(off[0].lastError, 'status 503');
  assert.equal(hooks.endpoints[0].active, false);
  const before = r.requests.length;
  hooks.enqueue('message.new', { n: 'after' });
  await hooks.drain();
  assert.equal(r.requests.length, before, 'a switched-off endpoint is not called');
  const line = lines.find((l) => l.event === 'webhook.disabled');
  assert.ok(line && line.endpoint === 'a' && line.give_ups === DISABLE_AFTER_GIVEUPS);
  assert.ok(!lines.some((l) => l.event === 'log.undeclared'));
});

test('an endpoint that has delivered nothing for a day while deliveries were attempted is switched off', async (t) => {
  const r = await receiver((rec, res) => { res.writeHead(503); res.end(); });
  t.after(() => r.close());
  let clock = Date.parse('2026-01-01T00:00:00Z');
  const off = [];
  const hooks = createWebhooks({ endpoints: [endpoint(r.url)], retryDelaysMs: [], sleep, now: () => clock, onDisable: (id, info) => off.push({ id, ...info }) });
  hooks.enqueue('message.new', { n: 1 });
  await hooks.drain();
  clock += DISABLE_AFTER_MS - 1000;
  hooks.enqueue('message.new', { n: 2 });
  await hooks.drain();
  assert.equal(off.length, 0, 'not yet a day');
  clock += 2000;
  hooks.enqueue('message.new', { n: 3 });
  await hooks.drain();
  assert.equal(off.length, 1);
  assert.equal(off[0].reason, 'no_delivery');
});

test('config refuses an unknown event, plain http off loopback, plaintext off loopback and a missing key', () => {
  const ok = { id: 'a', url: 'https://hooks.example.test/in', secrets: [SECRET], keys: [KEY] };
  const cfg = (e) => () => normalizeConfig({ webhooks: { endpoints: [e] } });
  assert.doesNotThrow(cfg(ok));
  assert.doesNotThrow(cfg({ ...ok, events: ['*'] }));
  assert.doesNotThrow(cfg({ ...ok, url: 'http://127.0.0.1:9/in', encrypt: false, keys: undefined }));
  assert.throws(cfg({ ...ok, events: ['message.nwe'] }), /message\.nwe, which is not an event/);
  assert.throws(cfg({ ...ok, url: 'http://hooks.example.test/in' }), /must be https unless it is loopback/);
  assert.throws(cfg({ ...ok, encrypt: false }), /encrypt can be off only for a loopback url/);
  assert.throws(cfg({ ...ok, keys: undefined }), /keys must be/);
  assert.throws(cfg({ ...ok, keys: [{ kid: 'k', key: 'short' }] }), /keys must be/);
  assert.throws(cfg({ ...ok, secrets: [SECRET, SECRET, SECRET] }), /secrets must be/);
  assert.throws(() => normalizeConfig({ webhooks: { endpoints: [ok, ok] } }), /used twice/);
  const legacy = normalizeConfig({ webhooks: { endpoints: [{ id: 'a', url: 'https://hooks.example.test/in', secret: SECRET, keys: [KEY] }] } });
  assert.deepEqual(legacy.webhooks.endpoints[0].secrets, [SECRET], 'a 2d endpoint secret is read as the current one');
  assert.ok(isLoopback('http://localhost:1/x') && isLoopback('http://[::1]:1/x') && !isLoopback('https://hooks.example.test/'));
});

test('the server hooks every event it publishes, messages and actions alike, and nothing private is in the clear', async (t) => {
  const r = await receiver();
  t.after(() => r.close());
  const srv = await boot({ webhooks: { endpoints: [endpoint(r.url, { events: ['*'] })] } });
  t.after(() => srv.close());

  srv.world.incoming(1, 'Synthetic webhook message', '+15550100999');
  await waitFor(() => eventsOf(r).includes('message.new'));
  assert.equal((await srv.post('/api/v1/chats/1/read', srv.tokens.device, {})).status, 200);
  await waitFor(() => eventsOf(r).includes('chat.read'));
  assert.equal((await srv.put('/api/v1/settings', srv.tokens.device, { values: { 'appearance.skin': 'dark' } })).status, 200);
  await waitFor(() => eventsOf(r).includes('settings.changed'));
  srv.srv.publish('mac.state', { name: 'mac.awake', on: true });
  await waitFor(() => eventsOf(r).includes('mac.state'));

  const all = r.requests.map((q) => q.body).join('\n');
  for (const secret of ['Synthetic webhook message', '+15550100999', 'appearance.skin']) assert.ok(!all.includes(secret), secret + ' reached a hook body in the clear');
  const msg = r.requests.find((q) => JSON.parse(q.body).event === 'message.new');
  assert.ok(verify(msg.headers['x-webhook-signature'], msg.body, SECRET));
  assert.equal(decrypt(JSON.parse(msg.body).jwe, KEY).message.text, 'Synthetic webhook message');
  const logged = JSON.stringify(srv.lines);
  for (const secret of [SECRET, KEY.key, 'Synthetic webhook message']) assert.ok(!logged.includes(secret), 'a secret, key or message text reached the log');
  assert.ok(!srv.lines.some((l) => l.event === 'log.undeclared'), 'every event is declared');
});

test('the server switches a failing endpoint off in its config file, and doctor names it with why', async (t) => {
  const r = await receiver((rec, res) => { res.writeHead(410); res.end(); });
  t.after(() => r.close());
  const srv = await boot({ webhooks: { endpoints: [endpoint(r.url)] }, webhookOptions: { retryDelaysMs: [], disableAfterGiveUps: 2 } });
  t.after(() => srv.close());
  saveConfig(srv.dir, srv.config);

  srv.world.incoming(1, 'Synthetic one');
  srv.world.incoming(1, 'Synthetic two');
  await waitFor(() => srv.lines.some((l) => l.event === 'webhook.disabled'));
  const saved = loadConfig(srv.dir).webhooks.endpoints[0];
  assert.equal(saved.active, false);
  assert.equal(saved.disabledReason, 'give_ups');
  assert.equal(saved.lastError, 'status 410');

  // A transport that answers doctor's one status request, so it runs without an engine.
  const listeners = new Set();
  const transport = {
    onLine: (cb) => listeners.add(cb),
    onExit: () => {},
    write: (s) => { const { id } = JSON.parse(s); setImmediate(() => { for (const cb of listeners) cb(JSON.stringify({ jsonrpc: '2.0', id, result: { database: { ready: true } } })); }); },
    close: async () => {},
  };
  const d = await runDoctor({ config: loadConfig(srv.dir), store: srv.store, makeTransport: () => transport, dataDir: srv.dir, attachmentsRoot: srv.root, platform: 'linux' });
  assert.ok(d.lines.some((l) => /^warn +hook a is switched off \(too many deliveries in a row were given up on, at .*, last error status 410\): fix its receiver, then run hooks enable a$/.test(l)), d.lines.join('\n'));
});

test('a reload takes a new endpoint list without a restart', async (t) => {
  const r = await receiver();
  t.after(() => r.close());
  const srv = await boot();
  t.after(() => srv.close());
  srv.srv.reloadHooks(normalizeConfig({ webhooks: { endpoints: [endpoint(r.url)] } }));
  srv.world.incoming(1, 'Synthetic after reload');
  await waitFor(() => r.requests.length === 1);
  assert.ok(srv.lines.some((l) => l.event === 'webhook.reloaded' && l.endpoints === 1 && l.active === 1));
});

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/main.js');
const run = (dir, ...args) => execFileSync(process.execPath, [cli, ...args, '--data', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const runFails = (dir, ...args) => {
  try {
    run(dir, ...args);
  } catch (e) {
    return String(e.stderr);
  }
  throw new Error('expected ' + args.join(' ') + ' to fail');
};

test('hooks add, list, rotate, retire, disable, enable and remove work from the command line, and list never prints a secret', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'srv-hooks-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir, 'init', '--engine', 'fake', '--port', '0');
  const added = run(dir, 'hooks', 'add', 'tool', 'https://hooks.example.test/in', '--events', 'message.new,chat.read');
  const secret = /^secret (\S+)$/m.exec(added)[1];
  const [, kid, key] = /^key {4}(\S+) (\S+)$/m.exec(added);
  const cfg = () => JSON.parse(readFileSync(path.join(dir, 'config.json'), 'utf8')).webhooks.endpoints;
  assert.deepEqual(cfg()[0].secrets, [secret]);
  assert.deepEqual(cfg()[0].keys, [{ kid, key }]);
  assert.deepEqual(cfg()[0].events, ['message.new', 'chat.read']);
  const listed = run(dir, 'hooks', 'list');
  assert.match(listed, /^tool {2}active {2}https:\/\/hooks\.example\.test\/in {2}events message\.new,chat\.read {2}encrypted/m);
  assert.ok(!listed.includes(secret) && !listed.includes(key), 'hooks list never prints a secret or key');

  const rotated = run(dir, 'hooks', 'rotate', 'tool');
  const secret2 = /^secret (\S+)$/m.exec(rotated)[1];
  assert.deepEqual(cfg()[0].secrets, [secret2, secret]);
  assert.equal(cfg()[0].keys.length, 2);
  assert.equal(cfg()[0].keys[1].key, key);
  run(dir, 'hooks', 'rotate', 'tool', '--retire');
  assert.deepEqual(cfg()[0].secrets, [secret2]);
  assert.equal(cfg()[0].keys.length, 1);

  run(dir, 'hooks', 'disable', 'tool');
  assert.equal(cfg()[0].active, false);
  assert.match(run(dir, 'hooks', 'list'), /tool {2}disabled \(by hand/);
  run(dir, 'hooks', 'enable', 'tool');
  assert.equal(cfg()[0].active, true);
  assert.equal(cfg()[0].disabledReason, undefined);

  assert.match(runFails(dir, 'hooks', 'add', 'x', 'https://hooks.example.test/in', '--events', 'nope'), /nope, which is not an event/);
  assert.match(runFails(dir, 'hooks', 'add', 'x', 'http://hooks.example.test/in'), /must be https unless it is loopback/);
  assert.match(runFails(dir, 'hooks', 'add', 'x', 'https://hooks.example.test/in', '--plaintext'), /loopback url only/);
  assert.match(runFails(dir, 'hooks', 'add', 'tool', 'https://hooks.example.test/in'), /already exists/);
  assert.equal(cfg().length, 1, 'a refused add writes nothing');
  assert.match(run(dir, 'hooks', 'add', 'local', 'http://127.0.0.1:9/in', '--plaintext'), /^secret /m);
  assert.equal(cfg()[1].encrypt, false);

  run(dir, 'hooks', 'remove', 'tool');
  run(dir, 'hooks', 'remove', 'local');
  assert.deepEqual(cfg(), []);
  assert.match(runFails(dir, 'hooks', 'remove', 'tool'), /no hook tool/);
});

test('a running server reads a hooks change on SIGHUP, without a restart', { skip: process.platform === 'win32' }, async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'srv-hup-'));
  run(dir, 'init', '--engine', 'fake', '--port', '0');
  const child = spawn(process.execPath, [cli, 'run', '--data', dir], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LOG_LEVEL: 'notice' } });
  t.after(() => { child.kill('SIGTERM'); rmSync(dir, { recursive: true, force: true }); });
  let out = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.on('data', (c) => { out += c; });
  const lines = () => out.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
  await waitFor(() => lines().some((l) => l.event === 'server.ready'), 15000);
  const pid = lines().find((l) => l.event === 'server.ready').pid;
  run(dir, 'hooks', 'add', 'tool', 'https://hooks.example.test/in', '--events', '*');
  child.kill('SIGHUP');
  await waitFor(() => lines().some((l) => l.event === 'webhook.reloaded'), 10000);
  const reloaded = lines().find((l) => l.event === 'webhook.reloaded');
  assert.equal(reloaded.endpoints, 1);
  assert.equal(reloaded.active, 1);
  assert.equal(reloaded.pid, pid, 'the same run took the change');
  assert.equal(child.exitCode, null, 'the server is still running');
  await sleep(0);
});

test('a test delivery goes to the one hook it names, never through a publish, and is signed and encrypted like a live one', async (t) => {
  const r = await receiver();
  t.after(() => r.close());
  const lines = [];
  const named = endpoint(r.url + '/named', { id: 'named', events: ['message.new'] });
  const other = endpoint(r.url + '/other', { id: 'other', events: ['*'] });
  const hooks = createWebhooks({ endpoints: [named, other], log: strictLog(lines), retryDelaysMs: [], sleep });
  hooks.enqueue(TEST_EVENT, { hook: 'other' });
  await hooks.drain();
  assert.equal(r.requests.length, 0, 'a publish never sends the test event, not even to *');
  const out = await hooks.test('named');
  assert.deepEqual(out, { ok: true, attempts: 1, status: 204, error: null });
  assert.equal(r.requests.length, 1);
  const rec = r.requests[0];
  assert.ok(verify(rec.headers['x-webhook-signature'], rec.body, SECRET));
  assert.equal(rec.headers['x-webhook-event'], TEST_EVENT);
  const payload = JSON.parse(rec.body);
  assert.deepEqual(Object.keys(payload).sort(), ['event', 'id', 'jwe', 'sentAt']);
  assert.deepEqual(decrypt(payload.jwe, KEY), { hook: 'named', test: true });
  assert.ok(lines.some((l) => l.event === 'webhook.delivered' && l.endpoint === 'named' && l.trigger === TEST_EVENT));
  await assert.rejects(hooks.test('nope'), /no hook nope/);
  hooks.endpoints[0].active = false;
  await assert.rejects(hooks.test('named'), /switched off/);
});

test('every event has a placeholder shape that validates against its declared model', () => {
  for (const name of eventNames()) {
    const data = sampleData(name);
    assert.deepEqual(validate(data, apiSpec.events[name], apiSpec.models), [], name);
  }
  assert.throws(() => sampleData('message.nwe'), /not an event/);
});

// The receiver docs/server.md shows, taken from the page itself, so the test proves the code a reader copies.
async function docsReceiver(dir) {
  const md = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../docs/server.md'), 'utf8');
  const block = /`{3}js\n(import \{ createDecipheriv[\s\S]*?export function open[\s\S]*?)`{3}/.exec(md);
  assert.ok(block, 'docs/server.md shows a receiver');
  const file = path.join(dir, 'receiver.mjs');
  writeFileSync(file, block[1]);
  return (await import(pathToFileURL(file).href)).open;
}

const runAsync = (dir, ...args) => new Promise((resolve) => {
  execFile(process.execPath, [cli, ...args, '--data', dir], { encoding: 'utf8' }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
});

test('hooks test sends one delivery a receiver built from the documented code verifies and decrypts, and a refusal exits non-zero', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'srv-hooktest-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const open = await docsReceiver(dir);
  let creds = null;
  const opened = [];
  const r = await receiver((rec, res) => {
    try {
      opened.push({ ...open(rec.headers, rec.body, creds), shape: JSON.parse(rec.body).shape });
      res.writeHead(204);
    } catch {
      res.writeHead(401);
    }
    res.end();
  });
  t.after(() => r.close());
  run(dir, 'init', '--engine', 'fake', '--port', '0');
  const added = run(dir, 'hooks', 'add', 'tool', r.url);
  const secret = /^secret (\S+)$/m.exec(added)[1];
  const [, kid, key] = /^key {4}(\S+) (\S+)$/m.exec(added);
  creds = { secret, keys: { [kid]: key } };

  const ok = await runAsync(dir, 'hooks', 'test', 'tool');
  assert.equal(ok.code, 0, ok.stderr);
  assert.match(ok.stdout, /^hook tool accepted the test delivery: status 204 after 1 attempt$/m);
  assert.equal(r.requests.length, 1, 'one delivery');
  assert.equal(opened.length, 1, 'the documented receiver verified the signature and decrypted the payload');
  assert.equal(opened[0].event, TEST_EVENT);
  assert.deepEqual(opened[0].data, { hook: 'tool', test: true });

  const shaped = await runAsync(dir, 'hooks', 'test', 'tool', '--event', 'message.new');
  assert.equal(shaped.code, 0, shaped.stderr);
  assert.equal(opened[1].event, TEST_EVENT, 'a shaped test is still a test event');
  assert.equal(opened[1].shape, 'message.new');
  assert.deepEqual(validate(opened[1].data, apiSpec.events['message.new'], apiSpec.models), []);

  creds = { secret: 'not-the-secret', keys: { [kid]: key } };
  const refused = await runAsync(dir, 'hooks', 'test', 'tool');
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /^hook tool did not accept the test delivery: status 401 after 1 attempt$/m);
  assert.equal(opened.length, 2, 'the wrong secret does not verify');

  const unknown = await runAsync(dir, 'hooks', 'test', 'tool', '--event', 'message.nwe');
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /--event takes one of message\.new/);
  const missing = await runAsync(dir, 'hooks', 'test', 'nope');
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /no hook nope/);
  run(dir, 'hooks', 'disable', 'tool');
  const off = await runAsync(dir, 'hooks', 'test', 'tool');
  assert.equal(off.code, 1);
  assert.match(off.stderr, /hook tool is switched off \(by hand\): run hooks enable tool first/);
  assert.equal(r.requests.length, 3, 'nothing is sent for an unknown event, a missing hook or a switched-off one');
  for (const out of [ok, shaped, refused]) assert.ok(!(out.stdout + out.stderr).includes(secret) && !(out.stdout + out.stderr).includes(key), 'hooks test never prints a secret or key');
});
