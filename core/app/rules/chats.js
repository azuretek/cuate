// Pure: the chat list's rules. The list can be sorted, filtered and gathered into person-made groups; only the
// arrangement lives here, so a group never changes which chats or messages exist.
export const SORT_ORDERS = ['recent', 'name', 'name-desc'];

// The sort choices named the way a person reads them. The page header's sort control and the list's own order share
// this one map, so a button's label and the order it asks for cannot drift.
export const SORT_LABELS = { recent: 'Recent', name: 'Name A to Z', 'name-desc': 'Name Z to A' };

// A stored order the menu no longer offers (the unread and manual orders before issue 136) reads as Recent, so an old
// setting draws a list and marks a choice rather than neither.
export function normalizeSort(sort) {
  return SORT_ORDERS.includes(sort) ? sort : 'recent';
}

// A chat placed in no group is drawn under this pseudo-group, so nothing disappears when it is left out of one.
export const UNGROUPED = 'ungrouped';

// The search reads a term one of two ways: Contact reads the chat's name and its participants, Full text reads the
// message text the client holds for it. The mode is chosen per term (issue 133).
export const SEARCH_MODES = ['contact', 'text'];
export const SEARCH_MODE_LABELS = { contact: 'Contact', text: 'Full text' };

// `text` and `mode` are what is being typed, which filters live; `terms` are the committed search terms, each with its
// own mode, and every one of them must match.
export function emptyFilters() {
  return { unread: false, group: null, kind: null, text: '', mode: 'contact', terms: [] };
}

export function orderChats(chats) {
  return [...chats].sort(byActivity);
}

const byActivity = (a, b) => (b.lastMessageAt || '').localeCompare(a.lastMessageAt || '') || String(a.id).localeCompare(String(b.id));
// Names compare the way a person reads them: by the locale's own collation, ignoring case and accents, with numbers in
// numeric order. The id breaks a tie so the order is stable.
function byName(locale) {
  const collator = new Intl.Collator(locale || undefined, { sensitivity: 'base', numeric: true });
  return (a, b) => collator.compare(chatTitle(a), chatTitle(b)) || String(a.id).localeCompare(String(b.id));
}

// The order the list draws in: by activity, or by the name drawn on the row, A to Z or Z to A.
export function sortChats(chats, { sort = 'recent', locale } = {}) {
  const list = [...chats];
  const order = normalizeSort(sort);
  if (order === 'recent') return list.sort(byActivity);
  const compare = byName(locale);
  return order === 'name' ? list.sort(compare) : list.sort((a, b) => compare(b, a));
}

// What a Contact term reads: the name drawn on the row and the participants.
export function contactSearchText(chat) {
  return [chatTitle(chat), (chat.participants || []).join(' ')].join(' ').toLowerCase();
}

// What a Full text term reads: the message text the client holds for the chat, its last message and any history it
// has loaded (`texts`, keyed by chat id).
export function messageSearchText(chat, texts = {}) {
  const loaded = (texts && texts[chat.id]) || [];
  return [(chat.lastMessage && chat.lastMessage.text) || '', ...loaded].join(' ').toLowerCase();
}

// One search term against one chat. A blank term matches everything; otherwise its text must appear in what its mode
// reads, case-insensitively.
export function matchesTerm(chat, term, { texts = {} } = {}) {
  const q = String((term && term.text) || '').trim().toLowerCase();
  if (!q) return true;
  return (term.mode === 'text' ? messageSearchText(chat, texts) : contactSearchText(chat)).includes(q);
}

const searchMode = (mode) => (SEARCH_MODES.includes(mode) ? mode : 'contact');

// Enter commits what was typed as a term in the chosen mode. A blank entry, or one that repeats a term already in
// force in the same mode, leaves the list as it was.
export function addTerm(terms = [], text, mode = 'contact') {
  const t = String(text || '').trim();
  const m = searchMode(mode);
  if (!t || terms.some((x) => x.mode === m && x.text.toLowerCase() === t.toLowerCase())) return terms;
  return [...terms, { text: t, mode: m }];
}

export function removeTerm(terms = [], index) {
  return terms.filter((_, i) => i !== index);
}

// A chip keeps its text and changes only how it reads.
export function setTermMode(terms = [], index, mode) {
  return terms.map((x, i) => (i === index ? { ...x, mode: searchMode(mode) } : x));
}

