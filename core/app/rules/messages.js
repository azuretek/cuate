// Pure: the conversation's rules.
const GLYPHS = { love: '\u2764\ufe0f', like: '\ud83d\udc4d', dislike: '\ud83d\udc4e', laugh: '\ud83d\ude02', emphasis: '\u203c\ufe0f', question: '\u2753' };

// The six standard tapbacks, in the order the Mac offers them, as { type, glyph }. These are the reactions the
// engine can send; any other emoji is shown when it arrives but refused when sent (issue 138).
export const TAPBACKS = Object.entries(GLYPHS).map(([type, glyph]) => ({ type, glyph }));

// The standard tapback an emoji stands for, or null. The text and emoji presentations of one character (with and
// without U+FE0F) name the same tapback; a skin tone or any other emoji names none.
export function tapbackType(emoji) {
  const bare = String(emoji || '').replace(/\ufe0f/g, '');
  for (const t of TAPBACKS) if (t.glyph.replace(/\ufe0f/g, '') === bare) return t.type;
  return null;
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

// The ids of the thread a message belongs to: its first message (followed up through replyTo, a parent not loaded
// included) and every message whose replies lead back to it. A loop in the data ends rather than spinning.
export function threadIds(messages, id) {
  const byId = new Map((messages || []).map((m) => [m.id, m]));
  const rootOf = (start) => {
    let at = start;
    const seen = new Set();
    while (!seen.has(at)) {
      seen.add(at);
      const parent = byId.get(at)?.replyTo;
      if (!parent) return at;
      at = parent;
    }
    return start;
  };
  const root = rootOf(id);
  const ids = new Set([root, id]);
  for (const m of byId.values()) if (rootOf(m.id) === root) ids.add(m.id);
  return ids;
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
