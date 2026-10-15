// The system Contacts store on the Mac (issue 393), behind one interface so the rules stay testable off a Mac.
// The store is read through the Contacts framework with the Mac's own osascript, the way the household's contacts
// lane reads it: the reader (run) is injected, so a test passes a fake and nothing in the suite needs a Mac, and a
// store that refuses (macOS has not allowed Contacts) reads as no contacts rather than failing the server.
import { execFile } from 'node:child_process';
import { watch } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { contactIndex, contactFor, contactName } from '../../core/app/rules/contacts.js';

// The program the Mac runs: one JSON object on stdout. Contacts are read only when macOS has ALREADY allowed them
// (authorizationStatus 3), so a refusal is reported to the server rather than prompting on the Mac's screen.
export const CONTACTS_JXA = [
  "ObjC.import('Contacts');",
  'const store = $.CNContactStore.alloc.init;',
  'const status = Number($.CNContactStore.authorizationStatusForEntityType($.CNEntityTypeContacts));',
  'if (status !== 3) { JSON.stringify({ authorized: false, status: status }); }',
  'else {',
  '  const keys = [$.CNContactGivenNameKey, $.CNContactMiddleNameKey, $.CNContactFamilyNameKey,',
  '    $.CNContactNicknameKey, $.CNContactOrganizationNameKey, $.CNContactPhoneNumbersKey,',
  '    $.CNContactEmailAddressesKey, $.CNContactThumbnailImageDataKey];',
  '  const all = store.unifiedContactsMatchingPredicateKeysToFetchError(',
  '    $.CNContact.predicateForContactsWithIdentifiers([]), keys, Ref());',
  '  const out = [];',
  '  for (let i = 0; i < Number(all.count); i += 1) {',
  '    const c = all.objectAtIndex(i);',
  '    const str = (v) => { try { return v && v.js !== undefined ? String(v.js) : String(v || ""); } catch (e) { return ""; } };',
  '    const rec = { given: str(c.givenName), middle: str(c.middleName), family: str(c.familyName),',
  '      nickname: str(c.nickname), organization: str(c.organizationName), phones: [], emails: [] };',
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
  '  }',
  '  JSON.stringify({ authorized: true, status: status, contacts: out });',
  '}',
].join('\n');

// The default reader: the Mac's own osascript. Anything else is passed as run by a test.
export const macRun = () => new Promise((resolve, reject) => {
  execFile('osascript', ['-l', 'JavaScript', '-e', CONTACTS_JXA], { encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
});

// Where the store lives, for the watch that tells the server a contact changed. A home other than this process's is
// never read; the caller injects what it watches.
export function contactsDir(home = os.homedir()) {
  return path.join(home, 'Library', 'Application Support', 'AddressBook');
}

export function createContacts({ run = macRun, log = null, dataDir = null, ttlMs = 60000, now = () => Date.now(), watchDir = process.platform === 'darwin' ? contactsDir() : null } = {}) {
  let index = null;
  let records = [];
  let loadedAt = 0;
  let loading = null;
  const photos = new Map(); // record -> { id, mime, bytes, file } once its picture is on disk

  // One read of the store, cached until it is TTL old. A read in flight is joined rather than repeated.
  async function load() {
    if (index && now() - loadedAt < ttlMs) return index;
    if (loading) return loading;
    const started = now();
    loading = (async () => {
      try {
        const text = await run();
        const parsed = JSON.parse(String(text || '{}'));
        if (!parsed || parsed.authorized !== true) {
          log?.emit('contacts.refused', { status: Number(parsed && parsed.status) || 0 });
          records = [];
        } else {
          records = Array.isArray(parsed.contacts) ? parsed.contacts : [];
          log?.emit('contacts.read', { count: records.length, status: Number(parsed.status) || 3, ms: Math.round(now() - started) });
        }
        index = contactIndex(records);
        loadedAt = now();
        photos.clear();
      } catch (e) {
        // A store that cannot be read (no permission, no osascript) is no contacts, never a failed server.
        log?.emit('contacts.refused', { status: 0, error: String((e && e.message) || e) });
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

  // The picture of a record, written once into the data folder's contacts cache and then reused. The id is a hash
  // of the bytes, so a picture that changed is a new id and a client can never draw the old one from its cache.
  async function photo(record) {
    if (!record || !record.photo || !dataDir) return null;
    if (photos.has(record)) return photos.get(record);
    const bytes = Buffer.from(String(record.photo), 'base64');
    if (!bytes.length) return null;
    const id = createHash('sha256').update(bytes).digest('base64url').slice(0, 22);
    const dir = path.join(dataDir, 'contacts');
    const file = path.join(dir, id + '.jpg');
    await mkdir(dir, { recursive: true });
    await writeFile(file, bytes);
    const made = { id, mime: 'image/jpeg', name: 'Contact photo', bytes: bytes.length, file };
    photos.set(record, made);
    return made;
  }

  // Told when the store changed, so a contact renamed or repictured reaches every client. The caller supplies what
  // happens next; a Mac with no store to watch is no watcher at all.
  function watchStore(onChange) {
    if (!watchDir) return () => {};
    let timer = null;
    let w = null;
    try {
      w = watch(watchDir, { persistent: false }, () => {
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

  return { load, forHandles, photo, watchStore, get records() { return records; } };
}
