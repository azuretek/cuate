import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../src/engine/index.js';
import { createLogger } from '../../core/kit/log.js';
import { logSpec } from '../src/paths.js';
import { eventText, chatPreview, applyMessageToChats } from '../../core/app/rules/chats.js';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createBackgroundReader } from '../src/engine/backgrounds.js';
import { readPlist, writePlist } from '../src/engine/bplist.js';
import { createAttachments } from '../src/attachments.js';
import { gradientPng } from '../src/engine/png.js';
import { mapBackground, BACKGROUND_ACTIONS } from '../../core/app/rules/engine-imsg.js';
import { boot, waitFor, openSocket } from './helpers.js';
import { buildFixtures, SCRIPT } from '../src/engine/fixtures.js';

// Issue 417: a participant changing the conversation's background is a row of its own with no text and no attachment
// (Messages records it as item type 3, group action 4 for a background set and 6 for one cleared). The engine's read
// says none of that, so the row reached the app as an empty message, drawn as an empty notice. Every row is synthetic.
const SAM = '+15555550123';
const row = (over = {}) => ({ id: 9, guid: 'BG-9', chat_id: 5, is_from_me: false, sender: SAM, sender_name: 'Sam Example', text: '', created_at: '2026-01-02T03:04:05.000Z', attachments: [], ...over });
const words = { id: 8, guid: 'TX-8', chat_id: 5, is_from_me: false, sender: SAM, sender_name: 'Sam Example', text: 'Synthetic hello', created_at: '2026-01-02T03:00:00.000Z', attachments: [] };

// The engine as imsg answers it: the background row is an ordinary row with nothing in it.
function transport(rows) {
  const t = { asked: [] };
  const lineCbs = new Set();
  const send = (o) => setImmediate(() => { for (const cb of lineCbs) cb(JSON.stringify(o)); });
  Object.assign(t, {
    write(s) {
      const req = JSON.parse(s);
      t.asked.push(req.method);
      if (req.method === 'status') return send({ jsonrpc: '2.0', id: req.id, result: { version: 't', database: { ready: true }, methods: [], capabilities: { features: {} } } });
      if (req.method === 'watch.subscribe') return send({ jsonrpc: '2.0', id: req.id, result: { subscription: 1 } });
      if (req.method === 'chats.list') return send({ jsonrpc: '2.0', id: req.id, result: { chats: [{ id: 5, display_name: 'Group', is_group: true }, { id: 6, display_name: 'One', is_group: false }] } });
      if (req.method === 'messages.history') return send({ jsonrpc: '2.0', id: req.id, result: { messages: req.params.chat_id === 5 ? rows : [] } });
      return send({ jsonrpc: '2.0', id: req.id, result: { ok: true } });
    },
    onLine(cb) { lineCbs.add(cb); },
    onExit() {},
    close() { return Promise.resolve(); },
  });
  return t;
}

// What the store records for those rows, and what `imsg chat-background status` answers for each chat: the shape the
// adapter is given in place of the real reader (server/src/engine/backgrounds.js).
const CACHE = '/synthetic/Messages/TranscriptBackgroundCache/';
function backgroundsFor(events, { safety = 0 } = {}) {
  return {
    among: (guids) => new Map(events.filter((e) => guids.includes(e.guid)).map((e) => [e.guid, e.action])),
    latest: () => new Map(events.map((e) => [String(e.chatId), e])),
    async status(chatId) {
      const e = events.filter((x) => String(x.chatId) === String(chatId)).at(-1);
      if (!e) return { ok: true, chat_id: Number(chatId), background_set: false };
      const set = e.action === 'set';
      return {
        ok: true, chat_id: Number(chatId), background_set: set, background_channel_guid: set ? e.guid : undefined, file_size: 10, communication_safety_state: safety,
        watch_background_path: set ? CACHE + e.guid + '-watchBackground' : undefined, watch_background_exists: set,
        latest_event: { row_id: 9, guid: e.guid, action: e.action, date: '2026-01-02T03:04:05.000Z' },
      };
    },
  };
}

async function withEngine(rows, backgrounds, fn) {
  const t = transport(rows);
  const log = createLogger({ spec: logSpec, app: 'test', run: 'test', sink: () => {}, now: Date.now, level: 'debug', strict: true });
  const engine = createEngine({ kind: 'fake', makeTransport: () => t, log: log.child('engine'), attachmentId: (a) => 'att:' + a.original_path, timeoutMs: 2000, backgrounds });
  await engine.start();
  try {
    await fn(engine, t);
  } finally {
    await engine.stop();
  }
}

