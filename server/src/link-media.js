// The server half of a shared video link (issue 243): the client never reaches the third party, so the server
// resolves the site's own media URL, fetches it within the bounds core/app/rules/link-media.js names, and holds the
// bytes in a cache with an expiry. The pure policy (which sites, and how large a fetch may be) is the rule module;
// this owns the network and the disk, both injected so a test stands in for the site and the clock.
import path from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { linkMediaSite, linkMediaKey, parseOgVideo, LINK_BOUNDS } from '../../core/app/rules/link-media.js';

const refuse = (code, message, status = 400) => Object.assign(new Error(message), { status, code });

// Read a response body up to max bytes, refusing rather than buffering whatever the far end sends.
async function readBounded(res, max, code, tooLarge) {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw refuse(code, tooLarge);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export function createLinkMedia({ dataDir = null, fetchImpl = globalThis.fetch, now = Date.now, bounds = LINK_BOUNDS } = {}) {
  const dir = dataDir ? path.join(dataDir, 'link-media') : null;
  if (dir) mkdirSync(dir, { recursive: true });
  const metaPath = (key) => path.join(dir, key + '.json');
  const bodyPath = (key) => path.join(dir, key + '.bin');

  function cached(key) {
    if (!dir) return null;
    try {
      const meta = JSON.parse(readFileSync(metaPath(key), 'utf8'));
      if (!meta || typeof meta.expiresAt !== 'number' || now() >= meta.expiresAt) return null;
      const body = readFileSync(bodyPath(key));
      if (body.length !== meta.bytes) return null;
      return { body, mime: meta.mime, bytes: meta.bytes, cached: true };
    } catch {
      return null;
    }
  }

  async function fetchPage(url) {
    let res;
    try {
      res = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(bounds.timeoutMs), headers: { accept: 'text/html' } });
    } catch (e) {
      const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
      throw refuse('link_unreachable', timedOut ? 'That link did not answer within ' + bounds.timeoutMs / 1000 + ' seconds.' : 'That link could not be reached.', 502);
    }
    if (!res.ok) {
      await res.body?.cancel?.().catch(() => {});
      throw refuse('link_unreachable', 'That link answered ' + res.status + '.', 502);
    }
    const body = await readBounded(res, bounds.maxPageBytes, 'link_too_large', 'That link answered with more than ' + Math.round(bounds.maxPageBytes / 1024) + ' KB.');
    return body.toString('utf8');
  }

  async function fetchMedia(url) {
    let res;
    try {
      res = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(bounds.timeoutMs) });
    } catch {
      throw refuse('link_media_unreachable', 'The video at that link could not be fetched.', 502);
    }
    if (!res.ok) {
      await res.body?.cancel?.().catch(() => {});
      throw refuse('link_media_unreachable', 'The video at that link answered ' + res.status + '.', 502);
    }
    const header = String(res.headers?.get?.('content-type') || '').split(';')[0].trim();
    const mime = /^video\//i.test(header) ? header : 'video/mp4';
    const body = await readBounded(res, bounds.maxMediaBytes, 'link_media_too_large', 'The video at that link is larger than ' + Math.round(bounds.maxMediaBytes / 1024 / 1024) + ' MB.');
    return { body, mime };
  }

  // Resolve the link now: fetch its page, read its own video metadata, fetch the media and hold it until it expires.
  async function resolve(url) {
    const site = linkMediaSite(url);
    if (!site) throw refuse('link_unsupported', 'That link is not one the app can play.');
    const page = await fetchPage(url);
    const mediaUrl = parseOgVideo(page);
    if (!mediaUrl) throw refuse('link_no_media', 'That link does not name a playable video.');
    const got = await fetchMedia(mediaUrl);
    const key = linkMediaKey(url);
    if (dir) {
      writeFileSync(bodyPath(key), got.body);
      writeFileSync(metaPath(key), JSON.stringify({ mime: got.mime, bytes: got.body.length, fetchedAt: now(), expiresAt: now() + (site.ttlMs || 0) }));
    }
    return { body: got.body, mime: got.mime, bytes: got.body.length, cached: false };
  }

  // A held copy still inside its expiry, else a fresh resolution.
  async function get(url) {
    return cached(linkMediaKey(url)) || resolve(url);
  }

  return { resolve, get };
}
