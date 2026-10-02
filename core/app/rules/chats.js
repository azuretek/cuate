// Pure: the chat list's rules. The list can be sorted, filtered and gathered into person-made groups; only the
// arrangement lives here, so a group never changes which chats or messages exist.
export const SORT_ORDERS = ['recent', 'unread', 'name', 'manual'];

// The sort choices named the way a person reads them. The page header's sort control and the list's own order share
// this one map, so a button's label and the order it asks for cannot drift.
export const SORT_LABELS = { recent: 'Recent activity', unread: 'Unread first', name: 'Name', manual: 'Manual order' };

// A chat placed in no group is drawn under this pseudo-group, so nothing disappears when it is left out of one.
export const UNGROUPED = 'ungrouped';

export function emptyFilters() {
  return { unread: false, group: null, kind: null, text: '' };
}

export function orderChats(chats) {
  return [...chats].sort(byActivity);
}

const byActivity = (a, b) => (b.lastMessageAt || '').localeCompare(a.lastMessageAt || '') || String(a.id).localeCompare(String(b.id));
const byName = (a, b) => chatTitle(a).localeCompare(chatTitle(b)) || String(a.id).localeCompare(String(b.id));

// The order the list draws in. Unread first keeps the unread chats in their own activity order rather than the order
// they arrived. Manual follows the stored sequence, and anything it does not name falls in by activity behind it.
export function sortChats(chats, { sort = 'recent', order = [] } = {}) {
  const list = [...chats];
  if (sort === 'unread') return [...list.filter((c) => c.unread > 0).sort(byActivity), ...list.filter((c) => !(c.unread > 0)).sort(byActivity)];
  if (sort === 'name') return list.sort(byName);
  if (sort === 'manual') {
    const rank = new Map(order.map((id, i) => [id, i]));
    const at = (c) => (rank.has(c.id) ? rank.get(c.id) : Infinity);
    return list.sort((a, b) => at(a) - at(b) || byActivity(a, b));
  }
  return list.sort(byActivity);
}

// The text a search reads: the chat's name, its participants and its last message.
export function chatSearchText(chat) {
  return [chatTitle(chat), (chat.participants || []).join(' '), (chat.lastMessage && chat.lastMessage.text) || ''].join(' ').toLowerCase();
}

// The search predicate: an empty query matches everything, and a query matches when it appears anywhere in the text
// a chat is searched by. It lives here, not in the element, so the element draws and never decides.
export function matchesSearch(chat, query) {
  const q = String(query || '').trim().toLowerCase();
  return !q || chatSearchText(chat).includes(q);
}

// Filters compose: each one that is set narrows the list and clearing one leaves the others alone. The group filter
// reads placement, where UNGROUPED means the chats that are in no group.
export function filterChats(chats, filters = {}, { placement = {} } = {}) {
  const f = { ...emptyFilters(), ...filters };
  return chats.filter((c) => {
    if (f.unread && !(c.unread > 0)) return false;
    if (f.group) {
      const g = placement[c.id] || null;
      if (f.group === UNGROUPED ? g : g !== f.group) return false;
    }
    if (f.kind === 'direct' && c.isGroup) return false;
    if (f.kind === 'group' && !c.isGroup) return false;
    if (!matchesSearch(c, f.text)) return false;
    return true;
  });
}

// The list drawn as sections: the person's groups in their own order, then the chats in no group. A chat whose group
// is gone counts as ungrouped, so it is never hidden.
export function groupSections(chats, { groups = [], placement = {} } = {}) {
  const byGroup = new Map(groups.map((g) => [g.id, []]));
  const ungrouped = [];
  for (const c of chats) {
    const g = placement[c.id];
    (g && byGroup.has(g) ? byGroup.get(g) : ungrouped).push(c);
  }
  return [...groups.map((g) => ({ id: g.id, name: g.name, chats: byGroup.get(g.id) })), { id: UNGROUPED, name: 'Ungrouped', chats: ungrouped }];
}

// The manual sequence covering every chat, so a move always has a neighbour to swap with. A stored head keeps its
// order and the chats it does not name follow by activity.
export function manualOrder(chats, order = []) {
  const ids = new Set(chats.map((c) => c.id));
  const head = order.filter((id) => ids.has(id));
  const seen = new Set(head);
  const rest = orderChats(chats.filter((c) => !seen.has(c.id))).map((c) => c.id);
  return [...head, ...rest];
}

// Move one chat one step within the manual sequence; at either end, or for a chat not in it, it is unchanged.
export function moveChat(order, id, delta) {
  const list = [...order];
  const i = list.indexOf(id);
  const j = i < 0 ? -1 : i + delta;
  if (i < 0 || j < 0 || j >= list.length) return list;
  [list[i], list[j]] = [list[j], list[i]];
  return list;
}

// Groups are pure lists too: create, rename and reorder are new lists, never edits in place.
export function addGroup(groups, { id, name }) {
  return [...groups, { id, name: String(name || '').trim() || 'Group' }];
}

export function renameGroup(groups, id, name) {
  return groups.map((g) => (g.id === id ? { ...g, name: String(name || '').trim() || g.name } : g));
}

export function moveGroup(groups, id, delta) {
  const list = [...groups];
  const i = list.findIndex((g) => g.id === id);
  const j = i < 0 ? -1 : i + delta;
  if (i < 0 || j < 0 || j >= list.length) return list;
  [list[i], list[j]] = [list[j], list[i]];
  return list;
}

