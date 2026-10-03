import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { boot, waitFor, openSocket } from './helpers.js';
import { openStore } from '../src/store.js';
import { apiSpec, naming, serverVersion, serverCommit } from '../src/paths.js';
import { validate } from '../../core/kit/rules/schema.js';
import { createApiClient } from '../../core/kit/api.js';
import { settingsGroups } from '../../core/app/rules/settings.js';

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
  const body = await r.json();
  conforms(body, 'Health');
  // The stamp, so an updater can tell which version answered without holding a token.
  assert.equal(body.version, serverVersion);
  assert.equal(body.commit, serverCommit);
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
  assert.equal(b.repository, 'https://github.com/' + naming.repo, 'About links to the repository naming.json names');
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

test('a reaction and a threaded reply go through the routes and the client, and reach every client live (issue 138)', async (t) => {
  const srv = await boot();
  t.after(() => srv.close());
  const events = [];
  const states = [];
  const client = createApiClient({ baseUrl: srv.base, token: srv.tokens.device, onEvent: (e) => events.push(e), onState: (st) => states.push(st) });
  t.after(() => client.close());
  client.connect();
  await waitFor(() => states.includes('open'));
  const at = (id) => '/api/v1/chats/1/messages/' + id + '/reactions';
  const added = await client.react('1', 'FAKE-0013', { emoji: '\u{1F602}' });
  conforms(added, 'ReactionResult');
  assert.deepEqual(added, { status: 'sent', targetId: 'FAKE-0013', type: 'laugh', add: true });
  await waitFor(() => events.some((e) => e.name === 'reaction' && e.data.targetId === 'FAKE-0013' && e.data.fromMe && e.data.add));
  conforms(events.find((e) => e.name === 'reaction').data, 'ReactionEvent');
  const mine = (await client.messages('1')).messages.find((m) => m.id === 'FAKE-0013').reactions.filter((r) => r.fromMe);
  assert.deepEqual(mine.map((r) => r.type), ['laugh']);
  const removed = await client.react('1', 'FAKE-0013', { emoji: '\u{1F602}', remove: true });
  assert.equal(removed.add, false);
  const custom = await srv.post(at('FAKE-0013'), srv.tokens.device, { emoji: '\u{1F389}' });
  assert.equal(custom.status, 422);
  assert.equal((await custom.json()).error.code, 'reaction_unsupported');
  for (const [path, body] of [[at('FAKE-0013'), {}], [at('FAKE-0013'), { emoji: '\u2764', extra: 1 }], [at('FAKE-0013'), { emoji: '\u2764', remove: 'yes' }], [at('row:9'), { emoji: '\u2764' }]]) {
    assert.equal((await srv.post(path, srv.tokens.device, body)).status, 400, path + ' ' + JSON.stringify(body));
  }
  assert.equal((await srv.post(at('FAKE-0013'), srv.tokens.tooling, { emoji: '\u2764' })).status, 403, 'a reaction needs the send scope');

  const reply = await client.send('1', { text: 'Synthetic threaded reply', clientKey: 'key-reply-api-01', replyTo: 'FAKE-0013' });
  conforms(reply, 'SendResult');
  await waitFor(() => events.some((e) => e.name === 'message.new' && e.data.message.id === reply.messageId));
  assert.equal(events.find((e) => e.name === 'message.new' && e.data.message.id === reply.messageId).data.message.replyTo, 'FAKE-0013');
  assert.equal((await srv.post(route(1), srv.tokens.device, { text: 'x', clientKey: 'key-reply-api-02', replyTo: 'row:9' })).status, 400);
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
  const w = await s.put('/api/v1/settings', a, { values: { 'appearance.skin': 'dark', 'appearance.textScale': 150 } });
  assert.equal(w.status, 200);
  conforms(await w.json(), 'Settings');
  const read = await (await s.get('/api/v1/settings', b)).json();
  assert.equal(read.values['appearance.skin'], 'dark', 'the second device reads the same value');
  assert.equal(read.values['appearance.textScale'], 150);
  assert.equal((await s.put('/api/v1/settings', a, { values: { 'Bad Key': 1 } })).status, 400);
  assert.equal((await s.put('/api/v1/settings', s.tokens.tooling, { values: { 'appearance.skin': 'light' } })).status, 403, 'a tooling token cannot change settings');
});

