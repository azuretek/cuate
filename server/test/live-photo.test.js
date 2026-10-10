// A Live Photo is a picture with its motion beside it (server/src/engine/live-photo.js): the still is the attachment, the
// motion is the .mov next to it, and a client sees one picture marked live whose motion it can ask for.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { boot } from './helpers.js';
import { motionPath, annotateLivePhotos } from '../src/engine/live-photo.js';

const disk = (paths) => (p) => paths.includes(p);

test('the motion is the .mov beside the still, under the same name', () => {
  assert.equal(motionPath('/a/b/IMG_1.HEIC', disk(['/a/b/IMG_1.MOV'])), '/a/b/IMG_1.MOV');
  assert.equal(motionPath('/a/b/IMG_1.heic', disk(['/a/b/IMG_1.mov'])), '/a/b/IMG_1.mov');
  assert.equal(motionPath('/a/b/IMG_1.heic', disk(['/a/c/IMG_1.mov', '/a/b/IMG_2.mov'])), null, 'another folder or another name is not its motion');
  assert.equal(motionPath('', disk([])), null);
  // A recorded path keeps its own separators whatever the server runs on, so a Windows server finds a Windows motion
  // and a Mac path alike.
  assert.equal(motionPath('C:\\att\\IMG_1.HEIC', disk(['C:\\att\\IMG_1.MOV'])), 'C:\\att\\IMG_1.MOV');
});

test('a picture with its motion on the disk is marked live, and only a picture', () => {
  const still = { filename: 'IMG_1.HEIC', mime_type: 'image/heic', original_path: '/a/IMG_1.HEIC' };
  const doc = { filename: 'IMG_1.pdf', mime_type: 'application/pdf', original_path: '/a/IMG_1.pdf' };
  const out = annotateLivePhotos({ attachments: [still, doc] }, disk(['/a/IMG_1.MOV']));
  assert.equal(out.attachments[0].live_photo, true);
  assert.equal(out.attachments[1].live_photo, undefined);
  const plain = { attachments: [still] };
  assert.equal(annotateLivePhotos(plain, disk([])), plain, 'a picture with no motion is left exactly as it was');
});

test('a motion an engine reports as its own attachment is folded into the still, never shown twice', () => {
  const still = { filename: 'IMG_1.HEIC', mime_type: 'image/heic', original_path: '/a/IMG_1.HEIC' };
  const motion = { filename: 'IMG_1.MOV', mime_type: 'video/quicktime', original_path: '/a/IMG_1.MOV' };
  const other = { filename: 'clip.mov', mime_type: 'video/quicktime', original_path: '/a/clip.mov' };
  const out = annotateLivePhotos({ attachments: [still, motion, other] }, disk(['/a/IMG_1.MOV', '/a/clip.mov']));
  assert.deepEqual(out.attachments.map((a) => a.filename), ['IMG_1.HEIC', 'clip.mov']);
});

let s;
before(async () => { s = await boot(); });
after(async () => { await s.close(); });

test('a Live Photo reaches the client as one picture marked live, and its motion is served beside it', async () => {
  writeFileSync(path.join(s.root, 'fake', 'hills.mov'), Buffer.from('synthetic motion'));
  const chats = await (await s.get('/api/v1/chats', s.tokens.device)).json();
  let found = null;
  for (const c of chats.chats) {
    const page = await (await s.get('/api/v1/chats/' + encodeURIComponent(c.id) + '/messages?limit=50', s.tokens.device)).json();
    found = page.messages.flatMap((m) => m.attachments).find((a) => a.name === 'hills.png') || found;
  }
  assert.ok(found, 'the fixture picture is in a conversation');
  assert.equal(found.live, true);
  const still = await (await s.get('/api/v1/chats/' + encodeURIComponent(chats.chats[0].id) + '/messages?limit=50', s.tokens.device)).json();
  const sunset = still.messages.flatMap((m) => m.attachments).find((a) => a.name === 'sunset.png');
  if (sunset) assert.equal(sunset.live, undefined, 'a picture with no motion beside it is not live');
  const r = await s.get('/api/v1/attachments/' + found.id + '?part=live', s.tokens.device);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'video/quicktime');
  assert.equal(Buffer.from(await r.arrayBuffer()).toString(), 'synthetic motion');
  assert.equal((await s.get('/api/v1/attachments/' + found.id, s.tokens.device)).headers.get('content-type'), 'image/png', 'the still is still the attachment');
  if (sunset) assert.equal((await s.get('/api/v1/attachments/' + sunset.id + '?part=live', s.tokens.device)).status, 404, 'a picture with no motion has no live part');
  assert.equal((await s.get('/api/v1/attachments/' + found.id + '?part=other', s.tokens.device)).status, 400, 'live is the only part');
});
