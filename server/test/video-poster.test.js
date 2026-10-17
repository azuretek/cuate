// Issue 415: a video's poster, the still a client draws in its tile so a video in a conversation is never an empty box.
// The server makes it once on the Mac from the video, caches it in the data folder as a Live Photo's motion is, and
// serves it as the attachment's poster part. Anything that has no poster answers 404, so a client falls back to drawing
// the video's own first frame rather than a broken image.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { boot } from './helpers.js';
import { createAttachments } from '../src/attachments.js';

function folder(t) {
  const base = mkdtempSync(path.join(os.tmpdir(), 'video-poster-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'Attachments');
  mkdirSync(path.join(root, 'cd'), { recursive: true });
  writeFileSync(path.join(root, 'cd', 'clip.mp4'), 'synthetic video');
  writeFileSync(path.join(root, 'cd', 'photo.png'), 'synthetic picture');
  return { base, root, dataDir: path.join(base, 'data') };
}

test('on a Mac a video has a poster, made once from the video and reused (issue 415)', async (t) => {
  const { root, dataDir } = folder(t);
  const rec = { id: 'att-clip', path: path.join(root, 'cd', 'clip.mp4'), mime: 'video/mp4' };
  let made = 0;
  const makePoster = async (src, out) => { made += 1; assert.ok(src.endsWith('clip.mp4')); writeFileSync(out, 'still of ' + readFileSync(src, 'utf8')); };
  const mac = createAttachments({ attachmentsRoot: root, dataDir, platform: 'darwin', makePoster });
  const [a, b] = await Promise.all([mac.resolve(rec, null, 'poster'), mac.resolve(rec, null, 'poster')]);
  assert.ok(a, 'a video has a poster part');
  assert.match(a.mime, /^image\//, 'the poster is a picture');
  assert.equal(readFileSync(a.file, 'utf8'), 'still of synthetic video');
  assert.equal(b.file, a.file);
  assert.equal((await mac.resolve(rec, null, 'poster')).file, a.file);
  assert.equal(made, 1, 'made once, however many ask at the same moment');
  assert.ok(!existsSync(a.file + '.part'), 'no half-written file is left behind');
  // Served by its real path, which on a hosted runner is not the temporary folder's own spelling of it: macOS names it
  // through a link and Windows through a short name, and only the native real path resolves both, as the server does.
  assert.equal((await mac.resolve(rec, null, null)).file, realpathSync.native(rec.path), 'the video itself is still the attachment');
});

test('a picture, a server off the Mac and a still that cannot be made have no poster (issue 415)', async (t) => {
  const { root, dataDir } = folder(t);
  const clip = { id: 'att-clip', path: path.join(root, 'cd', 'clip.mp4'), mime: 'video/mp4' };
  const photo = { id: 'att-photo', path: path.join(root, 'cd', 'photo.png'), mime: 'image/png' };
  const makePoster = async (src, out) => writeFileSync(out, 'still');
  const mac = createAttachments({ attachmentsRoot: root, dataDir, platform: 'darwin', makePoster });
  assert.equal(await mac.resolve(photo, null, 'poster'), null, 'a picture is its own still');
  const linux = createAttachments({ attachmentsRoot: root, dataDir: path.join(dataDir, 'linux'), platform: 'linux', makePoster });
  assert.equal(await linux.resolve(clip, null, 'poster'), null, 'only a Mac makes a poster');
  const broken = createAttachments({ attachmentsRoot: root, dataDir: path.join(dataDir, 'broken'), platform: 'darwin', makePoster: async () => { throw new Error('no still'); } });
  assert.equal(await broken.resolve(clip, null, 'poster'), null, 'a failed still is no poster, never a broken image');
});

let s;
before(async () => { s = await boot(); });
after(async () => { await s.close(); });

test('the attachment route serves a poster part, and a picture has none (issue 415)', async () => {
  const chats = await (await s.get('/api/v1/chats', s.tokens.device)).json();
  let picture = null;
  for (const c of chats.chats) {
    const page = await (await s.get('/api/v1/chats/' + encodeURIComponent(c.id) + '/messages?limit=50', s.tokens.device)).json();
    picture = page.messages.flatMap((m) => m.attachments).find((a) => /^image\//.test(a.mime) && !a.missing) || picture;
  }
  assert.ok(picture, 'the fixture has a picture');
  assert.equal((await s.get('/api/v1/attachments/' + picture.id + '?part=poster', s.tokens.device)).status, 404, 'poster is a part the route knows, and a picture has none');
  assert.equal((await s.get('/api/v1/attachments/' + picture.id + '?part=other', s.tokens.device)).status, 400, 'an unknown part is still refused');
});
