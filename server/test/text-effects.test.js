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
import { readAttributedString, readTypedStream } from '../src/engine/typedstream.js';
import { TEXT_RUNS } from '../src/engine/fixtures.js';
import { stylesFromRuns, letters, TEXT_EFFECT_IDS } from '../../core/app/rules/text-styles.js';
import { styledParts } from '../../core/app/rules/links.js';
import { boot } from './helpers.js';

// Issue 433: a sender's text effect (Big, Small, Shake, Nod, Explode, Ripple, Bloom, Jitter) is an attribute on a
// stretch of the words Messages keeps in the store's attributedBody column. imsg recovers the words and none of the
// attributes, so the message reached the app as plain words. The bodies here were archived by Foundation's own
// NSArchiver from synthetic words (server/test/fixtures/attributed-bodies.json); every row is synthetic.
const here = path.dirname(fileURLToPath(import.meta.url));
const BODIES = JSON.parse(readFileSync(path.join(here, 'fixtures', 'attributed-bodies.json'), 'utf8')).bodies;
const body = (name) => Buffer.from(BODIES[name].base64, 'base64');

test('an archived attributed body reads as its words and the effect over each stretch (issue 433)', () => {
  const bloom = readAttributedString(body('bloom'));
  assert.equal(bloom.text, 'Happy birthday!');
  assert.deepEqual(bloom.runs.map((r) => [r.start, r.length, r.attributes.get('__kIMTextEffectAttributeName') ?? null]), [[0, 6, null], [6, 9, 6]]);
  const big = readAttributedString(body('big'));
  assert.equal(big.text, BODIES.big.text, 'words beyond one byte a letter read whole');
  assert.deepEqual(big.runs.map((r) => [r.start, r.length]), [[0, 17]], 'and a run counts UTF-16 code units, as NSString does');
  assert.deepEqual(richRuns(body('plain')), { text: 'Just words', runs: [] }, 'a body with no effect has no runs to draw');
  assert.equal(richRuns(Buffer.from('not a typedstream at all')), null, 'and one that is not an archive reads as none');
  assert.throws(() => readTypedStream(body('bloom').subarray(0, 40)), /damaged typedstream/, 'a body cut short is refused, never guessed past');
});

test('the effect numbers are the ones Messages records (issue 433)', () => {
  assert.deepEqual(TEXT_EFFECT_IDS, { 4: 'ripple', 5: 'big', 6: 'bloom', 8: 'nod', 9: 'shake', 10: 'jitter', 11: 'small', 12: 'explode' });
});

// A scratch folder, removed by one hook that first closes every holder: on Windows a folder with an open handle cannot
// be removed.
const scratch = (t, name) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), name + '-'));
  const holders = [];
  t.after(() => { for (const h of holders) h.close(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, hold: (h) => { holders.push(h); return h; } };
};

test('the store reader reads the effects of the rows asked about, and only of rows that carry one (issue 433)', (t) => {
  const { dir, hold } = scratch(t, 'rich-store');
  const file = path.join(dir, 'chat.db');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, text TEXT, attributedBody BLOB)');
  const put = db.prepare('INSERT INTO message (ROWID, guid, text, attributedBody) VALUES (?, ?, ?, ?)');
  put.run(1, 'FX-1', null, body('bloom'));
  put.run(2, 'FX-2', null, body('inline'));
  put.run(3, 'PLAIN-3', null, body('plain'));
  put.run(4, 'NONE-4', 'Synthetic words', null);
  put.run(5, 'FX-5', null, body('big'));
  db.close();
  const reader = hold(createRichTextReader({ dbPath: file }));
  const found = reader.among(['FX-1', 'FX-2', 'PLAIN-3', 'NONE-4', 'MISSING']);
  assert.deepEqual([...found.keys()].sort(), ['FX-1', 'FX-2'], 'a row with no effect, no body or no row is not named');
  assert.deepEqual(found.get('FX-1'), { text: 'Happy birthday!', runs: [{ start: 6, length: 9, effect: 6 }] });
  assert.deepEqual(found.get('FX-2').runs, [{ start: 1, length: 4, effect: 10 }]);
  assert.equal(reader.among([]).size, 0);

  const { dir: oldDir } = scratch(t, 'rich-old');
  const old = path.join(oldDir, 'chat.db');
  const odb = new DatabaseSync(old);
  odb.exec('CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, text TEXT)');
  odb.close();
  assert.equal(hold(createRichTextReader({ dbPath: old })).among(['X']).size, 0, 'a store with no attributed bodies has no effects');
});

