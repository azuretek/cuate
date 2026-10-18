// Issue 447: bold, italic, underline and strikethrough are attributes on stretches of the words Messages keeps in the
// store's attributedBody column, the same column the text effects are read from (issue 433), and imsg carries none of
// them, so they reached the app as plain words. The bodies here were archived by Foundation's own NSArchiver from
// synthetic words (server/test/fixtures/formatted-bodies.json); every row is synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { createRichTextReader, richRuns } from '../src/engine/rich-text.js';
import { stylesFromRuns } from '../../core/app/rules/text-styles.js';
import { styledParts } from '../../core/app/rules/links.js';
import { apiSpec } from '../src/paths.js';
import { validate } from '../../core/kit/rules/schema.js';
import { boot } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const BODIES = JSON.parse(readFileSync(path.join(here, 'fixtures', 'formatted-bodies.json'), 'utf8')).bodies;
const body = (name) => Buffer.from(BODIES[name].base64, 'base64');

test('an archived body reads as its words and each stretch\'s bold, italic, underline and strikethrough (issue 447)', () => {
  assert.deepEqual(richRuns(body('each')), { text: 'Bold, italic, underlined and struck', runs: [
    { start: 0, length: 4, bold: 1 },
    { start: 6, length: 6, italic: 1 },
    { start: 14, length: 10, underline: 1 },
    { start: 29, length: 6, strikethrough: 1 },
  ] });
  assert.deepEqual(richRuns(body('stacked')).runs, [
    { start: 0, length: 7, bold: 1, italic: 1 },
    { start: 7, length: 4, bold: 1, italic: 1, underline: 1 },
  ], 'several styles on one stretch are all read');
  assert.deepEqual(richRuns(body('withEffect')).runs, [
    { start: 0, length: 10, effect: 6 },
    { start: 10, length: 4, effect: 6, bold: 1 },
  ], 'and a style composes with a text effect');
});

test('the model carries each stretch\'s styles, and the bubble cuts its words by every one (issue 447)', () => {
  const each = richRuns(body('each'));
  const styles = stylesFromRuns(each.text, each.runs);
  assert.deepEqual(styles, [
    { start: 0, length: 4, bold: true },
    { start: 6, length: 6, italic: true },
    { start: 14, length: 10, underline: true },
    { start: 29, length: 6, strikethrough: true },
  ]);
  for (const s of styles) assert.deepEqual(validate(s, 'TextStyle', apiSpec.models), []);
  const fx = richRuns(body('withEffect'));
  assert.deepEqual(stylesFromRuns(fx.text, fx.runs), [{ start: 0, length: 10, effect: 'bloom' }, { start: 10, length: 4, effect: 'bloom', bold: true }]);
  const stacked = richRuns(body('stacked'));
  const parts = styledParts(stacked.text, stylesFromRuns(stacked.text, stacked.runs));
  assert.deepEqual(parts, [
    { text: 'All of ', bold: true, italic: true },
    { text: 'them', bold: true, italic: true, underline: true },
    { text: ' at once' },
  ]);
  // A link inside bold words still opens, and the words joined are the message's words exactly.
  const linked = styledParts('See www.example.com now', [{ start: 0, length: 12, bold: true }]);
  assert.deepEqual(linked, [{ text: 'See ', bold: true }, { text: 'www.exam', bold: true, href: 'https://www.example.com' }, { text: 'ple.com', href: 'https://www.example.com' }, { text: ' now' }]);
  assert.equal(linked.map((p) => p.text).join(''), 'See www.example.com now');
});

test('the store reader reads a row whose words are formatted and carry no effect (issue 447)', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'formatted-store-'));
  const file = path.join(dir, 'chat.db');
  const db = new DatabaseSync(file);
  const reader = createRichTextReader({ dbPath: file });
  // Close everything that holds the file before the folder is removed: on Windows a directory with an open handle cannot be removed.
  t.after(() => { reader.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });
  db.exec('CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, text TEXT, attributedBody BLOB)');
  const put = db.prepare('INSERT INTO message (ROWID, guid, text, attributedBody) VALUES (?, ?, ?, ?)');
  put.run(1, 'FMT-1', null, body('each'));
  put.run(2, 'FMT-2', null, body('stacked'));
  const found = reader.among(['FMT-1', 'FMT-2', 'FMT-none']);
  assert.deepEqual([...found.keys()].sort(), ['FMT-1', 'FMT-2']);
  assert.equal(found.get('FMT-1').runs.length, 4);
});

test('formatted words reach the model through every read (issue 447)', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const { messages } = await (await s.get('/api/v1/chats/1/messages?limit=50', s.tokens.device)).json();
  const m = messages.find((x) => x.id === 'FAKE-0016');
  assert.equal(m.text, 'Did you book the campsite for the weekend?');
  assert.deepEqual(m.styles, [{ start: 8, length: 4, bold: true }, { start: 17, length: 8, underline: true }, { start: 34, length: 7, italic: true }]);
  assert.deepEqual(validate(m, 'Message', apiSpec.models), []);
});
