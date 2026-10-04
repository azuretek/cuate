// Pure: the conversation's rules.
const GLYPHS = { love: '\u2764\ufe0f', like: '\ud83d\udc4d', dislike: '\ud83d\udc4e', laugh: '\ud83d\ude02', emphasis: '\u203c\ufe0f', question: '\u2753' };

// The six standard tapbacks, in the order the Mac offers them, as { type, glyph }. These are the reactions every
// engine can send; one that advertises tapback.emoji version 2 sends any other emoji as itself, and one that does not shows it
// when it arrives but refuses it when sent (issues 138 and 188).
export const TAPBACKS = Object.entries(GLYPHS).map(([type, glyph]) => ({ type, glyph }));

// The standard tapback an emoji stands for, or null. The text and emoji presentations of one character (with and
// without U+FE0F) name the same tapback; a skin tone or any other emoji names none.
export function tapbackType(emoji) {
  const bare = String(emoji || '').replace(/\ufe0f/g, '');
  for (const t of TAPBACKS) if (t.glyph.replace(/\ufe0f/g, '') === bare) return t.type;
  return null;
}

// The `tapback.emoji` capability version an arbitrary emoji reaction needs. The engine names and versions its
// capabilities, so the client asks for the version it needs rather than trusting a flag; a build advertising an
// older version, or none, is refused before the bridge is asked, and the refusal names this version.
export const EMOJI_TAPBACK_VERSION = 2;

// The engine as one line for a reader, e.g. "imsg 0.9.2", or '' when the app does not know the build. The build is
// named when it is known and never invented.
export function engineLabel(engine) {
  if (!engine || typeof engine !== 'object') return '';
  const kind = typeof engine.kind === 'string' ? engine.kind : '';
  const version = engine.version == null ? '' : String(engine.version);
  return [kind, version].filter(Boolean).join(' ');
}

// What the reader is told when the engine cannot send the reaction they chose: the limit is named honestly, the
// engine build is named only when it is known, and the version the engine would need is named. It is said in place
// and in the app's own notice style, never as a raw error or a log line, and never as a silent downgrade to a
// classic tapback (issue 241).
export function reactionUnsupported(engine, needed = EMOJI_TAPBACK_VERSION) {
  const label = engineLabel(engine);
  return {
    message: label
      ? 'The message engine on the Mac (' + label + ') can send the six classic reactions, not arbitrary emoji.'
      : 'The message engine on the Mac can send the six classic reactions, not arbitrary emoji.',
    detail: 'An arbitrary emoji reaction needs tapback.emoji version ' + needed + '.',
  };
}

// The id the engine can react to or thread a reply to: a message's guid. A message still being sent (local:) or a row
// the engine gave no guid (row:) has nothing to target yet. The server's routes check the same pattern.
export const MESSAGE_GUID = /^[A-Za-z0-9_-]{1,128}$/;
export const canTarget = (m) => Boolean(m) && MESSAGE_GUID.test(String(m.id)) && !m.state;

// What a message's menu offers (issue 169): React on any message the engine can target, and Reply in thread only on
// someone else's, since a thread is started by answering another person. Sending off on the server offers neither.
export function messageActions(m, { sending = false } = {}) {
  if (!sending || !canTarget(m)) return [];
  return m.fromMe ? ['react'] : ['reply', 'react'];
}

// The first message of the thread a message belongs to, followed up through replyTo (a parent not loaded included).
// Threads are one level deep, as on the Mac, so a reply to a reply belongs to the same thread and a reply sent from
// the thread names this message (issue 183). A loop in the data ends rather than spinning.
export function threadRoot(messages, id) {
  return rootIn(new Map((messages || []).map((m) => [m.id, m])), id);
}

function rootIn(byId, start) {
  let at = start;
  const seen = new Set();
  while (!seen.has(at)) {
    seen.add(at);
    const parent = byId.get(at)?.replyTo;
    if (!parent) return at;
    at = parent;
  }
  return start;
}

// The ids of the thread a message belongs to: its first message and every message whose replies lead back to it.
export function threadIds(messages, id) {
  const byId = new Map((messages || []).map((m) => [m.id, m]));
  const rootOf = (start) => rootIn(byId, start);
  const root = rootOf(id);
  const ids = new Set([root, id]);
  for (const m of byId.values()) if (rootOf(m.id) === root) ids.add(m.id);
  return ids;
}

