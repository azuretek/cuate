// Phase 2d: the export. One document of the message data, in full or since the last export, built from the engine
// and held to core/spec/export.schema.json by the same pure validator the API contract uses. It reads the engine and
// never writes to it; the only file it writes is its own marker in the data folder.
//
// It is collected with the engine's own ROWID cursor (engine.after, the messages.after surface), one resumable page
// at a time. Paging every chat from here instead made the round trip count unbounded in the history: one call per
// page per chat, so a real database answered for minutes and the endpoint never returned (issue 41). A sweep over
// message ROWID order costs one call per SWEEP_LIMIT messages whatever the chat count is. The chat list is read
// once in full, so the document names every chat its messages belong to (issue 44). A message that belongs to no
// chat is left out: it is no conversation's, so the document carries nothing it cannot name (issue 48).
//
// The engine answers one call at a time and does not stop working on a call the server has given up on, so a sweep
// is the most expensive thing the server asks of it. Two sweeps at once pushed single pages past the engine timeout,
// and a sweep whose client had gone kept paging for minutes, so every request behind either one timed out (issue 107).
// One sweep runs at a time, a second is refused with a busy error rather than started, and a sweep stops at the next
// page once its caller's signal aborts, so an abandoned export costs at most the page in flight.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT, serverVersion } from './paths.js';
import { validate } from '../../core/kit/rules/schema.js';
import { NO_CHAT_ID } from '../../core/app/rules/engine-imsg.js';

const spec = JSON.parse(readFileSync(path.join(ROOT, 'core/spec/export.schema.json'), 'utf8'));

/** The export format spec, so a caller or a test reads the one owner rather than a copy. */
export const exportSpec = spec;

/** The problems this document has against the export schema, empty when it conforms. */
export function validateExport(doc) {
  return validate(doc, 'Export', spec.models);
}

const toChat = (c) => ({ id: c.id, name: c.name, isGroup: c.isGroup, service: c.service, participants: c.participants.slice(), lastMessageAt: c.lastMessageAt || null });
const toMessage = (m) => ({
  id: m.id,
  chatId: m.chatId,
  fromMe: m.fromMe,
  sender: m.sender || null,
  senderName: m.senderName || null,
  text: m.text,
  sentAt: m.sentAt,
  replyTo: m.replyTo || null,
  read: typeof m.read === 'boolean' ? m.read : null,
  attachments: m.attachments.map((a) => a.id),
  reactions: m.reactions.map((r) => ({ type: r.type, emoji: r.emoji || null, fromMe: r.fromMe, sender: r.sender || null })),
});

// The engine bounds one messages.after page at 500 rows, so a sweep asks for the largest page the engine will give.
const SWEEP_LIMIT = 500;

// The engine's chats.list carries no page bound of its own: its rpc docs give a maximum for messages.history,
// messages.search and messages.after, but none for chats.list. apiSpec.paging.chats.max is GET /api/v1/chats' page
// bound, and reading it here named only that page while the sweep carried every message, so the document held
// messages whose chat it never named (issue 44). This is larger than any Messages database, and inside a signed
// 32-bit int, so no engine can overflow it.
const CHAT_LIMIT = 1000000000;

/** Thrown when an export is asked for while another is sweeping the engine. */
export const EXPORT_RUNNING = 'export_running';
/** Thrown when the caller's signal aborted the sweep before it finished. */
export const EXPORT_ABANDONED = 'export_abandoned';

