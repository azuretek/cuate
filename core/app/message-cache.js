// The message store on the device (issue 441): every conversation's messages the page has been given, the conversation
// list beside them, the cursor that says how far the server's changes have been taken, and the pictures tiles draw.
// It lives in IndexedDB through core/kit/device-store.js, so every shell (the desktop page, the iOS web view and the
// Android web view) keeps the same store with the same code, and the rules it follows are rules/message-store.js.
//
// It never holds the token or any other secret: the server's address is kept only as a one-way digest, so a store
// opened for a different server starts empty. A web view with no IndexedDB, or one that refuses it, opens no store,
// and the page runs exactly as it does without one.
import { openDeviceStore } from '../kit/device-store.js';
import { mergeHeld, applyChangeList, holdable, mediaEvictions, holdsMedia, mediaKey, serverDigest } from './rules/message-store.js';

export const STORE_NAME = 'message-store';
const STORE_VERSION = 1;
const STORES = { meta: 'key', convos: 'chatId', messages: 'key', media: 'key', mediaUse: 'key' };
// How long the store waits for a burst of renders to settle before it writes what they changed.
const SAVE_MS = 400;
const messageKey = (chatId, id) => String(chatId) + '\u0000' + String(id);
const prefixOf = (chatId) => String(chatId) + '\u0000';

/**
 * @param {string} url the server's address, kept only as its digest
 * @param {{ idb?: any, timers?: any, now?: () => number, saveMs?: number }} [options]
 */
