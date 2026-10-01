import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLogger } from '../../core/kit/log.js';
import { logSpec } from '../src/paths.js';
import { normalizeConfig } from '../src/config.js';
import { syslogFrame, createSyslogShip, createLogSink } from '../src/syslog.js';
import { waitFor } from './helpers.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const scratch = () => mkdtempSync(path.join(os.tmpdir(), 'srv-syslog-'));

// An off the shelf collector: a plain TCP listener that keeps every octet it is sent.
function collector() {
  const parts = [];
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('data', (c) => parts.push(c.toString('utf8')));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    parts,
    text: () => parts.join(''),
    port: server.address().port,
    close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(r); }),
  })));
}

test('a log line becomes one RFC 5424 message framed with its octet count', () => {
  const line = { ts: '2026-09-30T23:46:30.000Z', level: 'notice', event: 'server.ready', msg: 'server ready', app: 'test', component: 'main', run: 'abcd1234', pid: 42, port: 7447, host: '127.0.0.1' };
  const frame = syslogFrame(line, { hostname: 'mac.example', app: 'test-server' });
  const m = /^(\d+) (<\d+>1 .*)$/.exec(frame);
  assert.ok(m, 'the frame is an octet count, a space, then the syslog message');
  assert.equal(Number(m[1]), Buffer.byteLength(m[2], 'utf8'), 'the count is the octet length of the syslog message');
  // local0 (16) times 8, plus notice (5), is 133.
  assert.ok(m[2].startsWith('<133>1 2026-09-30T23:46:30.000Z mac.example test-server 42 server.ready - '), m[2]);
  assert.equal(JSON.parse(m[2].slice(m[2].indexOf('{'))).event, 'server.ready', 'the message carries the JSON line');
});

test('an approved line reaches the collector, and an undeclared event never does', async (t) => {
  const c = await collector();
  t.after(() => c.close());
  const d = scratch();
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const lines = [];
  const sink = createLogSink({
    spec: logSpec,
    app: 'test-server',
    syslog: { host: '127.0.0.1', port: c.port },
    spillPath: path.join(d, 'log-spill.jsonl'),
    hostname: 'mac.example',
    write: (l) => lines.push(l),
  });
  t.after(() => sink.close());
  const logger = createLogger({ spec: logSpec, app: 'test', run: 'test', sink, now: Date.now, level: 'debug', strict: true });

  logger.emit('server.ready', { port: 7447, host: '127.0.0.1' });
  await waitFor(() => c.text().includes('"event":"server.ready"'));
  assert.match(c.text(), /^\d+ <\d+>1 /, 'the collector gets the octet count and the syslog message, not the bare JSON');
  assert.equal(JSON.parse(c.text().slice(c.text().indexOf('{'))).port, 7447);

  // An undeclared event is refused by the strict logger, and the sink refuses it too if one is handed to it directly.
  const before = c.text();
  assert.throws(() => logger.emit('nope.event'), /undeclared log event/);
  assert.equal(sink.ship.send({ ts: new Date().toISOString(), level: 'notice', event: 'nope.event', msg: 'x' }), false);
  await sleep(50);
  assert.equal(c.text(), before, 'nothing undeclared reached the collector');
  assert.equal(sink.ship.stats.refused, 1);
});

test('a line the collector will not take is kept in a spill file and said out loud', async (t) => {
  const d = scratch();
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const spillPath = path.join(d, 'log-spill.jsonl');
  const lines = [];
  const sink = createLogSink({
    spec: logSpec,
    app: 'test-server',
    syslog: { host: '127.0.0.1', port: 1 },
    spillPath,
    hostname: 'mac.example',
    log: { emit: (event, fields) => lines.push({ event, ...fields }) },
    write: (l) => lines.push(l),
  });
  t.after(() => sink.close());
  const logger = createLogger({ spec: logSpec, app: 'test', run: 'test', sink, now: Date.now, level: 'debug', strict: true });

  logger.emit('server.ready', { port: 7447, host: '127.0.0.1' });
  await waitFor(() => existsSync(spillPath) && readFileSync(spillPath, 'utf8').includes('"event":"server.ready"'));
  const kept = readFileSync(spillPath, 'utf8').trim().split('\n').map((s) => JSON.parse(s));
  assert.equal(kept.length, 1, 'the line is kept, once');
  assert.equal(kept[0].event, 'server.ready');
  assert.ok(lines.some((l) => l.event === 'log.spilled' && l.count === 1), 'the failure is said out loud');
});

test('the sink never ships its own spill notice, so a failing collector cannot loop', async (t) => {
  const c = await collector();
  t.after(() => c.close());
  const ship = createSyslogShip({ host: '127.0.0.1', port: c.port, spec: logSpec, app: 'test' });
  t.after(() => ship.close());
  const sent = ship.send({ ts: '2026-09-30T00:00:00.000Z', level: 'warn', event: 'log.spilled', msg: 'x', host: 'h', port: 1, count: 2 });
  assert.equal(sent, false);
  await sleep(50);
  assert.equal(c.text(), '');
});

test('the collector address is configuration, refused when half written', () => {
  assert.equal(normalizeConfig({}).log.syslog, null);
  assert.deepEqual(normalizeConfig({ log: { syslog: { host: 'log.internal', port: 514 } } }).log.syslog, { host: 'log.internal', port: 514 });
  assert.throws(() => normalizeConfig({ log: { syslog: { host: 'log.internal' } } }), /log\.syslog\.port/);
  assert.throws(() => normalizeConfig({ log: { syslog: { port: 514 } } }), /log\.syslog\.host/);
  assert.throws(() => normalizeConfig({ log: { syslog: { host: '', port: 514 } } }), /log\.syslog\.host/);
  assert.throws(() => normalizeConfig({ log: { syslog: { host: 'log.internal', port: 0 } } }), /log\.syslog\.port/);
});