test('every notice switch and the automatic download setting is held on the server', async () => {
  const a = s.store.createToken('device', 'notice device a').token;
  const b = s.store.createToken('device', 'notice device b').token;
  // The keys come from the settings schema's own sections, so a switch added there is held to this test too.
  const keys = settingsGroups().filter((g) => g.id === 'notifications' || g.id === 'updates').flatMap((g) => g.fields.map((f) => f.key));
  assert.ok(keys.includes('notifications.updateAvailable') && keys.includes('updates.autoDownload'), 'the sections name the switches');
  for (const value of [false, true]) {
    const values = Object.fromEntries(keys.map((k) => [k, k === 'updates.autoDownload' ? value : !value]));
    assert.equal((await s.put('/api/v1/settings', a, { values })).status, 200);
    // Read back from the server by another device, never from the writer's own copy.
    const read = await (await s.get('/api/v1/settings', b)).json();
    for (const k of keys) assert.equal(read.values[k], values[k], k + ' round-trips through the server');
  }
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

test('a theme is held on the server as one setting, read back by another device and cleared with null', async () => {
  const a = s.store.createToken('device', 'theme device a').token;
  const b = s.store.createToken('device', 'theme device b').token;
  const theme = { name: 'imported', source: 'tweakcn', color: { light: { accent: 'oklch(0.5 0.1 40)' }, dark: { accent: 'oklch(0.8 0.1 40)' } }, radius: { md: '0.5rem' } };
  assert.equal((await s.put('/api/v1/settings', a, { values: { 'appearance.theme': theme } })).status, 200);
  assert.deepEqual((await (await s.get('/api/v1/settings', b)).json()).values['appearance.theme'], theme, 'every client reads the theme the server holds');
  assert.equal((await s.put('/api/v1/settings', b, { values: { 'appearance.theme': null } })).status, 200);
  assert.equal((await (await s.get('/api/v1/settings', a)).json()).values['appearance.theme'], null, 'null puts every client back on the default tokens');
});

test('a settings change is broadcast over the event stream', async () => {
  const a = await openSocket(s.base);
  a.ws.send(JSON.stringify({ type: 'auth', token: s.tokens.device }));
  await waitFor(() => a.frames.some((f) => f.type === 'hello'));
  await s.put('/api/v1/settings', s.tokens.device, { values: { 'appearance.textScale': 125 } });
  await waitFor(() => a.frames.some((f) => f.type === 'event' && f.name === 'settings.changed'));
  const ev = a.frames.find((f) => f.type === 'event' && f.name === 'settings.changed');
  conforms(ev.data, 'SettingsEvent');
  assert.equal(ev.data.values['appearance.textScale'], 125);
  a.ws.close();
});

// Theme import by URL (issue 112). The theme is served from a loopback server this test owns, in the two shapes a
// tweakcn URL can answer with: the registry JSON and the CSS export.
async function themeHost(routes) {
  const srv = http.createServer((req, res) => {
    const r = routes[req.url];
    if (!r) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return; }
    res.writeHead(r.status || 200, { 'content-type': r.type || 'application/json' });
    res.end(r.body);
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  return { base: 'http://127.0.0.1:' + srv.address().port, close: () => new Promise((resolve) => srv.close(resolve)) };
}

test('a theme given as a URL lands on the server, is offered to every client, and says what it refused', async () => {
  const item = { name: 'harbour', title: 'Harbour', cssVars: { theme: { radius: '0.5rem' }, light: { background: '#f0f4ff', primary: '#1d4ed8', 'chart-1': '#000000' }, dark: { background: '#0b1020', primary: '#93c5fd' } } };
  const host = await themeHost({ '/harbour.json': { body: JSON.stringify(item) }, '/plain.css': { type: 'text/css', body: ':root { --primary: #8a3b12; } .dark { --primary: #e0a070; }' } });
  const a = s.store.createToken('device', 'theme url device a').token;
  const b = s.store.createToken('device', 'theme url device b').token;
  const sock = await openSocket(s.base);
  try {
    sock.ws.send(JSON.stringify({ type: 'auth', token: b }));
    await waitFor(() => sock.frames.some((f) => f.type === 'hello'));
    await s.put('/api/v1/settings', a, { values: { 'appearance.themes': null, 'appearance.theme': null } });
    const r = await s.post('/api/v1/themes', a, { url: host.base + '/harbour.json' });
    assert.equal(r.status, 200);
    const out = await r.json();
    conforms(out, 'ThemeImportResult');
    assert.equal(out.theme.id, 'harbour');
    assert.equal(out.theme.name, 'Harbour');
    assert.equal(out.theme.url, host.base + '/harbour.json');
    assert.equal(out.theme.color.light.accent, '#1d4ed8');
    assert.equal(out.theme.color.dark.bg, '#0b1020');
    assert.deepEqual(out.refused, ['chart-1'], 'what the theme could not carry is named in the answer');
    assert.match(out.summary, /Refused: chart-1/);
    const held = (await (await s.get('/api/v1/settings', b)).json()).values;
    assert.deepEqual(held['appearance.themes'].map((t) => t.id), ['harbour'], 'another device reads the imported theme from the server');
    assert.equal(held['appearance.theme'], null, 'an import offers the theme; it does not put it in force');
    await waitFor(() => sock.frames.some((f) => f.type === 'event' && f.name === 'settings.changed' && f.data.values['appearance.themes']));
    // The CSS export works the same way, and the name a request gives wins.
    const css = await (await s.post('/api/v1/themes', a, { url: host.base + '/plain.css', name: 'Rust' })).json();
    assert.equal(css.theme.id, 'rust');
    assert.equal(css.theme.color.dark.accent, '#e0a070');
    // The same URL again replaces its entry rather than adding a twin.
    assert.equal((await s.post('/api/v1/themes', a, { url: host.base + '/harbour.json' })).status, 200);
    assert.deepEqual((await (await s.get('/api/v1/settings', b)).json()).values['appearance.themes'].map((t) => t.id), ['harbour', 'rust']);
  } finally {
    sock.ws.close();
    await host.close();
  }
});

test('a bad theme URL, or a URL that is not a theme, is refused with the reason and saves nothing', async () => {
  const host = await themeHost({ '/page.html': { type: 'text/html', body: '<html><body>A blog post about colours</body></html>' }, '/empty.json': { body: JSON.stringify({ name: 'x', cssVars: { light: { 'chart-1': '#000' } } }) }, '/huge.css': { type: 'text/css', body: ':root { --primary: #000; }' + ' '.repeat(300 * 1024) } });
  const a = s.store.createToken('device', 'theme url refusals').token;
  try {
    await s.put('/api/v1/settings', a, { values: { 'appearance.themes': [{ id: 'kept', name: 'Kept', color: { light: {}, dark: {} } }] } });
    const before = (await (await s.get('/api/v1/settings', a)).json()).values;
    const cases = [
      [{ url: 'not a url' }, 400, 'bad_url'],
      [{ url: 'file:///etc/passwd' }, 400, 'bad_url'],
      [{ url: 'ftp://example.com/theme.css' }, 400, 'bad_url'],
      [{}, 400, 'bad_url'],
      [{ url: host.base + '/missing.json' }, 400, 'theme_unreachable'],
      [{ url: host.base + '/page.html' }, 400, 'bad_theme'],
      [{ url: host.base + '/empty.json' }, 400, 'bad_theme'],
      [{ url: host.base + '/huge.css' }, 400, 'too_large'],
      [{ url: 'http://127.0.0.1:1/theme.json' }, 400, 'theme_unreachable'],
      [{ url: host.base + '/page.html', extra: 1 }, 400, 'bad_body'],
    ];
    for (const [body, status, code] of cases) {
      const r = await s.post('/api/v1/themes', a, body);
      const err = await r.json();
      assert.equal(r.status, status, JSON.stringify(body));
      conforms(err, 'Error');
      assert.equal(err.error.code, code, JSON.stringify(body));
      assert.ok(err.error.message.length > 0, 'the refusal carries a reason');
    }
    assert.match((await (await s.post('/api/v1/themes', a, { url: host.base + '/missing.json' })).json()).error.message, /404/, 'the reason names what the URL answered');
    assert.deepEqual((await (await s.get('/api/v1/settings', a)).json()).values['appearance.themes'], before['appearance.themes'], 'nothing was saved');
    assert.equal((await s.post('/api/v1/themes', s.tokens.tooling, { url: host.base + '/page.html' })).status, 403, 'a tooling token cannot import a theme');
  } finally {
    await host.close();
  }
});

test('the appearance choice survives a server restart', async () => {
  const a = s.store.createToken('device', 'skin restart').token;
  assert.equal((await s.put('/api/v1/settings', a, { values: { 'appearance.skin': 'light', 'appearance.textScale': 200 } })).status, 200);
  // A second open of the same database is what the next process reads at boot.
  const reopened = openStore(path.join(s.dir, 'state.db'));
  try {
    const values = reopened.getAllSettings();
    assert.equal(values['appearance.skin'], 'light');
    assert.equal(values['appearance.textScale'], 200);
  } finally {
    reopened.close();
  }
});