// The terms in force, named the way the empty list says them.
export function termsSentence(terms = []) {
  const parts = terms.map((t) => '"' + t.text + '" (' + SEARCH_MODE_LABELS[searchMode(t.mode)] + ')');
  if (parts.length < 2) return parts.join('');
  return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
}

// What the list says when nothing is left: the search terms when there are any, the filters otherwise.
export function emptyListText(filters = {}) {
  const f = { ...emptyFilters(), ...filters };
  const terms = [...f.terms];
  if (String(f.text || '').trim()) terms.push({ text: String(f.text).trim(), mode: f.mode });
  return terms.length ? 'No conversations match ' + termsSentence(terms) + '.' : 'No conversations match these filters.';
}

// Filters compose: each one that is set narrows the list and clearing one leaves the others alone. The group filter
// reads placement, where UNGROUPED means the chats that are in no group. Every committed term and the text being typed
// must all match, so each term refines the one before.
export function filterChats(chats, filters = {}, { placement = {}, texts = {} } = {}) {
  const f = { ...emptyFilters(), ...filters };
  const terms = [...(Array.isArray(f.terms) ? f.terms : []), { text: f.text, mode: f.mode }];
  return chats.filter((c) => {
    if (f.unread && !(c.unread > 0)) return false;
    if (f.group) {
      const g = placement[c.id] || null;
      if (f.group === UNGROUPED ? g : g !== f.group) return false;
    }
    if (f.kind === 'direct' && c.isGroup) return false;
    if (f.kind === 'group' && !c.isGroup) return false;
    if (!terms.every((t) => matchesTerm(c, t, { texts }))) return false;
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

// The list's sections follow the sort in force (issue 217): newest first by day (Today, Yesterday, Earlier), or by
// the first letter of the name for the name sorts, both read off the order the sort already produced, so the sections
// come out in that order and changing the sort regroups the list rather than only reordering it.
export const LETTER_OTHER = '#';

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function dayName(at, now) {
  const d = new Date(at);
  const today = new Date(now);
  if (sameDay(d, today)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(today.getDate() - 1);
  return sameDay(d, yesterday) ? 'Yesterday' : 'Earlier';
}

function letterName(chat) {
  const ch = [...chatTitle(chat).trim()][0] || '';
  return /\p{L}/u.test(ch) ? ch.toLocaleUpperCase() : LETTER_OTHER;
}

// A list that lands in one section draws as plain rows, so a small list gets no more than the dividers between them.
export function listSections(chats, { sort = 'recent', now = 0 } = {}) {
  const grouping = normalizeSort(sort) === 'recent' ? 'day' : 'letter';
  const sections = [];
  const byName = new Map();
  for (const c of chats) {
    const name = grouping === 'day' ? dayName(c.lastMessageAt, now) : letterName(c);
    let s = byName.get(name);
    if (!s) { s = { id: 'sort:' + name, name, chats: [], sortSection: true }; byName.set(name, s); sections.push(s); }
    s.chats.push(c);
  }
  return sections;
}

// A group made without a name takes the first "Group N" not already in use, so two unnamed groups never read alike.
export function defaultGroupName(groups = []) {
  const taken = new Set(groups.map((g) => g.name));
  let n = 1;
  while (taken.has('Group ' + n)) n += 1;
  return 'Group ' + n;
}

// Groups are pure lists too: create, rename and reorder are new lists, never edits in place. The name is optional.
export function addGroup(groups, { id, name }) {
  return [...groups, { id, name: String(name || '').trim() || defaultGroupName(groups) }];
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
import { messageSummary } from './payload.js';

export function chatPreview(chat) {
  const m = chat.lastMessage;
  if (!m) return '';
  // A message that carries an inline object reads as the object, not as the placeholder character, and one with nothing
  // readable left is the attachment it actually is (issue #80). A payload reads as the link it is, never as its name
  // (issue 238).
  return (m.fromMe ? 'You: ' : '') + messageSummary({ ...m, text: stripInlineObjects(m.text) });
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
  const lastMessage = { text: message.text, fromMe: message.fromMe, sentAt: message.sentAt, attachments: message.attachments.length, link: message.link || null, payloads: message.payloads || 0 };
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
