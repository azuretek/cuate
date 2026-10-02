import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { boot, waitFor, openSocket } from './helpers.js';
import { apiSpec, naming } from '../src/paths.js';
import { validate } from '../../core/kit/rules/schema.js';
import { createApiClient } from '../../core/kit/api.js';

const conforms = (v, type) => assert.deepEqual(validate(v, type, apiSpec.models), []);
const route = (s) => '/api/v1/chats/' + s + '/messages';
let s;
before(async () => { s = await boot(); });
after(async () => { await s.close(); });

test('the server listens on loopback only', () => {
  assert.equal(s.srv.address, '127.0.0.1');
});

test('a first socket reloads a snapshot when an event arrived before authentication', async (t) => {
  const server = await boot();
  t.after(() => server.close());
  let messages;
  const states = [];
  let refreshed;
  const client = createApiClient({ baseUrl: server.base, token: server.tokens.device, onState: (state) => states.push(state), onEvent: (event) => {
    if (event.name === 'resync') refreshed = client.messages('1').then((result) => { messages = result.messages; });
  } });
  t.after(() => client.close());
  messages = (await client.messages('1')).messages;
  const before = messages.length;
  const delivered = new Promise((resolve) => server.engine.on((name) => { if (name === 'message.new') resolve(); }));
  server.world.incoming(1, 'Synthetic message during initial connection');
  await delivered;
  client.connect();
  await waitFor(() => states.includes('open'));
  assert.ok(refreshed, 'initial hello must request a fresh snapshot');
  await refreshed;
  assert.equal(messages.length, before + 1);
  assert.equal(messages.at(-1).text, 'Synthetic message during initial connection');
});

test('health answers without a token', async () => {
  const r = await s.get('/healthz');
  assert.equal(r.status, 200);
  conforms(await r.json(), 'Health');
});

test('every other route needs a token, and only in the Authorization header', async () => {
  for (const p of ['/api/v1/info', '/api/v1/chats', route(1)]) assert.equal((await s.get(p)).status, 401, p);
  assert.equal((await s.get('/api/v1/chats', 'tok_' + 'x'.repeat(40))).status, 401);
  const r = await fetch(s.base + '/api/v1/chats?token=' + s.tokens.device, { headers: { authorization: 'Bearer ' + s.tokens.device } });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.code, 'token_in_url');
});

test('info conforms and names the product from naming.json', async () => {
  const r = await s.get('/api/v1/info', s.tokens.tooling);
  assert.equal(r.status, 200);
  const b = await r.json();
  conforms(b, 'Info');
  assert.equal(b.product, naming.product);
  assert.equal(b.apiVersion, apiSpec.version);
  assert.equal(b.engine.ready, true);
});

test('chats list newest first, each with a preview', async () => {
  const b = await (await s.get('/api/v1/chats', s.tokens.device)).json();
  conforms(b, 'ChatList');
  assert.equal(b.chats.length, 3);
  const times = b.chats.map((c) => c.lastMessageAt);
  assert.deepEqual(times, [...times].sort().reverse());
  assert.ok(b.chats.every((c) => c.lastMessage && typeof c.lastMessage.text === 'string'));
});

// Counts every read the server makes of the engine's chat list and history.
const countReads = (engine) => {
  const n = { reads: 0 };
  for (const name of ['chats', 'messages']) {
    const real = engine[name];
    engine[name] = (...args) => {
      n.reads += 1;
      return real(...args);
    };
  }
  return n;
};

test('the chat list and its previews are held from the start, so a chat list reads nothing from the engine', async () => {
  const t = await boot();
  try {
    await t.srv.warmed;
    const n = countReads(t.engine);
    const r = await t.get('/api/v1/chats', t.tokens.device);
    assert.equal(r.status, 200);
    const { chats } = await r.json();
    assert.ok(chats.length >= 3);
    assert.ok(chats.every((c) => c.lastMessage), 'every chat carries its preview');
    assert.equal(n.reads, 0, 'the chat list read nothing from the engine');
    await t.get('/api/v1/chats?limit=500', t.tokens.device);
    assert.equal(n.reads, 1, 'asking for more chats than are held reads the list once');
  } finally {
    await t.close();
  }
});

