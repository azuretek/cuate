// Issue 181: the conversation's media and moving through it, and the action set a media message's menu offers. The
// navigation rule (which item is where, and what one step is) and the action set are pure, so they are held here
// without a browser or an engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMediaAttachment, mediaKind, isLivePhoto, mediaItems, mediaIndex, mediaStep, mediaNeighbours, swipeStep, SWIPE_MIN_PX } from '../app/rules/media.js';
import { messageActions } from '../app/rules/messages.js';

let n = 0;
const msg = (o) => ({ id: 'm' + n++, chatId: '1', fromMe: false, sender: '+15555550100', text: '', sentAt: '2026-01-15T10:00:00.000Z', replyTo: null, attachments: [], reactions: [], ...o });
const png = (id, o) => ({ id, name: 'sunset.png', mime: 'image/png', bytes: 10, sticker: false, missing: false, ...o });
const mp4 = (id, o) => ({ id, name: 'clip.mp4', mime: 'video/mp4', bytes: 10, sticker: false, missing: false, ...o });

// A Live Photo is a picture the server found its motion beside: its preview and the viewer show the still, so it is a
// picture item marked live, and the viewer plays the attachment's live part over it on request.
test('a Live Photo is a picture marked live, and it opens in the viewer as its still with its motion on offer', () => {
  assert.equal(isLivePhoto(png('a', { live: true })), true);
  assert.equal(isLivePhoto(png('b')), false, 'a plain picture');
  assert.equal(isLivePhoto(mp4('c', { live: true })), false, 'only a picture is live');
  assert.equal(isLivePhoto(png('d', { live: true, missing: true })), false, 'not on the Mac');
  assert.equal(mediaKind(png('e', { live: true })), 'image', 'its kind as an attachment stays a picture');
  const items = mediaItems([msg({ id: 'L1', attachments: [png('att-live', { live: true }), png('att-still')] })]);
  assert.deepEqual(items.map((x) => [x.id, x.kind, x.live]), [['att-live', 'image', true], ['att-still', 'image', undefined]]);
});

test('a media item is a picture or a video that is really there, never a document, a sticker, a local or a missing file', () => {
  assert.equal(isMediaAttachment(png('a')), true);
  assert.equal(isMediaAttachment(mp4('b')), true);
  assert.equal(isMediaAttachment({ id: 'c', mime: 'application/pdf', missing: false }), false, 'a document is saved, not shown');
  assert.equal(isMediaAttachment(png('d', { sticker: true })), false, 'a sticker is drawn as itself');
  assert.equal(isMediaAttachment(png('e', { missing: true })), false, 'not on the Mac');
  assert.equal(isMediaAttachment(png('f', { local: true })), false, 'still being sent');
  assert.equal(isMediaAttachment(null), false);
  assert.equal(mediaKind(png('g')), 'image');
  assert.equal(mediaKind(mp4('h')), 'video');
  assert.equal(mediaKind({ id: 'i', mime: 'text/plain' }), null);
});

test('the media list is every picture and video in conversation order, each naming its message and its kind', () => {
  const messages = [
    msg({ id: 'FAKE-0001', attachments: [png('att-a')] }),
    msg({ id: 'FAKE-0002', attachments: [{ id: 'att-doc', mime: 'application/pdf', name: 'booking.pdf', missing: false }] }),
    msg({ id: 'FAKE-0003', attachments: [png('att-b', { sticker: true }), mp4('att-c')] }),
    msg({ id: 'FAKE-0004', attachments: [] }),
    msg({ id: 'FAKE-0005', attachments: [png('att-e', { missing: true })] }),
  ];
  const items = mediaItems(messages);
  assert.deepEqual(items.map((x) => x.id), ['att-a', 'att-c'], 'pictures and videos only, in conversation order, the sticker and the document left out');
  assert.deepEqual(items.map((x) => x.kind), ['image', 'video']);
  assert.deepEqual(items.map((x) => x.messageId), ['FAKE-0001', 'FAKE-0003']);
  assert.equal(mediaItems([]).length, 0);
});

test('one step moves to the neighbour in conversation order, and stays put at each end rather than wrapping', () => {
  const items = mediaItems([msg({ id: 'a', attachments: [png('att-1')] }), msg({ id: 'b', attachments: [mp4('att-2')] }), msg({ id: 'c', attachments: [png('att-3')] })]);
  assert.equal(mediaStep(items, 'att-1', 'next').id, 'att-2', 'next is the following item');
  assert.equal(mediaStep(items, 'att-3', 'prev').id, 'att-2', 'previous is the item before');
  assert.equal(mediaStep(items, 'att-1', 'prev'), null, 'the first item has no previous');
  assert.equal(mediaStep(items, 'att-3', 'next'), null, 'the last item has no next');
  assert.equal(mediaStep(items, 'not-there', 'next'), null, 'an id not in the list has neither');
  assert.equal(mediaIndex(items, 'att-2'), 1);
  assert.equal(mediaIndex(items, 'not-there'), -1);
});

