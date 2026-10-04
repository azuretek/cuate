import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTyping } from '../src/typing.js';
import { boot, openSocket, waitFor } from './helpers.js';

const typed = (frames) => frames.filter((f) => f.type === 'event' && f.name === 'typing');

test('a typing state expires on its own and announces a stop', async () => {
  const seen = [];
  const typing = createTyping({ publish: (name, data, except) => seen.push({ name, data, except }), ttlMs: 30 });
  typing.relay({ chatId: '1', from: 'device-a', typing: true });
  assert.deepEqual(seen.map((s) => s.data.typing), [true]);
  assert.equal(seen[0].except, 'device-a', 'the device that sent it is left out of its own start');
  await new Promise((r) => setTimeout(r, 70));
  assert.deepEqual(seen.map((s) => s.data.typing), [true, false], 'the stale state ends itself');
  assert.equal(typing.size(), 0);
});

test('a stop and a device leaving both end its typing, per conversation', () => {
  const seen = [];
  const typing = createTyping({ publish: (name, data) => seen.push(data) });
  typing.relay({ chatId: '1', from: 'device-a', typing: true });
  typing.relay({ chatId: '2', from: 'device-a', typing: true });
  typing.relay({ chatId: '1', from: 'device-a', typing: false });
  typing.stopFrom('device-a');
  assert.deepEqual(seen.filter((d) => d.typing === false).map((d) => d.chatId), ['1', '2']);
  assert.equal(typing.size(), 0);
});

test('a device typing reaches the account other device, never the one that sent it', async () => {
  const b = await boot();
  try {
    const second = b.store.createToken('device', 'second device').token;
    const one = await openSocket(b.base);
    const two = await openSocket(b.base);
    one.ws.send(JSON.stringify({ type: 'auth', token: b.tokens.device }));
    two.ws.send(JSON.stringify({ type: 'auth', token: second }));
    await waitFor(() => one.frames.some((f) => f.type === 'hello') && two.frames.some((f) => f.type === 'hello'));
    const res = await b.post('/api/v1/chats/1/typing', b.tokens.device, { typing: true });
    assert.equal(res.status, 200);
    await waitFor(() => typed(two.frames).length === 1);
    assert.equal(typed(one.frames).length, 0, 'the device that sent it hears nothing');
    const d = typed(two.frames)[0].data;
    assert.equal(d.chatId, '1');
    assert.equal(d.kind, 'device');
    assert.equal(d.typing, true);
    assert.equal(typeof d.from, 'string');
    one.ws.close();
    two.ws.close();
  } finally { await b.close(); }
});

test('typing never becomes a message', async () => {
  const b = await boot();
  try {
    const before = await (await b.get('/api/v1/chats/1/messages', b.tokens.device)).json();
    const res = await b.post('/api/v1/chats/1/typing', b.tokens.device, { typing: true });
    assert.equal(res.status, 200);
    const after = await (await b.get('/api/v1/chats/1/messages', b.tokens.device)).json();
    assert.equal(after.messages.length, before.messages.length);
  } finally { await b.close(); }
});

test('only a sending device may report typing, and it must say true or false', async () => {
  const b = await boot();
  try {
    assert.equal((await b.post('/api/v1/chats/1/typing', b.tokens.tooling, { typing: true })).status, 403);
    assert.equal((await b.post('/api/v1/chats/1/typing', b.tokens.device, { typing: 'yes' })).status, 400);
    assert.equal((await b.post('/api/v1/chats/1/typing', b.tokens.device, { typing: true, chat: '2' })).status, 400);
  } finally { await b.close(); }
});

test('inbound typing is off by default, so no contact indicator is invented', async () => {
  const b = await boot();
  try {
    const one = await openSocket(b.base);
    one.ws.send(JSON.stringify({ type: 'auth', token: b.tokens.device }));
    await waitFor(() => one.frames.some((f) => f.type === 'hello'));
    b.world.incomingTyping(1, true);
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(typed(one.frames).length, 0);
    one.ws.close();
  } finally { await b.close(); }
});

test('with the switch on, a bridge typing event is relayed as the contact typing', async () => {
  const b = await boot({ typingIncoming: true });
  try {
    const one = await openSocket(b.base);
    one.ws.send(JSON.stringify({ type: 'auth', token: b.tokens.device }));
    await waitFor(() => one.frames.some((f) => f.type === 'hello'));
    b.world.incomingTyping(1, true);
    await waitFor(() => typed(one.frames).length === 1);
    assert.deepEqual(typed(one.frames)[0].data, { chatId: '1', from: 'contact', kind: 'contact', typing: true });
    b.world.incomingTyping(1, false);
    await waitFor(() => typed(one.frames).length === 2);
    assert.equal(typed(one.frames)[1].data.typing, false);
    one.ws.close();
  } finally { await b.close(); }
});
