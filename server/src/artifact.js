// The server's release artifact: a gzipped tarball, its manifest (version, commit, Node range and the SHA-256 of every
// file) and the SHA-256 of the tarball itself. The release workflow builds it (scripts/release/server-artifact.mjs) and
// the publisher verifies it before anything is attached to a release. These checks live in the server, not in the
// release scripts, so the installed server's updater can run exactly the checks the publisher ran, from the same code.
//
// The tarball is plain ustar written here rather than by a system tar: the bytes depend only on the files, their
// modes and one timestamp, so the same commit builds the same artifact on any runner, and reading it back never
// asks a platform tar what it would have done with a link or an absolute path. Only regular files are written, and
// only regular files and directories are accepted on the way back in.
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BLOCK = 512;
export const MANIFEST_GENERATOR = 'scripts/release/server-artifact.mjs';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** The three release assets for one version. */
export function artifactNames(slug, version) {
  const stem = slug + '-server-' + version;
  return { tarball: stem + '.tar.gz', digest: stem + '.tar.gz.sha256', manifest: stem + '.manifest.json' };
}

/**
 * A path an artifact may carry: relative, forward slashes, already normal, and inside the folder it unpacks into.
 * Returns the reason it may not, or null.
 */
export function pathProblem(p) {
  if (typeof p !== 'string' || !p) return 'an empty path';
  if (p.includes('\\') || p.includes('\0')) return 'a path with a backslash or a NUL: ' + JSON.stringify(p);
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return 'an absolute path: ' + p;
  if (path.posix.normalize(p) !== p || p.split('/').some((part) => part === '..' || part === '.' || part === '')) return 'a path that is not normal: ' + p;
  return null;
}

function field(buf, offset, length, value) {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length > length) throw new Error('a tar header field is too long: ' + value);
  bytes.copy(buf, offset);
}
const octal = (n, width) => n.toString(8).padStart(width - 1, '0') + '\0';

function header(name, size, mode, mtime) {
  const h = Buffer.alloc(BLOCK);
  let prefix = '';
  let base = name;
  if (Buffer.byteLength(name) > 100) {
    // ustar splits a long path at a slash: up to 155 bytes of prefix and 100 of name.
    const cut = name.lastIndexOf('/', 155);
    if (cut <= 0 || Buffer.byteLength(name.slice(cut + 1)) > 100 || Buffer.byteLength(name.slice(0, cut)) > 155) throw new Error('a path too long for the artifact: ' + name);
    prefix = name.slice(0, cut);
    base = name.slice(cut + 1);
  }
  field(h, 0, 100, base);
  field(h, 100, 8, octal(mode, 8));
  field(h, 108, 8, octal(0, 8));
  field(h, 116, 8, octal(0, 8));
  field(h, 124, 12, octal(size, 12));
  field(h, 136, 12, octal(mtime, 12));
  h.fill(0x20, 148, 156);
  field(h, 156, 1, '0');
  field(h, 257, 6, 'ustar\0');
  field(h, 263, 2, '00');
  field(h, 345, 155, prefix);
  let sum = 0;
  for (const byte of h) sum += byte;
  field(h, 148, 8, sum.toString(8).padStart(6, '0') + '\0 ');
  return h;
}

/**
 * The gzipped ustar bytes for these files. files: [{ path, data, executable }]. Sorted by path, owned by 0:0 and
 * dated mtime (seconds), so the output is a function of the input alone.
 */
export function writeTarball(files, mtime) {
  const parts = [];
  for (const file of [...files].sort(byPath)) {
    const problem = pathProblem(file.path);
    if (problem) throw new Error('refusing to pack ' + problem);
    parts.push(header(file.path, file.data.length, file.executable ? 0o755 : 0o644, mtime), file.data);
    const pad = (BLOCK - (file.data.length % BLOCK)) % BLOCK;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return gzipSync(Buffer.concat(parts), { level: 9 });
}

const str = (buf, from, length) => {
  const end = buf.indexOf(0, from);
  return buf.toString('utf8', from, end >= 0 && end < from + length ? end : from + length);
};

/**
 * The regular files in a gzipped tarball, as a Map of path to bytes. Anything that is not a regular file or a
 * directory (a link, a device, a pax or GNU extension) is refused rather than skipped, as is a bad checksum, an
 * unsafe path, a path that appears twice, and a tarball that ends before its end-of-archive marker.
 */
export function readTarball(gz) {
  const tar = gunzipSync(gz);
  const files = new Map();
  let at = 0;
  for (;;) {
    if (at + BLOCK > tar.length) throw new Error('the tarball ends without an end-of-archive marker');
    const h = tar.subarray(at, at + BLOCK);
    if (h.every((byte) => byte === 0)) return files;
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i];
    if (parseInt(str(h, 148, 8).trim(), 8) !== sum) throw new Error('a tar header has a bad checksum at byte ' + at);
    if (str(h, 257, 6) !== 'ustar') throw new Error('not a ustar tarball');
    const prefix = str(h, 345, 155);
    const name = (prefix ? prefix + '/' : '') + str(h, 0, 100);
    const type = String.fromCharCode(h[156] || 0x30);
    const size = parseInt(str(h, 124, 12).trim() || '0', 8);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('a tar entry has a bad size: ' + name);
    at += BLOCK;
    if (type === '5') continue;
    if (type !== '0') throw new Error('the tarball holds something other than a file: ' + name + ' (type ' + type + ')');
    const problem = pathProblem(name);
    if (problem) throw new Error('the tarball holds ' + problem);
    if (files.has(name)) throw new Error('the tarball holds ' + name + ' twice');
    if (at + size > tar.length) throw new Error('the tarball is cut short in ' + name);
    files.set(name, Buffer.from(tar.subarray(at, at + size)));
    at += size + ((BLOCK - (size % BLOCK)) % BLOCK);
  }
}