test('a live message moves its chat to the top of the held list without a read', async () => {
  const t = await boot();
  try {
    await t.srv.warmed;
    const list = async () => (await (await t.get('/api/v1/chats', t.tokens.device)).json()).chats;
    const oldest = (await list()).at(-1);
    const n = countReads(t.engine);
    t.world.incoming(Number(oldest.id), 'Synthetic bump');
    let top = null;
    for (let i = 0; i < 100 && (!top || top.id !== oldest.id); i += 1) {
      await new Promise((r) => setTimeout(r, 20));
      top = (await list())[0];
    }
    assert.equal(top.id, oldest.id);
    assert.equal(top.lastMessage.text, 'Synthetic bump');
    assert.equal(n.reads, 0, 'nothing was read from the engine');
  } finally {
    await t.close();
  }
});

test('history pages from newest to oldest', async () => {
  const first = await (await s.get(route(1) + '?limit=3', s.tokens.device)).json();
  conforms(first, 'MessageList');
  assert.equal(first.messages.length, 3);
  assert.equal(first.hasMore, true);
  const times = first.messages.map((m) => m.sentAt);
  assert.deepEqual(times, [...times].sort());
  const older = await (await s.get(route(1) + '?limit=50&before=' + encodeURIComponent(first.messages[0].sentAt), s.tokens.device)).json();
  conforms(older, 'MessageList');
  assert.equal(older.messages.length, 3);
  assert.ok(older.messages.every((m) => m.sentAt < first.messages[0].sentAt));
  assert.equal(older.hasMore, false);
  assert.equal((await s.get(route('abc'), s.tokens.device)).status, 400);
  assert.equal((await s.get(route(1) + '?before=yesterday', s.tokens.device)).status, 400);
});

test('a tooling token cannot send', async () => {
  const r = await s.post(route(1), s.tokens.tooling, { text: 'Synthetic tool send', clientKey: 'key-tool-0001' });
  assert.equal(r.status, 403);
});

test('a send goes out once, and a repeated client key is answered without a second send', async () => {
  const count = s.world.sends.length;
  const r1 = await s.post(route(1), s.tokens.device, { text: 'Synthetic send one', clientKey: 'key-one-00001' });
  assert.equal(r1.status, 201);
  const b1 = await r1.json();
  conforms(b1, 'SendResult');
  assert.equal(b1.status, 'sent');
  assert.ok(b1.messageId);
  const r2 = await s.post(route(1), s.tokens.device, { text: 'Synthetic send one', clientKey: 'key-one-00001' });
  assert.equal(r2.status, 200);
  const b2 = await r2.json();
  conforms(b2, 'SendResult');
  assert.equal(b2.duplicate, true);
  assert.equal(b2.messageId, b1.messageId);
  assert.equal(s.world.sends.length, count + 1);
});

test('bad send bodies are refused', async () => {
  for (const body of [{ text: '', clientKey: 'key-bad-00001' }, { text: 'x', clientKey: 'no' }, { text: 'x', clientKey: 'key-bad-00002', extra: 1 }]) {
    assert.equal((await s.post(route(1), s.tokens.device, body)).status, 400, JSON.stringify(body));
  }
});

test('a file send goes out once, and an unknown or malformed file is refused', async () => {
  const b = await (await s.get(route(1) + '?limit=50', s.tokens.device)).json();
  const file = b.messages.flatMap((m) => m.attachments)[0];
  assert.ok(file, 'the fixture carries one attachment to send back');
  const count = s.world.sends.length;
  const r1 = await s.post(route(1), s.tokens.device, { file: file.id, clientKey: 'key-file-0001' });
  assert.equal(r1.status, 201);
  conforms(await r1.json(), 'SendResult');
  assert.equal(s.world.sends.length, count + 1);
  assert.equal(s.world.sends.at(-1).file, s.store.getAttachment(file.id).path);
  const r2 = await s.post(route(1), s.tokens.device, { file: file.id, clientKey: 'key-file-0001' });
  assert.equal(r2.status, 200);
  assert.equal((await r2.json()).duplicate, true);
  assert.equal(s.world.sends.length, count + 1);
  assert.equal((await s.post(route(1), s.tokens.device, { file: 'short', clientKey: 'key-file-0002' })).status, 400);
  const unknown = await s.post(route(1), s.tokens.device, { file: 'unknownunknown01', clientKey: 'key-file-0003' });
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).error.code, 'attachment_unknown');
  assert.equal((await s.post(route(1), s.tokens.device, { clientKey: 'key-file-0004' })).status, 400);
});

