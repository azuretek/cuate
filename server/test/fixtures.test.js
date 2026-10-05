import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCRIPT, SYNTHETIC_HANDLE, buildFixtures } from '../src/engine/fixtures.js';
import { mapMessage } from '../../core/app/rules/engine-imsg.js';
import { mediaItems } from '../../core/app/rules/media.js';


// The viewer's step controls need somewhere to step to (issue 181): the first conversation must carry more than one
// media item, or the smoke that steps next and previous would be clicking a control the viewer never drew.
test('the first conversation carries more than one media item, so the viewer has a neighbour to step to', () => {
  const { messages } = buildFixtures({ base: 0, imagePath: '/x/sunset.png', imageBytes: 1, docPath: '/x/booking.pdf', docBytes: 1, photo2Path: '/x/hills.png', photo2Bytes: 1 });
  let n = 0;
  const attachmentId = () => 'att' + String(++n).padStart(18, '0');
  const first = messages.filter((m) => m.chat_id === 1).map((m) => mapMessage(m, { attachmentId }));
  const items = mediaItems(first);
  assert.ok(items.length >= 2, 'the first conversation carries ' + items.length + ' media item(s), and the viewer needs at least two to step between');
});

test('the fake engine holds synthetic data only', () => {
  const { chats, messages } = buildFixtures({ base: 0, imagePath: '/x', imageBytes: 1 });
  for (const c of chats) for (const h of c.participants) assert.match(h, SYNTHETIC_HANDLE);
  for (const m of messages) if (m.sender) assert.match(m.sender, SYNTHETIC_HANDLE);
  const texts = new Set(SCRIPT.map((line) => line[4]));
  for (const m of messages) assert.ok(texts.has(m.text), m.text);
});
