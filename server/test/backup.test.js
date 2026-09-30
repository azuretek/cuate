import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { createLogger } from '../../core/kit/log.js';
import { logSpec } from '../src/paths.js';
import { normalizeConfig } from '../src/config.js';
import { openStore } from '../src/store.js';
import { createEngine } from '../src/engine/index.js';
import { createFakeImsg } from '../src/engine/fake.js';
import { makeAttachmentId } from '../src/ids.js';
import { startServer } from '../src/app.js';
import { backupDataDir, restoreDataDir } from '../src/backup.js';

const tmp = (p) => mkdtempSync(path.join(os.tmpdir(), p));

async function withServer(dir, fn) {
  const lines = [];
  const logger = createLogger({ spec: logSpec, app: 'test', run: 'test', sink: (l) => lines.push(l), now: Date.now, level: 'debug', strict: true });
  const config = normalizeConfig({ port: 0, engine: { kind: 'fake' } });
  if (!existsSync(path.join(dir, 'config.json'))) writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config), { mode: 0o600 });
  if (!existsSync(path.join(dir, 'secret'))) writeFileSync(path.join(dir, 'secret'), 'test-secret\n', { mode: 0o600 });
  const store = openStore(path.join(dir, 'state.db'));
  const root = path.join(dir, 'attachments');
  const world = createFakeImsg({ attachmentsRoot: root });
  const engine = createEngine({ kind: 'fake', makeTransport: () => world.transport(), log: logger.child('engine'), attachmentId: makeAttachmentId({ secret: 'test-secret', store }) });
  await engine.start();
  const srv = await startServer({ config, store, engine, log: logger.child('http'), dataDir: dir, attachmentsRoot: root });
  try {
    return await fn({ dir, store, engine, world, srv, lines });
  } finally {
    await srv.close();
    await engine.stop();
    store.close();
  }
}

const chatIds = async (base, token) => (await (await fetch(base + '/api/v1/chats', { headers: { authorization: 'Bearer ' + token } })).json()).chats.map((c) => c.id);

test('a backup restores into an empty folder and the restored server serves the same chats', async (t) => {
  const dirA = tmp('backup-a-');
  const dirB = tmp('backup-b-');
  const file = path.join(tmp('backup-file-'), 'state.backup');
  t.after(() => { rmSync(dirA, { recursive: true, force: true }); rmSync(dirB, { recursive: true, force: true }); rmSync(path.dirname(file), { recursive: true, force: true }); });

  const before = await withServer(dirA, async ({ store, srv }) => {
    const { token } = store.createToken('device', 'kept');
    const ids = await chatIds('http://127.0.0.1:' + srv.port, token);
    const written = await backupDataDir({ dataDir: dirA, out: file });
    assert.deepEqual(written.names.sort(), ['config.json', 'secret', 'state.db']);
    return { token, ids };
  });
  assert.ok(before.ids.length > 0);

  restoreDataDir({ file, dataDir: dirB });
  const after = await withServer(dirB, async ({ store, srv }) => {
    assert.ok(store.findToken(before.token), 'the device token came back');
    return chatIds('http://127.0.0.1:' + srv.port, before.token);
  });
  assert.deepEqual(after, before.ids, 'the restored server serves the same chats');
});

test('a backup taken while the state is being written restores valid', async (t) => {
  const dir = tmp('backup-live-');
  const restored = tmp('backup-restored-');
  t.after(() => { rmSync(dir, { recursive: true, force: true }); rmSync(restored, { recursive: true, force: true }); });
  const store = openStore(path.join(dir, 'state.db'));
  const { token } = store.createToken('device', 'before');
  let writing = true;
  const writer = (async () => {
    let i = 0;
    while (writing) {
      store.putAttachment('att' + (i % 40), '/tmp/x', 'image/png', 'x.png');
      i += 1;
      await new Promise((r) => setTimeout(r, 1));
    }
  })();
  await new Promise((r) => setTimeout(r, 15));
  const file = path.join(dir, 'snap.backup');
  await backupDataDir({ dataDir: dir, out: file });
  writing = false;
  await writer;
  store.close();

  restoreDataDir({ file, dataDir: restored });
  const copy = openStore(path.join(restored, 'state.db'));
  try {
    assert.equal(copy.findToken(token).name, 'before');
  } finally {
    copy.close();
  }
  const raw = new DatabaseSync(path.join(restored, 'state.db'));
  try {
    assert.equal(raw.prepare('pragma integrity_check').get().integrity_check, 'ok');
  } finally {
    raw.close();
  }
});

test('restore refuses a folder that already holds state, and refuses a file that is not a backup', async (t) => {
  const dir = tmp('backup-guard-');
  const file = path.join(tmp('backup-guard-file-'), 'state.backup');
  t.after(() => { rmSync(dir, { recursive: true, force: true }); rmSync(path.dirname(file), { recursive: true, force: true }); });
  const store = openStore(path.join(dir, 'state.db'));
  store.createToken('device', 'kept');
  store.close();
  await backupDataDir({ dataDir: dir, out: file });

  assert.throws(() => restoreDataDir({ file, dataDir: dir }), /not empty/);
  const foreign = path.join(path.dirname(file), 'foreign.json');
  writeFileSync(foreign, JSON.stringify({ hello: 'world' }));
  assert.throws(() => restoreDataDir({ file: foreign, dataDir: tmp('backup-guard-b-') }), /not a server backup/);
  const target = tmp('backup-guard-c-');
  t.after(() => rmSync(target, { recursive: true, force: true }));
  restoreDataDir({ file, dataDir: target });
  assert.ok(existsSync(path.join(target, 'state.db')));
});
