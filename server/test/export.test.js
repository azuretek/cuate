import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createLogger } from '../../core/kit/log.js';
import { logSpec, apiSpec } from '../src/paths.js';
import { createEngine } from '../src/engine/index.js';
import { createFakeImsg } from '../src/engine/fake.js';
import { makeAttachmentId } from '../src/ids.js';
import { openStore } from '../src/store.js';
import { createExporter, validateExport, exportSpec, EXPORT_RUNNING, EXPORT_ABANDONED } from '../src/export.js';
import { boot, waitFor } from './helpers.js';

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
  const mark = JSON.parse(readFileSync(path.join(h.dir, 'export.json'), 'utf8'));
  assert.equal(mark.exportedAt, r1.doc.exportedAt);
  assert.ok(Number.isFinite(mark.lastRowid), 'the mark carries the engine ROWID the sweep reached');

  await new Promise((r) => setTimeout(r, 30));
  const chatId = Number(r1.doc.chats[0].id);
  h.world.incoming(chatId, 'A message after the first export');

  const r2 = await exporter.write(path.join(h.dir, 'out', 'second.json'), { mode: 'since' });
  assert.equal(r2.doc.mode, 'since');
  assert.equal(r2.doc.since, r1.doc.exportedAt);
  assert.ok(r2.doc.messages.length >= 1, 'the new message is there');
  assert.ok(r2.doc.messages.every((m) => m.sentAt > r2.doc.since), 'nothing older than the mark is carried');
});

test('a full export sweeps the engine cursor, so its round trips follow the history and not the chat count', async (t) => {
  const h = harness();
  t.after(() => h.close());
  await h.start();
  const exporter = createExporter({ engine: h.engine, dataDir: h.dir, log: h.logger.child('export'), pageSize: 4 });
  const doc = await exporter.collect();
  assert.deepEqual(validateExport(doc), []);
  const sweeps = h.world.requests.filter((m) => m === 'messages.after').length;
  const perChat = h.world.requests.filter((m) => m === 'messages.history').length;
  assert.equal(perChat, 0, 'the export never pages a chat');
  assert.equal(sweeps, Math.ceil(doc.messages.length / 4), 'one sweep page per four messages, whatever the chat count is');
  assert.ok(sweeps < doc.chats.length + doc.messages.length, 'the sweep is not one call per chat');
  assert.ok(h.lines.some((l) => l.event === 'export.page' && l.ms >= 0), 'every page is timed');
  assert.ok(!h.lines.some((l) => l.event === 'log.undeclared'), 'every event is declared');
});

