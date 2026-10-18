// Text effects a sender laid over their words (issue 433). Messages keeps a message's words as an attributed string in
// the store's attributedBody column, and an effect chosen for a stretch of them (Big, Small, Shake, Nod, Explode,
// Ripple, Bloom, Jitter) is an attribute on that stretch. imsg recovers the words but none of the attributes, so this
// module reads them from the store itself, read-only, the way edits.js reads which rows were edited: only the rows
// asked about, and of those only the ones whose attributedBody names an attribute we draw.
import { DatabaseSync } from 'node:sqlite';
import { readAttributedString } from './typedstream.js';

// The attributes read, by the name Messages gives each, and the key each run carries it under.
// Bold, italic, underline and strikethrough (issue 447) are each a number on the stretch they cover, 1 where laid.
export const RICH_ATTRIBUTES = Object.freeze({
  __kIMTextEffectAttributeName: 'effect',
  __kIMTextBoldAttributeName: 'bold',
  __kIMTextItalicAttributeName: 'italic',
  __kIMTextUnderlineAttributeName: 'underline',
  __kIMTextStrikethroughAttributeName: 'strikethrough',
});

/**
 * One attributedBody as the runs the app draws: the words it holds, and each stretch carrying at least one attribute
 * we read, with those attributes under their own keys. A body that is not an attributed string reads as null.
 * @param {Buffer | Uint8Array} body
 * @returns {{ text: string, runs: { start: number, length: number, effect?: number, bold?: number, italic?: number, underline?: number, strikethrough?: number }[] } | null}
 */
export function richRuns(body) {
  let parsed;
  try {
    parsed = readAttributedString(body);
  } catch {
    return null;
  }
  const runs = [];
  for (const r of parsed.runs) {
    const run = { start: r.start, length: r.length };
    let any = false;
    for (const [name, key] of Object.entries(RICH_ATTRIBUTES)) {
      const v = r.attributes.get(name);
      if (typeof v === 'number' && v) { run[key] = v; any = true; }
    }
    if (any && r.length > 0) runs.push(run);
  }
  return { text: parsed.text, runs };
}

/**
 * The reader opens the store lazily, read-only, and keeps the connection; close() lets it go.
 * @param {{ dbPath: string, open?: (file: string) => any }} options
 */
export function createRichTextReader({ dbPath, open = (file) => new DatabaseSync(file, { readOnly: true }) }) {
  let db = null;
  let readable = null;
  const conn = () => {
    if (!db) db = open(dbPath);
    if (readable === null) readable = db.prepare("SELECT name FROM pragma_table_info('message')").all().some((r) => r.name === 'attributedBody');
    return db;
  };
  // A row is read only when its body names one of the attributes, so a page of plain messages decodes nothing.
  const names = Object.keys(RICH_ATTRIBUTES);
  const mentions = '(' + names.map(() => 'instr(m.attributedBody, CAST(? AS BLOB)) > 0').join(' OR ') + ')';
  return {
    // Of these message guids, the ones whose words carry an attribute we draw, each with its words and its runs.
    among(guids) {
      const list = [...new Set((guids || []).map(String))].filter(Boolean);
      const found = new Map();
      if (!list.length || !conn() || !readable) return found;
      const rows = conn().prepare(
        'SELECT m.guid AS guid, m.attributedBody AS body FROM message m WHERE m.guid IN (' + list.map(() => '?').join(',') + ') AND ' + mentions,
      ).all(...list, ...names);
      for (const r of rows) {
        const rich = r.body ? richRuns(Buffer.from(r.body)) : null;
        if (rich && rich.runs.length) found.set(String(r.guid), rich);
      }
      return found;
    },
    close() {
      try { db?.close(); } catch { /* already closed */ }
      db = null;
      readable = null;
    },
  };
}
