// Issue 243: the server resolves a shared video link's media, fetches it within bounds and caches it, so a client
// never reaches the third party. The network and the clock are injected, so this is held with no site and no wait.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLinkMedia } from '../src/link-media.js';

const PAGE = 'https://www.instagram.com/reel/EXAMPLE/';
const MEDIA = 'https://cdn.example.com/reel.mp4';
const html = (video) => (video === null ? '<html>no video here</html>' : '<meta property="og:video" content="' + video + '">');

function fakeFetch({ page = html(MEDIA), pageStatus = 200, mediaStatus = 200, mediaType = 'video/mp4', bytes = 'video-bytes', pageBytes = null } = {}) {
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    if (String(url).includes('instagram.com')) {
      if (pageBytes != null) return new Response('x'.repeat(pageBytes), { status: pageStatus, headers: { 'content-type': 'text/html' } });
      return new Response(page, { status: pageStatus, headers: { 'content-type': 'text/html' } });
    }
    return new Response(bytes, { status: mediaStatus, headers: { 'content-type': mediaType } });
  };
  impl.calls = calls;
  return impl;
}

async function withDir(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'link-media-'));
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('a shared video link resolves to its site media and is cached within its expiry', async () => {
  await withDir(async (dir) => {
    let clock = 1000;
    const fetchImpl = fakeFetch();
    const lm = createLinkMedia({ dataDir: dir, fetchImpl, now: () => clock });
    const first = await lm.get(PAGE);
    assert.equal(first.bytes, Buffer.byteLength('video-bytes'));
    assert.equal(first.mime, 'video/mp4');
    assert.equal(first.cached, false);
    assert.deepEqual(fetchImpl.calls, [PAGE, MEDIA], 'the page is read, then the media it names');
    const second = await lm.get(PAGE);
    assert.equal(second.cached, true, 'a second ask is served from the cache');
    assert.equal(fetchImpl.calls.length, 2, 'the site is not asked again');
    assert.equal(readdirSync(path.join(dir, 'link-media')).length, 2, 'one body and one metadata file, both keyed by a hash');
    clock += 21600001;
    const third = await lm.get(PAGE);
    assert.equal(third.cached, false, 'past its expiry it resolves again');
    assert.equal(fetchImpl.calls.length, 4);
  });
});

test('a link on a site we do not name, or one that names no video, is refused with its reason', async () => {
  await withDir(async (dir) => {
    const lm = createLinkMedia({ dataDir: dir, fetchImpl: fakeFetch() });
    await assert.rejects(() => lm.get('https://example.com/a/video'), (e) => e.code === 'link_unsupported');
    const noVideo = createLinkMedia({ dataDir: dir, fetchImpl: fakeFetch({ page: html(null) }) });
    await assert.rejects(() => noVideo.get(PAGE), (e) => e.code === 'link_no_media');
  });
});

test('a site that answers too large, or cannot be reached, is refused rather than trusted', async () => {
  await withDir(async (dir) => {
    const tooBig = createLinkMedia({ dataDir: dir, fetchImpl: fakeFetch({ pageBytes: 524289 }) });
    await assert.rejects(() => tooBig.get(PAGE), (e) => e.code === 'link_too_large');
    const bigMedia = createLinkMedia({ dataDir: dir, fetchImpl: fakeFetch({ bytes: 'x'.repeat(26214401) }) });
    await assert.rejects(() => bigMedia.get(PAGE), (e) => e.code === 'link_media_too_large');
    const down = createLinkMedia({ dataDir: dir, fetchImpl: async () => { throw Object.assign(new Error('no route'), { name: 'TypeError' }); } });
    await assert.rejects(() => down.get(PAGE), (e) => e.code === 'link_unreachable');
  });
});
