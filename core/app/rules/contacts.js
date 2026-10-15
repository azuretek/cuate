// Pure: how a conversation's addresses meet the system Contacts store (issue 393). One place decides which record an
// address belongs to, and what name a record draws, so the reader and the chat list cannot disagree about either.
//
// An address is matched in its international form first: its digits with the country code when it carries one. A tail
// alone is a fallback, and only the tail of a number that carries one, because two numbers in different countries can
// end the same way, and drawing that person's name and face on the wrong conversation is worse than drawing none. A
// key two records claim is an ambiguity and matches nobody (issue 393).

// The digits of an address, with nothing else.
export function digitsOf(raw) {
  return String(raw || '').replace(/\D+/g, '');
}

// A phone in its international form: the digits with a leading + when the address carries a country code, which a
// leading + or 00 marks, or more than ten digits carries by itself. A number with no mark and ten or fewer digits is
// left national, so it can still meet a contact's number through the tail below.
export function phoneKey(raw) {
  const s = String(raw || '').trim();
  let digits = digitsOf(s);
  if (!digits) return '';
  let international = false;
  if (/^\+/.test(s)) international = true;
  else if (/^00/.test(s)) { digits = digits.replace(/^0+/, ''); international = true; }
  if (digits.length > 10) international = true;
  return international ? '+' + digits : digits;
}

// The tail a national number may meet an international one on: the last ten digits, and only of a number that carries
// at least ten of them. Anything shorter has no tail to give, since a short number is not a phone at all.
export function nationalKey(raw) {
  const digits = digitsOf(raw);
  return digits.length >= 10 ? digits.slice(-10) : '';
}

// An address's exact key: an email lower cased, a phone in its international form, anything else trimmed and lower
// cased. A phone key and an email key never collide, because a key of digits alone is not an email.
export function handleKey(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s.includes('@')) return s.toLowerCase();
  if (/\d/.test(s)) return phoneKey(s);
  return s.toLowerCase();
}

// The store as two indexes, each key to the records that claim it, so a key held by two people is visible as an
// ambiguity rather than silently resolved to one of them.
export function contactIndex(records) {
  const add = (map, key, record) => {
    if (!key) return;
    const list = map.get(key);
    if (!list) map.set(key, [record]);
    else if (!list.includes(record)) list.push(record);
  };
  const exact = new Map();
  const national = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    if (!record) continue;
    for (const phone of Array.isArray(record.phones) ? record.phones : []) { add(exact, phoneKey(phone), record); add(national, nationalKey(phone), record); }
    for (const email of Array.isArray(record.emails) ? record.emails : []) add(exact, String(email || '').trim().toLowerCase(), record);
  }
  return { exact, national };
}

// The one record a key holds, or nothing. A key two people claim names neither of them.
const only = (list) => (list && list.length === 1 ? list[0] : null);

// The record a conversation's addresses name, or nothing. Every address is tried exactly first, and a tail only after
// that, so a number that names one person outright never falls through to another.
export function contactFor(handles, index) {
  const list = Array.isArray(handles) ? handles : [];
  const exact = index && index.exact;
  const national = index && index.national;
  if (!exact || !national) return null;
  for (const handle of list) {
    const found = only(exact.get(handleKey(handle)));
    if (found) return found;
  }
  for (const handle of list) {
    // An explicit country code or an email must never fall back to a different country's phone.
    if (String(handle).includes('@') || phoneKey(handle).startsWith('+') || exact.has(handleKey(handle))) continue;
    const key = nationalKey(handle);
    const found = key ? only(national.get(key)) : null;
    if (found) return found;
  }
  return null;
}

// Whether the shell that hosts the page has a contact editor of its own (issue 393): the Mac's Contacts, the iPhone's
// contact card, the Android contacts app. A shell with none (a Windows or Linux desktop) says so on app.info, and the
// control is not drawn there rather than drawn and doing nothing.
export function hasContactEditor(host) {
  return Boolean(host && host.contactsEditor === true);
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
