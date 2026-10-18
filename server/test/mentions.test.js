// Issue 453: a confirmed mention is an attribute on the stretch of words that reads as the name, its value the address
// of the person mentioned, in the store's attributedBody column, read by the same reader as the text effects (issue 433)
// and the formatting (issue 447). imsg carries none of it, so a mention reached the app as plain words. The bodies here
// were archived by Foundation's own NSArchiver from synthetic words and addresses
// (server/test/fixtures/mention-bodies.json); every row is synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { createEngine } from '../src/engine/index.js';
import { createLogger } from '../../core/kit/log.js';
import { logSpec } from '../src/paths.js';
import { createRichTextReader, richRuns } from '../src/engine/rich-text.js';
import { stylesFromRuns } from '../../core/app/rules/text-styles.js';
import { styledParts } from '../../core/app/rules/links.js';
import { apiSpec } from '../src/paths.js';
import { validate } from '../../core/kit/rules/schema.js';
import { boot } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const BODIES = JSON.parse(readFileSync(path.join(here, 'fixtures', 'mention-bodies.json'), 'utf8')).bodies;
const body = (name) => Buffer.from(BODIES[name].base64, 'base64');

test('an archived body reads as its words and each mention with the address it stands for (issue 453)', () => {
  assert.deepEqual(richRuns(body('mention')), { text: 'Sam are you coming?', runs: [{ start: 0, length: 3, mention: '+15555550123' }] });
  assert.deepEqual(richRuns(body('twoMentions')).runs, [
    { start: 0, length: 5, mention: 'riley@example.com' },
    { start: 10, length: 3, mention: '+15555550123' },
    { start: 15, length: 6, bold: 1 },
  ]);
});

test('the model carries each mention, and the bubble cuts its words by it beside every other style (issue 453)', () => {
  const two = richRuns(body('twoMentions'));
  const styles = stylesFromRuns(two.text, two.runs);
  assert.deepEqual(styles, [
    { start: 0, length: 5, mention: 'riley@example.com' },
    { start: 10, length: 3, mention: '+15555550123' },
    { start: 15, length: 6, bold: true },
  ]);
  for (const s of styles) assert.deepEqual(validate(s, 'TextStyle', apiSpec.models), []);
  assert.deepEqual(styledParts(two.text, styles), [
    { text: 'Riley', mention: 'riley@example.com' },
    { text: ' and ' },
    { text: 'Sam', mention: '+15555550123' },
    { text: ', ' },
    { text: 'dinner', bold: true },
    { text: ' at 7' },
  ]);
  // Two mentions side by side stay two, each its own person.
  assert.deepEqual(styledParts('AB', [{ start: 0, length: 1, mention: 'a@example.com' }, { start: 1, length: 1, mention: 'b@example.com' }]).map((p) => p.mention), ['a@example.com', 'b@example.com']);
  assert.deepEqual(stylesFromRuns('AB', [{ start: 0, length: 1, mention: '' }]), [], 'a mention of nobody is no mention');
});

test('the store reader reads a row whose words carry only a mention (issue 453)', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mention-store-'));
  const file = path.join(dir, 'chat.db');
  const db = new DatabaseSync(file);
  const reader = createRichTextReader({ dbPath: file });
  // Close everything that holds the file before the folder is removed: on Windows a directory with an open handle cannot be removed.
  t.after(() => { reader.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });
  db.exec('CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, text TEXT, attributedBody BLOB)');
  db.prepare('INSERT INTO message (ROWID, guid, text, attributedBody) VALUES (?, ?, ?, ?)').run(1, 'MEN-1', null, body('mention'));
  assert.deepEqual(reader.among(['MEN-1']).get('MEN-1').runs, [{ start: 0, length: 3, mention: '+15555550123' }]);
});

// The engine as imsg answers it: a group's words, and no mark of any mention on them.
function transport(rows) {
  const lineCbs = new Set();
  const send = (o) => setImmediate(() => { for (const cb of lineCbs) cb(JSON.stringify(o)); });
  return {
    write(s) {
      const req = JSON.parse(s);
      if (req.method === 'status') return send({ jsonrpc: '2.0', id: req.id, result: { version: 't', database: { ready: true }, methods: [], capabilities: { features: {} } } });
      if (req.method === 'watch.subscribe') return send({ jsonrpc: '2.0', id: req.id, result: { subscription: 1 } });
      if (req.method === 'chats.list') return send({ jsonrpc: '2.0', id: req.id, result: { chats: [{ id: 7, display_name: 'Weekend plans', is_group: true }] } });
      if (req.method === 'messages.history') return send({ jsonrpc: '2.0', id: req.id, result: { messages: rows } });
      return send({ jsonrpc: '2.0', id: req.id, result: { ok: true } });
    },
    onLine(cb) { lineCbs.add(cb); },
    onExit() {},
    close() { return Promise.resolve(); },
  };
}

async function withEngine(rows, richText, fn) {
  const lines = [];
  const log = createLogger({ spec: logSpec, app: 'test', run: 'test', sink: (l) => lines.push(l), now: Date.now, level: 'debug', strict: true });
  const engine = createEngine({ kind: 'fake', makeTransport: () => transport(rows), log: log.child('engine'), attachmentId: (a) => 'att:' + a.original_path, timeoutMs: 2000, richText });
  await engine.start();
  try {
    await fn(engine, lines);
  } finally {
    await engine.stop();
  }
}

const row = (over) => ({ id: 1, guid: 'MEN-1', chat_id: 7, is_from_me: false, sender: 'jordan@example.com', text: 'Sam are you coming?', created_at: '2026-01-02T03:04:05.000Z', attachments: [], ...over });

test('a mention lands only on the words it was laid on: words that changed since, or a store that cannot be read, draw plain (issue 453)', async () => {
  const held = richRuns(body('mention'));
  const store = { among: (guids) => new Map(guids.filter((g) => g === 'MEN-1' || g === 'MEN-2').map((g) => [g, held])) };
  await withEngine([row(), row({ id: 2, guid: 'MEN-2', text: 'Pam are you coming?' })], store, async (engine) => {
    const { messages } = await engine.messages('7');
    assert.deepEqual(messages.find((m) => m.id === 'MEN-1').styles, [{ start: 0, length: 3, mention: '+15555550123' }]);
    assert.equal(messages.find((m) => m.id === 'MEN-2').styles, undefined, 'a mention never names a person over words it was not laid on');
  });
  const broken = { among: () => { throw Object.assign(new Error('the store at a private path is locked'), { code: 'SQLITE_BUSY' }); } };
  await withEngine([row()], broken, async (engine, lines) => {
    const { messages } = await engine.messages('7');
    assert.equal(messages[0].text, 'Sam are you coming?');
    assert.equal(messages[0].styles, undefined, 'the words draw plain');
    assert.equal(lines.find((l) => l.event === 'richtext.failed')?.error, 'SQLITE_BUSY', 'and the failure is a declared line, named by its code');
  });
});

test('a mention reaches the model through every read (issue 453)', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const { messages } = await (await s.get('/api/v1/chats/2/messages?limit=50', s.tokens.device)).json();
  const m = messages.find((x) => (x.styles || []).some((st) => st.mention));
  assert.ok(m, 'the group carries a message with a mention');
  assert.equal(m.text, 'Jordan, can you grab ice on the way?');
  assert.deepEqual(m.styles, [{ start: 0, length: 6, mention: 'jordan@example.com' }]);
  assert.deepEqual(validate(m, 'Message', apiSpec.models), []);
});
