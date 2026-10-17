// Issue 415: a video in a conversation was drawn as a blank tile on iPhone. The tile was a video element that read only
// its metadata and had no poster, and WKWebView paints no frame for that, so the conversation showed an empty box
// wearing the play mark. The tile now asks the server for the video's poster and draws it, and where there is none the
// video's source carries a first-frame fragment so the web view seeks into the clip and paints that frame.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const defined = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { defined[name] = cls; }, get() { return undefined; } };
globalThis.document = { createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
let urls = 0;
URL.createObjectURL = () => 'blob:video-preview-' + ++urls;
URL.revokeObjectURL = () => {};
await import('../app/components/app-attachment.js');
const AppAttachment = defined['app-attachment'];

// The Lit template as the text it would draw, nested templates included, without a browser.
function words(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(words).join('');
  if (value?.strings) return value.strings.map((s, i) => s + words(value.values[i])).join('');
  return '';
}

let ids = 0;
const clip = () => ({ id: 'vid' + String(++ids).padStart(11, '0'), name: 'clip.mp4', mime: 'video/mp4', missing: false });
const element = () => {
  const el = Object.create(AppAttachment.prototype);
  el.src = '';
  el.poster = '';
  el.isConnected = true;
  el.failed = false;
  const pending = [];
  el.client = { attachment: (id, options = {}) => new Promise((resolve, reject) => { pending.push({ id, options, resolve, reject }); }) };
  return { el, pending };
};
const show = (el, next) => {
  const before = el.attachment;
  el.attachment = next;
  el.updated(new Map([['attachment', before]]));
};
const settle = () => new Promise((r) => setTimeout(r, 0));
const videoTag = (el) => words(el.render()).match(/<video[^>]*>/)?.[0] || '';

test('a video tile asks the server for its poster and draws it on the video (issue 415)', async () => {
  const { el, pending } = element();
  show(el, clip());
  const video = pending.find((p) => !p.options.part);
  const poster = pending.find((p) => p.options.part === 'poster');
  assert.ok(video, 'the video itself is fetched, as before');
  assert.ok(poster, 'the poster is asked for beside it');
  video.resolve(new Blob(['mp4'], { type: 'video/mp4' }));
  poster.resolve(new Blob(['jpg'], { type: 'image/jpeg' }));
  await settle();
  const tag = videoTag(el);
  assert.ok(el.poster, 'the poster is held by the tile');
  assert.ok(tag.includes('poster=' + el.poster), 'the video is drawn with the poster as its still: ' + tag);
});

test('a video the server has no poster for is drawn at its first frame, never as an empty box (issue 415)', async () => {
  const { el, pending } = element();
  show(el, clip());
  pending.find((p) => !p.options.part).resolve(new Blob(['mp4'], { type: 'video/mp4' }));
  pending.find((p) => p.options.part === 'poster')?.reject(Object.assign(new Error('HTTP 404'), { status: 404 }));
  await settle();
  assert.equal(el.failed, false, 'a missing poster is not a failed video');
  const tag = videoTag(el);
  assert.ok(tag.includes('src=' + el.src + '#t=0.1'), 'the source seeks into the clip so the web view paints a frame: ' + tag);
  assert.ok(!/poster=blob/.test(tag), 'no poster is claimed when there is none');
});

test('a picture never asks for a poster (issue 415)', () => {
  const { el, pending } = element();
  show(el, { id: 'pic00000000001', name: 'photo.png', mime: 'image/png', missing: false });
  assert.deepEqual(pending.map((p) => p.options.part), [undefined], 'one request, for the picture itself');
});

// The proof in the shell's own web view (issue 415): a Debug-only fixture draws two synthetic video tiles, one with a
// poster and one without, and the iOS UI test reads each tile's pixels.
test('the video tile fixture is a Debug seam the iOS UI test reads by its pixels (issue 415)', () => {
  const read = (f) => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
  const naming = JSON.parse(read('core/spec/naming.json'));
  const shell = read('ios/' + naming.product + '/ShellView.swift');
  assert.match(shell, /#if DEBUG[\s\S]*--video-tile-fixture[\s\S]*#endif/, 'the fixture is a Debug seam');
  assert.match(read('ios/project.yml'), /CONFIGURATION.*Debug[\s\S]*core\/test\/video-tile-fixture\.js/, 'copied into test builds only');
  const uiTest = read('ios/' + naming.product + 'UITests/VideoTileTests.swift');
  for (const part of ['--video-tile-fixture', 'Play poster-clip.mp4', 'Play plain-clip.mp4', '.screenshot()']) assert.ok(uiTest.includes(part), 'the UI test reads both tiles by their pixels: ' + part);
  assert.doesNotMatch(read('core/app/main.js'), /video-tile-fixture/);
});
