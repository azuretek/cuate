// Issue 440: whether a voice message has been played was lost between devices. The Mac's own store records it on the
// message's row (is_audio_message, and is_played with date_played once it is played on any of the person's devices),
// and imsg's rows carry neither. The server reads both from the store, read-only, marks each voice message's recording
// with voice and played on every read and live message, and keeps a play on one of our own clients so every other
// client is told and reads it played too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { boot, waitFor, openSocket } from './helpers.js';
import { apiSpec } from '../src/paths.js';
import { validate } from '../../core/kit/rules/schema.js';
import { createVoiceReader } from '../src/engine/voices.js';

const conforms = (v, type) => assert.deepEqual(validate(v, type, apiSpec.models), []);
const listen = async (s) => {
  const a = await openSocket(s.base);
  a.ws.send(JSON.stringify({ type: 'auth', token: s.tokens.device }));
  await waitFor(() => a.frames.some((f) => f.type === 'hello'));
  return a;
};
const voiceOf = (page, id) => page.messages.find((m) => m.id === id)?.attachments?.[0] || null;
const page = async (s) => (await s.get('/api/v1/chats/1/messages?limit=50', s.tokens.device)).json();

// The folder is removed once the reader has let the store go: Windows refuses to remove a database still open.
function store(t, columns) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'voices-'));
  const readers = [];
  t.after(() => { for (const r of readers) r.close(); rmSync(dir, { recursive: true, force: true }); });
  const file = path.join(dir, 'chat.db');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT UNIQUE' + (columns ? ', is_audio_message INTEGER DEFAULT 0, is_played INTEGER DEFAULT 0, date_played INTEGER DEFAULT 0' : '') + ')');
  return { file, db, keep: (reader) => { readers.push(reader); return reader; } };
}

test('the store reader names the voice messages among the rows asked about, and which were played (issue 440)', (t) => {
  const { file, db, keep } = store(t, true);
  const insert = db.prepare('INSERT INTO message (guid, is_audio_message, is_played, date_played) VALUES (?, ?, ?, ?)');
  insert.run('SYNTH-VOICE-NEW', 1, 0, 0);
  insert.run('SYNTH-VOICE-HEARD', 1, 1, 750000000000000000);
  insert.run('SYNTH-TEXT', 0, 0, 0);
  db.close();
  const reader = keep(createVoiceReader({ dbPath: file }));
  const found = reader.among(['SYNTH-VOICE-NEW', 'SYNTH-VOICE-HEARD', 'SYNTH-TEXT', 'SYNTH-ABSENT']);
  assert.deepEqual([...found.keys()].sort(), ['SYNTH-VOICE-HEARD', 'SYNTH-VOICE-NEW'], 'only the voice messages');
  assert.equal(found.get('SYNTH-VOICE-NEW').played, false);
  assert.equal(found.get('SYNTH-VOICE-HEARD').played, true);
  assert.match(found.get('SYNTH-VOICE-HEARD').playedAt, /^20\d\d-\d\d-\d\dT/, 'with when, from the store\'s own clock');
  assert.equal(reader.among([]).size, 0);
  // The store is opened read-only: the reader never writes to Messages.
  assert.throws(() => reader.connection().exec("UPDATE message SET is_played = 1"), /readonly|read-only/i);
});

test('a store from before voice messages had a mark names none (issue 440)', (t) => {
  const { file, db, keep } = store(t, false);
  db.prepare('INSERT INTO message (guid) VALUES (?)').run('SYNTH-OLD');
  db.close();
  const reader = keep(createVoiceReader({ dbPath: file }));
  assert.equal(reader.among(['SYNTH-OLD']).size, 0);
});

test('a voice message is read with its voice and played marks, and reads played once it is played on another device (issue 440)', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const id = s.world.voiceMessage(1, '+15555550100');
  let first = voiceOf(await page(s), id);
  conforms(first, 'Attachment');
  assert.equal(first.voice, true, 'its recording is marked a voice message');
  assert.equal(first.played, false, 'and not played');
  s.world.playElsewhere(id);
  first = voiceOf(await page(s), id);
  assert.equal(first.played, true, 'played on the phone, it reads played here');
  const others = (await page(s)).messages.filter((m) => m.id !== id).flatMap((m) => m.attachments);
  assert.ok(others.every((a) => a.voice === undefined && a.played === undefined), 'nothing else is marked');
  // The resumable sweep reads the same marks.
  const swept = (await s.engine.after({ sinceRowid: 0 })).messages.find((m) => m.id === id);
  assert.equal(swept.attachments[0].voice, true);
  assert.equal(swept.attachments[0].played, true);
});

test('a voice message arriving live carries its marks (issue 440)', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const a = await listen(s);
  t.after(() => a.ws.close());
  const id = s.world.voiceMessage(1, '+15555550100', { live: true });
  await waitFor(() => a.frames.some((f) => f.type === 'event' && f.name === 'message.new' && f.data.message.id === id));
  const ev = a.frames.find((f) => f.type === 'event' && f.name === 'message.new' && f.data.message.id === id);
  conforms(ev.data, 'MessageEvent');
  assert.equal(ev.data.message.attachments[0].voice, true);
  assert.equal(ev.data.message.attachments[0].played, false);
});

test('a store that cannot be read leaves a voice message unmarked and logs voice.failed by its code (issue 440)', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const id = s.world.voiceMessage(1, '+15555550100');
  s.world.breakVoices(Object.assign(new Error('unable to open /private/synthetic/chat.db'), { code: 'ERR_SQLITE_ERROR' }));
  const first = voiceOf(await page(s), id);
  assert.equal(first.voice, undefined, 'unmarked');
  const line = s.lines.find((l) => l.event === 'voice.failed');
  assert.ok(line, 'voice.failed is logged');
  assert.equal(line.error, 'ERR_SQLITE_ERROR');
  assert.ok(!JSON.stringify(line).includes('/private/synthetic'), 'by its code, never a path');
});

test('a play on one client is kept by the server and told to every client, so each reads it played (issue 440)', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const id = s.world.voiceMessage(1, '+15555550100');
  const before = voiceOf(await page(s), id);
  assert.equal(before.played, false);
  const a = await listen(s);
  t.after(() => a.ws.close());
  const r = await s.post('/api/v1/attachments/' + before.id + '/played', s.tokens.device, {});
  assert.equal(r.status, 200);
  const body = await r.json();
  conforms(body, 'AttachmentPlayed');
  assert.deepEqual(body, { attachmentId: before.id, played: true });
  await waitFor(() => a.frames.some((f) => f.type === 'event' && f.name === 'attachment.played'));
  const ev = a.frames.find((f) => f.type === 'event' && f.name === 'attachment.played');
  conforms(ev.data, 'AttachmentPlayed');
  assert.equal(ev.data.attachmentId, before.id);
  assert.equal(voiceOf(await page(s), id).played, true, 'every later read says played');
  assert.equal((await s.post('/api/v1/attachments/unknownattachment0/played', s.tokens.device, {})).status, 404, 'an attachment the server never handed out is refused');
  assert.equal((await s.post('/api/v1/attachments/bad!/played', s.tokens.device, {})).status, 400);
});
