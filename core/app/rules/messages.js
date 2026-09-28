// Pure: the conversation's rules.
const GLYPHS = { love: '\u2764\ufe0f', like: '\ud83d\udc4d', dislike: '\ud83d\udc4e', laugh: '\ud83d\ude02', emphasis: '\u203c\ufe0f', question: '\u2753' };

export function mergeMessages(existing, incoming) {
  const map = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) map.set(m.id, { ...map.get(m.id), ...m });
  return [...map.values()].sort((a, b) => a.sentAt.localeCompare(b.sentAt) || String(a.id).localeCompare(String(b.id)));
}

// Separators after a gap, and runs of messages from one sender close together, as Messages draws them.
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
  return 'Sent';
}

// One tapback per person per message, as iMessage keeps them: adding replaces that person's earlier one.
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
