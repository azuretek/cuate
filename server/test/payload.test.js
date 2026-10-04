// The server types a message's own plugin payload from its bytes, so the client can show a link preview's picture
// without a third party fetch (issue 238).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annotatePayloads } from '../src/engine/payload.js';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const payload = (over = {}) => ({ transfer_name: 'X.pluginPayloadAttachment', filename: 'X.pluginPayloadAttachment', mime_type: '', total_bytes: 10, is_sticker: false, missing: false, original_path: '/tmp/X.pluginPayloadAttachment', ...over });

test('a payload with no type is typed from its own bytes, and the input is not mutated', () => {
  const m = { attachments: [payload()] };
  const out = annotatePayloads(m, () => JPEG);
  assert.equal(out.attachments[0].mime_type, 'image/jpeg');
  assert.equal(m.attachments[0].mime_type, '');
});

test('a payload whose file is gone is left alone, so it stays missing', () => {
  const m = { attachments: [payload()] };
  assert.equal(annotatePayloads(m, () => null), m);
});

test('an ordinary attachment and an already typed payload are never read', () => {
  let reads = 0;
  const m = { attachments: [payload({ mime_type: 'image/png' }), { transfer_name: 'sunset.png', mime_type: 'image/png', original_path: '/tmp/sunset.png' }] };
  const out = annotatePayloads(m, () => { reads += 1; return JPEG; });
  assert.equal(reads, 0);
  assert.equal(out, m);
});
