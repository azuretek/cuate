import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createEngine } from '../src/engine/index.js';
import { createSendEffectReader } from '../src/engine/send-effects.js';
import { createLogger } from '../../core/kit/log.js';
import { logSpec } from '../src/paths.js';
import { validate } from '../../core/kit/rules/schema.js';
import { mapMessage } from '../../core/app/rules/engine-imsg.js';
import { chatPreview, applyMessageToChats } from '../../core/app/rules/chats.js';
import { messageNotice } from '../../core/app/rules/notifications.js';
import { SEND_STYLES, sendEffectLine } from '../../core/app/rules/send-effects.js';
import { SEND_STYLE_ROWS } from '../src/engine/fixtures.js';
import { boot, waitFor, openSocket } from './helpers.js';

// Issue 442: a message sent with a bubble effect (Slam, Loud, Gentle, Invisible Ink) or a screen effect (Echo,
// Spotlight, Balloons, Confetti, Love, Lasers, Fireworks, Celebration, Shooting Star) reached the app as an ordinary
// message. Messages records the effect on the message's own row, in expressive_send_style_id, and imsg's message reads
// do not carry it, so the server reads it from the store, read-only, for the rows a page or the live stream asks about.
// Every row here is synthetic.
const apiSpec = JSON.parse(readFileSync(new URL('../../core/spec/api.json', import.meta.url), 'utf8'));
const conforms = (v, type) => assert.deepEqual(validate(v, type, apiSpec.models), []);
const SAM = '+15555550123';

// Messages' own identifier for each effect, and the name the app gives it.
const EFFECTS = [
  ['com.apple.MobileSMS.expressivesend.impact', 'slam', 'Slam'],
  ['com.apple.MobileSMS.expressivesend.loud', 'loud', 'Loud'],
  ['com.apple.MobileSMS.expressivesend.gentle', 'gentle', 'Gentle'],
  ['com.apple.MobileSMS.expressivesend.invisibleink', 'invisible-ink', 'Invisible Ink'],
  ['com.apple.messages.effect.CKEchoEffect', 'echo', 'Echo'],
  ['com.apple.messages.effect.CKSpotlightEffect', 'spotlight', 'Spotlight'],
  ['com.apple.messages.effect.CKHappyBirthdayEffect', 'balloons', 'Balloons'],
  ['com.apple.messages.effect.CKConfettiEffect', 'confetti', 'Confetti'],
  ['com.apple.messages.effect.CKHeartEffect', 'love', 'Love'],
  ['com.apple.messages.effect.CKLasersEffect', 'lasers', 'Lasers'],
  ['com.apple.messages.effect.CKFireworksEffect', 'fireworks', 'Fireworks'],
  ['com.apple.messages.effect.CKSparklesEffect', 'celebration', 'Celebration'],
  ['com.apple.messages.effect.CKShootingStarEffect', 'shooting-star', 'Shooting Star'],
];

const row = (i, over = {}) => ({ id: 100 + i, guid: 'FX-' + i, chat_id: 5, is_from_me: false, sender: SAM, sender_name: 'Sam Example', text: 'Synthetic words ' + i, created_at: new Date(Date.UTC(2026, 0, 2, 3, i)).toISOString(), attachments: [], ...over });
const ROWS = [...EFFECTS.map((_, i) => row(i)), row(20, { guid: 'PLAIN' }), row(21, { guid: 'ODD' })];
// What the store records for those rows: each effect's identifier, and one this app does not know.
const STORE = new Map([...EFFECTS.map(([id], i) => ['FX-' + i, id]), ['ODD', 'com.apple.messages.effect.CKSomethingNewEffect']]);

// The engine as imsg answers it: every row an ordinary row, with no word of the effect it was sent with.
function transport(rows) {
  const t = { asked: [], notify: null };
  const lineCbs = new Set();
  const send = (o) => setImmediate(() => { for (const cb of lineCbs) cb(JSON.stringify(o)); });
  Object.assign(t, {
    write(s) {
      const req = JSON.parse(s);
      t.asked.push(req.method);
      if (req.method === 'status') return send({ jsonrpc: '2.0', id: req.id, result: { version: 't', database: { ready: true }, methods: [], capabilities: { features: {} } } });
      if (req.method === 'watch.subscribe') return send({ jsonrpc: '2.0', id: req.id, result: { subscription: 1 } });
      if (req.method === 'chats.list') return send({ jsonrpc: '2.0', id: req.id, result: { chats: [{ id: 5, display_name: '', contact_name: 'Sam Example', identifier: SAM, is_group: false }] } });
      if (req.method === 'messages.history') return send({ jsonrpc: '2.0', id: req.id, result: { messages: rows } });
      return send({ jsonrpc: '2.0', id: req.id, result: { ok: true } });
    },
    live(message) { send({ jsonrpc: '2.0', method: 'message', params: { subscription: 1, message } }); },
    onLine(cb) { lineCbs.add(cb); },
    onExit() {},
    close() { return Promise.resolve(); },
  });
  return t;
}

