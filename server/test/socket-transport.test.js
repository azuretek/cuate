import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { socketTransport } from '../src/engine/socket.js';
import { createRpc } from '../src/engine/rpc.js';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'rpc-'));
  const path = process.platform === 'win32' ? String.raw`\\.\pipe\rpc-` + process.pid + '-' + Date.now() : join(dir, 'h.sock');
  const peers = new Set();
  const server = createServer((peer) => { peers.add(peer); peer.on('close', () => peers.delete(peer)); });
  server.listen(path);
  await once(server, 'listening');
  t.after(async () => {
    for (const peer of peers) peer.destroy();
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  return { path, server };
}

test('socket transport carries RPC, fragmented lines and notifications without a child', async (t) => {
  const { path, server } = await fixture(t);
  const connected = once(server, 'connection');
  const transport = socketTransport({ path });
  t.after(() => transport.close());
  const rpc = createRpc({ transport, timeoutMs: 1000 });
  const notices = [];
  rpc.onNotification((method, params) => notices.push({ method, params }));
  const answer = rpc.request('helper.hello', { token: 'synthetic' });
  const [peer] = await connected;
  const [data] = await once(peer, 'data');
  const request = JSON.parse(data.toString());
  assert.equal(request.method, 'helper.hello');
  assert.equal(request.params.token, 'synthetic');
  assert.equal(data.toString().endsWith('\n'), true);
  const reply = JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocol: 1 } });
  peer.write(reply.slice(0, 10));
  peer.write(reply.slice(10) + '\n' + JSON.stringify({ jsonrpc: '2.0', method: 'db.changed', params: { revision: 2 } }) + '\n');
  assert.deepEqual(await answer, { protocol: 1 });
  assert.deepEqual(notices, [{ method: 'db.changed', params: { revision: 2 } }]);
});

test('a disconnected helper rejects in-flight requests and close is repeatable', async (t) => {
  const { path, server } = await fixture(t);
  const connected = once(server, 'connection');
  const transport = socketTransport({ path });
  const rpc = createRpc({ transport, timeoutMs: 1000 });
  const rejected = assert.rejects(rpc.request('status'), { code: 'engine_exit' });
  const [peer] = await connected;
  peer.destroy();
  await rejected;
  await transport.close();
  await transport.close();
});

test('a connection failure is one exit and reaches subscribers registered after exit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rpc-missing-'));
  try {
    const transport = socketTransport({ path: join(dir, 'missing.sock') });
    const exits = [];
    await new Promise((resolve) => transport.onExit((info) => { exits.push(info); resolve(); }));
    assert.equal(exits.length, 1);
    assert.equal(exits[0].error, 'ENOENT');
    let late;
    transport.onExit((info) => { late = info; });
    assert.equal(late.error, 'ENOENT');
    await transport.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
