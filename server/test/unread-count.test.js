// Issue 389, our own layer: imsg's chat list carries an unread_count that includes every unread inbound row, and
// Messages writes a group membership change, a rename or another group action as a row with no text and nothing to
// show that it never marks read and never counts. So a chat whose only unread rows are those event rows read as
// unread here with nothing a person sent. The adapter counts each unread chat's ordinary messages instead, so such a
// chat reads as 0 while a genuine unread message still counts. The engine's own count cannot be trusted until
// openclaw/imsg skips item_type <> 0 (the upstream issue this PR drafts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { createEngine } from '../src/engine/index.js';
import { createFakeImsg } from '../src/engine/fake.js';
import { createLogger } from '../../core/kit/log.js';
import { logSpec } from '../src/paths.js';
import { UNREAD_SCAN_ROWS, UNREAD_SCAN_PAGES } from '../../core/app/rules/engine-imsg.js';

async function withEngine(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'unread-'));
  const lines = [];
  const log = createLogger({ spec: logSpec, app: 'test', run: 'test', sink: (l) => lines.push(l), now: Date.now, level: 'debug', strict: true });
  const world = createFakeImsg({ attachmentsRoot: dir });
  const engine = createEngine({ kind: 'fake', makeTransport: () => world.transport(), log: log.child('engine'), attachmentId: () => 'att' });
  await engine.start();
  try {
    await fn({ world, engine, lines });
  } finally {
    await engine.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a chat whose only unread rows are engine event rows reads as 0, and a real unread message still counts (issue 389)', async () => {
  await withEngine(async ({ world, engine }) => {
    // Chat 3 starts read. Two group actions leave it unread_count: 2 in the engine, with no message a person sent.
    world.incomingEvent(3);
    world.incomingEvent(3);
    let list = await engine.chats({ recountUnread: true });
    assert.equal(list.find((c) => c.id === '3').unread, 0, 'two event rows do not make a chat unread here');
    // A genuine unread message still counts.
    world.incoming(3, 'Synthetic unread');
    list = await engine.chats({ recountUnread: true });
    assert.equal(list.find((c) => c.id === '3').unread, 1, 'a real unread message counts');
    // A group photo change is an event row that carries an attachment; it does not count either.
    world.incomingEvent(3, { attachments: [{ transfer_name: 'GroupPhotoImage', mime_type: '', total_bytes: 10, is_sticker: false, missing: false, original_path: '/x/GroupPhotoImage' }] });
    list = await engine.chats({ recountUnread: true });
    assert.equal(list.find((c) => c.id === '3').unread, 1, 'a group photo change beside one real message still reads 1');
    // The fixture conversation (chat 1) keeps its one genuine unread message.
    list = await engine.chats({ recountUnread: true });
    assert.equal(list.find((c) => c.id === '1').unread, 1, 'a genuine unread message is kept');
    // A caller that does not ask for the recount (an export, a search) leaves the engine's own number alone and pages
    // no chat.
    const plain = await engine.chats();
    assert.equal(plain.find((c) => c.id === '3').unread, 4, 'without the recount the engine\'s own count carries all four rows, the three event rows included');
  });
});

// Issue 389, the scan bound: a genuine unread message deeper than one page must still be found, so it is never
// silently dropped.
test('a genuine unread message past the first page still counts (issue 389)', async () => {
  await withEngine(async ({ world, engine }) => {
    const base = Date.now() - 60000;
    const at = (ms) => new Date(ms).toISOString();
    // Chat 3 starts read and its fixture messages are days old. Put one genuine unread message well behind a page of
    // newer, already read messages, so only a second page of the scan can reach it.
    world.incoming(3, 'Synthetic unread behind a page', undefined, { created_at: at(base - 100 * 60000) });
    for (let i = 0; i < UNREAD_SCAN_ROWS + 20; i++) world.inboundRead(3, 'later ' + i, { created_at: at(base - 99 * 60000 + i * 1000) });
    const list = await engine.chats({ recountUnread: true });
    assert.equal(list.find((c) => c.id === '3').unread, 1, 'the unread message behind the first page still counts');
  });
});

// Issue 389, the fail safe: a chat whose unread rows sit beyond the whole page bound keeps the engine's own number,
// never a false zero, because the scan cannot prove they are not messages.
test('unread rows beyond the page bound are never silently dropped to zero (issue 389)', async () => {
  await withEngine(async ({ world, engine }) => {
    const base = Date.now() - 60000;
    const at = (ms) => new Date(ms).toISOString();
    // Chat 2 starts read. Its one unread row sits behind more read messages than the whole bound can scan, so the
    // recount cannot reach it; the engine's own number is kept instead of reporting nothing.
    world.incoming(2, 'Synthetic unread beyond the bound', undefined, { created_at: at(base - 100 * 60000) });
    for (let i = 0; i < UNREAD_SCAN_ROWS * UNREAD_SCAN_PAGES + 20; i++) world.inboundRead(2, 'later ' + i, { created_at: at(base - 99 * 60000 + i * 1000) });
    const list = await engine.chats({ recountUnread: true });
    assert.equal(list.find((c) => c.id === '2').unread, 1, 'the engine number is kept, never a false zero');
  });
});