// A chat is in at most one group: placing it moves it, and placing it in no group drops its entry. The arrangement is
// keyed by chat id, so renaming the chat or a member keeps it where it was put.
export function placeChat(placement, chatId, groupId) {
  const out = { ...placement };
  if (groupId && groupId !== UNGROUPED) out[chatId] = groupId;
  else delete out[chatId];
  return out;
}

// A group nobody has named reaches us with the chat's own identifier as its name, so the list read
// "chat323392484988469066" where it should read the people in it (issue #80). An identifier is not a name, so those
// fall through to the participants, joined the way a person would say them, and then to a plain label.
const CHAT_IDENTIFIER = /^chat[0-9]+$/i;

export function chatTitle(chat) {
  const name = String(chat.name || '').trim();
  if (name && !CHAT_IDENTIFIER.test(name)) return name;
  const people = (chat.participants || []).map((p) => String(p).trim()).filter(Boolean);
  if (people.length === 1) return people[0];
  if (people.length === 2) return people[0] + ' and ' + people[1];
  if (people.length === 3) return people[0] + ', ' + people[1] + ' and 1 other';
  if (people.length > 3) return people[0] + ', ' + people[1] + ' and ' + (people.length - 2) + ' others';
  return chat.isGroup ? 'Group chat' : 'Unknown';
}

import { stripInlineObjects } from './engine-imsg.js';

export function chatPreview(chat) {
  const m = chat.lastMessage;
  if (!m) return '';
  const count = m.attachments || 0;
  // A message that carries an inline object reads as the object, not as the placeholder character, and one with nothing
  // readable left is the attachment it actually is (issue #80).
  const text = stripInlineObjects(m.text).trim();
  const body = text || (count === 1 ? '1 attachment' : count > 1 ? count + ' attachments' : '');
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

// The edit mode's own rules: which rows are checked and what a selection does. Everything here is pure, so the list
// draws the selection and the page acts on it, and the confirm gate is tested without a browser.

// Checking a row toggles it. The checked list is a plain array so it crosses an event and a setting as data.
export function toggleChecked(checked = [], id) {
  return checked.includes(id) ? checked.filter((x) => x !== id) : [...checked, id];
}

// Select-all turns every named row on, or clears exactly those rows and leaves any others checked.
export function setAllChecked(checked = [], ids = [], on) {
  if (on) return [...new Set([...checked, ...ids])];
  return checked.filter((id) => !ids.includes(id));
}

export function allChecked(checked = [], ids = []) {
  return ids.length > 0 && ids.every((id) => checked.includes(id));
}

// The count of checked rows that are actually on screen, which is what the header shows and the confirm modal names.
export function checkedCount(checked = [], ids = []) {
  return ids.filter((id) => checked.includes(id)).length;
}

// Adding a selection to a group is the single-row placement applied to each id.
export function addChatsToGroup(placement = {}, ids = [], groupId) {
  return ids.reduce((acc, id) => placeChat(acc, id, groupId), { ...placement });
}

// A brand new group takes the selection with it, so both changes travel in one settings patch.
export function groupFromSelection(groups = [], placement = {}, ids = [], { id, name } = {}) {
  return { groups: addGroup(groups, { id, name }), placement: addChatsToGroup(placement, ids, id) };
}

// A group leaves the list and every placement that pointed at it goes with it, so no chat keeps a group that is gone.
export function removeGroup(groups = [], id) {
  return groups.filter((g) => g.id !== id);
}

export function clearGroupPlacement(placement = {}, groupId) {
  const out = {};
  for (const [chatId, g] of Object.entries(placement)) if (g !== groupId) out[chatId] = g;
  return out;
}

// Delete is a client-side hide: a chat leaves this client's list and nothing on the server is touched. The hidden
// ids are a setting, so every device one person uses draws the same list.
export function hideChats(hidden = [], ids = []) {
  return [...new Set([...hidden, ...ids])];
}

// A hidden chat also leaves the manual order and the placement, so what is drawn and what is kept stay in step.
export function forgetChats(order = [], placement = {}, ids = []) {
  const gone = new Set(ids);
  const outPlacement = {};
  for (const [chatId, g] of Object.entries(placement)) if (!gone.has(chatId)) outPlacement[chatId] = g;
  return { order: order.filter((id) => !gone.has(id)), placement: outPlacement };
}

// The confirm gate. A delete request opens the modal with the ids it names and nothing else, and only a second,
// explicit confirmation resolves it: nothing reaches the hide without the second press. An empty selection cannot
// open the gate at all.
export const DELETE_STEPS = { idle: 'idle', confirming: 'confirming' };

export function requestDelete(ids = []) {
  const unique = [...new Set(ids)];
  return unique.length ? { ids: unique, step: DELETE_STEPS.confirming } : null;
}

export function requestDeleteGroup(id, name) {
  return id ? { kind: 'group', id, name: String(name || 'this group'), step: DELETE_STEPS.confirming } : null;
}

// The second, explicit press. It resolves any pending delete, a selection of chats or a single group, and nothing
// else does, so no delete reaches its action on one press.
export function resolveDelete(pending, confirmed) {
  if (!pending || pending.step !== DELETE_STEPS.confirming || confirmed !== true) return null;
  return pending;
}
