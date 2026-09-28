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

export function createEngine({ kind, makeTransport, log, attachmentId, timeoutMs = 30000, sendTimeoutMs = 60000 }) {
  let transport = null;
  let rpc = null;
  let state = { kind, version: null, ready: false };
  let lastRowid = 0;
  let stopping = false;
  let restartMs = 1000;
  let timer = null;
  let dropExtras = false;
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

  async function subscribe() {
    await request('watch.subscribe', { since_rowid: lastRowid, attachments: true, include_reactions: true }, 15000, ['attachments', 'include_reactions']);
  }

  function onNotification(method, params) {
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
    setState({ version: st && st.version != null ? String(st.version) : null, ready: Boolean(st && st.database && st.database.ready) });
    log.emit('engine.start', { kind, version: state.version, ready: state.ready });
    try {
      await subscribe();
    } catch (e) {
      log.emit('engine.error', { method: 'watch.subscribe', code: numCode(e), error: e.message });
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
    return { messages: list.slice(0, limit).reverse(), hasMore: list.length > limit };
  }

  async function sendText(chatId, text) {
    try {
      const r = await request('send', { chat_id: Number(chatId), text }, sendTimeoutMs);
      return { ok: true, messageId: r && r.guid ? String(r.guid) : null };
    } catch (e) {
      const disposition = e.data && e.data.disposition;
      if (e.code === -32001 || e.code === 'timeout' || e.code === 'engine_exit' || disposition === 'may_have_completed' || disposition === 'still_in_flight') {
        return { ok: false, uncertain: true, code: String(e.code) };
      }
      return { ok: false, uncertain: false, code: String(e.code ?? 'error'), error: e.message };
    }
  }

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
    sendText,
    info: () => ({ kind: state.kind, version: state.version, ready: state.ready }),
    on: (cb) => listeners.add(cb),
    onState: (cb) => stateListeners.add(cb),
  };
}