test('a since export over a mark written before the rowid cursor filters on the mark time, then carries a cursor', async (t) => {
  const h = harness();
  t.after(() => h.close());
  await h.start();
  const exporter = createExporter({ engine: h.engine, dataDir: h.dir, log: h.logger.child('export') });
  const first = await exporter.write(path.join(h.dir, 'out', 'first.json'));
  writeFileSync(path.join(h.dir, 'export.json'), JSON.stringify({ exportedAt: first.doc.exportedAt }) + '\n');
  await new Promise((r) => setTimeout(r, 30));
  h.world.incoming(1, 'A message after a mark with no cursor');
  const second = await exporter.write(path.join(h.dir, 'out', 'second.json'), { mode: 'since' });
  assert.equal(second.doc.mode, 'since');
  assert.ok(second.doc.messages.length >= 1, 'the new message is carried');
  assert.ok(second.doc.messages.every((m) => m.sentAt > second.doc.since), 'nothing older than the mark is carried');
  assert.ok(Number.isFinite(JSON.parse(readFileSync(path.join(h.dir, 'export.json'), 'utf8')).lastRowid), 'the run leaves a cursor behind');
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

test('a full export asks for the whole chat list, not the client page bound, so nothing is capped', async (t) => {
  const h = harness();
  t.after(() => h.close());
  await h.start();
  const asked = [];
  const engine = { ...h.engine, chats: (opts) => { asked.push(opts && opts.limit); return h.engine.chats(opts); } };
  const doc = await createExporter({ engine, dataDir: h.dir }).collect();
  assert.equal(asked.length, 1, 'the chat list is read once');
  assert.ok(asked[0] > apiSpec.paging.chats.max, 'the read is not the client page bound');
  assert.deepEqual(validateExport(doc), []);
});

test('an export refuses a document whose messages name a chat its list does not carry', async (t) => {
  const h = harness();
  t.after(() => h.close());
  await h.start();
  // A cap below the chats that carry messages stands in for the client page bound the export used to read: the sweep
  // still carries chat 3's messages, so the run must refuse rather than hand tooling a message with no chat.
  await assert.rejects(() => createExporter({ engine: h.engine, dataDir: h.dir, chatLimit: 2 }).collect(), /does not name/);
});

test('a full export names every chat in a database larger than the client page bound', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'export-big-'));
  try {
    const many = Array.from({ length: 1200 }, (_, i) => ({ id: String(i + 1), name: 'chat ' + (i + 1), isGroup: false, service: 'iMessage', participants: [], lastMessageAt: null }));
    const asked = [];
    const engine = {
      chats: async (opts) => { asked.push(opts.limit); return many; },
      after: async ({ sinceRowid }) => ({
        messages: [{ id: 'm-1200', chatId: '1200', fromMe: false, sender: null, senderName: null, text: 'hi', sentAt: '2026-01-01T00:00:00.000Z', replyTo: null, read: null, attachments: [], reactions: [] }],
        nextRowid: sinceRowid + 1,
        hasMore: false,
      }),
    };
    const doc = await createExporter({ engine, dataDir: dir }).collect();
    assert.ok(asked[0] > apiSpec.paging.chats.max, 'the whole list is read, not a capped page');
    assert.equal(doc.chats.length, 1200, 'every chat is named');
    assert.ok(doc.messages.every((m) => doc.chats.some((c) => c.id === m.chatId)), 'every message belongs to a named chat');
    assert.deepEqual(validateExport(doc), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an export leaves out a message that belongs to no chat, and records how many', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'export-nochat-'));
  try {
    const lines = [];
    const logger = createLogger({ spec: logSpec, app: 'test', run: 'test', sink: (l) => lines.push(l), now: Date.now, level: 'debug', strict: true });
    const chats = [{ id: '1', name: 'Avery Quinn', isGroup: false, service: 'iMessage', participants: [], lastMessageAt: null }];
    // A message the engine reports with chat 0 belongs to no chat: the list never names it, and a real database on the
    // Mac has such rows. The run carries the chat's message and leaves the chatless one out rather than fail or half
    // name the document (issue 48).
    const engine = {
      chats: async () => chats,
      after: async ({ sinceRowid }) => ({
        messages: [
          { id: 'm-1', chatId: '1', fromMe: false, sender: null, senderName: null, text: 'hello', sentAt: '2026-01-01T00:00:00.000Z', replyTo: null, read: null, attachments: [], reactions: [] },
          { id: 'm-2', chatId: '0', fromMe: false, sender: null, senderName: null, text: 'no chat', sentAt: '2026-01-01T00:00:01.000Z', replyTo: null, read: null, attachments: [], reactions: [] },
        ],
        nextRowid: sinceRowid + 2,
        hasMore: false,
      }),
    };
    const exporter = createExporter({ engine, dataDir: dir, log: logger.child('export') });
    const doc = await exporter.collect();
    assert.deepEqual(validateExport(doc), [], 'the document conforms');
    assert.equal(doc.messages.length, 1, 'the message that belongs to a chat is carried');
    assert.equal(doc.messages[0].chatId, '1');
    assert.ok(doc.messages.every((m) => doc.chats.some((c) => c.id === m.chatId)), 'every message names a chat');
    await exporter.write(path.join(dir, 'out.json'));
    assert.ok(lines.some((l) => l.event === 'export.written' && l.chatless === 1), 'the left-out message is counted');
    assert.ok(!lines.some((l) => l.event === 'log.undeclared'), 'every event is declared');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Issue 107: an export holds the engine for minutes on a real database, so one whose caller has gone must stop paging,
// and a second one must be refused rather than compete with the first for the engine.
const sweepPages = (world) => world.requests.filter((m) => m === 'messages.after').length;

test('an export whose caller goes away stops at the page in flight, and frees the engine for the next one', async (t) => {
  const h = harness();
  t.after(() => h.close());
  await h.start();
  const exporter = createExporter({ engine: h.engine, dataDir: h.dir, log: h.logger.child('export'), pageSize: 1 });
  h.world.behavior.afterDelayMs = 40;
  const abandoned = new AbortController();
  const run = exporter.collect({ signal: abandoned.signal });
  await waitFor(() => sweepPages(h.world) === 1);
  abandoned.abort();
  await assert.rejects(run, (e) => e.code === EXPORT_ABANDONED);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(sweepPages(h.world), 1, 'no page is asked for after the caller went away');
  assert.ok(h.lines.some((l) => l.event === 'export.abandoned' && l.pages === 1), 'the stop is logged with the pages it swept');
  assert.equal(exporter.running(), false, 'the engine is free again');
  h.world.behavior.afterDelayMs = 0;
  assert.deepEqual(validateExport(await exporter.collect()), [], 'the next export runs and conforms');
  assert.ok(!h.lines.some((l) => l.event === 'log.undeclared'), 'every event is declared');
});

test('a second export while one is sweeping is refused, and the first completes and conforms', async (t) => {
  const h = harness();
  t.after(() => h.close());
  await h.start();
  const exporter = createExporter({ engine: h.engine, dataDir: h.dir, log: h.logger.child('export'), pageSize: 4 });
  h.world.behavior.afterDelayMs = 20;
  const first = exporter.collect();
  await waitFor(() => sweepPages(h.world) >= 1);
  await assert.rejects(exporter.collect(), (e) => e.code === EXPORT_RUNNING);
  await assert.rejects(exporter.write(path.join(h.dir, 'out.json')), (e) => e.code === EXPORT_RUNNING, 'a written export waits its turn too');
  const doc = await first;
  assert.deepEqual(validateExport(doc), [], 'the first export completes and conforms');
  assert.equal(sweepPages(h.world), Math.ceil(doc.messages.length / 4), 'only the first export swept the engine');
  assert.deepEqual(validateExport(await exporter.collect()), [], 'once it has finished the next one runs');
});

// A route-level history big enough for the server's own page size to need several pages.
const growHistory = (world, n) => { for (let i = 0; i < n; i += 1) world.incoming(1, 'history ' + i); };

test('the export route stops sweeping when its client disconnects, and the server goes on answering', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  growHistory(s.world, 1100);
  s.world.behavior.afterDelayMs = 150;
  const before = sweepPages(s.world);
  const req = http.get(s.base + '/api/v1/export', { headers: { authorization: 'Bearer ' + s.tokens.tooling } });
  req.on('error', () => {});
  await waitFor(() => sweepPages(s.world) === before + 1);
  req.destroy();
  await waitFor(() => s.lines.some((l) => l.event === 'export.abandoned'));
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(sweepPages(s.world), before + 1, 'the sweep made no call after its client went away');
  assert.ok(s.lines.some((l) => l.event === 'http.request' && l.route === 'export' && l.status === 499), 'the request is logged as closed by its client');
  assert.ok(!s.lines.some((l) => l.event === 'http.error' && l.route === 'export'), 'an abandoned export is not a server error');
  assert.equal((await s.get('/api/v1/chats', s.tokens.tooling)).status, 200, 'the chat list answers straight afterwards');
  s.world.behavior.afterDelayMs = 0;
  const next = await s.get('/api/v1/export', s.tokens.tooling);
  assert.equal(next.status, 200, 'a new export runs once the abandoned one has stopped');
  assert.deepEqual(validateExport(await next.json()), []);
});

test('the export route answers a concurrent export 409 export_running and keeps serving other requests', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  growHistory(s.world, 1100);
  s.world.behavior.afterDelayMs = 150;
  let settled = false;
  const first = s.get('/api/v1/export', s.tokens.tooling).then((r) => { settled = true; return r; });
  await waitFor(() => sweepPages(s.world) >= 1);
  const second = await s.get('/api/v1/export?mode=since', s.tokens.tooling);
  assert.equal(second.status, 409, 'the second export is refused');
  assert.equal((await second.json()).error.code, 'export_running', 'with a status that says why');
  assert.equal((await s.get('/api/v1/chats', s.tokens.tooling)).status, 200, 'the chat list answers while the export sweeps');
  assert.equal(settled, false, 'the first export was still sweeping');
  const r = await first;
  assert.equal(r.status, 200, 'the first export completes');
  const doc = await r.json();
  assert.deepEqual(validateExport(doc), [], 'and conforms');
  assert.ok(doc.messages.length > 1100, 'with the whole history');
  assert.ok(!s.lines.some((l) => l.event === 'log.undeclared'), 'every event is declared');
});
