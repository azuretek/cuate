// Issue 243: which shared video links play in the app's own viewer, and the metadata the server reads to resolve one.
// The policy is pure, so it is held with no browser, no network and no clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostOf, linkMediaSite, isPlayableLink, linkMediaKey, parseOgVideo, LINK_SITES } from '../app/rules/link-media.js';

test('a link is playable only on a site we name, by host or subdomain', () => {
  assert.equal(hostOf('https://www.instagram.com/reel/x/?a=1'), 'instagram.com');
  assert.equal(hostOf('not a url'), '');
  assert.equal(isPlayableLink('https://www.instagram.com/reel/Dda347IpKrV/'), true);
  assert.equal(isPlayableLink('https://m.instagram.com/reel/x/'), true, 'a subdomain of a named site is one of its links');
  assert.equal(isPlayableLink('https://example.com/a/video'), false, 'a site we do not name stays a plain card');
  assert.equal(isPlayableLink(''), false);
  assert.equal(linkMediaSite('https://example.com/x'), null);
  assert.ok(LINK_SITES.some((s) => s.host === 'instagram.com'));
});

test('a link key is stable and names nothing about the link', () => {
  const a = linkMediaKey('https://www.instagram.com/reel/Dda347IpKrV/');
  assert.equal(a, linkMediaKey('https://www.instagram.com/reel/Dda347IpKrV/'), 'the same link is one cache entry');
  assert.notEqual(a, linkMediaKey('https://www.instagram.com/reel/other/'));
  assert.match(a, /^[0-9a-f]{8}$/);
  assert.doesNotMatch(a, /instagram/i, 'no host reaches a filename');
});

test('the video URL is read from the page metadata, secure first, and only an absolute http(s) value', () => {
  assert.equal(parseOgVideo('<meta property="og:video" content="https://cdn.example.com/a.mp4">'), 'https://cdn.example.com/a.mp4');
  const secure = '<meta property="og:video" content="https://cdn.example.com/a.mp4"><meta property="og:video:secure_url" content="https://cdn.example.com/s.mp4">';
  assert.equal(parseOgVideo(secure), 'https://cdn.example.com/s.mp4', 'the secure URL wins');
  assert.equal(parseOgVideo('<meta name="og:video" content="https://cdn.example.com/n.mp4">'), 'https://cdn.example.com/n.mp4', 'name is read as well as property');
  assert.equal(parseOgVideo('<meta property="og:video" content="/relative.mp4">'), null, 'a relative value is refused');
  assert.equal(parseOgVideo('<meta property="og:video" content="javascript:alert(1)">'), null, 'a non-http value is refused');
  assert.equal(parseOgVideo('<html>no video</html>'), null);
  assert.equal(parseOgVideo(''), null);
});