test('a background change is a line naming who changed it, never an empty notice (issue 417)', async () => {
  await withEngine([row(), words], backgroundsFor([{ chatId: 5, guid: 'BG-9', action: 'set' }]), async (engine) => {
    const { messages } = await engine.messages('5');
    const m = messages.find((x) => x.id === 'BG-9');
    assert.equal(m.event && m.event.kind, 'background', 'the row is the background changing');
    assert.equal(m.event.action, 'set');
    assert.deepEqual(m.attachments, [], 'and never a picture in the timeline');
    assert.equal(eventText(m), 'Sam Example changed the background');
    assert.equal(eventText({ ...m, fromMe: true }), 'You changed the background');
    assert.equal(messages.find((x) => x.id === 'TX-8').event, undefined, 'an ordinary message is a message');
  });
});

test('a background cleared reads as removed, and an empty row Messages records as nothing else stays a message (issue 417)', async () => {
  const cleared = row({ guid: 'BG-10', id: 10 });
  await withEngine([cleared, row({ guid: 'NOT-BG', id: 11 })], backgroundsFor([{ chatId: 5, guid: 'BG-10', action: 'clear' }]), async (engine) => {
    const { messages } = await engine.messages('5');
    const m = messages.find((x) => x.id === 'BG-10');
    assert.equal(m.event && m.event.kind, 'background');
    assert.equal(eventText(m), 'Sam Example removed the background');
    assert.equal(messages.find((x) => x.id === 'NOT-BG').event, undefined, 'only the rows the store records as a background change are one');
  });
});

test('the chat list carries the conversation background the engine reports, as the backdrop to draw (issue 417)', async () => {
  await withEngine([row()], backgroundsFor([{ chatId: 5, guid: 'BG-9', action: 'set' }]), async (engine) => {
    const list = await engine.chats({ photos: true });
    const group = list.find((c) => c.id === '5');
    assert.ok(group.background, 'the chat carries its background');
    assert.equal(group.background.id, 'att:' + CACHE + 'BG-9-watchBackground', 'the picture is the one Messages rendered for the chat');
    assert.equal(group.background.name, 'Background');
    assert.equal(list.find((c) => c.id === '6').background, null, 'a chat with no background has none');
  });
  await withEngine([row()], backgroundsFor([{ chatId: 5, guid: 'BG-9', action: 'clear' }]), async (engine) => {
    assert.equal((await engine.chats({ photos: true })).find((c) => c.id === '5').background, null, 'a cleared background draws nothing');
  });
  await withEngine([row()], backgroundsFor([{ chatId: 5, guid: 'BG-9', action: 'set' }], { safety: 1 }), async (engine) => {
    assert.equal((await engine.chats({ photos: true })).find((c) => c.id === '5').background, null, 'nor one Messages holds back for communication safety');
  });
});

test('the list preview names the change, and a live clear takes the backdrop away at once (issue 417)', () => {
  const m = { id: 'BG-9', chatId: '5', fromMe: false, sender: SAM, senderName: 'Sam Example', text: '', sentAt: '2026-01-02T03:04:05.000Z', attachments: [], link: null, payloads: 0, reactions: [], event: { kind: 'background', action: 'set' } };
  const chats = [{ id: '5', name: 'Group', isGroup: true, unread: 0, lastMessageAt: '2026-01-01T00:00:00.000Z', lastMessage: null, background: { id: 'old' } }];
  const set = applyMessageToChats(chats, m).chats[0];
  assert.equal(chatPreview(set), 'Sam Example changed the background');
  assert.equal(set.background.id, 'old', 'a new background arrives from the server as the chat changing, never guessed here');
  const clear = applyMessageToChats(chats, { ...m, event: { kind: 'background', action: 'clear' } }).chats[0];
  assert.equal(clear.background, null);
  assert.equal(chatPreview(clear), 'Sam Example removed the background');
});
// --- The pieces the feature is built from ---


