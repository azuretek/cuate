// Attachments: an opaque id maps back to a file inside the Messages attachments folder and nowhere else. A HEIC or
// HEIF photo is converted to JPEG with the Mac's own sips when a client asks, and the conversion is cached in the
// data folder so it happens once. A Live Photo's motion is served from beside its still when a client asks for the
// live part, and from inside the attachments folder only, as the still is.
import os from 'node:os';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { mkdir, access, realpath, stat, rename, open } from 'node:fs/promises';
import { sniff, UNKNOWN_MIME } from './file-type.js';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { motionPath } from './engine/live-photo.js';

// A Live Photo's motion is HEVC in a QuickTime file, which only Apple's own players decode; Chromium on Windows, Linux
// and Android cannot, and iOS refused it from the viewer. On a Mac it is converted once with the system's own avconvert
// to H.264 in an MP4, which every client plays, with its index first so playback starts before the file is read. The
// conversion is injectable so it is tested without a Mac.
const avconvert = (src, out) => new Promise((resolve, reject) => execFile('avconvert', ['--source', src, '--preset', 'Preset1280x720', '--output', out, '--replace'], { timeout: 60000 }, (err) => (err ? reject(err) : resolve())));

export function createAttachments({ attachmentsRoot, dataDir, platform = process.platform, convertMotion = avconvert }) {
  // The recorded path is real, and inside the attachments folder or Messages' sticker cache beside it (a sticker's
  // picture is kept there, issue 341), or there is nothing to serve.
  const roots = () => [attachmentsRoot, attachmentsRoot ? path.join(path.dirname(attachmentsRoot), 'StickerCache') : null].filter(Boolean);
  async function inside(recorded) {
    const expanded = recorded.startsWith('~/') ? path.join(os.homedir(), recorded.slice(2)) : recorded;
    const real = await realpath(expanded).catch(() => null);
    if (!real) return null;
    for (const r of roots()) {
      const root = await realpath(r).catch(() => null);
      if (root && (real === root || real.startsWith(root + path.sep))) return real;
    }
    return null;
  }

  // A file Messages recorded no type for (a group photo, issue 341) is read for one, and a HEIC is drawn as a JPEG.
  async function sniffed(file) {
    const fh = await open(file, 'r');
    try {
      const buf = Buffer.alloc(64);
      const { bytesRead } = await fh.read(buf, 0, 64, 0);
      return sniff(new Uint8Array(buf.subarray(0, bytesRead)));
    } finally {
      await fh.close();
    }
  }

  async function toJpeg(src, id) {
    const dir = path.join(dataDir, 'cache');
    await mkdir(dir, { recursive: true });
    const out = path.join(dir, id + '.jpg');
    try {
      await access(out);
      return out;
    } catch {
      // Not converted yet.
    }
    await new Promise((resolve, reject) => execFile('sips', ['-s', 'format', 'jpeg', src, '--out', out], { timeout: 30000 }, (err) => (err ? reject(err) : resolve())));
    return out;
  }

  // The motion as an MP4 in the data folder's cache, made once and reused. It is written beside its final name and
  // renamed into place, so a request arriving mid-conversion never serves half a file. A conversion that fails leaves
  // the original to be served, which Apple's players still play.
  const converting = new Map();
  async function toMp4(src, id) {
    const dir = path.join(dataDir, 'cache');
    const out = path.join(dir, id + '.live.mp4');
    try { await access(out); return out; } catch { /* not converted yet */ }
    if (!converting.has(out)) {
      converting.set(out, (async () => {
        await mkdir(dir, { recursive: true });
        const part = out + '.part.mp4';
        await convertMotion(src, part);
        await rename(part, out);
        return out;
      })().finally(() => converting.delete(out)));
    }
    return converting.get(out);
  }

  return {
    async resolve(rec, format, part = null) {
      if (part === 'live') {
        const expanded = rec.path.startsWith('~/') ? path.join(os.homedir(), rec.path.slice(2)) : rec.path;
        const motion = motionPath(expanded, (p) => existsSync(p));
        const real = motion ? await inside(motion) : null;
        if (!real) return null;
        if (platform === 'darwin') {
          const mp4 = await toMp4(real, rec.id).catch(() => null);
          if (mp4) return { file: mp4, mime: 'video/mp4', size: (await stat(mp4)).size };
        }
        const st = await stat(real);
        return { file: real, mime: 'video/quicktime', size: st.size };
      }
      const real = await inside(rec.path);
      if (!real) return null;
      let file = real;
      let mime = rec.mime;
      if (!mime || mime === UNKNOWN_MIME) {
        mime = (await sniffed(real).catch(() => null)) || UNKNOWN_MIME;
        if (/heic|heif/i.test(mime) && platform === 'darwin') {
          file = await toJpeg(real, rec.id);
          mime = 'image/jpeg';
        }
      }
      if (format === 'jpeg' && /heic|heif/i.test(rec.mime) && platform === 'darwin') {
        file = await toJpeg(real, rec.id);
        mime = 'image/jpeg';
      }
      const st = await stat(file);
      return { file, mime, size: st.size };
    },
    stream(file, res) {
      const s = createReadStream(file);
      s.on('error', () => res.destroy());
      return s;
    },
  };
}
