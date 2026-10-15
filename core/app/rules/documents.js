// Pure: what a document in a conversation does when it is pressed (issue 374).
//
// A document is any attachment that is not a picture or a video (core/app/rules/media.js). Some kinds the app shows
// itself, in the media viewer: a PDF, drawn page by page by the bundled pdf.js; text, code and CSV, as text; and audio
// a web view can play, in a player. Pressing one of those opens it in the viewer, which offers Open in and Save beside
// it. Any other kind goes straight to Open in, which hands the file to the device's own apps. Save stays for every
// file, in the viewer and on the message's menu. Nothing here fetches or opens anything: it only answers what to do.
import { isMediaAttachment } from './media.js';

// The largest file the viewer draws itself. A text file past its bound would be one enormous block to lay out, and a
// PDF or a recording past its bound would sit in memory whole, so either goes to Open in instead, where the device's
// own app pages it in.
export const TEXT_PREVIEW_MAX_BYTES = 1024 * 1024;
export const PDF_PREVIEW_MAX_BYTES = 50 * 1024 * 1024;
export const AUDIO_PREVIEW_MAX_BYTES = 100 * 1024 * 1024;

// The text a person reads as text: plain text, Markdown, CSV and tab-separated tables, logs, configuration and code.
// Rich text and HTML are text underneath, but their source is not what was sent to be read, so they open elsewhere.
const TEXT_EXTENSIONS = new Set([
  'txt', 'text', 'md', 'markdown', 'csv', 'tsv', 'log', 'json', 'ndjson', 'xml', 'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'env',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'swift', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'm',
  'php', 'pl', 'lua', 'r', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'sql', 'css', 'scss', 'diff', 'patch', 'srt', 'vtt',
]);
const TEXT_TYPES = new Set([
  'application/json', 'application/x-ndjson', 'application/xml', 'application/javascript', 'application/x-javascript',
  'application/ecmascript', 'application/x-sh', 'application/x-yaml', 'application/yaml', 'application/toml', 'application/sql',
  'application/x-subrip',
]);
const NOT_TEXT_TYPES = new Set(['text/html', 'text/rtf', 'text/richtext', 'text/enriched']);

// Audio every web view the app runs in plays: MP3, AAC and MPEG-4 audio, WAV, Ogg, Opus, WebM and FLAC. A voice note
// recorded on a phone is a Core Audio file, which no web view plays, so it opens in the device's own apps instead.
const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'aac', 'wav', 'oga', 'ogg', 'opus', 'flac']);
const AUDIO_TYPES = new Set([
  'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac', 'audio/x-aac', 'audio/wav', 'audio/x-wav',
  'audio/wave', 'audio/ogg', 'audio/opus', 'audio/webm', 'audio/flac', 'audio/x-flac',
]);

// The lower-cased extension of a file name, without the dot, or '' when it has none.
export function extensionOf(name) {
  const base = String(name || '').split(/[\\/]/).pop();
  const dot = base.lastIndexOf('.');
  return dot > 0 && dot < base.length - 1 ? base.slice(dot + 1).toLowerCase() : '';
}

// A type with its parameters dropped, lower-cased: 'Text/Plain; charset=UTF-8' is 'text/plain'.
const bareType = (mime) => String(mime || '').split(';')[0].trim().toLowerCase();

// A file whose size is known and past the bound is too large to draw here; one whose size is unknown is tried.
const fits = (a, max) => !(Number.isFinite(Number(a.bytes)) && Number(a.bytes) > max);

// Whether an attachment is a document the person can press: a real file, on the Mac and fully sent, that is not media.
export function isFileAttachment(a) {
  return Boolean(a) && !a.local && !a.missing && !a.sticker && !isMediaAttachment(a);
}

// What the viewer draws for a document: 'pdf', 'text' or 'audio', or null when the app cannot show it itself. The
// type the file carries decides first and its extension second, since the Mac often records a document as
// application/octet-stream under its real name.
export function previewKind(a) {
  if (!isFileAttachment(a)) return null;
  const type = bareType(a.mime);
  const ext = extensionOf(a.name);
  const generic = !type || type === 'application/octet-stream';
  if (NOT_TEXT_TYPES.has(type)) return null;
  if (type === 'application/pdf' || (generic && ext === 'pdf')) return fits(a, PDF_PREVIEW_MAX_BYTES) ? 'pdf' : null;
  if (AUDIO_TYPES.has(type) || (generic && AUDIO_EXTENSIONS.has(ext))) return fits(a, AUDIO_PREVIEW_MAX_BYTES) ? 'audio' : null;
  const text = type.startsWith('text/') || TEXT_TYPES.has(type) || (generic && TEXT_EXTENSIONS.has(ext));
  if (text) return fits(a, TEXT_PREVIEW_MAX_BYTES) ? 'text' : null;
  return null;
}

// What pressing a document does: 'view' opens it in the media viewer, with Open in and Save; 'open' hands it straight
// to the device's own apps. Anything that is not a document the person can press (still sending, not on the Mac, or a
// picture or video, which the viewer shows as media) answers null.
export function filePress(a) {
  if (!isFileAttachment(a)) return null;
  return previewKind(a) ? 'view' : 'open';
}

// The zoom of a PDF in the viewer, as a multiple of its fitted width: from half the width to four times it, the step a
// press or a key takes, and a factor clamped between them. Fit is 1.
export const DOC_ZOOM_MIN = 0.5;
export const DOC_ZOOM_MAX = 4;
export const DOC_ZOOM_STEP = 1.25;

export function docZoom(scale, factor) {
  const s = (Number(scale) || 1) * (Number(factor) || 1);
  return Math.min(DOC_ZOOM_MAX, Math.max(DOC_ZOOM_MIN, Math.round(s * 1000) / 1000));
}

// How wide a page is drawn at fit: the room across the viewer, never wider than half again the page's own size, so a
// page on a wide desktop window is not blown up past reading size. Answers CSS pixels per PDF point.
export const PAGE_FIT_MAX = 1.5;

export function pageFit(pageWidth, roomWidth) {
  const w = Number(pageWidth) || 0;
  const room = Number(roomWidth) || 0;
  if (w <= 0 || room <= 0) return 1;
  return Math.min(PAGE_FIT_MAX, room / w);
}

// The size a page is laid out at and the bitmap it is drawn into: its CSS size at the scale it is shown at, and its
// pixel size at the device's pixel ratio, held under a bound on the pixel count so a deep zoom on a large page never
// asks for a canvas a web view refuses (they stop drawing past a little over 16 million pixels).
export const PAGE_MAX_PIXELS = 16 * 1024 * 1024;

export function pageCanvas(pageWidth, pageHeight, scale, ratio = 1, maxPixels = PAGE_MAX_PIXELS) {
  const cssWidth = Math.max(1, Math.round((Number(pageWidth) || 0) * scale));
  const cssHeight = Math.max(1, Math.round((Number(pageHeight) || 0) * scale));
  const want = Math.max(1, Number(ratio) || 1);
  const r = Math.min(want, Math.sqrt(maxPixels / (cssWidth * cssHeight)));
  return { cssWidth, cssHeight, width: Math.max(1, Math.floor(cssWidth * r)), height: Math.max(1, Math.floor(cssHeight * r)), ratio: r };
}
