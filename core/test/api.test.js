import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from '../kit/api.js';

function harness() {
  const sockets = [];
  const events = [];
  class Socket {
    constructor() { sockets.push(this); }
    send() {}
    close() {}
    frame(frame) { this.onmessage({ data: JSON.stringify(frame) }); }
  }
  const client = createApiClient({ baseUrl: 'http://example.test', token: 'synthetic', WebSocketImpl: Socket, onEvent: (event) => events.push(event) });
  return { client, sockets, events };
}

test('initial handshake resyncs events missed between the snapshot and socket authentication', () => {
  const { client, sockets, events } = harness();
  client.connect();
  sockets[0].frame({ type: 'hello', epoch: 'test', seq: 1, resumed: false });
  assert.deepEqual(events, [{ name: 'resync', data: {} }]);
  client.close();
});

test('empty initial stream needs no resync and a resumed stream keeps replayed events', () => {
  const { client, sockets, events } = harness();
  client.connect();
  sockets[0].frame({ type: 'hello', epoch: 'test', seq: 0, resumed: false });
  assert.deepEqual(events, []);
  client.connect();
  sockets[1].frame({ type: 'hello', epoch: 'test', seq: 1, resumed: true });
  sockets[1].frame({ type: 'event', seq: 1, name: 'message.new', data: { message: { text: 'Synthetic live message' } } });
  assert.equal(events.length, 1);
  assert.equal(events[0].name, 'message.new');
  client.close();
});