test('emoji survive the route, the engine and the store: the same code points come back in the history, the live event and the list preview', async () => {
  const text = 'emoji \u{1F1EF}\u{1F1F5} \u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467} \u{1F44D}\u{1F3FF} \u{2764}\u{FE0F}';
  const a = await openSocket(s.base);
  a.ws.send(JSON.stringify({ type: 'auth', token: s.tokens.device }));
  await waitFor(() => a.frames.some((f) => f.type === 'hello'));
  const sent = await s.post(route(2), s.tokens.device, { text, clientKey: 'key-emoji-0001' });
  assert.equal(sent.status, 201);
  const { messageId } = await sent.json();
  const isOurs = (f) => f.type === 'event' && f.name === 'message.new' && f.data.message.id === messageId;
  await waitFor(() => a.frames.some(isOurs));
  a.ws.close();
  const live = a.frames.find(isOurs).data.message.text;
  const history = (await (await s.get(route(2) + '?limit=50', s.tokens.device)).json()).messages.find((m) => m.id === messageId).text;
  const chats = (await (await s.get('/api/v1/chats', s.tokens.device)).json()).chats;
  const preview = chats.find((c) => c.id === '2').lastMessage.text;
  for (const [where, got] of [['live', live], ['history', history], ['preview', preview]]) {
    assert.deepEqual([...got].map((c) => c.codePointAt(0)), [...text].map((c) => c.codePointAt(0)), where);
  }
});

test('a file from the device uploads, is sent by its id with a caption, and keeps its emoji name', async () => {
  const bytes = Buffer.from('a synthetic photo, not a real one');
  const name = 'beach \u{1F3D6}\u{FE0F}.jpg';
  const up = await s.post('/api/v1/attachments', s.tokens.device, { name, mime: 'image/jpeg', data: bytes.toString('base64') });
  assert.equal(up.status, 201);
  const att = await up.json();
  conforms(att, 'Attachment');
  assert.equal(att.name, name);
  assert.equal(att.bytes, bytes.length);
  const held = s.store.getAttachment(att.id);
  assert.ok(held.path.startsWith(s.dir), 'the upload lives in the server data folder');
  assert.deepEqual(readFileSync(held.path), bytes, 'the same bytes come back from disk');
  const count = s.world.sends.length;
  const r = await s.post(route(1), s.tokens.device, { file: att.id, text: 'look \u{1F44B}\u{1F3FD}', clientKey: 'key-upload-001' });
  assert.equal(r.status, 201);
  assert.equal(s.world.sends.length, count + 1);
  assert.equal(s.world.sends.at(-1).file, held.path);
});