test('what the viewer controls need: the position, the count, and whether there is one each way', () => {
  const items = mediaItems([msg({ id: 'a', attachments: [png('att-1')] }), msg({ id: 'b', attachments: [png('att-2')] })]);
  assert.deepEqual(mediaNeighbours(items, 'att-1'), { index: 0, count: 2, canPrev: false, canNext: true, prev: null, next: items[1] });
  assert.deepEqual(mediaNeighbours(items, 'att-2'), { index: 1, count: 2, canPrev: true, canNext: false, prev: items[0], next: null });
});

test('a swipe moves a step only when it is mostly horizontal and past the threshold', () => {
  assert.equal(swipeStep(-(SWIPE_MIN_PX + 10), 4), 'next', 'a left swipe goes to the next item');
  assert.equal(swipeStep(SWIPE_MIN_PX + 10, 4), 'prev', 'a right swipe goes to the previous item');
  assert.equal(swipeStep(SWIPE_MIN_PX - 1, 0), null, 'a short move is not a swipe');
  assert.equal(swipeStep(-(SWIPE_MIN_PX + 40), 120), null, 'a mostly-vertical move is a scroll');
});

test('a message that carries a real picture or video offers Save beside Reply and React; a text message does not', () => {
  assert.deepEqual(messageActions(msg({ id: 'FAKE-0001', attachments: [png('att-1')] }), { sending: true }), ['save', 'reply', 'react']);
  assert.deepEqual(messageActions(msg({ id: 'FAKE-0002', fromMe: true, sender: null, attachments: [mp4('att-2')] }), { sending: true }), ['save', 'react'], 'your own media message can be saved and reacted to, never replied in thread');
  assert.deepEqual(messageActions(msg({ id: 'FAKE-0003' }), { sending: true }), ['reply', 'react'], 'a message with no file offers no save');
  assert.deepEqual(messageActions(msg({ id: 'FAKE-0004', attachments: [png('att-4')] }), { sending: false }), [], 'with sending off there is nothing to save either');
});

// The viewer and the attachment draw a video as a video, not a picture (issue 181): the case the smoke's synthetic
// fixture does not carry, held at the component so the rendering rule cannot regress.
const components = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { components[name] = cls; }, get() { return undefined; } };
globalThis.document = { createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
await import('../app/components/app-attachment.js');
await import('../app/components/app-image-viewer.js');

// The Lit template as the text it would draw, nested templates included, without a browser.
function words(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(words).join('');
  if (value?.strings) return value.strings.map((s, i) => s + words(value.values[i])).join('');
  return '';
}

test('the viewer draws a video as a video, with the step controls between the conversation media', () => {
  const items = [
    { id: 'att-p', kind: 'image', src: 'blob:p', name: 'sunset.png' },
    { id: 'att-v', kind: 'video', src: 'blob:v', name: 'clip.mp4', mime: 'video/mp4' },
  ];
  const host = (i) => ({ items, index: i, kind: items[i].kind, alt: items[i].name, src: items[i].src, view: { scale: 1, x: 0, y: 0 }, moving: false, client: null });
  const viewer = components['app-image-viewer'].prototype;
  const image = words(viewer.render.call(host(0)));
  const video = words(viewer.render.call(host(1)));
  assert.ok(image.includes('<img class="viewer-image"') && image.includes('sunset.png'), 'a picture is an image element');
  assert.ok(video.includes('<video class="viewer-image"') && video.includes('clip.mp4'), 'a video is a video element');
  assert.ok(video.includes('data-kind=video') && video.includes('data-count=2'), 'the item on screen and the count are named');
  assert.ok(image.includes('viewer-prev') && image.includes('viewer-next') && image.includes('aria-label="Previous item"') && image.includes('aria-label="Next item"'), 'the step controls are drawn when there is more than one item');
});

test('a video attachment is a media preview that opens the viewer, never a save button, and anything that moves wears the play mark', () => {
  const attachment = components['app-attachment'].prototype;
  const video = words(attachment.render.call({ attachment: { id: 'att-v', name: 'clip.mp4', mime: 'video/mp4', missing: false }, client: {}, failed: false, src: 'blob:v' }));
  assert.ok(video.includes('attachment-preview') && video.includes('Play clip.mp4'), 'a video opens the viewer, and says it plays');
  assert.ok(video.includes('<video class="attachment-image"'), 'drawn as a video');
  assert.ok(video.includes('class="media-play"') && video.includes('data-icon="play"'), 'a video wears the play mark in its corner');
  const live = words(attachment.render.call({ attachment: { id: 'att-l', name: 'IMG_1.HEIC', mime: 'image/heic', missing: false, live: true }, client: {}, failed: false, src: 'blob:l' }));
  assert.ok(live.includes('<img class="attachment-image"') && live.includes('class="media-play"') && live.includes('Play IMG_1.HEIC'), 'a Live Photo is its still with the play mark');
  const still = words(attachment.render.call({ attachment: { id: 'att-s', name: 'sunset.png', mime: 'image/png', missing: false }, client: {}, failed: false, src: 'blob:s' }));
  assert.ok(!still.includes('media-play') && still.includes('Open sunset.png'), 'a plain picture wears no play mark');
  const file = words(attachment.render.call({ attachment: { id: 'att-d', name: 'booking.pdf', mime: 'application/pdf', missing: false }, client: {}, failed: false, src: '' }));
  assert.ok(file.includes('attachment-file') && file.includes('Save booking.pdf') && !file.includes('attachment-preview'), 'a document is still saved, not shown');
});
