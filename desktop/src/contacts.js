// Edit contact (issue 393): the Mac's own Contacts, on the person a conversation is with. macOS only; every other
// platform reports contactsEditor false on app.info and the page draws no control there. The Contacts framework is not
// reachable from the shell's own process, so this drives Contacts through AppleScript (JXA), which macOS attributes to
// this app, and answers false when the person is not found or the editor will not open.
import { execFile } from 'node:child_process';

const NL = String.fromCharCode(10);

// The program osascript runs: find the person by the address the conversation carries, then show them. A phone is
// compared by its full digits and an email by its lower-cased text. Exactly one matching card is required;
// an ambiguous address is refused rather than opening another person's card.
const program = (want) => [
  "ObjC.import('Contacts');",
  'const app = Application("Contacts");',
  'const want = ' + JSON.stringify(want) + ';',
  "const digits = String(want).replace(/[^0-9]/g, '');",
  '// Match full digits only: an editor must never guess another country.',
  'let found = null;',
  'let matches = 0;',
  'const people = app.people();',
  'for (let i = 0; i < people.length; i += 1) {',
  '  let matched = false;',
  '  const p = people[i];',
  '  try {',
  '    const phones = p.phones();',
  '    for (let j = 0; j < phones.length; j += 1) {',
  "      const raw = String(phones[j].value());",
  "      const d = raw.replace(/[^0-9]/g, '');",
  '      if (digits && d === digits && want.indexOf("@") < 0) { matched = true; break; }',
  '    }',
  '  } catch (e) { /* a record with no number */ }',
  '  if (!matched) {',
  '    try {',
  '      const emails = p.emails();',
  '      for (let j = 0; j < emails.length; j += 1) {',
  "        if (String(emails[j].value()).toLowerCase() === want.toLowerCase()) { matched = true; break; }",
  '      }',
  '    } catch (e) { /* a record with no address */ }',
  '  }',
  '  if (matched) { matches += 1; found = p; }',
  '}',
  'if (matches !== 1) found = null;',
  // Contacts exposes writable selection, not a show command. Select first so a refusal never activates a wrong card.
  'if (found) { app.selection = [found]; app.activate(); }',
  'JSON.stringify(Boolean(found));',
].join(NL);

export function openContact(handle, { platform = process.platform, run = execFile } = {}) {
  const address = String(handle || '').trim();
  if (platform !== 'darwin' || !address) return Promise.resolve(false);
  return new Promise((resolve) => {
    run('osascript', ['-l', 'JavaScript', '-e', program(address)], { timeout: 20000 }, (err, stdout) => resolve(!err && String(stdout).trim() === 'true'));
  });
}
