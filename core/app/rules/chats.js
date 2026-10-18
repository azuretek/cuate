// Pure: the chat list's rules. The list can be sorted, filtered and searched; only the arrangement lives here. A group
// is the message service's own group conversation (issue 326), never an arrangement made in this app.
export const SORT_ORDERS = ['recent', 'name', 'name-desc'];

// The sort choices named the way a person reads them. The page header's sort control and the list's own order share
// this one map, so a button's label and the order it asks for cannot drift.
export const SORT_LABELS = { recent: 'Recent', name: 'Name A to Z', 'name-desc': 'Name Z to A' };

// A stored order the menu no longer offers (the unread and manual orders before issue 136) reads as Recent, so an old
// setting draws a list and marks a choice rather than neither.
export function normalizeSort(sort) {
  return SORT_ORDERS.includes(sort) ? sort : 'recent';
}

// The search reads a term one of two ways: Contact reads the chat's name and its participants, Full text reads the
// message text the client holds for it. The mode is chosen per term (issue 133).
export const SEARCH_MODES = ['contact', 'text'];
export const SEARCH_MODE_LABELS = { contact: 'Contact', text: 'Full text' };

// `text` and `mode` are what is being typed, which filters live; `terms` are the committed search terms, each with its
// own mode, and every one of them must match.
export function emptyFilters() {
  return { unread: false, kind: null, text: '', mode: 'contact', terms: [] };
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

// What a Contact term reads: the name drawn on the row, the people's contact names and the participants.
export function contactSearchText(chat) {
  return [chatTitle(chat), chatPeople(chat).join(' '), (chat.participants || []).join(' ')].join(' ').toLowerCase();
}

// The people a chat is drawn as: each member by the name the server's Contacts store gave it, or by its address when
// the store does not know it (issue 393). A chat that reached us with no members (an older server, or one with no
// Contacts store) reads as its addresses, as before. Reading the addresses alone drew an unnamed group as phone numbers
// while the server already knew everyone in it.
function chatPeople(chat) {
  const members = Array.isArray(chat.members) && chat.members.length ? chat.members.map((m) => (m && (m.name || m.handle)) || '') : chat.participants || [];
  return members.map((p) => String(p).trim()).filter(Boolean);
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

// Filters compose: each one that is set narrows the list and clearing one leaves the others alone. Every committed
// term and the text being typed must all match, so each term refines the one before.
export function filterChats(chats, filters = {}, { texts = {} } = {}) {
  const f = { ...emptyFilters(), ...filters };
  const terms = [...(Array.isArray(f.terms) ? f.terms : []), { text: f.text, mode: f.mode }];
  return chats.filter((c) => {
    if (f.unread && !(c.unread > 0)) return false;
    if (f.kind === 'direct' && c.isGroup) return false;
    if (f.kind === 'group' && !c.isGroup) return false;
    if (!terms.every((t) => matchesTerm(c, t, { texts }))) return false;
    return true;
  });
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

// A group nobody has named reaches us with the chat's own identifier as its name, so the list read
// "chat323392484988469066", or a 32 character hex string, where it should read the people in it (issues 80 and 388).
// An identifier is not a name, so those fall through to the participants, joined the way a person would say them, and
// then to a plain label. isMachineName (engine-imsg.js) is the one test of what an identifier looks like.
export function chatTitle(chat) {
  const name = String(chat.name || '').trim();
  if (name && !isMachineName(name, chat)) return name;
  const people = chatPeople(chat);
  if (people.length === 1) return people[0];
  if (people.length === 2) return people[0] + ' and ' + people[1];
  if (people.length === 3) return people[0] + ', ' + people[1] + ' and 1 other';
  if (people.length > 3) return people[0] + ', ' + people[1] + ' and ' + (people.length - 2) + ' others';
  return chat.isGroup ? 'Group chat' : 'Unknown';
}

import { stripInlineObjects, isMachineName } from './engine-imsg.js';
export { isMachineName };
import { messageSummary } from './payload.js';

export function chatPreview(chat) {
  const m = chat.lastMessage;
  if (!m) return '';
  if (m.event) return eventText(m);
  // A message that carries an inline object reads as the object, not as the placeholder character, and one with nothing
  // readable left is the attachment it actually is (issue #80). A payload reads as the link it is, never as its name
  // (issue 238).
  return (m.fromMe ? 'You: ' : '') + messageSummary({ ...m, text: stripInlineObjects(m.text) });
}

// The words for an event in a conversation (issue 341): who did it, then what changed. A background is the
// conversation's own (issue 417), set or cleared, and a rename gives the group its name or removes it (issue 439).
export function eventText(m) {
  const who = m.fromMe ? 'You' : String(m.senderName || m.sender || 'Someone');
  if (m.event && m.event.kind === 'groupPhoto') return who + ' changed the group photo';
  if (m.event && m.event.kind === 'background') return who + (m.event.action === 'clear' ? ' removed the background' : ' changed the background');
  if (m.event && m.event.kind === 'rename') return m.event.name ? who + ' named the conversation \u201c' + m.event.name + '\u201d' : who + ' removed the name from the conversation';
  return '';
}

export function initials(name) {
  const words = String(name || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (/^\d/.test(words[0])) return '#';
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
}

// What a list preview keeps of an event: its kind, and the action or name its words need.
export function eventPreview(e) {
  return { kind: e.kind, ...(e.action ? { action: e.action } : {}), ...(typeof e.name === 'string' ? { name: e.name } : {}) };
}

// A live message moves its chat to the top with a new preview; an inbound one in a chat that is not open adds unread.
export function applyMessageToChats(chats, message, { openChatId = null } = {}) {
  const i = chats.findIndex((c) => c.id === message.chatId);
  if (i < 0) return { chats, known: false };
  const c = chats[i];
  if (c.lastMessageAt && c.lastMessageAt > message.sentAt) return { chats, known: true };
  const unread = !message.fromMe && message.chatId !== openChatId ? (c.unread || 0) + 1 : c.unread || 0;
  const lastMessage = { text: message.text, fromMe: message.fromMe, sentAt: message.sentAt, attachments: message.attachments.length, link: message.link || null, payloads: message.payloads || 0, ...(message.sendEffect ? { sendEffect: message.sendEffect } : {}) };
  const out = chats.slice();
  const photo = message.event && message.event.kind === 'groupPhoto' ? { photo: message.event.photo } : {};
  // A background cleared takes the backdrop away at once; a new one arrives from the server as the chat changing,
  // carrying the picture, since only the server can read it (issue 417).
  const backdrop = message.event && message.event.kind === 'background' && message.event.action === 'clear' ? { background: null } : {};
  // A rename is the group's title from now on, on every client at once (issue 439).
  const renamed = message.event && message.event.kind === 'rename' ? { name: String(message.event.name || '') } : {};
  const event = message.event ? eventPreview(message.event) : null;
  out[i] = { ...c, ...photo, ...backdrop, ...renamed, unread, lastMessageAt: message.sentAt, lastMessage: event ? { ...lastMessage, event, senderName: message.senderName || null } : lastMessage };
  return { chats: orderChats(out), known: true };
}

// An edited message changes the chat's preview when it is the message the preview shows (issue 391): the same time and
// the same side. The preview carries no id, so an older message's edit leaves it alone, and nothing moves in the list.
export function applyEditToChats(chats, message) {
  const i = chats.findIndex((c) => c.id === message.chatId);
  if (i < 0) return chats;
  const c = chats[i];
  const last = c.lastMessage;
  if (!last || last.sentAt !== message.sentAt || Boolean(last.fromMe) !== Boolean(message.fromMe)) return chats;
  const out = chats.slice();
  out[i] = { ...c, lastMessage: { ...last, text: message.text, link: message.link || last.link || null, edited: true } };
  return out;
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

// Delete is a client-side hide: a chat leaves this client's list and nothing on the server is touched. The hidden
// ids are a setting, so every device one person uses draws the same list.
export function hideChats(hidden = [], ids = []) {
  return [...new Set([...hidden, ...ids])];
}

// A hidden chat also leaves the manual order, so what is drawn and what is kept stay in step.
export function forgetChats(order = [], ids = []) {
  const gone = new Set(ids);
  return order.filter((id) => !gone.has(id));
}

// The confirm gate. A delete request opens the modal with the ids it names and nothing else, and only a second,
// explicit confirmation resolves it: nothing reaches the hide without the second press. An empty selection cannot
// open the gate at all.
export const DELETE_STEPS = { idle: 'idle', confirming: 'confirming' };

export function requestDelete(ids = []) {
  const unique = [...new Set(ids)];
  return unique.length ? { ids: unique, step: DELETE_STEPS.confirming } : null;
}

// The second, explicit press. It resolves a pending delete of a selection of chats, and nothing else does, so no delete reaches its action on one press.
export function resolveDelete(pending, confirmed) {
  if (!pending || pending.step !== DELETE_STEPS.confirming || confirmed !== true) return null;
  return pending;
}

// A new conversation names its people as addresses, a phone number or an email (issue 326). What is typed is split on
// commas, semicolons and line breaks; each part is kept once, and a part that is neither is reported back, never sent.
const ADDRESS = /^(\+?[0-9][0-9 ().-]{2,30}|[^\s@]{1,64}@[^\s@]{1,190})$/;
export const isAddress = (a) => typeof a === 'string' && ADDRESS.test(a.trim());

export function parseRecipients(text = '') {
  const parts = String(text).split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean);
  const addresses = [];
  const invalid = [];
  for (const p of parts) (isAddress(p) ? addresses : invalid).push(p);
  return { addresses: [...new Set(addresses)], invalid };
}

// The people the composer offers as it is typed into: every person this list already talks to one to one, by the
// name the list shows and the address the conversation uses, matched on either, the newest conversation first.
export function recipientSuggestions(chats = [], query = '', { exclude = [], limit = 8 } = {}) {
  const q = String(query).trim().toLocaleLowerCase();
  const seen = new Set(exclude);
  const out = [];
  for (const c of orderChats(chats)) {
    if (c.isGroup || !Array.isArray(c.participants) || c.participants.length !== 1) continue;
    const address = c.participants[0];
    if (seen.has(address)) continue;
    const name = chatTitle(c);
    if (q && !name.toLocaleLowerCase().includes(q) && !String(address).toLocaleLowerCase().includes(q)) continue;
    seen.add(address);
    out.push({ address, name, chatId: c.id });
    if (out.length >= limit) break;
  }
  return out;
}

// A selection in Edit becomes one group conversation (issue 326): the people of every chosen conversation, each once.
export function groupAddresses(chats = [], ids = []) {
  const want = new Set(ids);
  const out = [];
  for (const c of chats) if (want.has(c.id)) for (const a of c.participants || []) if (!out.includes(a)) out.push(a);
  return out;
}

// A chat the server says changed (created, renamed, a member added or removed) replaces the one the list holds, or
// joins it, and the list keeps its order. A change that carries no preview keeps the one the list already draws: the
// preview is the newest message's, which the message stream brings, so a rename's own line is not wiped by the chat
// changing straight after it (issue 439).
export function upsertChat(chats = [], chat) {
  if (!chat || chat.id == null) return chats;
  const i = chats.findIndex((c) => c.id === chat.id);
  const out = i < 0 ? [...chats, chat] : chats.map((c, k) => (k === i ? { ...c, ...chat, lastMessage: chat.lastMessage || c.lastMessage || null } : c));
  return orderChats(out);
}

// A messaging link another app hands us when this app is the default for messages (issue 333): sms:, smsto:, mms:,
// mmsto:, im: and imessage:, each naming one or more people (commas between them) and maybe a body. The platform's own
// link is parsed here once, for every shell; a link naming nobody, or anything that is not a phone number or an email,
// is not a messaging link.
const LINK = /^(sms|smsto|mms|mmsto|im|imessage):(?:\/\/)?([^?]*)(?:\?(.*))?$/i;
export function parseMessagingLink(url) {
  const m = LINK.exec(String(url || '').trim());
  if (!m) return null;
  let people;
  try { people = decodeURIComponent(m[2]); } catch { return null; }
  const addresses = [...new Set(people.split(/[,;]/).map((p) => p.trim()).filter(Boolean))];
  if (!addresses.length || !addresses.every(isAddress)) return null;
  let body = '';
  if (m[3]) { try { body = new URLSearchParams(m[3]).get('body') || ''; } catch { body = ''; } }
  return { addresses, body };
}

// Where a messaging link lands: the conversation already held with exactly those people, or a new one started with them.
export function linkTarget(chats = [], link) {
  if (!link) return null;
  const want = [...link.addresses].sort().join('\n');
  const hit = orderChats(chats).find((c) => Array.isArray(c.participants) && c.isGroup === link.addresses.length > 1 && [...c.participants].sort().join('\n') === want);
  return hit ? { open: hit.id } : { compose: link.addresses };
}