// What the conversation draws for threads, from the stored pointer alone (issue 208). Every reply carries the
// message it answers as its replyTo pointer, stored when the message was ingested; every drawn path is that pointer
// walked back, never a guess from who spoke before whom. For each message the conversation holds the mark is:
//   { replies: n }  a message that answers nothing and is answered by n of the messages present: one quiet line under
//                   it reading the count, which opens the thread.
//   { root }        a message that is itself a reply: the message it answers, resolved by walking the pointer. A reply
//                   whose parent is not loaded yet still carries its root, so it resolves once the parent loads.
// A message with neither is not in the map. The list is in time order.
export function threadMarks(messages) {
  const list = messages || [];
  const byId = new Map(list.map((m) => [m.id, m]));
  const marks = new Map();
  const replies = new Map();
  for (const m of list) {
    if (!m.replyTo) continue;
    const root = rootIn(byId, m.id);
    if (root === m.id) continue;
    marks.set(m.id, { root });
    replies.set(root, (replies.get(root) || 0) + 1);
  }
  for (const [root, count] of replies) if (byId.has(root)) marks.set(root, { ...(marks.get(root) || {}), replies: count });
  return marks;
}

// The path a message answers, walked through the stored pointer (issue 208): from the message itself back to its
// thread's first message. Threads are one level deep, so the path is usually a reply and its original; a parent not
// loaded yet leaves the path ending at that id, and it extends once the parent loads. A loop in the data ends.
export function threadPath(messages, id) {
  const byId = new Map((messages || []).map((m) => [m.id, m]));
  const path = [];
  const seen = new Set();
  let at = id;
  while (at && !seen.has(at)) {
    seen.add(at);
    path.push(at);
    at = byId.has(at) ? byId.get(at).replyTo : null;
  }
  return path;
}

// The link under a thread's ghost original: how many replies it has.
export function replyCountLabel(count) {
  return count + (count === 1 ? ' Reply' : ' Replies');
}

// The reaction this device's owner has on a message, or null.
export function myReaction(m) {
  return (m && Array.isArray(m.reactions) ? m.reactions.find((r) => r.fromMe) : null) || null;
}

// What a reply shows of the message it answers: who wrote it and a line of it. A parent that is not loaded is
// reported as not found, so the quote says so rather than inventing one.
export function replyQuote(messages, m, { max = 80 } = {}) {
  if (!m || !m.replyTo) return null;
  const parent = (messages || []).find((x) => x.id === m.replyTo) || null;
  if (!parent) return { id: m.replyTo, found: false, who: '', text: 'An earlier message' };
  const who = parent.fromMe ? 'You' : parent.senderName || parent.sender || '';
  const words = String(parent.text || '').replace(/\s+/g, ' ').trim();
  const first = parent.attachments && parent.attachments[0];
  const body = words || (first ? first.name : '');
  const text = Array.from(body).length > max ? Array.from(body).slice(0, max - 1).join('') + '\u2026' : body;
  return { id: parent.id, found: true, who, text };
}

export function mergeMessages(existing, incoming) {
  const map = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) map.set(m.id, { ...map.get(m.id), ...m });
  return [...map.values()].sort((a, b) => a.sentAt.localeCompare(b.sentAt) || String(a.id).localeCompare(String(b.id)));
}

// Separators after a gap, and runs of messages from one sender close together.
export function groupMessages(messages, { gapMs = 3600000, runMs = 300000 } = {}) {
  const items = [];
  let prev = null;
  for (const m of messages) {
    const t = Date.parse(m.sentAt);
    const gap = !prev || t - Date.parse(prev.sentAt) > gapMs;
    if (gap) items.push({ kind: 'separator', at: m.sentAt, key: 'sep:' + m.id });
    const sameRun = Boolean(prev) && !gap && prev.fromMe === m.fromMe && (prev.sender || '') === (m.sender || '') && t - Date.parse(prev.sentAt) <= runMs;
    if (sameRun) items[items.length - 1].last = false;
    items.push({ kind: 'message', message: m, first: !sameRun, last: true, key: m.id });
    prev = m;
  }
  return items;
}

export function deliveryLabel(m) {
  if (!m.fromMe) return '';
  if (m.state === 'sending') return 'Sending\u2026';
  if (m.state === 'uncertain') return 'May not have sent';
  if (m.state === 'failed') return 'Not sent';
  if (typeof m.readAt === 'string' && Number.isFinite(Date.parse(m.readAt))) return 'Read ' + m.readAt;
  return 'Sent';
}

// One tapback per person per message: adding replaces that person's earlier one.
export function applyReaction(messages, r) {
  const i = messages.findIndex((m) => m.id === r.targetId);
  if (i < 0) return messages;
  const who = (x) => (x.fromMe ? 'me' : x.sender || '');
  const m = messages[i];
  const reactions = m.reactions.filter((x) => who(x) !== who(r));
  if (r.add) reactions.push({ type: r.type, emoji: r.emoji ?? null, fromMe: r.fromMe, sender: r.sender ?? null });
  const out = messages.slice();
  out[i] = { ...m, reactions };
  return out;
}

export function reactionGlyph(r) {
  return r.emoji || GLYPHS[r.type] || '\u2022';
}

export function summarizeReactions(reactions) {
  const counts = new Map();
  for (const r of reactions) {
    const g = reactionGlyph(r);
    counts.set(g, (counts.get(g) || 0) + 1);
  }
  return [...counts].map(([glyph, count]) => ({ glyph, count }));
}