/** The manifest for a set of files: what a tarball must hold, file by file. */
export function manifestOf({ name, version, commit, node, files }) {
  const list = [...files].sort(byPath).map((file) => ({ path: file.path, size: file.data.length, sha256: sha256(file.data) }));
  return { generatedBy: MANIFEST_GENERATOR, name, version, commit, node, files: list };
}

/** The digest file's text, in the format sha256sum reads. */
export const digestText = (tarball, name) => sha256(tarball) + '  ' + name + '\n';

/**
 * Every check that stands between a downloaded server and running it. Throws on the first problem; returns the
 * files, so a caller that goes on to unpack writes exactly the bytes that were checked.
 *
 *   tarball   the .tar.gz bytes
 *   digest    the .sha256 file's text
 *   manifest  the parsed manifest
 *   names     artifactNames() for the expected version
 *   version   the version the caller expects
 *   commit    optional: the commit the caller expects
 */
export function verifyArtifact({ tarball, digest, manifest, names, version, commit }) {
  const m = /^([a-f0-9]{64}) [ *](\S+)\n?$/.exec(String(digest));
  if (!m) throw new Error('the digest file is not one SHA-256 line');
  if (m[2] !== names.tarball) throw new Error('the digest names ' + m[2] + ', not ' + names.tarball);
  if (m[1] !== sha256(tarball)) throw new Error('tarball digest mismatch: ' + names.tarball);
  if (!manifest || typeof manifest !== 'object') throw new Error('the manifest is not an object');
  if (manifest.version !== version) throw new Error('the manifest names version ' + manifest.version + ', not ' + version);
  if (!/^[a-f0-9]{40}$/.test(manifest.commit || '')) throw new Error('the manifest names no commit');
  if (commit && manifest.commit !== commit) throw new Error('the manifest names commit ' + manifest.commit + ', not ' + commit);
  if (/-dev\.\d+\.[a-f0-9]{10}$/.test(version) && !version.endsWith(manifest.commit.slice(0, 10))) throw new Error('the manifest commit is not the version\'s commit');
  if (typeof manifest.node !== 'string' || !manifest.node.trim()) throw new Error('the manifest names no Node range');
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error('the manifest lists no files');
  const files = readTarball(tarball);
  const listed = new Set();
  for (const entry of manifest.files) {
    const problem = pathProblem(entry && entry.path);
    if (problem) throw new Error('the manifest lists ' + problem);
    if (listed.has(entry.path)) throw new Error('the manifest lists ' + entry.path + ' twice');
    listed.add(entry.path);
    const data = files.get(entry.path);
    if (!data) throw new Error('missing from the tarball: ' + entry.path);
    if (data.length !== entry.size || sha256(data) !== entry.sha256) throw new Error('file digest mismatch: ' + entry.path);
  }
  for (const p of files.keys()) if (!listed.has(p)) throw new Error('not in the manifest: ' + p);
  const stamp = files.get('server/stamp.json');
  if (!stamp) throw new Error('the artifact carries no server/stamp.json');
  const parsed = JSON.parse(stamp.toString('utf8'));
  if (parsed.version !== manifest.version || parsed.commit !== manifest.commit) throw new Error('the server stamp and the manifest disagree');
  return files;
}

/** Write verified files under dir. The caller passes what verifyArtifact returned, never a fresh read. */
export function writeFiles(files, dir) {
  for (const [p, data] of files) {
    const target = path.join(dir, ...p.split('/'));
    if (path.relative(dir, target).startsWith('..')) throw new Error('refusing to write outside the folder: ' + p);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, data);
  }
}
