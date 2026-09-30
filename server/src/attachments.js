// Attachments: an opaque id maps back to a file inside the Messages attachments folder and nowhere else. A HEIC or
// HEIF photo is converted to JPEG with the Mac's own sips when a client asks, and the conversion is cached in the
// data folder so it happens once.
import os from 'node:os';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { mkdir, access, realpath, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';

export function createAttachments({ attachmentsRoot, dataDir, platform = process.platform }) {
  // The recorded path is real, and inside the attachments folder, or there is nothing to serve.
  async function inside(recorded) {
    const root = await realpath(attachmentsRoot).catch(() => null);
    const expanded = recorded.startsWith('~/') ? path.join(os.homedir(), recorded.slice(2)) : recorded;
    const real = await realpath(expanded).catch(() => null);
    if (!root || !real || !(real === root || real.startsWith(root + path.sep))) return null;
    return real;
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

  return {
    async resolve(rec, format) {
      const real = await inside(rec.path);
      if (!real) return null;
      let file = real;
      let mime = rec.mime;
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