test('a stretch is moved back past the placeholders the model strips, and an effect we do not know is left out (issue 433)', () => {
  assert.deepEqual(stylesFromRuns('\uFFFCLook at this', [{ start: 1, length: 4, effect: 10 }]), [{ start: 0, length: 4, effect: 'jitter' }]);
  assert.deepEqual(stylesFromRuns('ab\uFFFCcd', [{ start: 0, length: 5, effect: 5 }]), [{ start: 0, length: 4, effect: 'big' }], 'a placeholder inside a stretch shortens it');
  assert.deepEqual(stylesFromRuns('\uFFFC', [{ start: 0, length: 1, effect: 5 }]), [], 'a stretch of placeholders alone is nothing');
  assert.deepEqual(stylesFromRuns('words', [{ start: 0, length: 5, effect: 99 }]), []);
  assert.deepEqual(stylesFromRuns('words', [{ start: 3, length: 9, effect: 5 }]), [], 'a stretch past the words is refused');
  assert.deepEqual(stylesFromRuns('words', [{ start: 0, length: 2, effect: 6 }, { start: 2, length: 3, effect: 6 }]), [{ start: 0, length: 5, effect: 'bloom' }], 'neighbouring stretches of one effect are one');
});

test('a bubble draws each stretch with its effect, and a link inside one still opens (issue 433)', () => {
  const text = 'Party at www.example.com tonight';
  const parts = styledParts(text, [{ start: 0, length: 24, effect: 'big' }]);
  assert.equal(parts.map((p) => p.text).join(''), text, 'the pieces are the words exactly');
  assert.deepEqual(parts, [
    { text: 'Party at ', effect: 'big' },
    { text: 'www.example.com', href: 'https://www.example.com/', effect: 'big' },
    { text: ' tonight' },
  ]);
  assert.deepEqual(styledParts('plain words'), [{ text: 'plain words' }]);
  assert.deepEqual(styledParts('abc', [{ start: 1, length: 9, effect: 'big' }]), [{ text: 'abc' }], 'a style past the words draws nothing');
  assert.deepEqual(letters('ok \u{1F389}'), ['o', 'k', ' ', '\u{1F389}'], 'a letter effect moves an emoji whole');
});

// The engine as imsg answers it: the words, and no mark of any effect on them.
function transport(rows) {
  const lineCbs = new Set();
  const send = (o) => setImmediate(() => { for (const cb of lineCbs) cb(JSON.stringify(o)); });
  return {
    write(s) {
      const req = JSON.parse(s);
      if (req.method === 'status') return send({ jsonrpc: '2.0', id: req.id, result: { version: 't', database: { ready: true }, methods: [], capabilities: { features: {} } } });
      if (req.method === 'watch.subscribe') return send({ jsonrpc: '2.0', id: req.id, result: { subscription: 1 } });
      if (req.method === 'chats.list') return send({ jsonrpc: '2.0', id: req.id, result: { chats: [{ id: 5, display_name: '', is_group: false }] } });
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

const row = (over) => ({ id: 1, guid: 'FX-1', chat_id: 5, is_from_me: false, sender: '+15555550123', text: 'Happy birthday!', created_at: '2026-01-02T03:04:05.000Z', attachments: [], ...over });

test('a message whose words carry an effect carries it, and one whose words changed since draws plain (issue 433)', async () => {
  const store = { among: (guids) => new Map(guids.filter((g) => g === 'FX-1' || g === 'FX-2').map((g) => [g, { text: 'Happy birthday!', runs: [{ start: 6, length: 9, effect: 6 }] }])) };
  await withEngine([row(), row({ id: 2, guid: 'FX-2', text: 'Words the store no longer holds' }), row({ id: 3, guid: 'P-3', text: 'Plain' })], store, async (engine) => {
    const { messages } = await engine.messages('5');
    assert.deepEqual(messages.find((m) => m.id === 'FX-1').styles, [{ start: 6, length: 9, effect: 'bloom' }]);
    assert.equal(messages.find((m) => m.id === 'FX-2').styles, undefined, 'an effect never lands on words it was not laid over');
    assert.equal(messages.find((m) => m.id === 'P-3').styles, undefined, 'a plain message carries no styles');
  });
});

test('a store that cannot be read draws every message plain, and says so (issue 433)', async () => {
  const broken = { among: () => { throw Object.assign(new Error('the store at a private path is locked'), { code: 'SQLITE_BUSY' }); } };
  await withEngine([row()], broken, async (engine, lines) => {
    const { messages } = await engine.messages('5');
    assert.equal(messages[0].text, 'Happy birthday!');
    assert.equal(messages[0].styles, undefined);
    const said = lines.find((l) => l.event === 'richtext.failed');
    assert.ok(said, 'the failure is a declared line');
    assert.equal(said.error, 'SQLITE_BUSY', 'named by its code, never by a message that could carry a path');
  });
});

test('end to end: the fake engine\'s birthday wishes carry Bloom over the stretch it was laid on (issue 433)', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const page = await (await s.get('/api/v1/chats/1/messages?limit=50', s.tokens.device)).json();
  const m = page.messages.find((x) => x.id === 'FAKE-0021');
  assert.ok(m, 'the message is in the history');
  assert.equal(m.text, 'Happy birthday to you!');
  assert.deepEqual(m.styles, [{ start: 6, length: 16, effect: 'bloom' }]);
  assert.equal(m.text.slice(6, 22), 'birthday to you!');
  assert.deepEqual(TEXT_RUNS['FAKE-0021'], [{ start: 6, length: 16, effect: 6 }]);
  assert.equal(page.messages.filter((x) => x.id !== 'FAKE-0021' && (x.styles || []).some((s) => s.effect)).length, 0, 'and no other message carries one');
});
