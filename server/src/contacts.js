// The system Contacts store on the Mac (issue 393), behind one interface so the rules stay testable off a Mac.
// The store is read through the Contacts framework with the Mac's own osascript, the way the household's contacts
// lane reads it: the reader (run) is injected, so a test passes a fake and nothing in the suite needs a Mac.
//
// ★ A store that was not allowed and a store that is simply empty are told apart, in the log and in status: an
// allowed store that holds no one reads as empty, and only a refusal reads as unavailable, with the state macOS gave
// (not determined, restricted or denied). Nothing here silently reports success for a store it could not read.
import { execFile } from 'node:child_process';
import { watch } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { sendShape, sniff } from './file-type.js';
import path from 'node:path';
import { contactIndex, contactFor, contactName } from '../../core/app/rules/contacts.js';

// The program the Mac runs: one JSON object on stdout. Contacts are read only when macOS has ALREADY allowed them
// (authorizationStatus 3), so a refusal is reported to the server rather than prompting on the Mac's screen.
//
// ★ The store is enumerated with one CNContactFetchRequest (unifyResults on), never by listing containers first: on a
// Mac whose people live in an account the server's identity cannot list containers for, containersMatchingPredicate
// answers no containers and a per-container read answers nobody, while an authorized enumeration reads every person
// (issue 393). The keys are bridged with $([...]): a plain JavaScript array can reach the Contacts framework as a
// dictionary, which it refuses with an unrecognized selector.
export const CONTACTS_JXA = [
  "ObjC.import('Contacts');",
  'const store = $.CNContactStore.alloc.init;',
  'const status = Number($.CNContactStore.authorizationStatusForEntityType($.CNEntityTypeContacts));',
  'if (status !== 3) { JSON.stringify({ authorized: false, status: status }); }',
  'else {',
  '  const keys = $([$.CNContactIdentifierKey, $.CNContactGivenNameKey, $.CNContactMiddleNameKey, $.CNContactFamilyNameKey,',
  '    $.CNContactNicknameKey, $.CNContactOrganizationNameKey, $.CNContactPhoneNumbersKey,',
  '    $.CNContactEmailAddressesKey, $.CNContactThumbnailImageDataKey, $.CNContactFormatter.descriptorForRequiredKeysForStyle($.CNContactFormatterStyleFullName)]);',
  '  const request = $.CNContactFetchRequest.alloc.initWithKeysToFetch(keys);',
  '  request.unifyResults = true;',
  '  const str = (v) => { try { return v && v.js !== undefined ? String(v.js) : String(v || ""); } catch (e) { return ""; } };',
  '  const out = [];',
  '  const seen = new Set();',
  '  const err = Ref();',
  '  const read = store.enumerateContactsWithFetchRequestErrorUsingBlock(request, err, (c) => {',
  '    const id = str(c.identifier);',
  '    if (id && seen.has(id)) return;',
  '    if (id) seen.add(id);',
  '    const rec = { given: str(c.givenName), middle: str(c.middleName), family: str(c.familyName),',
  '      nickname: str(c.nickname), organization: str(c.organizationName), displayName: str($.CNContactFormatter.stringFromContactStyle(c, $.CNContactFormatterStyleFullName)), phones: [], emails: [] };',
  '    const phones = c.phoneNumbers;',
  '    for (let j = 0; phones && j < Number(phones.count); j += 1) {',
  '      try { const v = phones.objectAtIndex(j).value.stringValue; if (v) rec.phones.push(String(v.js !== undefined ? v.js : v)); } catch (e) { /* a value with no number */ }',
  '    }',
  '    const emails = c.emailAddresses;',
  '    for (let j = 0; emails && j < Number(emails.count); j += 1) {',
  '      try { const v = emails.objectAtIndex(j).value; if (v) rec.emails.push(String(v.js !== undefined ? v.js : v)); } catch (e) { /* a value with no address */ }',
  '    }',
  '    try { if (c.thumbnailImageData) rec.photo = String(c.thumbnailImageData.base64EncodedStringWithOptions(0)); } catch (e) { /* a record with no picture */ }',
  '    out.push(rec);',
  '  });',
  '  if (!read) throw new Error("Contacts could not be read");',
  '  JSON.stringify({ authorized: true, status: status, contacts: out });',
  '}',
].join('\n');