const readerOf = (store) => ({ asked: [], among(guids) { this.asked.push([...guids]); return new Map([...store].filter(([g]) => guids.includes(g))); }, close() {} });

async function withEngine(rows, sendEffects, fn) {
  const t = transport(rows);
  const lines = [];
  const log = createLogger({ spec: logSpec, app: 'test', run: 'test', sink: (l) => lines.push(l), now: Date.now, level: 'debug', strict: true });
  const engine = createEngine({ kind: 'fake', makeTransport: () => t, log: log.child('engine'), attachmentId: (a) => 'att:' + a.original_path, timeoutMs: 2000, sendEffects });
  await engine.start();
  try {
    await fn(engine, t, lines);
  } finally {
    await engine.stop();
  }
}

test('a message sent with an effect carries it, named, and an ordinary one carries none (issue 442)', async () => {
  const reader = readerOf(STORE);
  await withEngine(ROWS, reader, async (engine) => {
    const { messages } = await engine.messages('5');
    for (const [, key, name] of EFFECTS) {
      const m = messages.find((x) => x.text === 'Synthetic words ' + EFFECTS.findIndex((e) => e[1] === key));
      assert.equal(m.sendEffect, key, name + ' reaches the model');
      assert.equal(sendEffectLine(m.sendEffect), 'Sent with ' + name, 'and the line under it names it');
      conforms(m, 'Message');
    }
    assert.equal(messages.find((x) => x.id === 'PLAIN').sendEffect, undefined, 'an ordinary message carries no effect');
    assert.equal(messages.find((x) => x.id === 'ODD').sendEffect, undefined, 'nor does one sent with an effect this app has no way to play');
    assert.deepEqual(reader.asked.flat().sort(), ROWS.map((r) => r.guid).sort(), 'only the rows the page holds are asked of the store, in one read');
    assert.equal(reader.asked.length, 1);
  });
  // Without the store, which is all imsg's own row says, nothing is an effect.
  await withEngine(ROWS, null, async (engine) => {
    const { messages } = await engine.messages('5');
    assert.equal(messages.filter((m) => m.sendEffect).length, 0);
  });
});

test('every one of Messages\' thirteen effects is known by its identifier, and a bubble effect is told from a screen one (issue 442)', () => {
  assert.deepEqual(Object.keys(SEND_STYLES).sort(), EFFECTS.map((e) => e[0]).sort());
  for (const [id, key] of EFFECTS) {
    const m = mapMessage({ ...row(1), expressive_send_style_id: id }, { attachmentId: () => 'a' });
    assert.equal(m.sendEffect, key, id);
  }
  assert.equal(mapMessage(row(1), { attachmentId: () => 'a' }).sendEffect, undefined);
  assert.equal(mapMessage({ ...row(1), expressive_send_style_id: '' }, { attachmentId: () => 'a' }).sendEffect, undefined);
});

test('a live message carries its effect, and a store that cannot be read leaves it plain and says so (issue 442)', async () => {
  const reader = readerOf(new Map([['LIVE-1', 'com.apple.messages.effect.CKConfettiEffect']]));
  await withEngine([], reader, async (engine, t) => {
    const told = [];
    engine.on((name, d) => { if (name === 'message.new') told.push(d.message); });
    t.live(row(30, { guid: 'LIVE-1', id: 900 }));
    await waitFor(() => told.length === 1);
    assert.equal(told[0].sendEffect, 'confetti');
  });
  const broken = { among() { throw new Error('the store is locked'); }, close() {} };
  await withEngine(ROWS, broken, async (engine, t, lines) => {
    const { messages } = await engine.messages('5');
    assert.equal(messages.length, ROWS.length, 'every message is still there');
    assert.equal(messages.filter((m) => m.sendEffect).length, 0, 'drawn plain');
    assert.ok(lines.some((l) => JSON.stringify(l).includes('sendeffect.failed')), 'and the failure is logged');
  });
});