export async function openMessageCache(url, { idb = globalThis.indexedDB, timers = globalThis, now = () => Date.now(), saveMs = SAVE_MS } = {}) {
  const store = await openDeviceStore({ name: STORE_NAME, stores: STORES, version: STORE_VERSION, idb, timers });
  if (!store) return null;
  const digest = serverDigest(url);
  let cursor = null;
  let chats = [];
  let settings = null;
  const convos = new Map();
  const uses = new Map();
  try {
    const server = await store.get('meta', 'server');
    if (!server || server.digest !== digest) {
      // Another server's store, or none: what it held is not this server's, so it goes before anything is read.
      await store.clear();
      await store.write([{ store: 'meta', put: { key: 'server', digest } }]);
    } else {
      const [c, list, values, records, used] = await Promise.all([store.get('meta', 'cursor'), store.get('meta', 'chats'), store.get('meta', 'settings'), store.all('convos'), store.all('mediaUse')]);
      cursor = c && typeof c.value === 'string' ? c.value : null;
      chats = list && Array.isArray(list.value) ? list.value : [];
      settings = values && values.value && typeof values.value === 'object' && !Array.isArray(values.value) ? values.value : null;
      for (const r of records) convos.set(String(r.chatId), { record: r, held: null });
      for (const u of used) uses.set(u.key, u);
    }
  } catch {
    store.close();
    return null;
  }

  // Every change to the store runs in turn, so a page, a list of changes and a clear never interleave.
  let chain = Promise.resolve();
  const serial = (fn) => {
    const run = chain.then(fn);
    chain = run.catch(() => {});
    return run;
  };
  // What was last written for each conversation, message by message, so a save writes only what changed.
  const written = new Map();
  const dirty = new Set();
  let saveTimer = null;
  let pendingChats = null;
  let pendingSettings = null;
  let lastKept = new Map();
  let closed = false;

  async function load(chatId) {
    const id = String(chatId);
    const entry = convos.get(id);
    if (!entry) return null;
    if (entry.held) return entry.held;
    const rows = await store.all('messages', { prefix: prefixOf(id) });
    const messages = mergeHeld(null, { messages: rows.map((r) => r.message) }).messages;
    written.set(id, new Map(messages.map((m) => [m.id, m])));
    entry.held = { messages, hasOlder: entry.record.hasOlder !== false, current: Boolean(entry.record.current), totalCount: entry.record.totalCount };
    return entry.held;
  }

  function opsFor(chatId) {
    const id = String(chatId);
    const entry = convos.get(id);
    if (!entry || !entry.held) return [];
    const { held } = entry;
    const before = written.get(id) || new Map();
    const after = new Map(held.messages.map((m) => [m.id, m]));
    const ops = [{ store: 'convos', put: { chatId: id, hasOlder: held.hasOlder, current: held.current, ...(held.totalCount ? { totalCount: held.totalCount } : {}) } }];
    for (const [mid, m] of after) if (before.get(mid) !== m) ops.push({ store: 'messages', put: { key: messageKey(id, mid), chatId: id, message: m } });
    for (const mid of before.keys()) if (!after.has(mid)) ops.push({ store: 'messages', del: messageKey(id, mid) });
    written.set(id, after);
    return ops;
  }

  function schedule() {
    if (saveTimer || closed) return;
    saveTimer = timers.setTimeout(() => { saveTimer = null; serial(flushDirty).catch(() => {}); }, saveMs);
  }
  async function flushDirty() {
    const ops = [];
    for (const id of dirty) ops.push(...opsFor(id));
    dirty.clear();
    if (pendingChats) { ops.push({ store: 'meta', put: { key: 'chats', value: pendingChats } }); pendingChats = null; }
    if (pendingSettings) { ops.push({ store: 'meta', put: { key: 'settings', value: pendingSettings } }); pendingSettings = null; }
    if (ops.length && !closed) await store.write(ops);
  }

  async function merged(chatId, incoming, options) {
    const id = String(chatId);
    if (!convos.has(id)) convos.set(id, { record: { chatId: id }, held: null });
    const entry = convos.get(id);
    const held = await load(id);
    entry.held = mergeHeld(held && held.messages.length ? held : null, incoming, options);
    dirty.add(id);
    schedule();
    return entry.held;
  }

  // The changes from one answer, applied to every conversation the store holds that they name.
  // A write that fails puts back what it would have changed, so memory never runs ahead of the store.
  async function applyList(list) {
    const names = new Set([...(list.messages || []), ...(list.unsent || []), ...(list.reactions || []), ...(list.reads || [])].map((x) => String(x.chatId)));
    const ops = [];
    const undo = [];
    for (const id of names) {
      if (!convos.has(id)) continue;
      const held = await load(id);
      const { held: next, changed } = applyChangeList(held, list, id);
      if (!changed) continue;
      const wasDirty = dirty.has(id);
      undo.push(() => { convos.get(id).held = held; written.set(id, before); if (wasDirty) dirty.add(id); });
      const before = written.get(id);
      convos.get(id).held = next;
      dirty.delete(id);
      ops.push(...opsFor(id));
    }
    return { ops, undo: () => { for (const u of undo) u(); } };
  }

  const cache = {
    get cursor() { return cursor; },
    // The conversation list as it was last drawn, to draw at once on the next open.
    get chats() { return chats; },
    // A held conversation ({ messages, hasOlder, current, totalCount }), or null when the store holds none.
    convo: (chatId) => serial(() => load(chatId)),
    // The conversation as it is in memory, without waiting: null when it has not been read from the store yet.
    heldNow: (chatId) => convos.get(String(chatId))?.held || null,
    // A page or a window of messages for one conversation. Nothing here is the server's word on what is current unless
    // the caller says so; a run the store does not hold yet replaces a stretch it shares nothing with.
    keep(chatId, incoming, options = {}) {
      if (!chatId || !incoming) return Promise.resolve(null);
      const id = String(chatId);
      if (!options.force && incoming.messages && lastKept.get(id) === incoming.messages && incoming.current === undefined && incoming.hasOlder === undefined) return Promise.resolve(null);
      lastKept.set(id, incoming.messages);
      return serial(() => merged(id, { ...incoming, messages: (incoming.messages || []).filter(holdable) }, options));
    },
    saveChats(list) {
      chats = Array.isArray(list) ? list : [];
      pendingChats = chats;
      schedule();
    },
    // The settings as the server last answered them, so a launch draws its theme, scheme and text size before the server
    // answers. They are the person's choices, never a credential; null when none are held.
    get settings() { return settings; },
    saveSettings(values) {
      if (!values || typeof values !== 'object' || Array.isArray(values)) return;
      settings = values;
      pendingSettings = values;
      schedule();
    },
    // One page of GET /api/v1/changes, written with the cursor it ends at in one transaction, so the store never says it
    // is newer than what it holds.
    apply(list) {
      return serial(async () => {
        const { ops, undo } = await applyList(list);
        ops.push({ store: 'meta', put: { key: 'cursor', value: list.cursor } });
        try { await store.write(ops); } catch (e) { undo(); throw e; }
        cursor = list.cursor;
      });
    },
    // A change heard on the live stream while the page runs. The cursor stays where it was: the next catch-up asks from
    // there and the change merges as one already held.
    live(list) {
      return serial(async () => {
        const { ops, undo } = await applyList(list);
        if (!ops.length) return;
        try { await store.write(ops); } catch (e) { undo(); throw e; }
      });
    },
    // The server cannot honour the cursor (another Mac, a rebuilt history): everything held goes, and the store starts
    // again from the head the server named.
    reset(head) {
      return serial(async () => {
        await store.write([...Object.keys(STORES).map((s) => ({ store: s, clear: true })), { store: 'meta', put: { key: 'server', digest } }, { store: 'meta', put: { key: 'cursor', value: head } }]);
        convos.clear();
        written.clear();
        dirty.clear();
        uses.clear();
        lastKept = new Map();
        chats = [];
        settings = null;
        cursor = head;
      });
    },
    // Too much changed to follow: every conversation is read again when it is next opened.
    stale() {
      return serial(async () => {
        const ops = [];
        for (const [id, entry] of convos) {
          if (entry.held) entry.held = { ...entry.held, current: false };
          entry.record = { ...entry.record, current: false };
          ops.push({ store: 'convos', put: { ...entry.record, chatId: id, ...(entry.held ? { hasOlder: entry.held.hasOlder } : {}) } });
        }
        if (ops.length) await store.write(ops);
      });
    },
    // A held picture as a Blob, or null. Reading one marks it used, so it is the last to go.
    async media(attachment, options = {}) {
      const key = mediaKey(attachment, options);
      if (!uses.has(key) || closed) return null;
      try {
        const rec = await store.get('media', key);
        if (!rec) { uses.delete(key); return null; }
        const use = { key, size: rec.size, usedAt: now() };
        uses.set(key, use);
        store.write([{ store: 'mediaUse', put: use }]).catch(() => {});
        return new Blob([rec.data], { type: rec.type || '' });
      } catch {
        return null;
      }
    },
    // A picture a tile drew, held if it is one the rules hold, and the least recently used let go to stay under the cap.
    keepMedia(attachment, blob, options = {}) {
      const size = blob && Number.isFinite(blob.size) ? blob.size : 0;
      if (closed || !holdsMedia(attachment, { part: options.part || null, kind: options.kind || null, type: blob.type || '', size })) return Promise.resolve(false);
      const key = mediaKey(attachment, options);
      return serial(async () => {
        const data = await blob.arrayBuffer();
        const use = { key, size, usedAt: now() };
        uses.set(key, use);
        const gone = mediaEvictions([...uses.values()], { keep: key });
        for (const k of gone) uses.delete(k);
        await store.write([{ store: 'media', put: { key, type: blob.type || '', size, data } }, { store: 'mediaUse', put: use }, ...gone.flatMap((k) => [{ store: 'media', del: k }, { store: 'mediaUse', del: k }])]);
        return true;
      });
    },
    mediaBytes: () => [...uses.values()].reduce((sum, u) => sum + (u.size || 0), 0),
    // Writes everything waiting, for a page about to go and for the tests.
    flush() {
      if (saveTimer) { timers.clearTimeout(saveTimer); saveTimer = null; }
      return serial(flushDirty);
    },
    // Signing out: everything goes, the digest of the server included.
    clear() {
      closed = true;
      if (saveTimer) { timers.clearTimeout(saveTimer); saveTimer = null; }
      return serial(async () => {
        await store.clear();
        store.close();
      });
    },
    close() {
      closed = true;
      if (saveTimer) { timers.clearTimeout(saveTimer); saveTimer = null; }
      return serial(async () => store.close());
    },
  };
  return cache;
}
