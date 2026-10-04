// The engine adapter: one interface over imsg rpc (or the fake), mapped to our model by core's rules. It supervises
// the engine, restarting it with a backoff and resuming the live stream after the last row it saw.
import { createRpc } from './rpc.js';
import { mapChat, mapMessage, mapReaction } from '../../../core/app/rules/engine-imsg.js';

const numCode = (e) => (typeof e.code === 'number' ? e.code : null);
const omit = (o, keys) => {
  const c = { ...o };
  for (const k of keys) delete c[k];
  return c;
};

export function createEngine({ kind, makeTransport, log, attachmentId, timeoutMs = 30000, sendTimeoutMs = 60000, typingIncoming = false }) {
  let transport = null;
  let rpc = null;
  let state = { kind, version: null, ready: false, features: [] };
  let lastRowid = 0;
  let stopping = false;
  let restartMs = 1000;
  let timer = null;
  let dropExtras = false;
  let canReadStatus = false;
  const listeners = new Set();
  const stateListeners = new Set();
  const emit = (name, data) => { for (const cb of listeners) cb(name, data); };
  const setState = (s) => {
    state = { ...state, ...s };
    for (const cb of stateListeners) cb({ ...state });
  };

  // Older imsg releases reject keys they do not know (-32602), so optional keys are dropped once, then for good.
  async function request(method, params, ms, extras = []) {
    if (!rpc) throw Object.assign(new Error('engine is not running'), { code: 'engine_down' });
    try {
      return await rpc.request(method, dropExtras ? omit(params, extras) : params, ms);
    } catch (e) {
      if (e.code === -32602 && extras.length && !dropExtras) {
        dropExtras = true;
        return rpc.request(method, omit(params, extras), ms);
      }
      throw e;
    }
  }

  // The chat whose GUID a bridge typing event names, read from the engine's own chat list. Only reached with the
  // inbound-typing switch on.
  async function chatIdForGuid(guid) {
    try {
      const r = await request('chats.list', { limit: 500 }, timeoutMs);
      const c = (r && Array.isArray(r.chats) ? r.chats : []).find((x) => String(x.guid) === guid);
      return c ? String(c.id) : null;
    } catch { return null; }
  }

  async function subscribe() {
    await request('watch.subscribe', { since_rowid: lastRowid, attachments: true, include_reactions: true }, 15000, ['attachments', 'include_reactions']);
  }

  function onNotification(method, params) {
    // Inbound typing, only when the switch is on: imsg reports it through an injected v2 bridge's event stream
    // (bridge.events.subscribe, "started-typing"/"stopped-typing"), which the ordinary watch never carries. The event
    // names the chat by its GUID, so it is resolved to the chat id the rest of the app uses (issue 230).
    if (method === 'bridge.event') {
      const ev = params.event || {};
      const typing = ev.event === 'started-typing' ? true : ev.event === 'stopped-typing' ? false : null;
      const guid = ev.data && ev.data.chatGuid;
      if (typing !== null && guid) {
        chatIdForGuid(String(guid)).then((chatId) => { if (chatId) emit('typing.incoming', { chatId, typing }); }).catch(() => {});
      }
      return;
    }
    if (method === 'message' && params.message) {
      const raw = params.message;
      if (Number.isFinite(raw.id) && raw.id > lastRowid) lastRowid = raw.id;
      if (raw.is_reaction) {
        const r = mapReaction(raw);
        if (r) emit('reaction', r);
        return;
      }
      emit('message.new', { message: mapMessage(raw, { attachmentId }) });
    } else if (method === 'watch.overflow') {
      const after = Number.isFinite(params.resume_after_rowid) ? params.resume_after_rowid : lastRowid;
      lastRowid = Math.max(lastRowid, after);
      log.emit('engine.overflow', { resume_after: after });
      subscribe().catch((e) => log.emit('engine.error', { method: 'watch.subscribe', code: numCode(e), error: e.message }));
    }
  }

  function onExit(e) {
    rpc = null;
    if (stopping) return;
    setState({ ready: false });
    const delay = restartMs;
    restartMs = Math.min(30000, restartMs * 2);
    log.emit('engine.exit', { code: Number.isFinite(e.code) ? e.code : null, signal: e.signal || null, restart_ms: delay });
    timer = setTimeout(() => {
      start().then(() => { if (state.ready) restartMs = 1000; }, () => {});
    }, delay);
  }

  async function start() {
    stopping = false;
    const t = makeTransport();
    transport = t;
    rpc = createRpc({ transport: t, timeoutMs });
    t.onExit((e) => { if (transport === t) onExit(e); });
    rpc.onNotification(onNotification);
    let st = null;
    try {
      st = await rpc.request('status', {}, 10000);
    } catch (e) {
      log.emit('engine.error', { method: 'status', code: numCode(e), error: e.message });
    }
    canReadStatus = Array.isArray(st?.methods) && st.methods.includes('message.send_status');
    // rpc_features is imsg's own capability list (an older release omits it, so the array is empty). The reaction
    // sender reads it through supportsEmojiTapback to decide whether an arbitrary emoji can be sent.
    setState({ version: st && st.version != null ? String(st.version) : null, ready: Boolean(st && st.database && st.database.ready), features: Array.isArray(st?.rpc_features) ? st.rpc_features : [] });
    log.emit('engine.start', { kind, version: state.version, ready: state.ready });
    try {
      await subscribe();
    } catch (e) {
      log.emit('engine.error', { method: 'watch.subscribe', code: numCode(e), error: e.message });
    }
    // Present and OFF by default (issue 230): the only source of another person typing is a bridge that is already
    // running, which this server never starts. The switch, and the engine advertising the method, must both be on.
    if (typingIncoming && Array.isArray(st?.methods) && st.methods.includes('bridge.events.subscribe')) {
      try {
        await request('bridge.events.subscribe', { buffer_limit: 256 }, 10000);
      } catch (e) {
        log.emit('engine.error', { method: 'bridge.events.subscribe', code: numCode(e), error: e.message });
      }
    }
  }

  async function chats({ limit = 200 } = {}) {
    const r = await request('chats.list', { limit }, timeoutMs);
    return (r && Array.isArray(r.chats) ? r.chats : []).map(mapChat);
  }

  async function messages(chatId, { limit = 50, before = null } = {}) {
    const params = { chat_id: Number(chatId), limit: limit + 2, attachments: true };
    if (before) params.end = before;
    const r = await request('messages.history', params, timeoutMs, ['attachments']);
    let list = (r && Array.isArray(r.messages) ? r.messages : []).filter((m) => !m.is_reaction).map((m) => mapMessage(m, { attachmentId }));
    if (before) list = list.filter((m) => m.sentAt < before);
    list.sort((a, b) => b.sentAt.localeCompare(a.sentAt));
    const page = list.slice(0, limit).reverse();
    // One bounded, read-only snapshot for the latest outgoing message on this page. Never turn
    // inbound is_read into a remote receipt, or poll the entire history on every page load.
    const outgoing = [...page].reverse().find((m) => m.fromMe && !m.id.startsWith('row:'));
    if (canReadStatus && outgoing) {
      try {
        const status = await request('message.send_status', { guid: outgoing.id }, Math.min(timeoutMs, 2000));
        const value = status?.status_fields?.date_read;
        const time = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) ? Date.parse(value) : NaN;
        if (status?.ok === true && status.guid === outgoing.id && Number.isFinite(time) && time >= Date.parse(outgoing.sentAt)) {
          outgoing.readAt = new Date(time).toISOString();
        }
      } catch (e) {
        if (e.code === -32601) canReadStatus = false;
        log.emit('engine.error', { method: 'message.send_status', code: numCode(e), error: e.message });
      }
    }
    return { messages: page, hasMore: list.length > limit };
  }

  // The engine's own resumable sweep: one cursor over message ROWID order, across every chat, in pages the
  // engine bounds itself (messages.after tops out at 500 rows). An export reads this rather than paging every
  // chat from here, so its round trips grow with the history and not with the chat count.
  const AFTER_LIMIT_MAX = 500;
  async function after({ sinceRowid = 0, limit = AFTER_LIMIT_MAX, attachments = true, includeReactions = false } = {}) {
    const params = {
      since_rowid: Math.max(0, Math.trunc(Number(sinceRowid) || 0)),
      limit: Math.min(AFTER_LIMIT_MAX, Math.max(1, Math.trunc(Number(limit) || AFTER_LIMIT_MAX))),
      attachments: Boolean(attachments),
      include_reactions: Boolean(includeReactions),
    };
    const r = await request('messages.after', params, timeoutMs, ['attachments', 'include_reactions']);
    const rows = r && Array.isArray(r.messages) ? r.messages : [];
    return {
      messages: rows.filter((m) => includeReactions || !m.is_reaction).map((m) => mapMessage(m, { attachmentId })),
      nextRowid: r && Number.isFinite(r.next_rowid) ? r.next_rowid : params.since_rowid,
      hasMore: Boolean(r && r.has_more),
    };
  }

  // One imsg call that sends something: a message, a file, a reply or a tapback. Whatever comes back, an outcome the
  // engine cannot vouch for is uncertain, and the sender above never retries it. `unsupported` names the codes that
  // mean the engine cannot do this at all (a method it lacks, or a bridge method with no bridge running), which the
  // sender refuses cleanly rather than reporting as a failed send.
  async function sendOut(params, method = 'send', unsupported = [-32601, -32003]) {
    try {
      const r = await request(method, params, sendTimeoutMs);
      return { ok: true, messageId: r && r.guid ? String(r.guid) : null };
    } catch (e) {
      const disposition = e.data && e.data.disposition;
      if (e.code === -32001 || e.code === 'timeout' || e.code === 'engine_exit' || disposition === 'may_have_completed' || disposition === 'still_in_flight') {
        return { ok: false, uncertain: true, code: String(e.code) };
      }
      if (unsupported.includes(e.code)) return { ok: false, uncertain: false, unsupported: true, code: String(e.code) };
      return { ok: false, uncertain: false, code: String(e.code ?? 'error'), error: e.message };
    }
  }

  // imsg `read` marks every message in a conversation read on the Mac, which is also what sends the read
  // receipt. The engine resolves the chat target itself and answers { ok: true }.
  async function read(chatId) {
    const r = await request('read', { chat_id: Number(chatId) }, timeoutMs);
    return { ok: Boolean(r && r.ok) };
  }

  // A reply carries `reply_to`, which imsg sends through its IMCore bridge only. An engine too old to know the key
  // answers -32602, and one with no bridge running -32003; both mean it cannot thread a reply, so both are refused as
  // unsupported rather than sent outside the thread. reply_to is never an optional extra the adapter may drop.
  const replyCodes = [-32601, -32602, -32003];
  const withReply = (params, replyTo) => (replyTo ? { ...params, reply_to: replyTo } : params);
  const sendText = (chatId, text, { replyTo = null } = {}) => sendOut(withReply({ chat_id: Number(chatId), text }, replyTo), 'send', replyTo ? replyCodes : undefined);

  // imsg stages one file per send under the Messages attachments folder before dispatch. An empty caption is left
  // out, so a file on its own is not a text send carrying nothing.
  const sendFile = (chatId, file, text = '', { replyTo = null } = {}) => sendOut(withReply(text ? { chat_id: Number(chatId), file, text } : { chat_id: Number(chatId), file }, replyTo), 'send', replyTo ? replyCodes : undefined);

  // The running engine advertises `tapback.emoji` when its bridge can send an arbitrary emoji reaction. A stock
  // bridge cannot: it builds only associated_message_type 2000 to 2005 and maps some emoji onto a standard kind, so
  // without the feature the sender refuses any emoji that is not one of the six (issue 188).
  const supportsEmojiTapback = () => state.features.includes('tapback.emoji');

  // imsg's bridge `tapback` adds or removes a reaction on a message by its guid, as an arbitrary `emoji` when the
  // engine advertises it, otherwise as one of the six classic `kind`s (issue 188).
  const react = (chatId, targetId, { type = '', emoji = '', remove = false } = {}) => {
    const base = { chat_id: Number(chatId), message_guid: String(targetId), remove: Boolean(remove) };
    if (emoji && supportsEmojiTapback()) return sendOut({ ...base, emoji }, 'tapback');
    if (!type) return Promise.resolve({ ok: false, uncertain: false, unsupported: true, code: 'emoji_unsupported' });
    return sendOut({ ...base, kind: type }, 'tapback');
  };

  function stop() {
    stopping = true;
    if (timer) clearTimeout(timer);
    const t = transport;
    transport = null;
    rpc = null;
    return t ? t.close() : Promise.resolve();
  }

  return {
    start,
    stop,
    chats,
    messages,
    after,
    read,
    sendText,
    sendFile,
    react,
    supportsEmojiTapback,
    info: () => ({ kind: state.kind, version: state.version, ready: state.ready }),
    on: (cb) => listeners.add(cb),
    onState: (cb) => stateListeners.add(cb),
  };
}
