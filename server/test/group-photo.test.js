import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { createEngine } from '../src/engine/index.js';
import { createAttachments } from '../src/attachments.js';
import { createLogger } from '../../core/kit/log.js';
import { logSpec } from '../src/paths.js';
import { mapMessage, isGroupPhotoRow, GROUP_PHOTO_NAME } from '../../core/app/rules/engine-imsg.js';
import { chatPreview, applyMessageToChats, eventText } from '../../core/app/rules/chats.js';

// Issue 341: a group photo change is an event and the group's picture, never a file; a sticker's picture is served from
// Messages' sticker cache. Every row here is synthetic.
const photoRow = (over = {}) => ({ id: 7, guid: 'G-7', chat_id: 5, is_from_me: false, sender: '+15550000001', sender_name: 'Sam Example', text: '', created_at: '2026-01-02T03:04:05.000Z', attachments: [{ transfer_name: GROUP_PHOTO_NAME, original_path: '/x/GroupPhotoImage', mime_type: '', total_bytes: 10, is_sticker: false, missing: false }], ...over });

test('a group photo row maps to a group photo event and no attachment (issue 341)', () => {
  assert.equal(isGroupPhotoRow(photoRow()), true);
  assert.equal(isGroupPhotoRow(photoRow({ text: 'look' })), false, 'a message with words is a message');
  assert.equal(isGroupPhotoRow(photoRow({ attachments: [{ transfer_name: 'IMG_1.HEIC' }] })), false, 'an ordinary picture is an attachment');
  const m = mapMessage(photoRow(), { attachmentId: () => 'att-1' });
  assert.deepEqual(m.attachments, []);
  assert.equal(m.event.kind, 'groupPhoto');
  assert.equal(m.event.photo.id, 'att-1');
  assert.equal(m.event.photo.mime, 'image/*', 'the type is the server\'s to read from the bytes');
  assert.equal(mapMessage(photoRow({ attachments: [{ ...photoRow().attachments[0], missing: true }] }), { attachmentId: () => 'a' }).event.photo, null, 'a missing photo is an event with no picture');
  assert.equal(mapMessage({ ...photoRow(), attachments: [], text: 'hi' }, { attachmentId: () => 'a' }).event, undefined, 'an ordinary message carries no event');
});

test('the list shows who changed the photo, and a live change becomes the group\'s picture (issue 341)', () => {
  const m = mapMessage(photoRow(), { attachmentId: () => 'att-2' });
  assert.equal(eventText(m), 'Sam Example changed the group photo');
  assert.equal(eventText({ ...m, fromMe: true }), 'You changed the group photo');
  const chats = [{ id: '5', name: 'Group', isGroup: true, unread: 0, lastMessageAt: '2026-01-01T00:00:00.000Z', lastMessage: null }];
  const r = applyMessageToChats(chats, m);
  assert.equal(r.chats[0].photo.id, 'att-2');
  assert.equal(chatPreview(r.chats[0]), 'Sam Example changed the group photo');
});

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

test('the chat list carries each group\'s latest photo, read once from its history (issue 341)', async () => {
  const older = photoRow({ id: 1, guid: 'G-1', created_at: '2025-01-01T00:00:00.000Z', attachments: [{ ...photoRow().attachments[0], original_path: '/x/old' }] });
  const newer = photoRow({ id: 2, guid: 'G-2', created_at: '2026-01-01T00:00:00.000Z', attachments: [{ ...photoRow().attachments[0], original_path: '/x/new' }] });
  const t = transport([newer, older, { id: 3, guid: 'G-3', chat_id: 5, text: 'hello', created_at: '2026-02-01T00:00:00.000Z', attachments: [] }]);
  const log = createLogger({ spec: logSpec, app: 'test', run: 'test', sink: () => {}, now: Date.now, level: 'debug', strict: true });
  const engine = createEngine({ kind: 'fake', makeTransport: () => t, log: log.child('engine'), attachmentId: (a) => 'att:' + a.original_path, timeoutMs: 2000 });
  await engine.start();
  try {
    assert.equal('photo' in (await engine.chats())[0], false, 'a listing for an export or a search reads no photos');
    assert.equal(t.asked.filter((m) => m === 'messages.history').length, 0, 'and pages no chat for one');
    const first = await engine.chats({ photos: true });
    assert.equal(first.find((c) => c.id === '5').photo.id, 'att:/x/new', 'the newest photo is the group\'s');
    assert.equal('photo' in first.find((c) => c.id === '6'), false, 'a conversation with one person has no group photo');
    const scans = t.asked.filter((m) => m === 'messages.history').length;
    await engine.chats({ photos: true });
    assert.equal(t.asked.filter((m) => m === 'messages.history').length, scans, 'a group is looked through once');
  } finally {
    await engine.stop();
  }
});

test('a sticker is served from the sticker cache beside the attachments, and a picture with no type is read (issue 341)', async (t) => {
  const base = mkdtempSync(path.join(os.tmpdir(), 'sticker-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'Messages', 'Attachments');
  const stickers = path.join(base, 'Messages', 'StickerCache', 's1');
  mkdirSync(root, { recursive: true });
  mkdirSync(stickers, { recursive: true });
  mkdirSync(path.join(base, 'Elsewhere'), { recursive: true });
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  writeFileSync(path.join(stickers, 'one-sticker.png'), png);
  writeFileSync(path.join(root, 'GroupPhotoImage'), png);
  writeFileSync(path.join(base, 'Elsewhere', 'secret.png'), png);
  const a = createAttachments({ attachmentsRoot: root, dataDir: path.join(base, 'data'), platform: 'linux' });
  const sticker = await a.resolve({ id: 's', path: path.join(stickers, 'one-sticker.png'), mime: 'image/png' });
  assert.ok(sticker && readFileSync(sticker.file).equals(png), 'the sticker is served');
  assert.equal(await a.resolve({ id: 'x', path: path.join(base, 'Elsewhere', 'secret.png'), mime: 'image/png' }), null, 'nothing outside the two folders is');
  const photo = await a.resolve({ id: 'g', path: path.join(root, 'GroupPhotoImage'), mime: '' });
  assert.equal(photo.mime, 'image/png', 'a group photo with no recorded type is served as what its bytes are');
});