export function createExporter({ engine, dataDir, log = null, now = () => new Date().toISOString(), pageSize = SWEEP_LIMIT, chatLimit = CHAT_LIMIT } = {}) {
  const limit = Math.min(SWEEP_LIMIT, Math.max(1, Math.trunc(pageSize) || SWEEP_LIMIT));
  const marker = path.join(dataDir, 'export.json');

  // The marker is the export's own cursor: when it ran, and the engine ROWID the sweep reached. A ROWID cursor is
  // only valid for the database instance that produced it, so this marker belongs to the database that wrote it:
  // restoring or replacing chat.db means deleting it, since a since run would otherwise resume past rows that the
  // new database has not seen.
  const lastMark = () => {
    if (!existsSync(marker)) return null;
    try {
      const m = JSON.parse(readFileSync(marker, 'utf8'));
      return { exportedAt: typeof m.exportedAt === 'string' ? m.exportedAt : null, lastRowid: Number.isFinite(m.lastRowid) ? m.lastRowid : null };
    } catch { return null; }
  };

  const lastExport = () => { const m = lastMark(); return m ? m.exportedAt : null; };

  // The one sweep allowed on the engine. It is taken before the first engine call and released only once the sweep's
  // last call has settled, an abandoned one included, so a new export never overlaps the page an old one left in flight.
  let running = false;
  async function exclusive(fn) {
    if (running) throw Object.assign(new Error('An export is already running. Try again when it has finished.'), { code: EXPORT_RUNNING });
    running = true;
    try { return await fn(); } finally { running = false; }
  }

  // Where a run starts: the whole history, or the mark the last run left. A mark written before the cursor existed
  // has no rowid, so a since run sweeps from the start and filters on the mark's time instead; the run it writes
  // then carries the cursor, so that happens once.
  function plan(mode, since) {
    if (mode !== 'since') return { from: null, cursor: 0 };
    const mark = lastMark();
    const from = since || (mark && mark.exportedAt) || null;
    if (!from) return { from: null, cursor: 0 };
    return { from, cursor: since || !mark || !Number.isFinite(mark.lastRowid) ? 0 : mark.lastRowid };
  }

  // One sweep of the engine cursor. The engine may consume more physical rows than it returns while it coalesces
  // URL previews, so the cursor it hands back is the one to continue from, and a cursor that does not advance ends
  // the sweep rather than looping on it.
  async function sweep({ from, cursor, signal = null }) {
    const startedAt = Date.now();
    const messages = [];
    const attachments = new Map();
    let chatless = 0;
    let pages = 0;
    let rowid = cursor;
    // Checked before every engine call: the call in flight when the caller goes away is the last one this sweep makes.
    const stopIfAbandoned = () => {
      if (!signal || !signal.aborted) return;
      if (log) log.emit('export.abandoned', { mode: from ? 'since' : 'full', pages, messages: messages.length, ms: Date.now() - startedAt });
      throw Object.assign(new Error('The export was abandoned by its caller.'), { code: EXPORT_ABANDONED });
    };
    stopIfAbandoned();
    const chats = await engine.chats({ limit: chatLimit });
    for (;;) {
      stopIfAbandoned();
      const t = Date.now();
      const page = await engine.after({ sinceRowid: rowid, limit });
      pages += 1;
      for (const m of page.messages) {
        if (from && m.sentAt <= from) continue;
        // A message the engine reports with no chat belongs to no conversation, so it is left out rather than carried
        // half named (issue 48). Every other unnamed chat is a real disagreement between the list and the stream, so it
        // stays in the document for check() below to refuse.
        if (m.chatId === NO_CHAT_ID) { chatless += 1; continue; }
        messages.push(toMessage(m));
        for (const a of m.attachments) if (!attachments.has(a.id)) attachments.set(a.id, { id: a.id, name: a.name, mime: a.mime, bytes: a.bytes, missing: a.missing });
      }
      if (log) log.emit('export.page', { mode: from ? 'since' : 'full', page: pages, since_rowid: rowid, next_rowid: page.nextRowid, messages: page.messages.length, ms: Date.now() - t });
      if (!page.hasMore || page.nextRowid <= rowid) break;
      rowid = page.nextRowid;
    }
    return { chats, messages, chatless, attachments: [...attachments.values()], pages, rowid, ms: Date.now() - startedAt };
  }

  function document(swept, from) {
    return {
      specVersion: spec.version,
      exportedAt: now(),
      mode: from ? 'since' : 'full',
      since: from,
      serverVersion,
      chats: swept.chats.map(toChat),
      messages: swept.messages,
      attachments: swept.attachments,
    };
  }

  function check(doc) {
    const problems = validateExport(doc);
    if (problems.length) throw new Error('export does not conform: ' + problems.join('; '));
    // Beyond the schema, the document's own contract: it names a chat for every message it carries. The whole chat
    // list is read, so every chat that carries a message is in it; if the engine's list ever disagrees with its own
    // message stream, fail rather than hand tooling a message whose chat the document does not name (issue 44).
    const named = new Set(doc.chats.map((c) => c.id));
    const missing = [...new Set(doc.messages.map((m) => m.chatId))].filter((id) => !named.has(id));
    if (missing.length) throw new Error('export carries messages whose chat it does not name: ' + missing.join(', '));
    return doc;
  }

  async function collect({ mode = 'full', since = null, signal = null } = {}) {
    return exclusive(async () => {
      const { from, cursor } = plan(mode, since);
      return check(document(await sweep({ from, cursor, signal }), from));
    });
  }

  async function write(file, opts = {}) {
    return exclusive(() => writeNow(file, opts));
  }

  async function writeNow(file, opts) {
    const { from, cursor } = plan(opts.mode || 'full', opts.since || null);
    const swept = await sweep({ from, cursor, signal: opts.signal || null });
    const doc = check(document(swept, from));
    mkdirSync(path.dirname(file), { recursive: true });
    const body = JSON.stringify(doc, null, 2) + '\n';
    writeFileSync(file, body, { mode: 0o600 });
    writeFileSync(marker, JSON.stringify({ exportedAt: doc.exportedAt, lastRowid: swept.rowid }) + '\n', { mode: 0o600 });
    const bytes = Buffer.byteLength(body);
    if (log) log.emit('export.written', { mode: doc.mode, chats: doc.chats.length, messages: doc.messages.length, chatless: swept.chatless, attachments: doc.attachments.length, bytes, pages: swept.pages, ms: swept.ms });
    return { file, bytes, doc };
  }

  return { collect, write, lastExport, running: () => running };
}
