// Phase 2d: the export. One document of the message data, in full or since the last export, built from the engine
// and held to core/spec/export.schema.json by the same pure validator the API contract uses. It reads the engine and
// never writes to it; the only file it writes is its own marker in the data folder.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT, serverVersion, apiSpec } from './paths.js';
import { validate } from '../../core/kit/rules/schema.js';

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

export function createExporter({ engine, dataDir, log = null, now = () => new Date().toISOString(), pageSize = apiSpec.paging.messages.max, chatLimit = apiSpec.paging.chats.max } = {}) {
  const marker = path.join(dataDir, 'export.json');

  const lastExport = () => {
    if (!existsSync(marker)) return null;
    try { return JSON.parse(readFileSync(marker, 'utf8')).exportedAt || null; } catch { return null; }
  };

  // Pages a chat from newest to oldest. An incremental export stops once a whole page is older than the mark, since
  // every page after it is older still.
  async function collect({ mode = 'full', since = null } = {}) {
    const from = mode === 'since' ? since || lastExport() : null;
    const chats = await engine.chats({ limit: chatLimit });
    const messages = [];
    const attachments = new Map();
    for (const chat of chats) {
      let before = null;
      for (;;) {
        const page = await engine.messages(chat.id, { limit: pageSize, before });
        if (!page.messages.length) break;
        const oldest = page.messages[0].sentAt;
        for (const m of page.messages) {
          if (from && m.sentAt <= from) continue;
          messages.push(toMessage(m));
          for (const a of m.attachments) if (!attachments.has(a.id)) attachments.set(a.id, { id: a.id, name: a.name, mime: a.mime, bytes: a.bytes, missing: a.missing });
        }
        if (!page.hasMore || (from && oldest <= from)) break;
        before = oldest;
      }
    }
    const doc = {
      specVersion: spec.version,
      exportedAt: now(),
      mode: from ? 'since' : 'full',
      since: from,
      serverVersion,
      chats: chats.map(toChat),
      messages,
      attachments: [...attachments.values()],
    };
    const problems = validateExport(doc);
    if (problems.length) throw new Error('export does not conform: ' + problems.join('; '));
    return doc;
  }

  async function write(file, opts = {}) {
    const doc = await collect(opts);
    mkdirSync(path.dirname(file), { recursive: true });
    const body = JSON.stringify(doc, null, 2) + '\n';
    writeFileSync(file, body, { mode: 0o600 });
    writeFileSync(marker, JSON.stringify({ exportedAt: doc.exportedAt }) + '\n', { mode: 0o600 });
    const bytes = Buffer.byteLength(body);
    if (log) log.emit('export.written', { mode: doc.mode, chats: doc.chats.length, messages: doc.messages.length, attachments: doc.attachments.length, bytes });
    return { file, bytes, doc };
  }

  return { collect, write, lastExport };
}
