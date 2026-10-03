// Issue 197: what a send hands Messages for a file. Messages decides how a file arrives (a photo, a video, a named
// document) from the file it is given, by its extension, so the shape is held here end to end over the fake engine:
// the upload a device makes, the attachment the server answers with, and the path the engine is asked to send. Every
// byte below is written in this file; none is a real photo or document.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdirSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { boot } from './helpers.js';

const route = (s) => '/api/v1/chats/' + s + '/messages';
let s;
before(async () => { s = await boot({ perMinute: 100 }); });
after(async () => { await s.close(); });

// Just enough of each format for its signature: what the server reads, never what a viewer would draw.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('synthetic png body')]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('synthetic jpeg body')]);
const box = (brand) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftyp' + brand + '\0\0\0\0' + brand + 'mp41'), Buffer.from('synthetic movie body')]);
const MP4 = box('isom');
const MOV = box('qt  ');
const PDF = Buffer.from('%PDF-1.7\n% synthetic document, not a real one\n%%EOF\n');
const UNKNOWN = Buffer.from('synthetic bytes in no format the server knows');

let n = 0;
const key = () => 'key-197-' + String(++n).padStart(6, '0');

async function upload(body) {
  const r = await s.post('/api/v1/attachments', s.tokens.device, body);
  return { status: r.status, body: await r.json() };
}

// Upload, send by id, and return what the device was told and what Messages was handed.
async function sendShape({ name, mime, bytes }) {
  const up = await upload({ name, ...(mime === undefined ? {} : { mime }), data: bytes.toString('base64') });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  const count = s.world.sends.length;
  const r = await s.post(route(1), s.tokens.device, { file: up.body.id, clientKey: key() });
  assert.equal(r.status, 201);
  assert.equal(s.world.sends.length, count + 1);
  const sent = s.world.sends.at(-1).file;
  return { att: up.body, sentName: path.basename(sent), held: s.store.getAttachment(up.body.id) };
}

test('an image goes to Messages with its real extension and type, whatever name the device gave it', async () => {
  // A pasted picture often arrives with no extension at all, which Messages shows as a blank document.
  const bare = await sendShape({ name: 'image', mime: 'image/png', bytes: PNG });
  assert.equal(bare.att.name, 'image.png');
  assert.equal(bare.att.mime, 'image/png');
  assert.equal(bare.sentName, 'image.png');
  assert.equal(bare.held.mime, 'image/png');
  // A name and a type that disagree with the bytes are corrected from the bytes.
  const wrong = await sendShape({ name: 'synthetic photo.heic', mime: 'image/heic', bytes: JPEG });
  assert.equal(wrong.sentName, 'synthetic photo.jpg');
  assert.equal(wrong.att.mime, 'image/jpeg');
  // A right name is left exactly as it is.
  const right = await sendShape({ name: 'Synthetic Sunset.PNG', mime: 'image/png', bytes: PNG });
  assert.equal(right.sentName, 'Synthetic Sunset.PNG');
});

test('a video goes to Messages as a video, named for its container', async () => {
  const mp4 = await sendShape({ name: 'clip', bytes: MP4 });
  assert.equal(mp4.sentName, 'clip.mp4');
  assert.equal(mp4.att.mime, 'video/mp4');
  const mov = await sendShape({ name: 'synthetic clip.bin', mime: 'application/octet-stream', bytes: MOV });
  assert.equal(mov.sentName, 'synthetic clip.mov');
  assert.equal(mov.att.mime, 'video/quicktime');
});

test('a PDF goes to Messages as a named document with its extension', async () => {
  const pdf = await sendShape({ name: 'Synthetic scan', mime: 'application/octet-stream', bytes: PDF });
  assert.equal(pdf.sentName, 'Synthetic scan.pdf');
  assert.equal(pdf.att.mime, 'application/pdf');
  const named = await sendShape({ name: 'synthetic.pdf', bytes: PDF });
  assert.equal(named.sentName, 'synthetic.pdf');
  assert.equal(named.att.mime, 'application/pdf');
});

test('a file of an unknown type keeps its own name and goes as a document', async () => {
  const odd = await sendShape({ name: 'synthetic notes.cuatex', bytes: UNKNOWN });
  assert.equal(odd.sentName, 'synthetic notes.cuatex');
  assert.equal(odd.att.mime, 'application/octet-stream');
  // A known extension with bytes the server cannot place keeps the device's word for it.
  const text = await sendShape({ name: 'synthetic.txt', bytes: UNKNOWN });
  assert.equal(text.sentName, 'synthetic.txt');
  assert.equal(text.att.mime, 'text/plain');
});

test('an empty file is refused with a reason, at upload and again at send, and never reaches Messages', async () => {
  const empty = await upload({ name: 'synthetic.png', mime: 'image/png', data: '' });
  assert.equal(empty.status, 400);
  // A held file that became empty after it was uploaded is refused when it would be sent.
  const up = await upload({ name: 'synthetic.png', mime: 'image/png', data: PNG.toString('base64') });
  truncateSync(s.store.getAttachment(up.body.id).path, 0);
  const count = s.world.sends.length;
  const k = key();
  const r = await s.post(route(1), s.tokens.device, { file: up.body.id, clientKey: k });
  assert.equal(r.status, 422);
  const body = await r.json();
  assert.equal(body.error.code, 'attachment_empty');
  assert.match(body.error.message, /empty/);
  assert.equal(s.world.sends.length, count, 'the empty file never reached the engine');
  assert.equal(s.store.getSend(k), null, 'a refused send is not recorded, so it is never replayed');
});

test('a file the server can no longer read is refused with a reason, not sent as a blank', async () => {
  const up = await upload({ name: 'synthetic.pdf', data: PDF.toString('base64') });
  rmSync(s.store.getAttachment(up.body.id).path);
  const count = s.world.sends.length;
  const r = await s.post(route(1), s.tokens.device, { file: up.body.id, clientKey: key() });
  assert.equal(r.status, 422);
  assert.equal((await r.json()).error.code, 'attachment_unreadable');
  assert.equal(s.world.sends.length, count);
});

test("a message's internal payload is never sent as an attachment", async () => {
  // Messages keeps a link preview or an app's message as a payload file beside the real attachments.
  const dir = path.join(s.root, 'synthetic-payload');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'E0A1B2C3-0000-4000-8000-000000000197.pluginPayloadAttachment');
  writeFileSync(file, 'synthetic payload');
  s.store.putAttachment('payload000000197', file, 'application/octet-stream', path.basename(file));
  const count = s.world.sends.length;
  const r = await s.post(route(1), s.tokens.device, { file: 'payload000000197', clientKey: key() });
  assert.equal(r.status, 422);
  assert.equal((await r.json()).error.code, 'attachment_internal');
  assert.equal(s.world.sends.length, count);
});
