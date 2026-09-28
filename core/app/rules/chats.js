// Pure: the chat list's rules.
export function orderChats(chats) {
  return [...chats].sort((a, b) => (b.lastMessageAt || '').localeCompare(a.lastMessageAt || '') || a.id.localeCompare(b.id));
}

export function chatTitle(chat) {
  return (chat.name || '').trim() || (chat.participants || []).join(', ') || 'Unknown';
}

export function chatPreview(chat) {
  const m = chat.lastMessage;
  if (!m) return '';
  const count = m.attachments || 0;
  const body = m.text || (count === 1 ? '1 attachment' : count > 1 ? count + ' attachments' : '');
  return (m.fromMe ? 'You: ' : '') + body;
}

export function initials(name) {
  const words = String(name || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (/^\d/.test(words[0])) return '#';
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
}

// A live message moves its chat to the top with a new preview; an inbound one in a chat that is not open adds unread.
export function applyMessageToChats(chats, message, { openChatId = null } = {}) {
  const i = chats.findIndex((c) => c.id === message.chatId);
  if (i < 0) return { chats, known: false };
  const c = chats[i];
  if (c.lastMessageAt && c.lastMessageAt > message.sentAt) return { chats, known: true };
  const unread = !message.fromMe && message.chatId !== openChatId ? (c.unread || 0) + 1 : c.unread || 0;
  const lastMessage = { text: message.text, fromMe: message.fromMe, sentAt: message.sentAt, attachments: message.attachments.length };
  const out = chats.slice();
  out[i] = { ...c, unread, lastMessageAt: message.sentAt, lastMessage };
  return { chats: orderChats(out), known: true };
}
