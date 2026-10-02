// Pure: the mapping from the imsg engine's JSON (docs/json.md in openclaw/imsg) to the model core/spec/api.json
// declares. The server imports it; its fake engine speaks the same JSON, so tests exercise this path end to end.
const TAPBACKS = new Set(['love', 'like', 'dislike', 'laugh', 'emphasis', 'question']);

const iso = (s) => {
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
const stripTarget = (g) => String(g).replace(/^(?:p:\d+\/|bp:)/, '');

export function mapChat(c) {
  return {
    id: String(c.id),
    name: String(c.display_name || c.contact_name || c.name || c.identifier || '').trim(),
    isGroup: Boolean(c.is_group),
    service: c.service ? String(c.service) : 'iMessage',
    participants: Array.isArray(c.participants) ? c.participants.map(String) : [],
    unread: Number.isFinite(c.unread_count) ? c.unread_count : 0,
    lastMessageAt: c.last_message_at ? iso(c.last_message_at) : null,
    lastMessage: null,
  };
}

function mapAttachment(a, attachmentId) {
  return {
    id: attachmentId(a),
    name: String(a.transfer_name || a.filename || 'attachment'),
    mime: String(a.mime_type || 'application/octet-stream'),
    bytes: Number.isFinite(a.total_bytes) ? a.total_bytes : 0,
    sticker: Boolean(a.is_sticker),
    missing: Boolean(a.missing) || !a.original_path,
  };
}

function mapInlineReaction(r) {
  const type = r.reaction_type || r.type;
  if (!type) return null;
  const fromMe = Boolean(r.is_from_me ?? r.from_me);
  return { type: TAPBACKS.has(type) ? type : 'emoji', emoji: r.reaction_emoji || r.emoji || null, fromMe, sender: fromMe ? null : r.sender || null };
}

// iMessage writes U+FFFC where an inline object sits, meaning an emoji sent as an image or a sticker, which arrives
// as an attachment of its own. The character has no glyph, so printing it drew a box in the message and in the list
// preview (issue #80). It is a placeholder, never content.
const INLINE_OBJECT = /\uFFFC/g;

export function stripInlineObjects(text) {
  return typeof text === 'string' ? text.replace(INLINE_OBJECT, '') : '';
}

export function mapMessage(m, { attachmentId }) {
  const fromMe = Boolean(m.is_from_me);
  return {
    id: m.guid ? String(m.guid) : 'row:' + m.id,
    chatId: String(m.chat_id),
    fromMe,
    sender: fromMe ? null : m.sender || null,
    senderName: fromMe ? null : m.sender_name || null,
    text: stripInlineObjects(m.text),
    sentAt: iso(m.created_at) || '1970-01-01T00:00:00.000Z',
    replyTo: m.reply_to_guid || m.thread_originator_guid || null,
    read: fromMe || typeof m.is_read !== 'boolean' ? null : m.is_read,
    attachments: (Array.isArray(m.attachments) ? m.attachments : []).map((a) => mapAttachment(a, attachmentId)),
    reactions: (Array.isArray(m.reactions) ? m.reactions : []).map(mapInlineReaction).filter(Boolean),
  };
}

// A standalone tapback row from the live stream, applied to the message it targets.
export function mapReaction(m) {
  if (!m.is_reaction || !m.reacted_to_guid) return null;
  const fromMe = Boolean(m.is_from_me);
  return {
    chatId: String(m.chat_id),
    targetId: stripTarget(m.reacted_to_guid),
    type: TAPBACKS.has(m.reaction_type) ? m.reaction_type : 'emoji',
    emoji: m.reaction_emoji || null,
    add: m.is_reaction_add !== false,
    fromMe,
    sender: fromMe ? null : m.sender || null,
  };
}
