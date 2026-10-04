import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCRIPT, SYNTHETIC_HANDLE, buildFixtures } from '../src/engine/fixtures.js';

test('the fake engine holds synthetic data only', () => {
  const { chats, messages } = buildFixtures({ base: 0, imagePath: '/x', imageBytes: 1, docPath: '/d', docBytes: 1, videoPath: '/v', videoBytes: 1 });
  for (const c of chats) for (const h of c.participants) assert.match(h, SYNTHETIC_HANDLE);
  for (const m of messages) if (m.sender) assert.match(m.sender, SYNTHETIC_HANDLE);
  const texts = new Set(SCRIPT.map((line) => line[4]));
  for (const m of messages) assert.ok(texts.has(m.text), m.text);
});
