// The rules of the message store on the device (issue 441): what a conversation holds, how a page from the server or a
// list of changes merges into it, which held pictures go when the store is full, and which server a store belongs to.
// The store itself (core/app/message-cache.js over core/kit/device-store.js) does the I/O; everything it decides is here.
import { mergeMessages, applyEdit, applyReaction } from './messages.js';

// Every picture a tile draws is held under one byte cap, the least recently used let go first. A picture larger than
// the item cap is an original rather than a tile's still, and is never held.
export const MEDIA_CACHE_BYTES = 48 * 1024 * 1024;
export const MEDIA_ITEM_MAX_BYTES = 1024 * 1024;
// A conversation's own pictures (its avatar or group photo, a person's face, the backdrop set for it) and a theme's type
// are drawn on every open, so they are held under the same cap with an item cap of their own: a backdrop is a whole
// photo rather than a tile's still.
export const PICTURE_ITEM_MAX_BYTES = 4 * 1024 * 1024;
// How many pages of changes one catch-up follows before it stops and lets each conversation be read again on open.
export const CHANGE_PAGES_MAX = 20;

// A message the server has never seen (one being sent, or one that failed) is the page's own, and is never held.
export const holdable = (m) => Boolean(m) && typeof m.id === 'string' && !m.id.startsWith('local:') && !m.state;

const flag = (v, fallback) => (typeof v === 'boolean' ? v : fallback);
const count = (a, b) => Math.max(Number.isFinite(a) ? a : 0, Number.isFinite(b) ? b : 0) || undefined;
const fresh = (incoming, page) => ({ messages: mergeMessages([], page), hasOlder: flag(incoming.hasOlder, true), current: flag(incoming.current, false), totalCount: count(incoming.totalCount) });

// A conversation held on the device: its messages, oldest first, as one contiguous run; whether the server has older
// ones than the oldest held (hasOlder); and whether the newest held is the newest the conversation has as of the store's
// cursor (current). A run that shares no message with what is held, and is not said to sit right next to it, is a
// different stretch of the conversation: the store keeps one run, so the newer stretch replaces the older.
export function mergeHeld(held, incoming, { adjacent = false } = {}) {
  const page = (incoming.messages || []).filter(holdable);
  if (!held || !held.messages.length) return fresh(incoming, page);
  if (!page.length) return { ...held, hasOlder: flag(incoming.hasOlder, held.hasOlder), current: flag(incoming.current, held.current), totalCount: count(held.totalCount, incoming.totalCount) };
  const ids = new Set(held.messages.map((m) => m.id));
  const overlaps = page.some((m) => ids.has(m.id));
  const messages = mergeMessages(held.messages, page);
  const at = (id) => messages.findIndex((m) => m.id === id);
  const heldFirst = held.messages[0].id;
  const heldLast = held.messages[held.messages.length - 1].id;
  const pageFirst = messages.find((m) => page.some((p) => p.id === m.id)).id;
  const pageLast = [...messages].reverse().find((m) => page.some((p) => p.id === m.id)).id;
  if (!overlaps && !adjacent) return at(pageLast) > at(heldLast) ? fresh(incoming, page) : held;
  return {
    messages,
    hasOlder: at(pageFirst) <= at(heldFirst) ? flag(incoming.hasOlder, held.hasOlder) : held.hasOlder,
    current: at(pageLast) >= at(heldLast) ? flag(incoming.current, held.current) : held.current,
    totalCount: count(held.totalCount, incoming.totalCount),
  };
}

// One conversation after a list of changes from GET /api/v1/changes. A message held is replaced by its new state (an
// edit), keeping its reactions; a new one joins the end only when what is held reaches the newest, since otherwise there
// is a gap before it; an unsent one goes; a reaction and a read receipt land on the message they name.
export function applyChangeList(held, list, chatId) {
  if (!held) return { held, changed: false };
  const id = String(chatId);
  let messages = held.messages;
  let changed = false;
  const have = new Map(messages.map((m) => [m.id, m]));
  const take = (list.messages || []).filter((m) => String(m.chatId) === id && holdable(m) && (have.has(m.id) || held.current));
  if (take.length) {
    messages = mergeMessages(messages, take.map((m) => (have.has(m.id) ? { ...m, reactions: have.get(m.id).reactions || m.reactions } : m)));
    changed = true;
  }
  const gone = new Set((list.unsent || []).filter((u) => String(u.chatId) === id).map((u) => u.id));
  if (gone.size && messages.some((m) => gone.has(m.id))) { messages = messages.filter((m) => !gone.has(m.id)); changed = true; }
  for (const r of (list.reactions || []).filter((x) => String(x.chatId) === id)) {
    const next = applyReaction(messages, r);
    if (next !== messages) { messages = next; changed = true; }
  }
  const read = applyReads(messages, list, id);
  if (read !== messages) { messages = read; changed = true; }
  return { held: changed ? { ...held, messages } : held, changed };
}

