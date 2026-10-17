// Attachments: an opaque id maps back to a file inside the Messages attachments folder and nowhere else. A HEIC or
// HEIF photo is converted to JPEG with the Mac's own sips when a client asks, and the conversion is cached in the
// data folder so it happens once. A Live Photo's motion is served from beside its still when a client asks for the
// live part, and from inside the attachments folder only, as the still is. A video's poster, the still a client draws
// in its tile, is made once on the Mac and served as the poster part (issue 415).
import os from 'node:os';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { mkdir, access, realpath, stat, rename, open, rm, readFile, writeFile } from 'node:fs/promises';
import { sniff, UNKNOWN_MIME } from './file-type.js';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { motionPath } from './engine/live-photo.js';
import { readPlist } from './engine/bplist.js';

// A Live Photo's motion is HEVC in a QuickTime file, which only Apple's own players decode; Chromium on Windows, Linux
// and Android cannot, and iOS refused it from the viewer. On a Mac it is converted once with the system's own avconvert
// to H.264 in an MP4, which every client plays, with its index first so playback starts before the file is read. The
// conversion is injectable so it is tested without a Mac.
const avconvert = (src, out) => new Promise((resolve, reject) => execFile('avconvert', ['--source', src, '--preset', 'Preset1280x720', '--output', out, '--replace'], { timeout: 60000 }, (err) => (err ? reject(err) : resolve())));

// A video's poster (issue 415): Quick Look's thumbnail of the video, which is a frame from it, as a PNG at most 640
// pixels on its longer side. qlmanage writes it into the folder it is given under the video's own name, so it is made
// in a folder of its own and moved into place. Injectable, so it is tested without a Mac.
const qlPoster = async (src, out) => {
  const dir = out + '.ql';
  await mkdir(dir, { recursive: true });
  try {
    await new Promise((resolve, reject) => execFile('qlmanage', ['-t', '-s', '640', '-o', dir, src], { timeout: 30000 }, (err) => (err ? reject(err) : resolve())));
    await rename(path.join(dir, path.basename(src) + '.png'), out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

export function createAttachments({ attachmentsRoot, dataDir, platform = process.platform, convertMotion = avconvert, makePoster = qlPoster }) {
  // The recorded path is real, and inside the attachments folder or Messages' sticker cache beside it (a sticker's
  // picture is kept there, issue 341), or there is nothing to serve.
  // The Contacts cache joins the Messages folders: a contact's picture is served by the same route, from the data
  // folder's own contacts folder (issue 393), and from nowhere else.
  // A conversation's background (issue 417) is the picture Messages rendered for it in its transcript background cache,
  // beside the attachments folder too, and is served from there and from nowhere else.
  const backgroundRoot = attachmentsRoot ? path.join(path.dirname(attachmentsRoot), 'TranscriptBackgroundCache') : null;
  const roots = () => [attachmentsRoot, attachmentsRoot ? path.join(path.dirname(attachmentsRoot), 'StickerCache') : null, backgroundRoot, dataDir ? path.join(dataDir, 'contacts') : null].filter(Boolean);
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

  // The rendered background is a property list holding the picture beside what it was drawn for; the picture is read
  // out once into the data folder's cache and served as the type its bytes are. A file that holds no picture is nothing
  // to serve.
  async function isBackground(real) {
    const root = backgroundRoot ? await realpath(backgroundRoot).catch(() => null) : null;
    return Boolean(root) && real.startsWith(root + path.sep) && real.endsWith('-watchBackground');
  }
  async function backgroundPicture(real, id) {
    const dir = path.join(dataDir, 'cache');
    const out = path.join(dir, id + '.background');
    try { await access(out); } catch {
      const plist = readPlist(await readFile(real));
      const bytes = plist && Buffer.isBuffer(plist.backgroundImageData) ? plist.backgroundImageData : null;
      if (!bytes || !bytes.length) return null;
      await mkdir(dir, { recursive: true });
      await writeFile(out + '.part', bytes);
      await rename(out + '.part', out);
    }
    const mime = (await sniffed(out).catch(() => null)) || UNKNOWN_MIME;
    return /^image\//.test(mime) ? { file: out, mime, size: (await stat(out)).size } : null;
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

  // The poster as a PNG in the data folder's cache, made once and reused, written beside its final name and renamed into
  // place as the motion is. A still that cannot be made is no poster: the caller answers 404 and the client draws the
  // video's own first frame.
  const posters = new Map();
  async function toPoster(src, id) {
    const dir = path.join(dataDir, 'cache');
    const out = path.join(dir, id + '.poster.png');
    try { await access(out); return out; } catch { /* not made yet */ }
    if (!posters.has(out)) {
      posters.set(out, (async () => {
        await mkdir(dir, { recursive: true });
        const part = out + '.part';
        await makePoster(src, part);
        await rename(part, out);
        return out;
      })().finally(() => posters.delete(out)));
    }
    return posters.get(out);
  }

  return {
    async resolve(rec, format, part = null) {
      if (part === 'poster') {
        if (platform !== 'darwin' || !/^video\//i.test(rec.mime || '')) return null;
        const real = await inside(rec.path);
        if (!real) return null;
        const still = await toPoster(real, rec.id).catch(() => null);
        if (!still) return null;
        return { file: still, mime: 'image/png', size: (await stat(still)).size };
      }
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
      if (await isBackground(real)) return backgroundPicture(real, rec.id).catch(() => null);
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