const scratch = (t, name) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), name + '-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('the store reader names the rows Messages records as a background set or cleared, and asks the engine for the rest (issue 417)', async (t) => {
  const dir = scratch(t, 'bg-store');
  const file = path.join(dir, 'chat.db');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, text TEXT, item_type INTEGER, group_action_type INTEGER, date INTEGER); CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);');
  const put = db.prepare('INSERT INTO message (ROWID, guid, text, item_type, group_action_type, date) VALUES (?, ?, ?, ?, ?, ?)');
  const join = db.prepare('INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)');
  const rows = [[1, 'S-1', null, 3, 4, 100, 5], [2, 'C-2', null, 3, 6, 200, 5], [3, 'P-3', null, 3, 1, 300, 5], [4, 'S-4', null, 3, 4, 150, 7], [5, 'T-5', 'Synthetic hello', 0, 0, 400, 5]];
  for (const [id, guid, text, item, action, date, chat] of rows) { put.run(id, guid, text, item, action, date); join.run(chat, id); }
  db.close();
  const calls = [];
  const reader = createBackgroundReader({ dbPath: file, bin: 'imsg-under-test', engineDb: '/synthetic/chat.db', run: async (bin, args) => { calls.push([bin, ...args]); return JSON.stringify({ ok: true, chat_id: 5, background_set: false }) + '\n'; } });
  t.after(() => reader.close());
  assert.deepEqual([...reader.among(['S-1', 'C-2', 'P-3', 'T-5', 'S-4']).entries()].sort(), [['C-2', 'clear'], ['S-1', 'set'], ['S-4', 'set']], 'a group photo row and a message are neither');
  const latest = reader.latest();
  assert.deepEqual(latest.get('5'), { chatId: '5', guid: 'C-2', action: 'clear' }, 'the newest change is the chat\'s');
  assert.deepEqual(latest.get('7'), { chatId: '7', guid: 'S-4', action: 'set' });
  assert.deepEqual(await reader.status('5'), { ok: true, chat_id: 5, background_set: false });
  assert.deepEqual(calls, [['imsg-under-test', 'chat-background', 'status', '--chat-id', '5', '--json', '--db', '/synthetic/chat.db']], 'the engine is asked for the chat, of the database it reads');
  assert.equal(await reader.status('5; rm'), null, 'a chat id is only ever a number');
  assert.deepEqual(BACKGROUND_ACTIONS, { 4: 'set', 6: 'clear' });
});

test('a store from before backgrounds existed has none (issue 417)', (t) => {
  const file = path.join(scratch(t, 'bg-old'), 'chat.db');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT); CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);');
  db.close();
  const reader = createBackgroundReader({ dbPath: file, bin: 'imsg' });
  t.after(() => reader.close());
  assert.equal(reader.among(['X']).size, 0);
  assert.equal(reader.latest().size, 0);
});

test('a background is drawn only when the engine names a picture there is to draw (issue 417)', () => {
  const id = (a) => 'att:' + a.original_path;
  const set = { ok: true, background_set: true, watch_background_path: '/s/TranscriptBackgroundCache/G-watchBackground', watch_background_exists: true, file_size: 12, communication_safety_state: 0, latest_event: { guid: 'G', action: 'set' } };
  assert.deepEqual(mapBackground(set, { attachmentId: id }), { id: 'att:/s/TranscriptBackgroundCache/G-watchBackground', name: 'Background', mime: 'image/*', bytes: 12, sticker: false, missing: false });
  assert.equal(mapBackground({ ...set, watch_background_exists: false }, { attachmentId: id }), null, 'a picture Messages has not rendered yet');
  assert.equal(mapBackground({ ...set, latest_event: { guid: 'G', action: 'clear' } }, { attachmentId: id }), null, 'a background cleared since');
  assert.equal(mapBackground({ ...set, communication_safety_state: 2 }, { attachmentId: id }), null);
  assert.equal(mapBackground({ ok: true, background_set: false }, { attachmentId: id }), null);
  assert.equal(mapBackground(null, { attachmentId: id }), null);
});

test('the backdrop picture is read out of the property list Messages keeps it in, and served from that cache alone (issue 417)', async (t) => {
  const base = scratch(t, 'bg-serve');
  const root = path.join(base, 'Messages', 'Attachments');
  const cache = path.join(base, 'Messages', 'TranscriptBackgroundCache');
  mkdirSync(root, { recursive: true });
  mkdirSync(cache, { recursive: true });
  mkdirSync(path.join(base, 'Elsewhere'), { recursive: true });
  const png = gradientPng(36, 64);
  const plist = writePlist({ isHighKey: false, luminance: 0.25, backgroundImageData: png, extensionIdentifier: 'synthetic.background' });
  assert.ok(readPlist(plist).backgroundImageData.equals(png), 'the property list holds the picture as written');
  writeFileSync(path.join(cache, 'BG-1-watchBackground'), plist);
  writeFileSync(path.join(cache, 'BG-2-watchBackground'), writePlist({ luminance: 0.5 }));
  writeFileSync(path.join(base, 'Elsewhere', 'BG-3-watchBackground'), plist);
  const a = createAttachments({ attachmentsRoot: root, dataDir: path.join(base, 'data'), platform: 'linux' });
  const served = await a.resolve({ id: 'bg1', path: path.join(cache, 'BG-1-watchBackground'), mime: 'application/octet-stream' });
  assert.equal(served.mime, 'image/png', 'served as the picture it holds, never as the property list');
  assert.ok(readFileSync(served.file).equals(png));
  assert.equal(await a.resolve({ id: 'bg2', path: path.join(cache, 'BG-2-watchBackground'), mime: '' }), null, 'a list holding no picture serves nothing');
  assert.equal(await a.resolve({ id: 'bg3', path: path.join(base, 'Elsewhere', 'BG-3-watchBackground'), mime: '' }), null, 'nor does one outside the cache');
  assert.throws(() => readPlist(Buffer.from('not a list at all, just some words here to read')), /not a binary property list/);
});

