// The history proof's video items are a committed phone-format clip, never one recorded in the page at run time
// (issue 406). On the macOS arm64 runner the page painted 3 frames in 350 ms and MediaRecorder wrote a 110 byte WebM
// with no frames in it, so every video item failed to open with DEMUXER_ERROR_COULD_NOT_OPEN and main went red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => readFileSync(path.join(root, file));
const proof = read('desktop/scripts/prove-history-window.mjs').toString();
const page = read('core/test/fixtures/history-proof.js').toString();

// The top-level boxes of an MP4, and the sample count its first sample-size table declares.
function mp4(bytes) {
  const boxes = {};
  for (let at = 0; at + 8 <= bytes.length;) {
    const size = bytes.readUInt32BE(at);
    const type = bytes.toString('latin1', at + 4, at + 8);
    if (size < 8) break;
    boxes[type] = (boxes[type] || 0) + size;
    at += size;
  }
  const stsz = bytes.indexOf('stsz', 0, 'latin1');
  return { boxes, codec: bytes.includes('avc1', 0, 'latin1') ? 'avc1' : null, samples: stsz < 0 ? 0 : bytes.readUInt32BE(stsz + 12) };
}

test('the history proof serves the committed phone-format clip for every video item, and records nothing in the page (issue 406)', () => {
  assert.match(proof, /core\/test\/live-photo-fixture\.mp4/, 'video items are copies of the committed clip');
  assert.match(proof, /mime_type: moving \? 'video\/mp4'/, 'served as the MP4 it is');
  assert.doesNotMatch(proof, /historyProof\.video\(\)/, 'no clip is recorded in the page at run time');
  assert.doesNotMatch(page, /MediaRecorder|captureStream/, 'the page script records nothing');
});

test('the committed clip has frames a player can open: an H.264 MP4 with samples (issue 406)', () => {
  const clip = mp4(read('core/test/live-photo-fixture.mp4'));
  for (const box of ['ftyp', 'moov', 'mdat']) assert.ok(clip.boxes[box] > 8, 'top-level ' + box + ' box: ' + JSON.stringify(clip.boxes));
  assert.equal(clip.codec, 'avc1', 'H.264, the codec a phone sends');
  assert.ok(clip.samples > 0, 'at least one frame: ' + clip.samples);
});
