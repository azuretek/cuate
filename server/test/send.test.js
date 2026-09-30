// Phase 2c: the send path on its own, over the fake engine, so every outcome of a send has one case here and no Mac
// is needed. The HTTP side of the same path is covered in api.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLogger } from '../../core/kit/log.js';
import { logSpec } from '../src/paths.js';
import { normalizeConfig } from '../src/config.js';
import { openStore } from '../src/store.js';
import { createEngine } from '../src/engine/index.js';
import { createFakeImsg } from '../src/engine/fake.js';
import { childTransport } from '../src/engine/child.js';
import { createSender } from '../src/send.js';
import { makeAttachmentId } from '../src/ids.js';

const quiet = () => createLogger({ spec: logSpec, app: 'test', run: 'test', sink: () => {}, now: Date.now, level: 'debug', strict: true });

// A sender over the fake engine, with no HTTP in the way. now can be injected so the rate window is testable.
function sender({ sending = true, perMinute = 20, sendTimeoutMs = 500, now } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'srv-send-'));
  const log = quiet();
  const config = normalizeConfig({ engine: { kind: 'fake' }, sending: { enabled: sending, perMinute } });
  const store = openStore(path.join(dir, 'state.db'));
  const root = path.join(dir, 'attachments');
  const world = createFakeImsg({ attachmentsRoot: root });
  const engine = createEngine({ kind: 'fake', makeTransport: () => world.transport(), log: log.child('engine'), attachmentId: makeAttachmentId({ secret: 'test-secret', store }), sendTimeoutMs });
  const send = createSender({ engine, store, config, log: log.child('send'), ...(now ? { now } : {}) });
  return {
    send, world, store, engine,
    start: () => engine.start(),
    async close() { await engine.stop(); store.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

test('a send is refused while the switch is off, and never reaches the engine or the store', async (t) => {
  const s = sender({ sending: false });
  t.after(() => s.close());
  await s.start();
  const r = await s.send('1', { text: 'Synthetic off' }, 'key-off-000001');
  assert.equal(r.http, 403);
  assert.equal(r.error[0], 'sending_off');
  assert.equal(s.world.sends.length, 0);
  assert.equal(s.store.getSend('key-off-000001'), null, 'a refused send is not recorded, so it is never replayed');
});

test('a burst past the rate limit is refused, and the window frees again', async (t) => {
  let clock = 1000;
  const s = sender({ perMinute: 2, now: () => clock });
  t.after(() => s.close());
  await s.start();
  assert.equal((await s.send('1', { text: 'Synthetic rate one' }, 'key-rate-00001')).http, 201);
  assert.equal((await s.send('1', { text: 'Synthetic rate two' }, 'key-rate-00002')).http, 201);
  const refused = await s.send('1', { text: 'Synthetic rate three' }, 'key-rate-00003');
  assert.equal(refused.http, 429);
  assert.equal(refused.error[0], 'rate_limited');
  clock += 61000;
  assert.equal((await s.send('1', { text: 'Synthetic rate four' }, 'key-rate-00004')).http, 201);
  assert.equal(s.world.sends.length, 3, 'the refused send stayed out of the engine');
});

test('a repeated client key is answered once, and a copy still in flight is answered, not sent again', async (t) => {
  const s = sender({ sendTimeoutMs: 5000 });
  t.after(() => s.close());
  await s.start();
  const first = await s.send('1', { text: 'Synthetic once' }, 'key-once-00001');
  assert.equal(first.http, 201);
  assert.ok(first.body.messageId);
  const again = await s.send('1', { text: 'Synthetic once' }, 'key-once-00001');
  assert.equal(again.http, 200);
  assert.equal(again.body.duplicate, true);
  assert.equal(again.body.messageId, first.body.messageId);
  assert.equal(s.world.sends.length, 1, 'the repeat was answered, not sent again');
  // while the first copy is still with the engine, a second copy is answered as a duplicate, never sent twice
  s.world.behavior.send = 'hang';
  const held = s.send('1', { text: 'Synthetic concurrent' }, 'key-race-00001');
  const copy = await s.send('1', { text: 'Synthetic concurrent' }, 'key-race-00001');
  assert.equal(copy.http, 200);
  assert.equal(copy.body.duplicate, true);
  assert.equal(s.world.sends.length, 1, 'the copy never reached the engine');
  s.world.crashAll();
  const ended = await held;
  assert.equal(ended.http, 202, 'the held send ends uncertain when the engine goes');
  assert.equal(s.store.getSend('key-race-00001').status, 'uncertain');
  assert.equal(s.world.attempts, 2, 'one attempt each for the sent and the held send');
});

test('a definite failure is reported and recorded, and a repeat is never sent', async (t) => {
  const s = sender();
  t.after(() => s.close());
  await s.start();
  s.world.behavior.send = 'fail';
  const r = await s.send('2', { text: 'Synthetic refused' }, 'key-fail-00001');
  assert.equal(r.http, 502);
  assert.equal(r.error[0], 'send_failed');
  assert.equal(s.store.getSend('key-fail-00001').status, 'failed');
  const again = await s.send('2', { text: 'Synthetic refused' }, 'key-fail-00001');
  assert.equal(again.body.duplicate, true);
  assert.equal(s.world.attempts, 1);
});

test('an uncertain engine answer is reported uncertain and never retried', async (t) => {
  const s = sender();
  t.after(() => s.close());
  await s.start();
  s.world.behavior.send = 'uncertain';
  const r = await s.send('2', { text: 'Synthetic unsure' }, 'key-unsure-001');
  assert.equal(r.http, 202);
  assert.equal(r.body.status, 'uncertain');
  assert.equal(s.store.getSend('key-unsure-001').status, 'uncertain');
  const again = await s.send('2', { text: 'Synthetic unsure' }, 'key-unsure-001');
  assert.equal(again.body.duplicate, true);
  assert.equal(s.world.attempts, 1);
});

test('a send the engine never answers is uncertain, not a failure', async (t) => {
  const s = sender({ sendTimeoutMs: 150 });
  t.after(() => s.close());
  await s.start();
  s.world.behavior.send = 'hang';
  const r = await s.send('2', { text: 'Synthetic silent' }, 'key-hang-00001');
  assert.equal(r.http, 202);
  assert.equal(r.body.status, 'uncertain');
  assert.equal(s.world.attempts, 1);
});

test('a send whose engine dies before it answers is uncertain, and is never retried', async (t) => {
  const s = sender({ sendTimeoutMs: 5000 });
  t.after(() => s.close());
  await s.start();
  s.world.behavior.send = 'hang';
  const pending = s.send('2', { text: 'Synthetic mid-send death' }, 'key-die-00001');
  await tick();
  s.world.crashAll();
  const r = await pending;
  assert.equal(r.http, 202);
  assert.equal(r.body.status, 'uncertain');
  assert.equal(s.store.getSend('key-die-00001').status, 'uncertain');
  assert.equal(s.world.attempts, 1);
});

// The engine starts children of its own, so stopping the transport has to stop the whole process group. Phase 2a
// measured that killing only the pid we spawned leaves the engine's child running and holding the stream.
test('closing the engine transport stops the engine and the children it started', { skip: process.platform === 'win32' ? 'Windows has no process group to signal' : false }, async () => {
  const log = quiet();
  const code = 'import { spawn } from "node:child_process";'
    + ' spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });'
    + ' setInterval(() => {}, 1000);';
  const t = childTransport({ bin: process.execPath, args: ['--input-type=module', '-e', code], log });
  const pgid = t.pid;
  const alive = () => { try { process.kill(-pgid, 0); return true; } catch { return false; } };
  await tick(400);
  assert.equal(alive(), true, 'the engine group is running before close');
  await t.close();
  await tick(200);
  assert.equal(alive(), false, 'the engine group, and the child it started, are gone');
});

// Phase 2c's other half: a send can carry a file. imsg stages one file per send, so one send is still one message one
// client key answers for, and the same switch, window, idempotency and uncertainty rules apply to it.
test('a file send hands the engine the file path, not the text, and is recorded once', async (t) => {
  const s = sender();
  t.after(() => s.close());
  await s.start();
  const { messages } = await s.engine.messages('1');
  const file = messages.flatMap((m) => m.attachments)[0];
  assert.ok(file, 'the fixture carries one attachment to send back');
  const r = await s.send('1', { file: file.id }, 'key-file-00001');
  assert.equal(r.http, 201);
  assert.equal(r.body.status, 'sent');
  assert.equal(s.world.sends.length, 1);
  assert.equal(s.world.sends[0].file, s.store.getAttachment(file.id).path, 'the engine got the path the id stands for');
  assert.equal(s.world.sends[0].text, '', 'a file on its own is not sent as empty text');
  const again = await s.send('1', { file: file.id }, 'key-file-00001');
  assert.equal(again.http, 200);
  assert.equal(again.body.duplicate, true);
  assert.equal(s.world.sends.length, 1, 'the repeat was answered, not sent again');
});

test('a file send can carry a caption, and an unknown file is refused before the engine sees it', async (t) => {
  const s = sender();
  t.after(() => s.close());
  await s.start();
  const { messages } = await s.engine.messages('1');
  const file = messages.flatMap((m) => m.attachments)[0];
  const r = await s.send('1', { file: file.id, text: 'Synthetic caption' }, 'key-file-00002');
  assert.equal(r.http, 201);
  assert.equal(s.world.sends[0].text, 'Synthetic caption');
  assert.equal(s.world.sends[0].file, s.store.getAttachment(file.id).path);
  const bad = await s.send('1', { file: 'unknownunknown01' }, 'key-file-00003');
  assert.equal(bad.http, 404);
  assert.equal(bad.error[0], 'attachment_unknown');
  assert.equal(s.store.getSend('key-file-00003'), null, 'a send we could not make is not recorded, so it is never replayed');
  assert.equal(s.world.sends.length, 1, 'the unknown file never reached the engine');
});

test('a send with neither text nor a file is refused', async (t) => {
  const s = sender();
  t.after(() => s.close());
  await s.start();
  const r = await s.send('1', {}, 'key-empty-00001');
  assert.equal(r.http, 400);
  assert.equal(r.error[0], 'bad_text');
  assert.equal(s.world.sends.length, 0);
});

test('a file send is refused while the switch is off, and one whose engine dies is uncertain', async (t) => {
  const off = sender({ sending: false });
  t.after(() => off.close());
  await off.start();
  const { messages } = await off.engine.messages('1');
  const file = messages.flatMap((m) => m.attachments)[0];
  const refused = await off.send('1', { file: file.id }, 'key-file-00004');
  assert.equal(refused.http, 403);
  assert.equal(off.world.sends.length, 0);

  const s = sender({ sendTimeoutMs: 5000 });
  t.after(() => s.close());
  await s.start();
  const held = await s.engine.messages('1');
  const one = held.messages.flatMap((m) => m.attachments)[0];
  s.world.behavior.send = 'hang';
  const pending = s.send('1', { file: one.id }, 'key-file-00005');
  await tick();
  s.world.crashAll();
  const r = await pending;
  assert.equal(r.http, 202);
  assert.equal(r.body.status, 'uncertain');
  assert.equal(s.store.getSend('key-file-00005').status, 'uncertain');
  assert.equal(s.world.attempts, 1, 'the file send was attempted once and never retried');
});
