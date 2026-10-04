// The engine adapter: one interface over imsg rpc (or the fake), mapped to our model by core's rules. It supervises
// the engine, restarting it with a backoff and resuming the live stream after the last row it saw.
import os from 'node:os';
import path from 'node:path';
import { openSync, readSync, closeSync } from 'node:fs';
import { createRpc } from './rpc.js';
import { isReady, nextDelay } from './link.js';
import { annotatePayloads } from './payload.js';
import { mapChat, mapMessage, mapReaction } from '../../../core/app/rules/engine-imsg.js';
import { EMOJI_TAPBACK_VERSION } from '../../../core/app/rules/messages.js';

// The first bytes of a message's own payload, read without copying the whole file. A payload under a temp path that is
// already gone reads nothing, which is how a missing one stays missing.
const HEAD_BYTES = 64;
function readHead(a) {
  const recorded = String(a.original_path || a.filename || '');
  if (!recorded) return null;
  const file = recorded.startsWith('~/') ? path.join(os.homedir(), recorded.slice(2)) : recorded;
  let fd;
  try {
    fd = openSync(file, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = readSync(fd, buf, 0, HEAD_BYTES, 0);
    return n > 0 ? buf.subarray(0, n) : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) { try { closeSync(fd); } catch { /* nothing left to close */ } }
  }
}

const numCode = (e) => (typeof e.code === 'number' ? e.code : null);
const omit = (o, keys) => {
  const c = { ...o };
  for (const k of keys) delete c[k];
  return c;
};