function applyReads(messages, list, id) {
  let out = messages;
  for (const r of (list.reads || []).filter((x) => String(x.chatId) === id)) {
    const i = out.findIndex((m) => m.id === r.id);
    if (i < 0 || out[i].readAt === r.readAt) continue;
    out = out.slice();
    out[i] = { ...out[i], read: true, readAt: r.readAt };
  }
  return out;
}

// The same changes over the messages a conversation has on screen, so an unsend, an edit, a reaction or a receipt made
// while the page was away is drawn without reading the page again. New messages are the window's to place, so they are
// handed back rather than merged here.
export function applyChangesToShown(messages, list, chatId) {
  const id = String(chatId);
  let out = messages;
  const have = new Set(messages.map((m) => m.id));
  const arrived = [];
  for (const m of (list.messages || []).filter((x) => String(x.chatId) === id)) {
    if (have.has(m.id)) out = applyEdit(out, m);
    else arrived.push(m);
  }
  const gone = new Set((list.unsent || []).filter((u) => String(u.chatId) === id).map((u) => u.id));
  if (gone.size) out = out.filter((m) => !gone.has(m.id));
  for (const r of (list.reactions || []).filter((x) => String(x.chatId) === id)) out = applyReaction(out, r);
  return { messages: applyReads(out, list, id), arrived };
}

// The held page just before a message, oldest first, for a conversation scrolled back: the store answers it without the
// server while it holds older messages, and says whether more lie beyond.
export function olderFromHeld(held, edgeId, size) {
  if (!held) return null;
  const i = held.messages.findIndex((m) => m.id === edgeId);
  if (i <= 0) return null;
  const from = Math.max(0, i - size);
  return { messages: held.messages.slice(from, i), hasMore: from > 0 || held.hasOlder };
}

// Which held pictures go so the rest fit under the cap: the least recently used first, never the one just written.
export function mediaEvictions(entries, { cap = MEDIA_CACHE_BYTES, keep = null } = {}) {
  let total = entries.reduce((sum, e) => sum + (e.size || 0), 0);
  const out = [];
  for (const e of [...entries].sort((a, b) => a.usedAt - b.usedAt || String(a.key).localeCompare(String(b.key)))) {
    if (total <= cap) break;
    if (e.key === keep) continue;
    out.push(e.key);
    total -= e.size || 0;
  }
  return out;
}

// Which pictures a tile draws are held: a video's poster, and an image (a sticker among them) small enough to be a
// tile's still. A video's own bytes and a Live Photo's motion are never held, nor is anything over the item cap.
// A conversation's own picture (kind 'picture') is held when it is an image under its own cap, and a theme's font file
// (kind 'font') under the same.
export function holdsMedia(attachment, { part = null, size = 0, kind = null, type = '' } = {}) {
  if (!attachment || !(size > 0)) return false;
  if (kind === 'font') return size <= PICTURE_ITEM_MAX_BYTES;
  if (kind === 'picture') return size <= PICTURE_ITEM_MAX_BYTES && /^image\//i.test(String(attachment.mime || type || ''));
  if (size > MEDIA_ITEM_MAX_BYTES) return false;
  if (part === 'poster') return true;
  if (part) return false;
  return /^image\//i.test(String(attachment.mime || ''));
}
export const mediaKey = (attachment, { part = null, format = null, kind = null } = {}) => (kind === 'font' ? 'font\u0000' : '') + String(attachment.id) + (part ? ':' + part : '') + (format ? ':' + format : '');

// Which server a store belongs to, as a one-way digest of its address, so the store never holds the address itself.
export function serverDigest(url) {
  const text = String(url || '').trim().replace(/\/+$/, '').replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, (m) => m.toLowerCase());
  return sha256Hex(text);
}

// SHA-256 over UTF-8 text, in plain code, since a page served from a shell's own scheme is not always a secure context
// and so may have no crypto.subtle.
const K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
export function sha256Hex(text) {
  const bytes = new TextEncoder().encode(String(text));
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bytes.length / 0x20000000));
  view.setUint32(padded.length - 4, (bytes.length * 8) >>> 0);
  const h = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, k] = h;
    for (let i = 0; i < 64; i += 1) {
      const t1 = (k + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      k = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += k;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('');
}
