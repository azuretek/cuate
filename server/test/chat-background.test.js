import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../src/engine/index.js';
import { createLogger } from '../../core/kit/log.js';
import { logSpec } from '../src/paths.js';
import { eventText, chatPreview, applyMessageToChats } from '../../core/app/rules/chats.js';

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