test('the fake engine\'s background is a synthetic row in a synthetic group (issue 417)', () => {
  const { messages, backgrounds } = buildFixtures({ base: 0, imagePath: '/x', imageBytes: 1 });
  assert.equal(backgrounds.length, 1);
  const m = messages.find((x) => x.guid === backgrounds[0].guid);
  assert.equal(m.text, '');
  assert.deepEqual(m.attachments, []);
  assert.ok(SCRIPT.some((line) => line[5] === 'background'));
});

const event = (frames, name, test) => frames.find((f) => f.type === 'event' && f.name === name && test(f.data));

test('end to end: the history draws the line, the chat carries its backdrop, and a change on another phone reaches every client (issue 417)', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const { chats } = await (await s.get('/api/v1/chats', s.tokens.device)).json();
  const group = chats.find((c) => c.id === '2');
  assert.ok(group.background && group.background.id, 'the group carries its backdrop');
  const pic = await s.get('/api/v1/attachments/' + group.background.id, s.tokens.device);
  assert.equal(pic.status, 200);
  assert.equal(pic.headers.get('content-type'), 'image/png');
  assert.equal(chats.find((c) => c.id === '1').background, null, 'a chat with no background has none');
  const page = await (await s.get('/api/v1/chats/2/messages?limit=50', s.tokens.device)).json();
  const line = page.messages.find((m) => m.event && m.event.kind === 'background');
  assert.ok(line, 'the background change is in the history as an event');
  assert.equal(eventText(line), 'Priya Shah changed the background');
  assert.deepEqual(line.attachments, []);
  assert.equal(page.messages.filter((m) => !m.event && !m.text && !m.attachments.length).length, 0, 'and nothing in the history is an empty notice');

  const a = await openSocket(s.base);
  t.after(() => a.ws.close());
  a.ws.send(JSON.stringify({ type: 'auth', token: s.tokens.device }));
  await waitFor(() => a.frames.some((f) => f.type === 'hello'));
  const live = s.world.changeBackground(2, 'jordan@example.com');
  await waitFor(() => Boolean(event(a.frames, 'chat.changed', (d) => d.id === '2' && d.background && d.background.id !== group.background.id)));
  const arrived = event(a.frames, 'message.new', (d) => d.message.id === live.guid);
  assert.equal(arrived.data.message.event.kind, 'background');
  assert.equal(arrived.data.message.event.action, 'set');
  const cleared = s.world.changeBackground(2, 'jordan@example.com', { clear: true });
  await waitFor(() => Boolean(event(a.frames, 'chat.changed', (d) => d.id === '2' && d.background === null)));
  assert.equal(event(a.frames, 'message.new', (d) => d.message.id === cleared.guid).data.message.event.action, 'clear');
  const after = await (await s.get('/api/v1/chats', s.tokens.device)).json();
  assert.equal(after.chats.find((c) => c.id === '2').background, null, 'the list read afterwards agrees');
  assert.match(chatPreview(after.chats.find((c) => c.id === '2')), / removed the background$/, 'and its preview names the change');
});
test('a background whose picture Messages has not rendered yet is asked for again, never held as none (issue 417)', async () => {
  const bg = backgroundsFor([{ chatId: 5, guid: 'BG-9', action: 'set' }]);
  let rendered = false;
  let asked = 0;
  const status = bg.status;
  bg.status = async (id) => { asked += 1; const s = await status(id); return rendered ? s : { ...s, watch_background_exists: false }; };
  await withEngine([row()], bg, async (engine) => {
    assert.equal((await engine.chats({ photos: true })).find((c) => c.id === '5').background, null, 'nothing to draw yet');
    rendered = true;
    assert.ok((await engine.chats({ photos: true })).find((c) => c.id === '5').background, 'the picture once it is there');
    const before = asked;
    await engine.chats({ photos: true });
    assert.equal(asked, before, 'and a chat whose background has not changed is not asked again');
  });
});
