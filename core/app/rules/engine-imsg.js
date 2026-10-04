// Pure: the mapping from the imsg engine's JSON (docs/json.md in openclaw/imsg) to the model core/spec/api.json
// declares. The server imports it; its fake engine speaks the same JSON, so tests exercise this path end to end.
import { isPayloadName, firstUrl, linkSite, payloadMedia } from './payload.js';

const TAPBACKS = new Set(['love', 'like', 'dislike', 'laugh', 'emphasis', 'question']);

// A message that belongs to no chat. The engine reports it with chat id 0, and a Messages database keys its chats from
// ROWID 1, so no chat list ever names 0 (issue 48). A consumer that must place every message in a conversation leaves
// such a message out rather than carry one whose chat it cannot name.
export const NO_CHAT_ID = '0';

// The chat a row names, with a row that names none (0, null or absent) reported as NO_CHAT_ID, so the adapter and every
// consumer agree on the one value that means no chat.
const chatOf = (m) => (m.chat_id ? String(m.chat_id) : NO_CHAT_ID);

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

// One attachment as the raw engine gives it, plus whether it is the message's own payload. A payload's raw name is
// kept only long enough to decide that, never as the name the model carries.
function attachmentView(a, attachmentId) {
  const name = String(a.transfer_name || a.filename || 'attachment');
  return {
    id: attachmentId(a),
    name,
    mime: String(a.mime_type || 'application/octet-stream'),
    bytes: Number.isFinite(a.total_bytes) ? a.total_bytes : 0,
    sticker: Boolean(a.is_sticker),
    missing: Boolean(a.missing) || !a.original_path,
    payload: isPayloadName(name),
  };
}

// One attachment in the model. The caller names a payload that is media we show (a Photo, a Video), so a raw payload
// filename can never reach the screen.
function modelAttachment(v, name) {
  return { id: v.id, name: name === undefined ? v.name : name, mime: v.mime, bytes: v.bytes, sticker: v.sticker, missing: v.missing };
}

// The title a payload carried, when one did, else null.
const payloadTitle = (m) => (typeof m.payload_title === 'string' && m.payload_title.trim() ? m.payload_title.trim() : null);

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

// The attachments and link a message carries, split so a payload is never a file. A real attachment keeps its name; a
// payload becomes the link card (the site, the URL, the title and the still it carried), or media shown under an honest
// name, or a quiet count when it is neither. A link is built only when the message actually carried a payload and names
// a URL, so ordinary text that happens to hold a link is left exactly as it was.
function payloadParts(m, { attachmentId }) {
  const views = (Array.isArray(m.attachments) ? m.attachments : []).map((a) => attachmentView(a, attachmentId));
  const files = views.filter((v) => !v.payload).map((v) => modelAttachment(v));
  const payloads = views.filter((v) => v.payload);
  if (!payloads.length) return { attachments: files, link: null, payloads: 0 };
  const url = firstUrl(stripInlineObjects(m.text)) || firstUrl(m.payload_url);
  const image = payloads.find((v) => !v.missing && /^image\//i.test(v.mime)) || null;
  const link = url ? { url, site: linkSite(url), title: payloadTitle(m), image: image ? modelAttachment(image, 'Link preview') : null } : null;
  const carried = link ? [] : payloads.filter((v) => !v.missing && payloadMedia(v.mime));
  return {
    attachments: [...files, ...carried.map((v) => modelAttachment(v, /^video\//i.test(v.mime) ? 'Video' : 'Photo'))],
    link,
    payloads: link ? 0 : payloads.length - carried.length,
  };
}

export function mapMessage(m, { attachmentId }) {
  const fromMe = Boolean(m.is_from_me);
  return {
    id: m.guid ? String(m.guid) : 'row:' + m.id,
    chatId: chatOf(m),
    fromMe,
    sender: fromMe ? null : m.sender || null,
    senderName: fromMe ? null : m.sender_name || null,
    text: stripInlineObjects(m.text),
    sentAt: iso(m.created_at) || '1970-01-01T00:00:00.000Z',
    // A message is in a thread only when imsg reports its thread originator. Its reply_to_guid is no such mark: Messages
    // fills it on ordinary rows with the message before it, so reading it marked every consecutive message as a reply
    // to the one above (issue 195).
    replyTo: m.thread_originator_guid ? String(m.thread_originator_guid) : null,
    read: fromMe || typeof m.is_read !== 'boolean' ? null : m.is_read,
    ...payloadParts(m, { attachmentId }),
    reactions: (Array.isArray(m.reactions) ? m.reactions : []).map(mapInlineReaction).filter(Boolean),
  };
}

// A standalone tapback row from the live stream, applied to the message it targets.
export function mapReaction(m) {
  if (!m.is_reaction || !m.reacted_to_guid) return null;
  const fromMe = Boolean(m.is_from_me);
  return {
    chatId: chatOf(m),
    targetId: stripTarget(m.reacted_to_guid),
    type: TAPBACKS.has(m.reaction_type) ? m.reaction_type : 'emoji',
    emoji: m.reaction_emoji || null,
    add: m.is_reaction_add !== false,
    fromMe,
    sender: fromMe ? null : m.sender || null,
  };
}
