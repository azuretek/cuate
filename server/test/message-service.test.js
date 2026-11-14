// Each message carries the service it travelled on, from the store's own row, and a voice message is sent as Messages'
// own audio message (issue 520). A consumer that trusts a sender only over iMessage, because an SMS or RCS sender
// address can be forged, needs the message's service and never the chat's: one chat can hold rows of both.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { createLogger } from '../../core/kit/log.js';
import { logSpec } from '../src/paths.js';
import { normalizeConfig } from '../src/config.js';
import { openStore } from '../src/store.js';
import { createEngine } from '../src/engine/index.js';
import { createFakeImsg } from '../src/engine/fake.js';
import { createSender } from '../src/send.js';
import { makeAttachmentId } from '../src/ids.js';
import { createServiceReader } from '../src/engine/services.js';

const quiet = () => createLogger({ spec: logSpec, app: 'test', run: 'test', sink: () => {}, now: Date.now, level: 'debug', strict: true });

function rig() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'srv-service-'));
  const log = quiet();
  const store = openStore(path.join(dir, 'state.db'));
  const world = createFakeImsg({ attachmentsRoot: path.join(dir, 'attachments') });
  const engine = createEngine({ kind: 'fake', makeTransport: () => world.transport(), log: log.child('engine'), attachmentId: makeAttachmentId({ secret: 'test-secret', store }), sendTimeoutMs: 500, services: world.services, voices: world.voices });
  const config = normalizeConfig({ engine: { kind: 'fake' }, sending: { enabled: true, perMinute: 20 } });
  const send = createSender({ engine, store, config, log: log.child('send') });
  return { dir, world, engine, store, send, async close() { await engine.stop(); store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('every message carries the service its own row names, never the chat\'s', async (t) => {
  const r = rig();
  t.after(() => r.close());
  await r.engine.start();
  const first = (await r.engine.messages('1')).messages;
  assert.ok(first.length >= 2, 'the fixture chat holds messages');
  assert.ok(first.every((m) => m.service === 'iMessage'), 'each row reads as iMessage by default');
  r.world.setService(first[0].id, 'SMS');
  const again = (await r.engine.messages('1')).messages;
  assert.equal(again.find((m) => m.id === first[0].id).service, 'SMS', 'an SMS row in an iMessage chat reads as SMS');
  assert.equal(again.find((m) => m.id === first[1].id).service, 'iMessage');
});

test('the store reader reads message.service read-only, and names nothing for a store without the column', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'svc-db-'));
  try {
    const file = path.join(dir, 'chat.db');
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, service TEXT); INSERT INTO message (guid, service) VALUES ('g-a', 'iMessage'), ('g-b', 'SMS'), ('g-c', NULL)");
    db.close();
    const reader = createServiceReader({ dbPath: file });
    const found = reader.among(['g-a', 'g-b', 'g-c', 'g-missing']);
    assert.deepEqual([...found], [['g-a', 'iMessage'], ['g-b', 'SMS']]);
    assert.throws(() => reader.connection().exec("UPDATE message SET service = 'x'"), 'the connection is read-only');
    reader.close();
    const old = path.join(dir, 'old.db');
    const o = new DatabaseSync(old);
    o.exec("CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT); INSERT INTO message (guid) VALUES ('g-a')");
    o.close();
    assert.equal(createServiceReader({ dbPath: old }).among(['g-a']).size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a voice message goes out as an audio send.attachment, alone, and is refused without the bridge', async (t) => {
  const r = rig();
  t.after(() => r.close());
  await r.engine.start();
  const file = (await r.engine.messages('1')).messages.flatMap((m) => m.attachments)[0];
  const sent = await r.send('1', { file: file.id, voice: true }, 'key-voice-0001');
  assert.equal(sent.http, 201, JSON.stringify(sent));
  assert.deepEqual(r.world.voiceSends, [{ chatId: 1, file: r.store.getAttachment(file.id).path, audio: true }]);
  assert.equal(r.world.sends.length, 0, 'never the plain file send');
  const captioned = await r.send('1', { file: file.id, voice: true, text: 'words' }, 'key-voice-0002');
  assert.equal(captioned.http, 400);
  assert.equal(captioned.error[0], 'bad_voice');
  const bare = await r.send('1', { text: 'words', voice: true }, 'key-voice-0003');
  assert.equal(bare.error[0], 'bad_voice');
  r.world.behavior.bridge = 'down';
  await r.engine.checkBridge?.();
  const down = await r.send('1', { file: file.id, voice: true }, 'key-voice-0004');
  assert.equal(down.http, 422);
  assert.equal(down.error[0], 'voice_unsupported');
});
