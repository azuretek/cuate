// A Live Photo is a picture with its motion beside it. Messages keeps the still as the message's attachment and writes
// the moving part next to it, in the same folder under the same name with a .mov extension, so the still is the only
// row the engine reports. A picture whose motion is on the disk is marked live_photo, which core's mapper turns into
// the model's live flag, and the server serves the motion from beside the still when a client asks for it. Should an
// engine ever report the motion as an attachment of its own as well, it is folded into the still rather than shown
// twice. Pure apart from the injected exists, so it is tested without a disk.
import path from 'node:path';

const MOTION_EXTS = ['.mov', '.MOV'];

const recordedOf = (a) => String((a && (a.original_path || a.filename)) || '');
const isImage = (a) => /^image\//i.test(String((a && a.mime_type) || ''));
const isVideo = (a) => /^video\//i.test(String((a && a.mime_type) || ''));
const stemOf = (p) => (p ? path.join(path.dirname(p), path.basename(p, path.extname(p))) : '');

// Where the motion for a still recorded at `recorded` is, or null when there is none. exists answers for one path.
export function motionPath(recorded, exists) {
  const stem = stemOf(String(recorded || ''));
  if (!stem || typeof exists !== 'function') return null;
  for (const ext of MOTION_EXTS) {
    const candidate = stem + ext;
    if (candidate !== recorded && exists(candidate)) return candidate;
  }
  return null;
}

export function annotateLivePhotos(message, exists) {
  const list = Array.isArray(message && message.attachments) ? message.attachments : [];
  if (!list.length) return message;
  const live = new Set();
  const attachments = list.map((a) => {
    if (!isImage(a) || a.missing || !recordedOf(a) || !motionPath(recordedOf(a), exists)) return a;
    live.add(stemOf(recordedOf(a)));
    return { ...a, live_photo: true };
  });
  if (!live.size) return message;
  return { ...message, attachments: attachments.filter((a) => !(isVideo(a) && live.has(stemOf(recordedOf(a))))) };
}