test('an upload is refused when it is malformed, too large, or the token cannot send', async () => {
  const ok = Buffer.from('x').toString('base64');
  for (const body of [{ name: 'a.txt' }, { name: 'a.txt', data: 'not base64!' }, { name: '', data: ok }, { name: 'a.txt', data: ok, extra: 1 }, { name: 'a.txt', data: '' }]) {
    assert.equal((await s.post('/api/v1/attachments', s.tokens.device, body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await s.post('/api/v1/attachments', s.tokens.tooling, { name: 'a.txt', data: ok })).status, 403);
  const big = Buffer.alloc(apiSpec.uploads.maxBytes + 1).toString('base64');
  const r = await s.post('/api/v1/attachments', s.tokens.device, { name: 'big.bin', data: big });
  assert.equal(r.status, 413);
});

test('an upload name is one path segment, so it cannot leave the uploads folder', async () => {
  const up = await (await s.post('/api/v1/attachments', s.tokens.device, { name: '../../escape.txt', data: Buffer.from('x').toString('base64') })).json();
  const held = s.store.getAttachment(up.id);
  assert.equal(up.name, 'escape.txt');
  assert.ok(held.path.startsWith(path.join(s.dir, 'uploads') + path.sep));
});

test('info reports the upload cap from the spec', async () => {
  const info = await (await s.get('/api/v1/info', s.tokens.device)).json();
  assert.equal(info.uploadMaxBytes, apiSpec.uploads.maxBytes);
});

test('an uncertain send is reported as uncertain and never retried', async () => {
  for (const [mode, key] of [['uncertain', 'key-unsure-001'], ['hang', 'key-hang-00001']]) {
    const attempts = s.world.attempts;
    s.world.behavior.send = mode;
    try {
      const r = await s.post(route(2), s.tokens.device, { text: 'Synthetic unsure', clientKey: key });
      assert.equal(r.status, 202, mode);
      assert.equal((await r.json()).status, 'uncertain');
      assert.equal(s.world.attempts, attempts + 1);
    } finally {
      s.world.behavior.send = 'ok';
    }
  }
});

test('a definite failure is reported as a failure', async () => {
  s.world.behavior.send = 'fail';
  try {
    const r = await s.post(route(2), s.tokens.device, { text: 'Synthetic refused', clientKey: 'key-fail-00001' });
    assert.equal(r.status, 502);
    assert.equal((await r.json()).error.code, 'send_failed');
  } finally {
    s.world.behavior.send = 'ok';
  }
});

test('attachments are served by id, and only from inside the attachments folder', async () => {
  const b = await (await s.get(route(1) + '?limit=50', s.tokens.device)).json();
  const a = b.messages.flatMap((m) => m.attachments)[0];
  assert.ok(a);
  conforms(a, 'Attachment');
  const r = await s.get('/api/v1/attachments/' + a.id, s.tokens.device);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.equal(Buffer.from(await r.arrayBuffer()).subarray(1, 4).toString(), 'PNG');
  assert.equal((await s.get('/api/v1/attachments/' + a.id)).status, 401);
  s.store.putAttachment('outsideoutside01', '/etc/hosts', 'text/plain', 'hosts');
  assert.equal((await s.get('/api/v1/attachments/outsideoutside01', s.tokens.device)).status, 404);
  assert.equal((await s.get('/api/v1/attachments/unknownunknown01', s.tokens.device)).status, 404);
});

test('the event stream needs a valid token in its first frame', async () => {
  const { ws } = await openSocket(s.base);
  const closed = new Promise((r) => { ws.onclose = (e) => r(e.code); });
  ws.send(JSON.stringify({ type: 'auth', token: 'not a token' }));
  assert.equal(await closed, 4401);
});

test('live messages stream, and a reconnect resumes where it left off', async () => {
  const a = await openSocket(s.base);
  a.ws.send(JSON.stringify({ type: 'auth', token: s.tokens.device }));
  await waitFor(() => a.frames.some((f) => f.type === 'hello'));
  const hello = a.frames.find((f) => f.type === 'hello');
  conforms(hello, 'Hello');
  assert.equal(hello.resumed, false);
  s.world.incoming(1, 'Synthetic live one');
  const isLive = (f) => f.type === 'event' && f.name === 'message.new' && f.data.message.text === 'Synthetic live one';
  await waitFor(() => a.frames.some(isLive));
  const ev = a.frames.find(isLive);
  conforms(ev, 'EventFrame');
  conforms(ev.data, 'MessageEvent');
  a.ws.close();
  await new Promise((r) => setTimeout(r, 50));
  s.world.incoming(1, 'Synthetic missed while away');
  await new Promise((r) => setTimeout(r, 100));
  const b = await openSocket(s.base);
  b.ws.send(JSON.stringify({ type: 'auth', token: s.tokens.device, resume: { epoch: hello.epoch, seq: ev.seq } }));
  await waitFor(() => b.frames.some((f) => f.type === 'event' && f.data.message && f.data.message.text === 'Synthetic missed while away'));
  assert.equal(b.frames.find((f) => f.type === 'hello').resumed, true);
  b.ws.close();
  const c = await openSocket(s.base);
  c.ws.send(JSON.stringify({ type: 'auth', token: s.tokens.device, resume: { epoch: 'another-epoch', seq: 1 } }));
  await waitFor(() => c.frames.some((f) => f.type === 'hello'));
  assert.equal(c.frames.find((f) => f.type === 'hello').resumed, false);
  c.ws.close();
});

test('tapbacks stream as reaction events', async () => {
  const a = await openSocket(s.base);
  a.ws.send(JSON.stringify({ type: 'auth', token: s.tokens.device }));
  await waitFor(() => a.frames.some((f) => f.type === 'hello'));
  s.world.react(1, 'FAKE-0012', 'laugh', '+15555550100');
  await waitFor(() => a.frames.some((f) => f.type === 'event' && f.name === 'reaction'));
  const ev = a.frames.find((f) => f.name === 'reaction');
  conforms(ev.data, 'ReactionEvent');
  assert.equal(ev.data.targetId, 'FAKE-0012');
  a.ws.close();
});

test('the client library talks to the server', async () => {
  const events = [];
  const states = [];
  const c = createApiClient({ baseUrl: s.base, token: s.tokens.device, onEvent: (e) => events.push(e), onState: (x) => states.push(x) });
  assert.equal((await c.info()).apiVersion, 1);
  assert.equal((await c.chats({ limit: 10 })).chats.length, 3);
  assert.ok((await c.messages('2', { limit: 10 })).messages.length > 0);
  c.connect();
  await waitFor(() => states.includes('open'));
  const r = await c.send('2', { text: 'Synthetic from the client', clientKey: 'client-key-0001' });
  assert.equal(r.status, 'sent');
  await waitFor(() => events.some((e) => e.name === 'message.new' && e.data.message.text === 'Synthetic from the client'));
  await assert.rejects(c.send('2', { text: 'x', clientKey: 'no' }), (e) => e.status === 400 && e.code === 'bad_client_key');
  conforms(await c.markRead('2'), 'ChatRead');
  c.close();
});

test('opening a conversation marks it read, the count follows, and every client is told', async () => {
  const t = await boot();
  try {
    await t.srv.warmed;
    const chats = async () => (await (await t.get('/api/v1/chats', t.tokens.device)).json()).chats;
    assert.equal((await chats()).find((c) => c.id === '1').unread, 1, 'the fixture leaves chat 1 unread');
    const sock = await openSocket(t.base);
    sock.ws.send(JSON.stringify({ type: 'auth', token: t.tokens.device }));
    await waitFor(() => sock.frames.some((f) => f.type === 'hello'));
    const r = await t.post('/api/v1/chats/1/read', t.tokens.device, {});
    assert.equal(r.status, 200);
    const body = await r.json();
    conforms(body, 'ChatRead');
    assert.equal(body.chatId, '1');
    assert.equal(body.unread, 0);
    assert.equal((await chats()).find((c) => c.id === '1').unread, 0, 'the held list follows the read');
    assert.ok(t.world.requests.includes('read'), 'the engine was asked to clear the read state');
    await waitFor(() => sock.frames.some((f) => f.type === 'event' && f.name === 'chat.read'));
    const ev = sock.frames.find((f) => f.name === 'chat.read');
    conforms(ev.data, 'ChatRead');
    assert.equal(ev.data.chatId, '1');
    assert.equal(ev.data.unread, 0);
    sock.ws.close();
  } finally {
    await t.close();
  }
});

test('marking read needs a client token, and a bad chat id is refused', async () => {
  const t = await boot();
  try {
    assert.equal((await t.post('/api/v1/chats/1/read', t.tokens.tooling, {})).status, 403);
    assert.equal((await t.post('/api/v1/chats/1/read')).status, 401);
    assert.equal((await t.post('/api/v1/chats/abc/read', t.tokens.device, {})).status, 400);
  } finally {
    await t.close();
  }
});

test('the engine is restarted when it dies', async () => {
  const exits = () => s.lines.filter((l) => l.event === 'engine.exit').length;
  const starts = () => s.lines.filter((l) => l.event === 'engine.start').length;
  const before0 = starts();
  s.world.crashAll();
  await waitFor(() => exits() > 0);
  await waitFor(() => starts() > before0, 5000);
  assert.equal(s.engine.info().ready, true);
  assert.equal((await s.get('/api/v1/chats', s.tokens.device)).status, 200);
});

test('no token or message text reaches a log line, even at debug', () => {
  const all = JSON.stringify(s.lines);
  assert.ok(s.lines.length > 10);
  for (const t of Object.values(s.tokens)) assert.ok(!all.includes(t), 'a token reached the log');
  for (const phrase of ['Synthetic send one', 'Synthetic live one', 'Synthetic from the client', 'Are we still on for coffee']) assert.ok(!all.includes(phrase), 'message text reached the log: ' + phrase);
});

test('sending is refused while switched off', async () => {
  const t = await boot({ sending: false });
  try {
    const r = await t.post(route(1), t.tokens.device, { text: 'Synthetic off', clientKey: 'key-off-000001' });
    assert.equal(r.status, 403);
    assert.equal((await r.json()).error.code, 'sending_off');
    assert.equal(t.world.sends.length, 0);
  } finally {
    await t.close();
  }
});

test('sends past the rate limit are refused', async () => {
  const t = await boot({ perMinute: 2 });
  try {
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await t.post(route(1), t.tokens.device, { text: 'Synthetic rate ' + i, clientKey: 'key-rate-0000' + i })).status);
    assert.deepEqual(codes, [201, 201, 429]);
  } finally {
    await t.close();
  }
});


