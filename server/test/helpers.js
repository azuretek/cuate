import { mkdtempSync, rmSync } from 'node:fs';
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

// A real server over the fake engine, with a strict logger at debug so an undeclared event fails the test.
export async function boot({ sending = true, perMinute = 20, sendTimeoutMs = 400, mac = null, restarts = null } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'srv-test-'));
  const lines = [];
  const logger = createLogger({ spec: logSpec, app: 'test', run: 'test', sink: (l) => lines.push(l), now: Date.now, level: 'debug', strict: true });
  const config = normalizeConfig({ port: 0, engine: { kind: 'fake' }, sending: { enabled: sending, perMinute } });
  const store = openStore(path.join(dir, 'state.db'));
  const root = path.join(dir, 'attachments');
  const world = createFakeImsg({ attachmentsRoot: root });
  const engine = createEngine({ kind: 'fake', makeTransport: () => world.transport(), log: logger.child('engine'), attachmentId: makeAttachmentId({ secret: 'test-secret', store }), sendTimeoutMs });
  await engine.start();
  const srv = await startServer({ config, store, engine, log: logger.child('http'), dataDir: dir, attachmentsRoot: root, mac, restarts });
  const tokens = {
    device: store.createToken('device', 'test device').token,
    tooling: store.createToken('tooling', 'test tool').token,
    admin: store.createToken('admin', 'test admin').token,
  };
  const base = 'http://127.0.0.1:' + srv.port;
  return {
    base, srv, world, store, engine, lines, tokens, config, dir, root, mac, restarts,
    get: (p, token) => fetch(base + p, { headers: token ? { authorization: 'Bearer ' + token } : {} }),
    post: (p, token, body) => fetch(base + p, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    put: (p, token, body) => fetch(base + p, { method: 'PUT', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    async close() {
      await srv.close();
      await engine.stop();
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const waitFor = async (fn, ms = 4000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

export const openSocket = (base) => new Promise((resolve, reject) => {
  const ws = new WebSocket(base.replace('http', 'ws') + '/api/v1/events');
  const frames = [];
  ws.onmessage = (e) => frames.push(JSON.parse(e.data));
  ws.onopen = () => resolve({ ws, frames });
  ws.onerror = reject;
});
