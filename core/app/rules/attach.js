// Pure: the composer's attach control and the file it stages. The picker's filter, the label a staged file shows,
// whether the server will take it (the cap comes from the server's own info, so the client never carries a second copy
// of the number), and the bytes as base64 for the upload body. No DOM, no clock, no storage.

// The filter handed to the shell's own picker, and it is empty: the picker is the system's, so it means every file.
// A phone's picker asks for a photo, a video, the camera or a document itself and a desktop opens its file dialog;
// we keep no type menu of ours and hide nothing from the picker (issue 187).
export const ATTACH_ACCEPT = '';

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