// The default reader: the Mac's own osascript. Anything else is passed as run by a test.
export const macRun = () => new Promise((resolve, reject) => {
  execFile('osascript', ['-l', 'JavaScript', '-e', CONTACTS_JXA], { encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
});

// The state macOS reports for Contacts, as the word the log and status carry. Only 3 is allowed; 0 means the person
// has never been asked, 1 that the system refuses it, 2 that it was denied.
export function contactsState(status) {
  const s = Number(status);
  if (s === 3) return 'authorized';
  if (s === 0) return 'not_determined';
  if (s === 1) return 'restricted';
  if (s === 2) return 'denied';
  return 'unknown';
}

// Where the store lives, for the watch that tells the server a contact changed.
export function contactsDir(home = os.homedir()) {
  return path.join(home, 'Library', 'Application Support', 'AddressBook');
}

export function createContacts({ run = macRun, log = null, dataDir = null, ttlMs = 60000, now = () => Date.now(), watchDir = process.platform === 'darwin' ? contactsDir() : null } = {}) {
  let index = null;
  let records = [];
  let loadedAt = 0;
  let loading = null;
  let last = { state: 'unread', status: null, count: 0, reason: null, ms: null, at: null };
  const photos = new Map();

  // One read of the store, cached until it is TTL old. A read in flight is joined rather than repeated.
  async function load() {
    if (index && now() - loadedAt < ttlMs) return index;
    if (loading) return loading;
    const started = now();
    loading = (async () => {
      try {
        const text = await run();
        const parsed = JSON.parse(String(text || '{}'));
        const status = Number(parsed && parsed.status);
        if (!parsed || parsed.authorized !== true) {
          const state = contactsState(status);
          last = { state, status: Number.isFinite(status) ? status : null, count: 0, reason: state, ms: Math.round(now() - started), at: new Date(now()).toISOString() };
          log?.emit('contacts.refused', { status: last.status === null ? 0 : last.status, reason: state });
          records = [];
        } else {
          if (status !== 3 || !Array.isArray(parsed.contacts)) throw new Error('Invalid Contacts response');
          records = parsed.contacts;
          const state = records.length ? 'ok' : 'empty';
          last = { state, status, count: records.length, reason: null, ms: Math.round(now() - started), at: new Date(now()).toISOString() };
          log?.emit('contacts.read', { count: records.length, status, state, ms: last.ms });
        }
        index = contactIndex(records);
        loadedAt = now();
        photos.clear();
      } catch (e) {
        // A store that cannot be read (no permission, no osascript) is no contacts, never a failed server.
        last = { state: 'error', status: null, count: 0, reason: 'error', ms: Math.round(now() - started), at: new Date(now()).toISOString() };
        log?.emit('contacts.refused', { status: 0, reason: 'error', error: String((e && e.message) || e) });
        records = [];
        index = contactIndex([]);
        loadedAt = now();
        photos.clear();
      } finally {
        loading = null;
      }
      return index;
    })();
    return loading;
  }

  async function forHandles(handles) {
    const idx = await load();
    const record = contactFor(handles, idx);
    if (!record) return null;
    return { record, name: contactName(record) };
  }

  // The picture of a record, written once into the data folder's contacts cache and then reused. The id is a hash of
  // the bytes, so a picture that changed is a new id and a client never draws the old one from its cache.
  async function photo(record) {
    if (!record || !record.photo || !dataDir) return null;
    if (photos.has(record)) return photos.get(record);
    const bytes = Buffer.from(String(record.photo), 'base64');
    if (!bytes.length) return null;
    const mime = sniff(bytes);
    if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime)) return null;
    const id = createHash('sha256').update(bytes).digest('base64url').slice(0, 22);
    const dir = path.join(dataDir, 'contacts');
    const file = path.join(dir, sendShape({ name: id, bytes }).name);
    await mkdir(dir, { recursive: true });
    await writeFile(file, bytes);
    const made = { id, mime, name: 'Contact photo', bytes: bytes.length, file };
    photos.set(record, made);
    return made;
  }

  // Told when the store changed, so a contact renamed or repictured reaches every client.
  function watchStore(onChange) {
    if (!watchDir) return () => {};
    let timer = null;
    let w = null;
    try {
      w = watch(watchDir, { persistent: false, recursive: true }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => { timer = null; loadedAt = 0; onChange(); }, 300);
        timer.unref?.();
      });
      w.on('error', () => {});
    } catch {
      return () => {};
    }
    return () => { clearTimeout(timer); try { w.close(); } catch { /* already closed */ } };
  }

  return {
    load,
    forHandles,
    photo,
    watchStore,
    /** What the store last answered: state is ok, empty, not_determined, restricted, denied, unknown, error or
     * unread, so an empty store and a refused one are never the same answer. */
    status: () => ({ ...last }),
    get records() { return records; },
  };
}