test('search finds messages through the fixture engine, newest first, and needs a search scope', async () => {
  const r = await s.get('/api/v1/search?q=' + encodeURIComponent('I will'), s.tokens.tooling);
  assert.equal(r.status, 200);
  const b = await r.json();
  conforms(b, 'SearchResults');
  assert.ok(b.results.length >= 2, 'the fixture holds two messages saying I will');
  assert.ok(b.results.every((x) => x.message.text.toLowerCase().includes('i will')));
  const times = b.results.map((x) => x.message.sentAt);
  assert.deepEqual(times, [...times].sort().reverse(), 'newest first');
  const one = await (await s.get('/api/v1/search?q=' + encodeURIComponent('I will') + '&chatId=2', s.tokens.tooling)).json();
  assert.ok(one.results.length >= 1);
  assert.ok(one.results.every((x) => x.chatId === '2'));
  assert.equal((await s.get('/api/v1/search?q=lake', s.tokens.device)).status, 403, 'a device token cannot search');
  assert.equal((await s.get('/api/v1/search', s.tokens.tooling)).status, 400);
  assert.equal((await s.get('/api/v1/search?q=%20', s.tokens.tooling)).status, 400);
  assert.equal((await s.get('/api/v1/search?q=lake&chatId=abc', s.tokens.tooling)).status, 400);
});

