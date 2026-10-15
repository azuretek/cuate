import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../src/engine/index.js';
import { createLogger } from '../../core/kit/log.js';
import { logSpec } from '../src/paths.js';
import { chatTitle } from '../../core/app/rules/chats.js';

// The engine's chat list as the Mac sends it for a group nobody named: no display name, and the group's identifier,
// here a 32 character hex string, where its name would be. Synthetic addresses only.
const HEX = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const CHATS = [
  { id: 11, name: HEX, display_name: '', contact_name: '', identifier: HEX, guid: 'iMessage;+;' + HEX, service: 'iMessage', is_group: true, participants: ['+15555550100', 'jordan@example.com', 'priya@example.com'], unread_count: 0 },
  { id: 12, name: 'chat500000002', display_name: '', contact_name: '', identifier: 'chat500000002', guid: 'iMessage;+;chat500000002', service: 'iMessage', is_group: true, participants: ['+15555550177', 'jordan@example.com'], unread_count: 0 },
  { id: 13, name: 'Weekend plans', display_name: 'Weekend plans', contact_name: '', identifier: 'chat500000003', guid: 'iMessage;+;chat500000003', service: 'iMessage', is_group: true, participants: ['+15555550177', 'jordan@example.com'], unread_count: 0 },
];

function transport() {
  const lineCbs = new Set();
  const send = (o) => setImmediate(() => { for (const cb of lineCbs) cb(JSON.stringify(o)); });
  return {
    write(s) {
      const req = JSON.parse(s);
      if (req.method === 'status') return send({ jsonrpc: '2.0', id: req.id, result: { version: 't', database: { ready: true }, methods: [], capabilities: { features: {} } } });
      if (req.method === 'watch.subscribe') return send({ jsonrpc: '2.0', id: req.id, result: { subscription: 1 } });
      if (req.method === 'chats.list') return send({ jsonrpc: '2.0', id: req.id, result: { chats: CHATS } });
      if (req.method === 'messages.history') return send({ jsonrpc: '2.0', id: req.id, result: { messages: [] } });
      return send({ jsonrpc: '2.0', id: req.id, result: { ok: true } });
    },
    onLine(cb) { lineCbs.add(cb); },
    onExit() {},
    close() { return Promise.resolve(); },
  };
}

test('the server sends no name for a group nobody named, so its people show instead of its identifier (issue 388)', async () => {
  const log = createLogger({ spec: logSpec, app: 'test', run: 'test', sink: () => {}, now: Date.now, level: 'debug', strict: true });
  const engine = createEngine({ kind: 'fake', makeTransport: () => transport(), log: log.child('engine'), attachmentId: () => 'att', timeoutMs: 2000 });
  await engine.start();
  try {
    const chats = await engine.chats();
    const byId = (id) => chats.find((c) => c.id === id);
    assert.equal(byId('11').name, '', 'a hex identifier is not sent as the name');
    assert.equal(byId('12').name, '', 'nor is a chat<digits> identifier');
    assert.equal(byId('13').name, 'Weekend plans', 'a name someone gave the group is kept');
    assert.equal(chatTitle(byId('11')), '+15555550100, jordan@example.com and 1 other');
    for (const c of chats) assert.doesNotMatch(chatTitle(c), /^(?:chat[0-9]+|[0-9a-f]{24,40})$/i, 'no title is an identifier');
  } finally {
    await engine.stop();
  }
});
