import { test } from 'node:test';
import assert from 'node:assert/strict';

const defined = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { defined[name] = cls; }, get() {} };
globalThis.document = { createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
await import('../app/components/app-image-viewer.js');
const proto = defined['app-image-viewer'].prototype;

function viewer(client) {
  const value = { client, items: Array.from({ length: 12 }, (_, i) => ({ id: String(i), attachmentId: String(i), kind: 'image' })), index: 5, isConnected: true, urls: new Map(), loadingMedia: new Map(), mediaRequests: new Map(), updateComplete: Promise.resolve(), closeDocument() {}, isDocument: () => false };
  for (const name of ['load', 'loadMedia', 'neighbourItems', 'pruneMedia', 'warmNeighbours', 'show']) value[name] = proto[name];
  return value;
}

test('viewer prefetch holds two neighbours each side and releases evicted blob URLs', async () => {
  const requested = [];
  const value = viewer({ attachment: async (id) => { requested.push(id); return new Blob(['synthetic-' + id], { type: 'image/png' }); } });
  await value.warmNeighbours();
  assert.deepEqual(requested, ['3', '4', '5', '6', '7']);
  assert.equal(value.urls.size, 5);
  const old = [...value.urls.values()];
  value.index = 10;
  value.pruneMedia();
  await value.warmNeighbours();
  assert.deepEqual([...value.urls.keys()], ['8', '9', '10', '11']);
  for (const url of old) await assert.rejects(fetch(url), 'evicted URL is revoked, not merely absent from the map');
  for (const url of value.urls.values()) URL.revokeObjectURL(url);
});

test('aborted or closed-view media requests cannot repopulate the neighbour cache', async () => {
  const jobs = new Map();
  const value = viewer({ attachment: (id, { signal }) => new Promise((resolve, reject) => {
    jobs.set(id, resolve);
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }) });
  const pending = value.warmNeighbours();
  assert.equal(value.mediaRequests.size, 5);
  value.index = 0;
  value.pruneMedia();
  value.isConnected = false;
  // A client that settles a result despite cancellation still must not attach it after close.
  for (const resolve of jobs.values()) resolve(new Blob(['synthetic']));
  await pending;
  assert.equal(value.urls.size, 0);
  assert.equal(value.loadingMedia.size, 0);
  assert.equal(value.mediaRequests.size, 0);
});