export function createEngine({ kind, makeTransport, log, attachmentId, timeoutMs = 30000, sendTimeoutMs = 60000, typingIncoming = false }) {
  // Every raw row becomes the model by the same step, so a payload is typed before it is mapped, whichever read it came
  // from.
  const toModel = (raw) => mapMessage(annotatePayloads(raw, readHead), { attachmentId });


  let state = { kind, version: null, ready: false, capabilities: null };
  let lastRowid = 0;
  let stopping = false;
  let dropExtras = false;
  let canReadStatus = false;
  // The link's own record, so the log and the diagnostics can say what happened: the generation of the current
  // child, how long it had been up, the last request that failed, and the restart history.
  let gen = 0;
  let current = null; // { transport, rpc, gen, alive, startedAt }, the one child that is ours
  let starting = null; // the in-flight start, so a second caller joins it rather than spawning a twin child
  let restartTimer = null;
  let delayMs = 0; // the last restart delay, doubled while the engine cannot stay up
  let readySince = null; // when the link last became ready, so the backoff can tell a flap from a recovery
  let restarts = 0;
  let lastExit = null;
  let lastFailure = null;
  const listeners = new Set();
  const stateListeners = new Set();
  const emit = (name, data) => { for (const cb of listeners) cb(name, data); };
  const setState = (s) => {
    state = { ...state, ...s };
    for (const cb of stateListeners) cb({ ...state });
  };
  // Readiness is a gate, not a guess: ready only when the child is alive, the database is readable and the watch is
  // subscribed (server/src/engine/link.js owns the rule). A change is one declared line, so a link that came up and
  // a link that went down are both visible.
  const markReady = (ready) => {
    if (ready) readySince = Date.now(); else readySince = null;
    if (Boolean(ready) === state.ready) return;
    setState({ ready: Boolean(ready) });
    log.emit('engine.ready', { ready: Boolean(ready), version: state.version });
  };
  const closeCurrent = () => {
    const c = current;
    current = null;
    if (c) { try { c.transport.close(); } catch { /* already gone */ } }
  };
  // One retry at a time, on the delay nextDelay decides. A live child that will not answer is retried the same way a
  // dead one is, so a half-open link cannot be replaced in a tight loop either.
  const scheduleRestart = (delay = null) => {
    if (stopping || restartTimer) return;
    if (delay === null) {
      const readyFor = readySince ? Date.now() - readySince : 0;
      delay = nextDelay(delayMs, { readyForMs: readyFor });
      delayMs = delay;
    }
    restartTimer = setTimeout(() => { restartTimer = null; start().catch(() => {}); }, delay);
    if (restartTimer.unref) restartTimer.unref();
  };

  // Every request is one declared line: its method, how long it took and whether it answered. A failure is an
  // engine.error carrying the engine's own code and message, and it is kept as the last failure so the exit that
  // follows can say what it was restarting away from. There is no code path that drops a failure silently.
  async function request(method, params, ms, extras = []) {
    const c = current;
    if (!c || !c.alive) {
      // A request refused because the link is down is still a failure, and it is logged as one rather than thrown
      // silently: a caller that gets an error can act on it, but a gap in the log is a mystery.
      log.emit('engine.error', { method, error: 'engine is not running' });
      throw Object.assign(new Error('engine is not running'), { code: 'engine_down' });
    }
    const t0 = Date.now();
    try {
      const r = await c.rpc.request(method, dropExtras ? omit(params, extras) : params, ms);
      log.emit('engine.request', { method, ms: Date.now() - t0, ok: true });
      return r;
    } catch (e) {
      const took = Date.now() - t0;
      if (e.code === -32602 && extras.length && !dropExtras) {
        dropExtras = true;
        log.emit('engine.request', { method, ms: took, ok: false });
        return request(method, omit(params, extras), ms);
      }
      log.emit('engine.request', { method, ms: took, ok: false });
      lastFailure = { method, code: numCode(e), error: e.message };
      log.emit('engine.error', { method, code: numCode(e), error: e.message, ms: took });
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
    // The watch gets the longer of the two bounds but never more than the engine timeout a caller configured, so a
    // hung subscribe is bounded by the same clock as every other request rather than sitting for fifteen seconds.
    await request('watch.subscribe', { since_rowid: lastRowid, attachments: true, include_reactions: true }, Math.min(15000, timeoutMs), ['attachments', 'include_reactions']);
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
      emit('message.new', { message: toModel(raw) });
    } else if (method === 'watch.overflow') {
      const after = Number.isFinite(params.resume_after_rowid) ? params.resume_after_rowid : lastRowid;
      lastRowid = Math.max(lastRowid, after);
      log.emit('engine.overflow', { resume_after: after });
      subscribe().catch(() => { /* request() logged it */ });
    }
  }

  function onExit(e, c) {
    c.alive = false;
    if (current === c) current = null;
    if (stopping) return;
    const at = Date.now();
    const uptimeMs = at - c.startedAt;
    const readyFor = readySince ? at - readySince : 0;
    const delay = nextDelay(delayMs, { readyForMs: readyFor });
    delayMs = delay;
    lastExit = { code: Number.isFinite(e.code) ? e.code : null, signal: e.signal || null, at: new Date(at).toISOString(), uptimeMs };
    restarts += 1;
    markReady(false);
    // The exit line is deferred by one microtask so the in-flight requests it killed have settled and the last
    // failure is known: the exit can then name what it is restarting away from, and a loop reads as one story rather
    // than a stack of unexplained restarts. e.stderr is the child's own last line, taken before it died.
    queueMicrotask(() => {
      log.emit('engine.exit', {
        code: lastExit.code,
        signal: lastExit.signal,
        restart_ms: delay,
        uptime_ms: uptimeMs,
        stderr: e.stderr || null,
        method: lastFailure ? lastFailure.method : null,
        error: lastFailure ? lastFailure.error : null,
      });
      lastFailure = null;
      scheduleRestart(delay);
    });
  }

  async function attempt(force) {
    if (force) closeCurrent();
    if (!current) {
      const my = ++gen;
      const t = makeTransport();
      const rpc = createRpc({ transport: t, timeoutMs });
      const c = { transport: t, rpc, gen: my, alive: true, startedAt: Date.now() };
      current = c;
      t.onExit((e) => { if (current === c) onExit(e, c); });
      rpc.onNotification(onNotification);
    }
    const c = current;
    let st = null;
    const statusAt = Date.now();
    try {
      st = await c.rpc.request('status', {}, 10000);
    } catch (e) {
      log.emit('engine.request', { method: 'status', ms: Date.now() - statusAt, ok: false });
      log.emit('engine.error', { method: 'status', code: numCode(e), error: e.message, ms: Date.now() - statusAt });
    }
    if (current !== c) return; // a newer start replaced this one, or the child died
    canReadStatus = Array.isArray(st?.methods) && st.methods.includes('message.send_status');
    // capabilities is the engine's own block (an older release omits it, so it stays null). The reaction sender
    // reads it through supportsEmojiTapback to decide whether an arbitrary emoji can be sent.
    setState({ version: st && st.version != null ? String(st.version) : null, capabilities: st && typeof st.capabilities === 'object' ? st.capabilities : null });
    const databaseReady = Boolean(st && st.database && st.database.ready);
    let subscribed = false;
    let subscribeUnsupported = false;
    if (databaseReady) {
      try {
        await subscribe();
        subscribed = true;
      } catch (e) {
        if (e.code === -32601) subscribeUnsupported = true; // an engine too old to know the method is still connected
      }
    }
    if (current !== c) return;
    const ready = isReady({ alive: c.alive, databaseReady, subscribed, subscribeUnsupported });
    markReady(ready);
    log.emit('engine.start', { kind, version: state.version, ready });
    // Present and OFF by default (issue 230): the only source of another person typing is a bridge that is already
    // running, which this server never starts. The switch, and the engine advertising the method, must both be on.
    if (typingIncoming && Array.isArray(st?.methods) && st.methods.includes('bridge.events.subscribe')) {
      try {
        await request('bridge.events.subscribe', { buffer_limit: 256 }, 10000);
      } catch { /* request() logged it */ }
    }
    if (!ready && c.alive) scheduleRestart(); // a live child that will not answer is retried on the backoff
  }

  async function start({ force = false } = {}) {
    if (stopping) return;
    if (starting) return starting;
    // A running child is never replaced by an ordinary start; only an explicit restart (force) does that. This is
    // what stops the adapter and the watchdog from each spawning a child for the same broken engine.
    if (!force && current && current.alive) return;
    if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
    starting = attempt(force).finally(() => { starting = null; });
    return starting;
  }

  async function chats({ limit = 200 } = {}) {
    const r = await request('chats.list', { limit }, timeoutMs);
    return (r && Array.isArray(r.chats) ? r.chats : []).map(mapChat);
  }

  async function messages(chatId, { limit = 50, before = null } = {}) {
    const params = { chat_id: Number(chatId), limit: limit + 2, attachments: true };
    if (before) params.end = before;
    const r = await request('messages.history', params, timeoutMs, ['attachments']);
    let list = (r && Array.isArray(r.messages) ? r.messages : []).filter((m) => !m.is_reaction).map((m) => toModel(m));
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
        if (e.code === -32601) canReadStatus = false; // request() already logged the failure
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
      messages: rows.filter((m) => includeReactions || !m.is_reaction).map((m) => toModel(m)),
      nextRowid: r && Number.isFinite(r.next_rowid) ? r.next_rowid : params.since_rowid,
      hasMore: Boolean(r && r.has_more),
    };
  }

  // One imsg call that sends something: a message, a file, a reply or a tapback. Whatever comes back, an outcome the
  // engine cannot vouch for is uncertain, and the sender above never retries it. `unsupported` names the codes that
  // mean the engine cannot do this at all (a method it lacks, or a bridge method with no bridge running), which the
  // sender refuses cleanly rather than reporting as a failed send.
  // existing is the guid of the message a reply answers, when this send is a reply. A send is answered with the guid
  // of the row the engine created and never with an existing message's id, but the bridge's reply path has answered a
  // threaded reply with the id of an existing message in the chat (issue 208). An answer that names the very message
  // the reply answers is therefore not trusted: the sender reports it uncertain rather than reporting that message as
  // the one it created, and never guesses.
  async function sendOut(params, method = 'send', unsupported = [-32601, -32003], existing = null) {
    try {
      const r = await request(method, params, sendTimeoutMs);
      const guid = r && r.guid ? String(r.guid) : null;
      if (guid && existing && guid === existing) return { ok: false, uncertain: true, code: 'reply_id_echoed' };
      return { ok: true, messageId: guid };
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
  const sendText = (chatId, text, { replyTo = null } = {}) => sendOut(withReply({ chat_id: Number(chatId), text }, replyTo), 'send', replyTo ? replyCodes : undefined, replyTo);

  // imsg stages one file per send under the Messages attachments folder before dispatch. An empty caption is left
  // out, so a file on its own is not a text send carrying nothing.
  const sendFile = (chatId, file, text = '', { replyTo = null } = {}) => sendOut(withReply(text ? { chat_id: Number(chatId), file, text } : { chat_id: Number(chatId), file }, replyTo), 'send', replyTo ? replyCodes : undefined, replyTo);

  // imsg names and versions its capabilities rather than advertising adjectives, so the client asks for the version
  // it needs. A capability's version tracks the shape of its API, and advertising it means the build supports that
  // shape. `tapback.emoji` is version 2 where the engine sends an arbitrary emoji as itself; a build that advertises
  // an older version, or predates the block and reports none, does not support that pattern. Such a build is denied
  // here, in place, and is never asked. A stock bridge builds only associated_message_type 2000 to 2005 and folds
  // some emoji onto a standard kind, so it is refused any emoji that is not one of the six (issue 188). The refusal
  // is explicit and never downgraded to a classic tapback.
  const REACTION_TAPBACK_EMOJI_VERSION = EMOJI_TAPBACK_VERSION;
  const capabilityVersion = (name) => {
    const value = state.capabilities && state.capabilities.features ? state.capabilities.features[name] : null;
    return Number.isInteger(value) ? value : 0;
  };
  const supportsEmojiTapback = () => capabilityVersion('tapback.emoji') >= REACTION_TAPBACK_EMOJI_VERSION;

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
    if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
    const c = current;
    current = null;
    return c ? c.transport.close() : Promise.resolve();
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
    capabilityVersion: (name) => capabilityVersion(name),
    emojiTapbackVersion: () => capabilityVersion('tapback.emoji'),
    // The link's state and its restart history, read by /api/v1/info and the diagnostics surface: a person
    // debugging a link that will not stay up sees the restart count, how long the current child has been up, how
    // long it has been ready, and the last exit with its code or signal.
    info: () => ({
      kind: state.kind,
      version: state.version,
      ready: state.ready,
      restarts,
      uptimeMs: current ? Date.now() - current.startedAt : null,
      readyMs: readySince ? Date.now() - readySince : null,
      lastExit,
    }),
    ensure: () => start(),
    restart: () => start({ force: true }),
    on: (cb) => listeners.add(cb),
    onState: (cb) => stateListeners.add(cb),
  };
}
