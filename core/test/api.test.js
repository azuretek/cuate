import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from '../kit/api.js';

function harness() {
  const sockets = [];
  const events = [];
  class Socket {
    constructor() { sockets.push(this); }
    send() {}
    close(code) { this.closedWith = code; }
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

test('reconnect drops the stream as a lost connection does, and it comes back resumed', () => {
  const pending = [];
  const sockets = [];
  const states = [];
  class Socket {
    constructor() { sockets.push(this); }
    send() {}
    close(code) { this.closedWith = code; }
    frame(frame) { this.onmessage({ data: JSON.stringify(frame) }); }
  }
  const timers = { setTimeout: (fn) => { pending.push(fn); return pending.length; }, clearTimeout() {} };
  const client = createApiClient({ baseUrl: 'http://example.test', token: 'synthetic', WebSocketImpl: Socket, timers, onState: (s) => states.push(s) });
  client.connect();
  sockets[0].frame({ type: 'hello', epoch: 'test', seq: 2, resumed: false });
  client.reconnect();
  assert.equal(sockets[0].closedWith, 4000);
  sockets[0].onclose({ code: 4000 });
  assert.equal(states.at(-1), 'reconnecting');
  pending.shift()();
  assert.equal(sockets.length, 2, 'a new stream is opened');
  sockets[1].frame({ type: 'hello', epoch: 'test', seq: 2, resumed: true });
  assert.equal(states.at(-1), 'open');
  client.close();
});
