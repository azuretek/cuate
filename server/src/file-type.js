// What a file is, read from its own bytes, and the name Messages needs to treat it as that. Messages decides how a
// file arrives (a photo, a video, a named document) from the file it is handed, by its extension: a picture with no
// extension, or with another format's, arrives as a blank document (issue 197). So the server reads the bytes,
// trusts them over the device's name and type, and gives the file the extension its format carries. Pure: bytes and
// strings in, answers out, no I/O.

// Formats read from their signature (an ISO media file by the brands its ftyp box names). ext is the extension a file gets when its name carries none of the format's;
// alt lists the other extensions the same format is known by.
const SNIFFED = [
  { mime: 'image/png', ext: 'png', test: (b) => starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { mime: 'image/jpeg', ext: 'jpg', alt: ['jpeg', 'jpe'], test: (b) => starts(b, [0xff, 0xd8, 0xff]) },
  { mime: 'image/gif', ext: 'gif', test: (b) => ascii(b, 0, 'GIF87a') || ascii(b, 0, 'GIF89a') },
  { mime: 'image/webp', ext: 'webp', test: (b) => ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP') },
  { mime: 'image/avif', ext: 'avif', brands: ['avif', 'avis'] },
  { mime: 'image/heic', ext: 'heic', alt: ['heif'], brands: ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1'] },
  { mime: 'video/quicktime', ext: 'mov', alt: ['qt'], brands: ['qt  '] },
  { mime: 'audio/mp4', ext: 'm4a', brands: ['M4A ', 'M4B '] },
  { mime: 'video/mp4', ext: 'mp4', alt: ['m4v'], brands: ['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'dash'] },
  { mime: 'application/pdf', ext: 'pdf', test: (b) => ascii(b, 0, '%PDF-') },
];

// Formats known by extension only: their bytes carry no signature the server reads, or one shared with others (a
// Word document is a zip), so the device's name is the best word for them.
const NAMED = {
  bin: 'application/octet-stream', dat: 'application/octet-stream',
  txt: 'text/plain', csv: 'text/csv', json: 'application/json', zip: 'application/zip', vcf: 'text/vcard',
  mp3: 'audio/mpeg', wav: 'audio/wav', aac: 'audio/aac', caf: 'audio/x-caf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pages: 'application/vnd.apple.pages', numbers: 'application/vnd.apple.numbers', key: 'application/vnd.apple.keynote',
};

export const UNKNOWN_MIME = 'application/octet-stream';

function starts(b, sig) {
  if (b.length < sig.length) return false;
  for (let i = 0; i < sig.length; i += 1) if (b[i] !== sig[i]) return false;
  return true;
}
function ascii(b, at, s) {
  if (b.length < at + s.length) return false;
  for (let i = 0; i < s.length; i += 1) if (b[at + i] !== s.charCodeAt(i)) return false;
  return true;
}
// An ISO media file (MP4, QuickTime, HEIC) names its kind in the ftyp box: a major brand at 8, then compatible brands
// after the minor version, from 16 to the end of the box. The major brand decides; a compatible brand only when the
// major one is a brand no format here claims.
function brands(b) {
  if (!ascii(b, 4, 'ftyp')) return null;
  const size = Math.min(b.length, ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0);
  const four = (at) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
  if (size < 12) return null;
  const list = [four(8)];
  for (let at = 16; at + 4 <= size; at += 4) list.push(four(at));
  return list;
}
const ISO = (names) => (b) => {
  const list = brands(b);
  if (!list) return false;
  const claimed = (x) => SNIFFED.some((f) => f.brands && f.brands.includes(x));
  return names.includes(list[0]) || (!claimed(list[0]) && list.slice(1).some((x) => names.includes(x)));
};

// The format the bytes are, or null when they carry no signature the server reads.
export function sniff(bytes) {
  const b = bytes || new Uint8Array(0);
  const hit = SNIFFED.find((f) => (f.brands ? ISO(f.brands)(b) : f.test(b)));
  return hit ? hit.mime : null;
}

const extOf = (name) => {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(name);
  return m ? m[1].toLowerCase() : '';
};
const known = (mime) => SNIFFED.find((f) => f.mime === mime) || null;

// The type a name stands for by its extension, or null.
export function mimeForName(name) {
  const ext = extOf(String(name || ''));
  if (!ext) return null;
  const hit = SNIFFED.find((f) => f.ext === ext || (f.alt || []).includes(ext));
  return hit ? hit.mime : NAMED[ext] || null;
}

const MIME = /^[\w.+-]+\/[\w.+-]+$/;

// The name and type a file goes to Messages with. The bytes decide the type when they carry a signature; otherwise
// the device's type, then the name's extension; otherwise it is a document of unknown type. A sniffed format whose
// extension the name lacks gets it: added when the name has none the server knows, put in place of another format's
// when it has one. Anything the server cannot place keeps its name exactly.
export function sendShape({ name, mime, bytes }) {
  const base = String(name || 'file');
  const declared = typeof mime === 'string' && MIME.test(mime) && mime.toLowerCase() !== UNKNOWN_MIME ? mime.toLowerCase() : null;
  const sniffed = sniff(bytes);
  const type = sniffed || declared || mimeForName(base) || UNKNOWN_MIME;
  const format = sniffed ? known(sniffed) : null;
  if (!format) return { name: base, mime: type };
  const ext = extOf(base);
  if (ext === format.ext || (format.alt || []).includes(ext)) return { name: base, mime: type };
  const stem = ext && mimeForName(base) ? base.slice(0, -(ext.length + 1)) : base;
  return { name: (stem || 'file') + '.' + format.ext, mime: type };
}

// Messages keeps a link preview's or an app message's data as a payload file beside the real attachments. It is the
// inside of one message, never a file anyone sent, so it is never sent on as an attachment.
export function internalPayload({ name, path: p }) {
  return [name, p].some((x) => /\.pluginpayloadattachment$/i.test(String(x || '')));
}
