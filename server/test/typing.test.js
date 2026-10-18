import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTyping } from '../src/typing.js';
import { normalizeConfig } from '../src/config.js';
import { boot, openSocket, waitFor } from './helpers.js';

const typed = (frames) => frames.filter((f) => f.type === 'event' && f.name === 'typing');

test('a typing state expires on its own and announces a stop', async () => {
  const seen = [];
  const typing = createTyping({ publish: (name, data, except) => seen.push({ name, data, except }), ttlMs: 30 });
  typing.relay({ chatId: '1', from: 'device-a', typing: true });
  assert.deepEqual(seen.map((s) => s.data.typing), [true]);
  assert.equal(seen[0].except, 'device-a', 'the device that sent it is left out of its own start');
  await waitFor(() => seen.length === 2);
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

// Our typing reaches the other person (issue 319): the server hands it to the engine once per conversation and takes
// it down when the last of our devices stops, and it never asks an engine that cannot.
test('outbound typing is told once per conversation, refreshed while it lasts, and taken down by the last device', () => {
  let clock = 0;
  const told = [];
  const typing = createTyping({ publish: () => {}, outbound: (chatId, on) => told.push([chatId, on]), refreshMs: 1000, now: () => clock, ttlMs: 60000 });
  typing.relay({ chatId: '1', from: 'a', typing: true });
  typing.relay({ chatId: '1', from: 'a', typing: true });
  typing.relay({ chatId: '1', from: 'b', typing: true });
  assert.deepEqual(told, [['1', true]], 'one start for the conversation, however many devices and relays');
  clock = 1500;
  typing.relay({ chatId: '1', from: 'a', typing: true });
  assert.deepEqual(told.at(-1), ['1', true], 'refreshed once the refresh interval passes');
  assert.equal(told.length, 2);
  typing.relay({ chatId: '1', from: 'a', typing: false });
  assert.equal(told.length, 2, 'another device is still typing there, so nothing is taken down');
  typing.stopFrom('b');
  assert.deepEqual(told.at(-1), ['1', false], 'the last device leaving takes it down');
  typing.relay({ chatId: '2', from: 'a', typing: false });
  assert.equal(told.length, 3, 'a stop for a conversation never started tells nothing');
  typing.stopAll();
});

test('outbound typing taken down when a device goes quiet, and an engine refusal is harmless', async () => {
  const told = [];
  const typing = createTyping({ publish: () => {}, outbound: (chatId, on) => { told.push([chatId, on]); return Promise.reject(new Error('refused')); }, ttlMs: 30 });
  typing.relay({ chatId: '3', from: 'a', typing: true });
  await waitFor(() => told.length === 2);
  assert.deepEqual(told, [['3', true], ['3', false]], 'the expiry takes it down');
});

test('a device typing shows on the other person side through the engine, and stopping takes it down', async () => {
  const b = await boot();
  try {
    assert.equal((await b.post('/api/v1/chats/1/typing', b.tokens.device, { typing: true })).status, 200);
    await waitFor(() => b.world.typings.length === 1);
    assert.deepEqual(b.world.typings[0], { chatId: 1, typing: true });
    assert.equal((await b.post('/api/v1/chats/1/typing', b.tokens.device, { typing: false })).status, 200);
    await waitFor(() => b.world.typings.length === 2);
    assert.deepEqual(b.world.typings[1], { chatId: 1, typing: false });
  } finally { await b.close(); }
});

test('outbound typing stays home with the switch off, or where the engine cannot show it', async () => {
  const off = await boot({ typingOutgoing: false });
  try {
    assert.equal((await off.post('/api/v1/chats/1/typing', off.tokens.device, { typing: true })).status, 200);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(off.world.typings.length, 0, 'the switch off');
  } finally { await off.close(); }
  assert.ok(normalizeConfig({}).typing.outgoing, 'on by default');
});

// Observability (Abi, 2026-10-14): each typing hand-off is logged with its outcome, so either direction can be checked
// from the server's log rather than only from someone's screen.
test('the other person typing and our typing sent to them are each logged with what happened', async () => {
  const lines = [];
  const log = { emit: (event, fields) => lines.push({ event, ...fields }) };
  let refuse = false;
  const typing = createTyping({ publish: () => {}, log, outbound: async () => { if (refuse) throw new Error('engine refused'); } });
  typing.incoming({ chatId: '7', typing: true });
  typing.relay({ chatId: '7', from: 'device-a', typing: true });
  refuse = true;
  typing.relay({ chatId: '8', from: 'device-a', typing: true });
  await new Promise((r) => setTimeout(r, 10));
  typing.stopAll();
  assert.deepEqual(lines.find((l) => l.event === 'typing.incoming'), { event: 'typing.incoming', chat: '7', typing: true, resolved: true, published: true });
  const out = lines.filter((l) => l.event === 'typing.outgoing');
  assert.deepEqual(out.find((l) => l.chat === '7'), { event: 'typing.outgoing', chat: '7', typing: true, ok: true });
  assert.deepEqual(out.find((l) => l.chat === '8'), { event: 'typing.outgoing', chat: '8', typing: true, ok: false, error: 'engine refused' });
});
