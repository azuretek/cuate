import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLogger } from '../../core/kit/log.js';
import { logSpec } from '../src/paths.js';
import { createEngine } from '../src/engine/index.js';
import { createFakeImsg } from '../src/engine/fake.js';
import { makeAttachmentId } from '../src/ids.js';
import { openStore } from '../src/store.js';
import { createExporter, validateExport, exportSpec } from '../src/export.js';
import { boot } from './helpers.js';

function harness() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'export-test-'));
  const lines = [];
  const logger = createLogger({ spec: logSpec, app: 'test', run: 'test', sink: (l) => lines.push(l), now: Date.now, level: 'debug', strict: true });
  const store = openStore(path.join(dir, 'state.db'));
  const root = path.join(dir, 'attachments');
  const world = createFakeImsg({ attachmentsRoot: root });
  const engine = createEngine({ kind: 'fake', makeTransport: () => world.transport(), log: logger.child('engine'), attachmentId: makeAttachmentId({ secret: 'test-secret', store }) });
  return {
    dir, lines, logger, engine, world,
    start: () => engine.start(),
    close: async () => { await engine.stop(); store.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}

test('the export schema owns a shape and rejects a document that does not conform', () => {
  assert.ok(exportSpec.models.Export, 'the schema declares the Export model');
  const bad = { specVersion: 1, exportedAt: 'now', mode: 'full', since: null, serverVersion: '0.0.0', chats: [], messages: [], attachments: [], extra: 1 };
  assert.ok(validateExport(bad).length > 0, 'an undeclared key fails');
  assert.ok(validateExport({}).length > 0, 'a missing document fails');
});

test('a full export conforms, names every chat and carries its messages', async (t) => {
  const h = harness();
  t.after(() => h.close());
  await h.start();
  const doc = await createExporter({ engine: h.engine, dataDir: h.dir, log: h.logger.child('export') }).collect();
  assert.deepEqual(validateExport(doc), []);
  assert.equal(doc.mode, 'full');
  assert.equal(doc.since, null);
  assert.equal(doc.specVersion, exportSpec.version);
  assert.ok(doc.chats.length > 0);
  assert.ok(doc.messages.length > 0);
  for (const m of doc.messages) assert.ok(doc.chats.some((c) => c.id === m.chatId), 'every message belongs to a chat');
  assert.ok(!h.lines.some((l) => l.event === 'log.undeclared'), 'every event is declared');
});

test('writing an export records the mark, and the next one carries only what is new', async (t) => {
  const h = harness();
  t.after(() => h.close());
  await h.start();
  const exporter = createExporter({ engine: h.engine, dataDir: h.dir, log: h.logger.child('export') });
  const first = path.join(h.dir, 'out', 'first.json');
  const r1 = await exporter.write(first);
  assert.deepEqual(JSON.parse(readFileSync(first, 'utf8')), r1.doc);
  assert.ok(r1.doc.messages.length > 0);
  assert.equal(exporter.lastExport(), r1.doc.exportedAt);

  await new Promise((r) => setTimeout(r, 30));
  const chatId = Number(r1.doc.chats[0].id);
  h.world.incoming(chatId, 'A message after the first export');

  const r2 = await exporter.write(path.join(h.dir, 'out', 'second.json'), { mode: 'since' });
  assert.equal(r2.doc.mode, 'since');
  assert.equal(r2.doc.since, r1.doc.exportedAt);
  assert.ok(r2.doc.messages.length >= 1, 'the new message is there');
  assert.ok(r2.doc.messages.every((m) => m.sentAt > r2.doc.since), 'nothing older than the mark is carried');
});

test('the export route hands the document to a tooling token and refuses a device token', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const r = await s.get('/api/v1/export', s.tokens.tooling);
  assert.equal(r.status, 200);
  const doc = await r.json();
  assert.deepEqual(validateExport(doc), [], 'the served document conforms to the export schema');
  assert.ok(doc.chats.length > 0, 'every chat is named');
  assert.ok(doc.messages.length > 0, 'the messages are carried');
  assert.equal((await s.get('/api/v1/export', s.tokens.device)).status, 403, 'a device token has no export scope');
  assert.equal((await s.get('/api/v1/export?mode=weird', s.tokens.tooling)).status, 400);
  const since = await s.get('/api/v1/export?mode=since', s.tokens.tooling);
  assert.equal(since.status, 200);
  assert.deepEqual(validateExport(await since.json()), [], 'the since mode conforms too');
});
