// An in-process engine that answers the same JSON-RPC methods as imsg rpc, over synthetic data. The server's tests,
// the desktop smoke and anyone without a Mac run against it. With liveText set, it delivers one incoming message a
// couple of seconds after the first conversation is opened, which is how the smoke proves live events reach the UI.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gradientPng } from './png.js';
import { buildFixtures, imsgReaction } from './fixtures.js';

export function createFakeImsg({ attachmentsRoot, base = Date.now() - 60000, liveText = null, liveDelayMs = 2000 } = {}) {
  mkdirSync(path.join(attachmentsRoot, 'fake'), { recursive: true });
  const imagePath = path.join(attachmentsRoot, 'fake', 'sunset.png');
  const png = gradientPng(480, 320);
  writeFileSync(imagePath, png);
  const { chats, messages } = buildFixtures({ base, imagePath, imageBytes: png.length });
  let rowid = messages.length;
  let attempts = 0;
  let liveSent = false;
  const sends = [];
  // send: how a send answers. sendDelayMs: how long a send takes to answer, so a test can hold one in flight.
  // afterDelayMs: how long each messages.after page takes, so a test can hold a sweep open.
  // bridge: 'ready', or 'down' to answer the bridge-only calls (a tapback, a reply) the way imsg does with no bridge.
  const behavior = { send: 'ok', sendDelayMs: 0, afterDelayMs: 0, bridge: 'ready' };
  const tapbacks = [];
  const KINDS = new Set(['love', 'like', 'dislike', 'laugh', 'emphasis', 'question']);
  const transports = new Set();

  const lastAt = (chatId) => messages.filter((m) => m.chat_id === chatId && !m.is_reaction).reduce((a, m) => (m.created_at > a ? m.created_at : a), '');
  const withAttachments = (m, on) => (on ? m : { ...m, attachments: [] });
  const add = (fields) => {
    rowid += 1;
    const m = { id: rowid, guid: 'FAKE-' + String(rowid).padStart(4, '0'), created_at: new Date().toISOString(), attachments: [], text: '', sender: '', sender_name: '', ...fields };
    messages.push(m);
    return m;
  };
  const broadcast = (m) => { for (const t of transports) t.notify(m); };

  const world = {
    sends,
    tapbacks,
    behavior,
    requests: [],
    get attempts() { return attempts; },
    incoming(chatId, text, sender) {
      const chat = chats.find((c) => c.id === chatId);
      const m = add({ chat_id: chatId, is_from_me: false, sender: sender || chat.participants[0], text, is_read: false });
      broadcast(m);
      return m;
    },
    // Someone else's reaction: a standard kind, or any emoji, added or taken off. The target's own reactions change as
    // they would in chat.db (one per person), and the row streams in imsg's shape, so the adapter maps what imsg sends.
    react(chatId, targetGuid, kindOrEmoji, sender, { remove = false } = {}) {
      const { type, emoji } = imsgReaction(kindOrEmoji);
      const target = messages.find((x) => x.guid === targetGuid && x.chat_id === chatId && !x.is_reaction);
      if (target) {
        const others = (target.reactions || []).filter((r) => r.is_from_me || r.sender !== sender);
        target.reactions = remove ? others : [...others, { type, emoji, sender, is_from_me: false }];
      }
      const m = add({ chat_id: chatId, is_from_me: false, sender, is_reaction: true, reaction_type: type, reaction_emoji: emoji, is_reaction_add: !remove, reacted_to_guid: targetGuid });
      broadcast(m);
      return m;
    },
    crashAll() { for (const t of [...transports]) t.crash(); },
    transport() {
      const lines = new Set();
      const exits = new Set();
      const subs = new Map();
      let nextSub = 0;
      let closed = false;
      const out = (obj) => {
        const s = JSON.stringify(obj);
        setImmediate(() => { if (!closed) for (const cb of lines) cb(s); });
      };
      const reply = (id, result) => out({ jsonrpc: '2.0', id, result });
      const fail = (id, code, message, data) => out({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } });
      const noBridge = (id) => fail(id, -32003, 'The bridge is not started. Run imsg launch explicitly before using bridge methods.', { retry_safe: true, disposition: 'not_started', transport: 'bridge', operation: 'send', detail: '' });
      const end = (code) => {
        if (closed) return;
        closed = true;
        transports.delete(t);
        for (const cb of exits) cb({ code, signal: null });
      };
      const handle = (req) => {
        const p = req.params || {};
        world.requests.push(req.method);
        switch (req.method) {
          case 'initialize':
          case 'status':
            return reply(req.id, { version: 'fake-1.0', protocol_version: 1, database: { path: ':fake:', ready: true } });
          case 'chats.list': {
            const list = chats.map((c) => ({ ...c, last_message_at: lastAt(c.id) || null })).sort((a, b) => (b.last_message_at || '').localeCompare(a.last_message_at || ''));
            return reply(req.id, { chats: list.slice(0, p.limit || 20) });
          }
          case 'messages.history': {
            let ms = messages.filter((m) => m.chat_id === p.chat_id && !m.is_reaction);
            if (p.end) ms = ms.filter((m) => m.created_at < p.end);
            ms = ms.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id).slice(0, p.limit || 50);
            if (liveText && !liveSent && (p.limit || 50) > 5) {
              liveSent = true;
              setTimeout(() => world.incoming(p.chat_id, liveText), liveDelayMs).unref();
            }
            return reply(req.id, { messages: ms.map((m) => withAttachments(m, p.attachments)) });
          }
          case 'messages.after': {
            const since = Number.isFinite(p.since_rowid) ? p.since_rowid : 0;
            const limit = Math.min(Math.max(1, Number.isFinite(p.limit) ? p.limit : 100), 500);
            const rows = messages.slice().sort((a, b) => a.id - b.id).filter((m) => m.id > since);
            let next = since;
            const out = [];
            for (const m of rows) {
              if (out.length >= limit) break;
              next = m.id;
              if (m.is_reaction && !p.include_reactions) continue;
              out.push(withAttachments(m, p.attachments));
            }
            const page = { messages: out, next_rowid: next, has_more: rows.some((m) => m.id > next) };
            if (behavior.afterDelayMs > 0) { setTimeout(() => reply(req.id, page), behavior.afterDelayMs).unref(); return undefined; }
            return reply(req.id, page);
          }
          case 'watch.subscribe':
            nextSub += 1;
            subs.set(nextSub, p);
            return reply(req.id, { subscription: nextSub, buffer_limit: 256 });
          case 'watch.unsubscribe':
            subs.delete(p.subscription);
            return reply(req.id, { ok: true });
          case 'read': {
            const chat = chats.find((c) => c.id === p.chat_id);
            if (!chat) return fail(req.id, -32602, 'unknown chat_id');
            for (const m of messages) {
              if (m.chat_id === p.chat_id && !m.is_reaction && !m.is_from_me) m.is_read = true;
            }
            chat.unread_count = 0;
            return reply(req.id, { ok: true });
          }
          case 'send': {
            attempts += 1;
            if (behavior.send === 'hang') return undefined;
            if (behavior.send === 'uncertain') return fail(req.id, -32001, 'The send may have completed.', { retry_safe: false, disposition: 'may_have_completed', transport: 'applescript', operation: 'send', detail: '' });
            if (behavior.send === 'fail') return fail(req.id, -32603, 'Messages refused the send.', { retry_safe: true, disposition: 'not_started', transport: 'applescript', operation: 'send', detail: '' });
            if (!p.text && !p.file) return fail(req.id, -32602, 'send needs text or a file.', { retry_safe: true, disposition: 'not_started', transport: 'applescript', operation: 'send', detail: '' });
            if (p.reply_to && behavior.bridge !== 'ready') return noBridge(req.id);
            const file = p.file ? [{ filename: path.basename(p.file), transfer_name: path.basename(p.file), mime_type: 'application/octet-stream', total_bytes: 0, is_sticker: false, missing: false, original_path: p.file }] : [];
            // As Messages records it: reply_to_guid names the chat's previous message on every row, and only a reply
            // carries thread_originator_guid, the message it was sent to (issue 195).
            const prev = [...messages].reverse().find((x) => x.chat_id === p.chat_id && !x.is_reaction);
            const m = add({ chat_id: p.chat_id, is_from_me: true, text: p.text || '', attachments: file, ...(prev ? { reply_to_guid: prev.guid } : {}), ...(p.reply_to ? { thread_originator_guid: p.reply_to, thread_originator_part: '0:0:0' } : {}) });
            sends.push({ chatId: p.chat_id, text: p.text || '', file: p.file || null, replyTo: p.reply_to || null });
            if (behavior.sendDelayMs > 0) setTimeout(() => reply(req.id, { ok: true, id: m.id, guid: m.guid }), behavior.sendDelayMs).unref();
            else reply(req.id, { ok: true, id: m.id, guid: m.guid });
            setTimeout(() => broadcast(m), 30).unref();
            return undefined;
          }
          // The bridge's tapback: one of the six standard kinds, added or removed on a message by its guid. The
          // target's own reactions change as they would in chat.db, and the reaction row streams like any other.
          case 'tapback': {
            attempts += 1;
            if (behavior.bridge !== 'ready') return noBridge(req.id);
            if (behavior.send === 'hang') return undefined;
            if (behavior.send === 'uncertain') return fail(req.id, -32001, 'The tapback may have completed.', { retry_safe: false, disposition: 'may_have_completed', transport: 'bridge', operation: 'tapback', detail: '' });
            if (behavior.send === 'fail') return fail(req.id, -32603, 'Messages refused the tapback.', { retry_safe: true, disposition: 'not_started', transport: 'bridge', operation: 'tapback', detail: '' });
            if (!KINDS.has(p.kind)) return fail(req.id, -32602, 'kind must be a standard tapback.');
            const target = messages.find((m) => m.guid === p.message_guid && m.chat_id === p.chat_id && !m.is_reaction);
            if (!target) return fail(req.id, -32602, 'unknown message_guid');
            const adding = p.remove !== true;
            const others = (target.reactions || []).filter((r) => !r.is_from_me);
            target.reactions = adding ? [...others, { ...imsgReaction(p.kind), is_from_me: true }] : others;
            const m = add({ chat_id: p.chat_id, is_from_me: true, is_reaction: true, reaction_type: p.kind, reaction_emoji: imsgReaction(p.kind).emoji, is_reaction_add: adding, reacted_to_guid: target.guid });
            tapbacks.push({ chatId: p.chat_id, targetId: target.guid, kind: p.kind, remove: !adding });
            reply(req.id, { ok: true });
            setTimeout(() => broadcast(m), 30).unref();
            return undefined;
          }
          default:
            return fail(req.id, -32601, 'Method not found');
        }
      };
      const t = {
        notify(m) {
          for (const [id, p] of subs) {
            if (m.is_reaction && !p.include_reactions) continue;
            if (p.chat_id && p.chat_id !== m.chat_id) continue;
            out({ jsonrpc: '2.0', method: 'message', params: { subscription: id, message: withAttachments(m, p.attachments) } });
          }
        },
        write(s) {
          let req;
          try { req = JSON.parse(s); } catch { return; }
          handle(req);
        },
        onLine(cb) { lines.add(cb); },
        onExit(cb) { exits.add(cb); },
        close() { end(0); return Promise.resolve(); },
        crash() { end(1); },
      };
      transports.add(t);
      return t;
    },
  };
  return world;
}
