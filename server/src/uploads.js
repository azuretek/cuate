// Uploads: a file a client sends from its own device, which the server does not already hold. The bytes arrive as
// base64 in the one JSON shape every surface shares (HTTP, MCP and the OpenAPI document), are written under the
// data folder, and get an attachment id like any other, so a send names an upload exactly as it names a file already
// in Messages. Messages copies what it sends into its own store, so an upload is kept only long enough to be sent
// (apiSpec.uploads.keepHours) and swept when the next one arrives. The name and type it is held under are the ones its
// bytes call for (file-type.js), since Messages decides from the name how the file arrives.
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { sendShape } from './file-type.js';

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

// The name the recipient sees, reduced to one path segment with nothing a filesystem could read as a route.
export function safeName(name) {
  const kept = [...String(name || '').split(/[\\/]/).pop()].filter((ch) => ch.charCodeAt(0) > 31 && ch.charCodeAt(0) !== 127 && !':*?"<>|'.includes(ch)).join('');
  const base = kept.trim().replace(/^\.+/, '');
  return (base || 'file').slice(0, 200);
}

export function createUploads({ dataDir, store, limits, now = Date.now }) {
  const root = path.join(dataDir, 'uploads');

  async function sweep() {
    const cutoff = now() - limits.keepHours * 3600000;
    const entries = await readdir(root).catch(() => []);
    for (const entry of entries) {
      const dir = path.join(root, entry);
      const st = await stat(dir).catch(() => null);
      if (st && st.mtimeMs < cutoff) await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  return {
    root,
    // Returns the Attachment model, or { error: [status, code, message] } for a body the server refuses.
    async put({ name, mime, data }) {
      if (typeof data !== 'string' || !data.length || data.length % 4 !== 0 || !BASE64.test(data)) return { error: [400, 'bad_data', 'data must be the file as base64.'] };
      const bytes = Buffer.from(data, 'base64');
      if (!bytes.length) return { error: [400, 'bad_data', 'The file is empty.'] };
      if (bytes.length > limits.maxBytes) return { error: [413, 'too_large', 'The file is larger than the server takes.'] };
      await sweep();
      const id = randomBytes(16).toString('base64url');
      const dir = path.join(root, id);
      await mkdir(dir, { recursive: true });
      // Messages types a file by its extension, so the file is written under the name its bytes call for, and that
      // is the name the recipient sees (issue 197).
      const shape = sendShape({ name: safeName(name), mime, bytes });
      const file = path.join(dir, shape.name);
      await writeFile(file, bytes, { mode: 0o600 });
      store.putAttachment(id, file, shape.mime, shape.name);
      return { id, name: shape.name, mime: shape.mime, bytes: bytes.length, sticker: false, missing: false };
    },
  };
}
