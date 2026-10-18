// Issue 435: a voice message is a Core Audio file (.caf, Opus inside on current iPhones, AMR or AAC on older ones) that
// no Chromium web view plays. The server recognises one by its bytes, and asked for format=m4a a server on the Mac
// converts it once with its own afconvert to AAC in an MPEG-4 file, caches the copy in the data folder and serves it as
// audio/mp4. Audio every web view plays, a server off the Mac and a copy that cannot be made serve the original.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { createAttachments } from '../src/attachments.js';
import { sniff, sendShape } from '../src/file-type.js';

// The first bytes of each kind of recording, as the files themselves begin: a Core Audio file's 'caff' and its version,
// and an AMR recording's '#!AMR' line.
const CAF = Buffer.concat([Buffer.from('caff'), Buffer.from([0, 1, 0, 0]), Buffer.from('desc'), Buffer.alloc(52)]);
const AMR = Buffer.concat([Buffer.from('#!AMR\n'), Buffer.alloc(32)]);

function folder(t) {
  const base = mkdtempSync(path.join(os.tmpdir(), 'voice-message-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'Attachments');
  mkdirSync(path.join(root, 'ab'), { recursive: true });
  writeFileSync(path.join(root, 'ab', 'Audio Message.caf'), CAF);
  writeFileSync(path.join(root, 'ab', 'untyped'), CAF);
  writeFileSync(path.join(root, 'ab', 'old.amr'), AMR);
  writeFileSync(path.join(root, 'ab', 'song.m4a'), 'synthetic mpeg-4 audio');
  return { base, root, dataDir: path.join(base, 'data') };
}

test('the server knows a Core Audio file and an AMR recording by their bytes (issue 435)', () => {
  assert.equal(sniff(new Uint8Array(CAF)), 'audio/x-caf', 'caff is a Core Audio file');
  assert.equal(sniff(new Uint8Array(AMR)), 'audio/amr', '#!AMR is an AMR recording');
  assert.equal(sendShape({ name: 'Audio Message', mime: '', bytes: new Uint8Array(CAF) }).name, 'Audio Message.caf', 'a nameless one gets its extension');
  assert.equal(sendShape({ name: 'memo', mime: '', bytes: new Uint8Array(AMR) }).name, 'memo.amr');
});

test('on a Mac a voice message asked for as m4a is converted once to AAC in an MPEG-4 file and served as that (issue 435)', async (t) => {
  const { root, dataDir } = folder(t);
  const rec = { id: 'att-voice', path: path.join(root, 'ab', 'Audio Message.caf'), mime: 'audio/x-caf' };
  let made = 0;
  const convertAudio = async (src, out) => { made += 1; assert.ok(/Audio Message\.caf$|untyped$|old\.amr$/.test(src)); writeFileSync(out, 'aac copy of ' + readFileSync(src).subarray(0, 4).toString()); };
  const mac = createAttachments({ attachmentsRoot: root, dataDir, platform: 'darwin', convertAudio });
  const [a, b] = await Promise.all([mac.resolve(rec, 'm4a'), mac.resolve(rec, 'm4a')]);
  assert.equal(a.mime, 'audio/mp4', 'the copy is served as MPEG-4 audio');
  assert.equal(readFileSync(a.file, 'utf8'), 'aac copy of caff');
  assert.equal(b.file, a.file);
  assert.equal((await mac.resolve(rec, 'm4a')).file, a.file, 'and kept for the next ask');
  assert.equal(made, 1, 'converted once, however many ask at the same moment');
  assert.ok(a.file.startsWith(path.join(dataDir, 'cache')), 'cached in the data folder');
  assert.deepEqual(readdirSync(path.dirname(a.file)).filter((f) => f.includes('.part')), [], 'no half-written copy is left behind');
  // Asked for as it is, the original is served.
  const original = await mac.resolve(rec, null);
  assert.equal(original.mime, 'audio/x-caf');
  assert.equal(readFileSync(original.file).subarray(0, 4).toString(), 'caff');
  // One Messages recorded with no type is read for one, and converted the same way; so is an AMR recording.
  const untyped = await mac.resolve({ id: 'att-untyped', path: path.join(root, 'ab', 'untyped'), mime: 'application/octet-stream' }, 'm4a');
  assert.equal(untyped.mime, 'audio/mp4');
  const amr = await mac.resolve({ id: 'att-amr', path: path.join(root, 'ab', 'old.amr'), mime: 'audio/amr' }, 'm4a');
  assert.equal(amr.mime, 'audio/mp4');
  assert.equal(made, 3);
});

test('audio every web view plays, a server off the Mac and a copy that cannot be made serve the original (issue 435)', async (t) => {
  const { root, dataDir } = folder(t);
  const voice = { id: 'att-voice', path: path.join(root, 'ab', 'Audio Message.caf'), mime: 'audio/x-caf' };
  const song = { id: 'att-song', path: path.join(root, 'ab', 'song.m4a'), mime: 'audio/x-m4a' };
  let made = 0;
  const convertAudio = async (src, out) => { made += 1; writeFileSync(out, 'copy'); };
  const mac = createAttachments({ attachmentsRoot: root, dataDir, platform: 'darwin', convertAudio });
  const played = await mac.resolve(song, 'm4a');
  assert.equal(played.mime, 'audio/x-m4a', 'audio every web view plays is served as it is');
  assert.equal(made, 0, 'and never converted');
  const linux = createAttachments({ attachmentsRoot: root, dataDir: path.join(dataDir, 'linux'), platform: 'linux', convertAudio });
  assert.equal((await linux.resolve(voice, 'm4a')).mime, 'audio/x-caf', 'only a Mac converts');
  assert.equal(made, 0);
  const broken = createAttachments({ attachmentsRoot: root, dataDir: path.join(dataDir, 'broken'), platform: 'darwin', convertAudio: async () => { throw new Error('no copy'); } });
  const fallback = await broken.resolve(voice, 'm4a');
  assert.equal(fallback.mime, 'audio/x-caf', 'a copy that cannot be made serves the original');
  assert.equal(readFileSync(fallback.file).subarray(0, 4).toString(), 'caff');
});

// A synthetic recording: a mono tone with a rising and falling level, as 16-bit PCM in a WAV file.
function toneWav(seconds = 1, rate = 48000) {
  const n = seconds * rate;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i += 1) b.writeInt16LE(Math.round(12000 * Math.sin((2 * Math.PI * 330 * i) / rate) * Math.sin((Math.PI * i) / n)), 44 + i * 2);
  return b;
}

test('on a Mac the system afconvert turns a synthetic Opus voice message into MPEG-4 audio (issue 435)', { skip: process.platform !== 'darwin' && 'afconvert is macOS only' }, async (t) => {
  const { root, dataDir } = folder(t);
  const wav = path.join(root, 'ab', 'tone.wav');
  writeFileSync(wav, toneWav());
  const caf = path.join(root, 'ab', 'Synthetic Voice.caf');
  // A voice message as current iPhones record it: Opus inside a Core Audio file.
  execFileSync('afconvert', ['-f', 'caff', '-d', 'opus@48000', wav, caf], { timeout: 60000 });
  assert.equal(sniff(new Uint8Array(readFileSync(caf).subarray(0, 64))), 'audio/x-caf', 'the synthetic voice message is a Core Audio file');
  const mac = createAttachments({ attachmentsRoot: root, dataDir, platform: 'darwin' });
  const copy = await mac.resolve({ id: 'att-real', path: caf, mime: 'audio/x-caf' }, 'm4a');
  assert.equal(copy.mime, 'audio/mp4');
  assert.equal(sniff(new Uint8Array(readFileSync(copy.file).subarray(0, 64))), 'audio/mp4', 'the copy is MPEG-4 audio by its own bytes');
  assert.ok(copy.size > 1000, 'and holds the recording: ' + copy.size + ' bytes');
  assert.ok(!existsSync(copy.file + '.part.m4a'));
});