test('a setting written by one device is read back by another', async () => {
  const a = s.store.createToken('device', 'settings device a').token;
  const b = s.store.createToken('device', 'settings device b').token;
  conforms(await (await s.get('/api/v1/settings', a)).json(), 'Settings');
  const w = await s.put('/api/v1/settings', a, { values: { 'appearance.skin': 'dark', 'appearance.textSize': 15 } });
  assert.equal(w.status, 200);
  conforms(await w.json(), 'Settings');
  const read = await (await s.get('/api/v1/settings', b)).json();
  assert.equal(read.values['appearance.skin'], 'dark', 'the second device reads the same value');
  assert.equal(read.values['appearance.textSize'], 15);
  assert.equal((await s.put('/api/v1/settings', a, { values: { 'Bad Key': 1 } })).status, 400);
  assert.equal((await s.put('/api/v1/settings', s.tokens.tooling, { values: { 'appearance.skin': 'light' } })).status, 403, 'a tooling token cannot change settings');
});

test('a chat arrangement is held on the server and read back on a reconnect', async () => {
  const a = s.store.createToken('device', 'arrangement device a').token;
  const b = s.store.createToken('device', 'arrangement device b').token;
  const groups = [{ id: 'g1', name: 'Family' }];
  const placement = { '1': 'g1' };
  const order = ['1', '2'];
  const w = await s.put('/api/v1/settings', a, { values: { 'chats.sort': 'manual', 'chats.groups': groups, 'chats.placement': placement, 'chats.order': order } });
  assert.equal(w.status, 200);
  // A second device connecting fresh reads the same arrangement, which is what surviving a reconnect means for a
  // value that lives on the server rather than on one device.
  const read = await (await s.get('/api/v1/settings', b)).json();
  assert.equal(read.values['chats.sort'], 'manual');
  assert.deepEqual(read.values['chats.groups'], groups);
  assert.deepEqual(read.values['chats.placement'], placement);
  assert.deepEqual(read.values['chats.order'], order);
});

test('a settings change is broadcast over the event stream', async () => {
  const a = await openSocket(s.base);
  a.ws.send(JSON.stringify({ type: 'auth', token: s.tokens.device }));
  await waitFor(() => a.frames.some((f) => f.type === 'hello'));
  await s.put('/api/v1/settings', s.tokens.device, { values: { 'appearance.density': 'compact' } });
  await waitFor(() => a.frames.some((f) => f.type === 'event' && f.name === 'settings.changed'));
  const ev = a.frames.find((f) => f.type === 'event' && f.name === 'settings.changed');
  conforms(ev.data, 'SettingsEvent');
  assert.equal(ev.data.values['appearance.density'], 'compact');
  a.ws.close();
});