test('Invisible Ink keeps its words out of the list preview and the notice, which name the effect instead (issue 442)', () => {
  const m = { id: 'INK', chatId: '5', fromMe: false, sender: SAM, senderName: 'Sam Example', text: 'Synthetic hidden words', sentAt: '2026-01-02T03:04:05.000Z', attachments: [], link: null, payloads: 0, reactions: [], sendEffect: 'invisible-ink' };
  const chats = [{ id: '5', name: 'Sam Example', isGroup: false, unread: 0, lastMessageAt: '2026-01-01T00:00:00.000Z', lastMessage: null }];
  const preview = chatPreview(applyMessageToChats(chats, m).chats[0]);
  assert.equal(preview, 'Sent with Invisible Ink');
  assert.equal(messageNotice('Sam Example', m).body, 'Sent with Invisible Ink');
  assert.ok(!messageNotice('Sam Example', m).body.includes('hidden'), 'the words never reach the notice');
  const loud = { ...m, sendEffect: 'confetti' };
  assert.equal(chatPreview(applyMessageToChats(chats, loud).chats[0]), 'Synthetic hidden words', 'any other effect shows its words as sent');
});

// --- The store reader ---

const scratch = (t, name) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), name + '-'));
  const holders = [];
  t.after(() => { for (const h of holders) h.close(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, hold: (h) => { holders.push(h); return h; } };
};

test('the store reader names the effect each asked row was sent with, read-only (issue 442)', (t) => {
  const { dir, hold } = scratch(t, 'fx-store');
  const file = path.join(dir, 'chat.db');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, text TEXT, expressive_send_style_id TEXT)');
  const put = db.prepare('INSERT INTO message (ROWID, guid, text, expressive_send_style_id) VALUES (?, ?, ?, ?)');
  put.run(1, 'S-1', 'Synthetic one', 'com.apple.MobileSMS.expressivesend.impact');
  put.run(2, 'C-2', 'Synthetic two', 'com.apple.messages.effect.CKConfettiEffect');
  put.run(3, 'P-3', 'Synthetic three', null);
  put.run(4, 'E-4', 'Synthetic four', '');
  put.run(5, 'U-5', 'Synthetic five', 'com.apple.messages.effect.CKConfettiEffect');
  db.close();
  const reader = hold(createSendEffectReader({ dbPath: file }));
  assert.deepEqual([...reader.among(['S-1', 'C-2', 'P-3', 'E-4']).entries()].sort(), [['C-2', 'com.apple.messages.effect.CKConfettiEffect'], ['S-1', 'com.apple.MobileSMS.expressivesend.impact']], 'a row with no effect is not named, and a row not asked about is not read');
  assert.equal(reader.among([]).size, 0);
});

test('a store from before effects existed has none (issue 442)', (t) => {
  const { dir, hold } = scratch(t, 'fx-old');
  const file = path.join(dir, 'chat.db');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT)');
  db.close();
  const reader = hold(createSendEffectReader({ dbPath: file }));
  assert.equal(reader.among(['X']).size, 0);
});

// --- End to end, over the fake engine ---

const event = (frames, name, fn) => frames.find((f) => f.type === 'event' && f.name === name && fn(f.data));

test('end to end: the history carries the effect, and one sent on a phone reaches every client with its effect (issue 442)', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const [guid, style] = Object.entries(SEND_STYLE_ROWS)[0];
  assert.equal(style, 'com.apple.messages.effect.CKConfettiEffect', 'the fake group holds a message sent with Confetti');
  const page = await (await s.get('/api/v1/chats/2/messages?limit=50', s.tokens.device)).json();
  conforms(page, 'MessageList');
  const fx = page.messages.find((m) => m.id === guid);
  assert.equal(fx.sendEffect, 'confetti');
  assert.equal(page.messages.filter((m) => m.sendEffect).length, 1, 'and nothing else in it is');

  const a = await openSocket(s.base);
  t.after(() => a.ws.close());
  a.ws.send(JSON.stringify({ type: 'auth', token: s.tokens.device }));
  await waitFor(() => a.frames.some((f) => f.type === 'hello'));
  const live = s.world.incoming(1, 'Synthetic surprise inside', null, { sendStyle: 'com.apple.MobileSMS.expressivesend.invisibleink' });
  await waitFor(() => Boolean(event(a.frames, 'message.new', (d) => d.message.id === live.guid)));
  const arrived = event(a.frames, 'message.new', (d) => d.message.id === live.guid).data.message;
  assert.equal(arrived.sendEffect, 'invisible-ink');
  conforms(arrived, 'Message');
  const { chats } = await (await s.get('/api/v1/chats', s.tokens.device)).json();
  assert.equal(chatPreview(chats.find((c) => c.id === '1')), 'Sent with Invisible Ink', 'the list the server serves keeps the words hidden too');
});
