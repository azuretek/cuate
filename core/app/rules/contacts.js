// Pure: how a conversation's handles meet the system Contacts store (issue 393). The server reads the store on
// the Mac and hands the records here, so the one place that decides which record a handle belongs to, and what
// name a record draws, is this file; the reader and the chat list cannot disagree about either.

// The key a handle matches on: a phone reduces to its last ten digits, so a country code or a formatted number
// still finds the person, and an email to lower case. A handle with too few digits to be a phone is compared as
// text, lower cased, rather than by a slice that would match every short string to every other.
export function handleKey(handle) {
  const raw = String(handle || '').trim();
  if (!raw) return '';
  if (raw.includes('@')) return raw.toLowerCase();
  const digits = raw.replace(/\D+/g, '');
  if (digits.length >= 7) return digits.slice(-10);
  return raw.toLowerCase();
}

// Every key a list of handles answers to, in the order they are given, with the empties dropped.
export function handleKeys(handles) {
  return (Array.isArray(handles) ? handles : []).map(handleKey).filter(Boolean);
}

// The record an index holds for a chat: the first of the chat's own handles the store knows, or nothing. An
// index is a Map from key to record, which is what contactIndex builds and the reader keeps.
export function contactFor(handles, index) {
  if (!index || typeof index.get !== 'function') return null;
  for (const key of handleKeys(handles)) {
    const record = index.get(key);
    if (record) return record;
  }
  return null;
}

// The name a record draws, chosen the way Contacts draws one: a nickname, else given and family, else the
// organisation. A record no part names reads as no name, so the engine's own name is left in place rather than
// replaced with an empty one.
export function contactName(record) {
  if (!record) return '';
  const nickname = String(record.nickname || '').trim();
  if (nickname) return nickname;
  const person = [record.given, record.middle, record.family]
    .map((p) => String(p || '').trim())
    .filter(Boolean)
    .join(' ');
  if (person) return person;
  return String(record.organization || '').trim();
}

// The index the reader's records turn into: one key per phone and email, the first record that claims a key
// keeping it, so a person held twice still answers once and the same key never flips between two records.
export function contactIndex(records) {
  const index = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const keys = [...handleKeys(record && record.phones), ...handleKeys(record && record.emails)];
    for (const key of keys) if (!index.has(key)) index.set(key, record);
  }
  return index;
}
