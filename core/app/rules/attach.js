// Pure: the composer's attach menu and the file it stages. What each menu entry offers the system picker, the label a
// staged file shows, whether the server will take it (the cap comes from the server's own info, so the client never
// carries a second copy of the number), and the bytes as base64 for the upload body. No DOM, no clock, no storage.

// The entries the attach menu shows, in order. accept is the system picker's filter; an empty one takes any file.
export const ATTACH_ACTIONS = [
  { id: 'media', label: 'Photo or video', accept: 'image/*,video/*' },
  { id: 'file', label: 'File', accept: '' },
];

const UNITS = ['B', 'KB', 'MB', 'GB'];

export function sizeLabel(bytes) {
  let n = Math.max(0, Number(bytes) || 0);
  let u = 0;
  while (n >= 1024 && u < UNITS.length - 1) { n /= 1024; u += 1; }
  return (u === 0 || n >= 10 ? String(Math.round(n)) : n.toFixed(1)) + ' ' + UNITS[u];
}

// Whether a picked file can be staged: { ok: true } or { ok: false, reason } in words the composer shows as they are.
export function stageCheck(file, maxBytes) {
  if (!file || !(Number(file.size) > 0)) return { ok: false, reason: 'That file is empty.' };
  if (Number(maxBytes) > 0 && file.size > maxBytes) return { ok: false, reason: 'That file is ' + sizeLabel(file.size) + '; the server takes up to ' + sizeLabel(maxBytes) + '.' };
  return { ok: true };
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Standard base64 of a Uint8Array, written out by hand so the same code runs in every shell without btoa's
// one-string limit on a large file.
export function toBase64(bytes) {
  const out = [];
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out.push(ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + ALPHABET[n & 63]);
  }
  if (i < bytes.length) {
    const rest = bytes.length - i;
    const n = (bytes[i] << 16) | (rest === 2 ? bytes[i + 1] << 8 : 0);
    out.push(ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + (rest === 2 ? ALPHABET[(n >> 6) & 63] : '=') + '=');
  }
  return out.join('');
}

// The bubble drawn the moment Send is pressed carries the staged file as a local attachment, shown by name until the
// server's own message replaces it.
export function localAttachment(file) {
  return { id: 'local', name: String(file.name || 'file'), mime: String(file.type || 'application/octet-stream'), bytes: Number(file.size) || 0, sticker: false, missing: false, local: true };
}
