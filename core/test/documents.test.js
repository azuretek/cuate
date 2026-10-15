// Issue 374: a document in a conversation is previewed in the media viewer when the app can show it (a PDF, text, or
// audio a web view plays), and handed to the device's own apps with Open in otherwise; Save stays for every file. The
// type rule, the PDF's zoom and page sizes, the bridge command each button sends and the viewer's document surface are
// held here without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  previewKind, filePress, isFileAttachment, extensionOf, docZoom, pageFit, pageCanvas,
  DOC_ZOOM_MIN, DOC_ZOOM_MAX, PAGE_FIT_MAX, PAGE_MAX_PIXELS, TEXT_PREVIEW_MAX_BYTES, PDF_PREVIEW_MAX_BYTES,
} from '../app/rules/documents.js';

const components = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} addController() {} };
globalThis.customElements = { define(name, cls) { components[name] = cls; }, get() { return undefined; } };
globalThis.document = { createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
const { openAttachment, saveAttachment } = await import('../app/components/app-attachment.js');
await import('../app/components/app-image-viewer.js');

function words(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(words).join('');
  if (value?.strings) return value.strings.map((s, i) => s + words(value.values[i])).join('');
  return '';
}

const file = (name, mime, o) => ({ id: 'att-' + name, name, mime, bytes: 10, sticker: false, missing: false, local: false, ...o });

test('a document the app can show opens in the viewer, and any other goes straight to Open in', () => {
  const cases = [
    [file('booking.pdf', 'application/pdf'), 'pdf'],
    [file('booking.pdf', 'application/octet-stream'), 'pdf'],
    [file('scan.PDF', ''), 'pdf'],
    [file('notes.txt', 'text/plain'), 'text'],
    [file('notes.txt', 'text/plain; charset=utf-8'), 'text'],
    [file('table.csv', 'text/csv'), 'text'],
    [file('table.csv', 'application/octet-stream'), 'text'],
    [file('main.swift', ''), 'text'],
    [file('data.json', 'application/json'), 'text'],
    [file('song.mp3', 'audio/mpeg'), 'audio'],
    [file('memo.m4a', 'audio/x-m4a'), 'audio'],
    [file('memo.m4a', 'application/octet-stream'), 'audio'],
    [file('Audio Message.caf', 'audio/x-caf'), null],
    [file('page.html', 'text/html'), null],
    [file('letter.rtf', 'text/rtf'), null],
    [file('photos.zip', 'application/zip'), null],
    [file('slides.key', 'application/x-iwork-keynote-sffkey'), null],
    [file('README', ''), null],
  ];
  for (const [a, kind] of cases) {
    assert.equal(previewKind(a), kind, a.name + ' (' + a.mime + ')');
    assert.equal(filePress(a), kind ? 'view' : 'open', a.name + ' press');
  }
});

test('a document too large to draw here opens in another app instead', () => {
  assert.equal(filePress(file('huge.txt', 'text/plain', { bytes: TEXT_PREVIEW_MAX_BYTES + 1 })), 'open');
  assert.equal(filePress(file('huge.pdf', 'application/pdf', { bytes: PDF_PREVIEW_MAX_BYTES + 1 })), 'open');
  assert.equal(filePress(file('short.txt', 'text/plain', { bytes: TEXT_PREVIEW_MAX_BYTES })), 'view', 'the bound itself still fits');
  assert.equal(filePress(file('unknown.pdf', 'application/pdf', { bytes: undefined })), 'view', 'an unknown size is tried');
});

test('only a real document is pressed as one: media, a sticker, a file still sending or not on the Mac is not', () => {
  assert.equal(filePress(file('sunset.png', 'image/png')), null, 'a picture is media');
  assert.equal(filePress(file('clip.mp4', 'video/mp4')), null, 'a video is media');
  assert.equal(isFileAttachment(file('booking.pdf', 'application/pdf', { missing: true })), false);
  assert.equal(isFileAttachment(file('booking.pdf', 'application/pdf', { local: true })), false);
  assert.equal(filePress(null), null);
  assert.equal(extensionOf('archive.tar.gz'), 'gz');
  assert.equal(extensionOf('.profile'), '', 'a leading dot is a name, not an extension');
  assert.equal(extensionOf('dir.d/README'), '');
});

test('a PDF zooms between its bounds, fits the room up to half again its size, and never asks for a canvas past the pixel bound', () => {
  assert.equal(docZoom(1, 1.25), 1.25);
  assert.equal(docZoom(DOC_ZOOM_MAX, 2), DOC_ZOOM_MAX, 'never past the deepest zoom');
  assert.equal(docZoom(DOC_ZOOM_MIN, 0.5), DOC_ZOOM_MIN, 'never below the widest');
  assert.equal(pageFit(612, 390), 390 / 612, 'a phone fits the page to its width');
  assert.equal(pageFit(612, 3000), PAGE_FIT_MAX, 'a wide window draws it at most half again its size');
  assert.equal(pageFit(0, 390), 1);
  const plain = pageCanvas(200, 260, 2, 2);
  assert.deepEqual([plain.cssWidth, plain.cssHeight, plain.width, plain.height], [400, 520, 800, 1040], 'drawn at the pixel ratio');
  const deep = pageCanvas(612, 792, 6, 3);
  assert.ok(deep.width * deep.height <= PAGE_MAX_PIXELS, 'a deep zoom stays under the bound');
  assert.equal(deep.cssWidth, 3672, 'and is still laid out at its full size');
});

test('Open in hands the shell the file through file.open and Save through file.save, each with its name, type and bytes', async () => {
  const calls = [];
  const bridge = { call: async (name, args) => { calls.push([name, args]); return true; } };
  const client = { attachment: async () => new Blob([Uint8Array.from([0x25, 0x50, 0x44, 0x46])], { type: 'application/pdf' }) };
  const a = file('booking.pdf', 'application/pdf');
  assert.equal(await openAttachment(a, { client, bridge }), true);
  assert.equal(await saveAttachment(a, { client, bridge }), true);
  assert.deepEqual(calls, [
    ['file.open', { name: 'booking.pdf', mime: 'application/pdf', data: 'JVBERg==' }],
    ['file.save', { name: 'booking.pdf', mime: 'application/pdf', data: 'JVBERg==' }],
  ]);
  assert.equal(await openAttachment(file('booking.pdf', 'application/pdf', { missing: true }), { client, bridge }), false, 'a file not on the Mac is not opened');
  const spec = JSON.parse(readFileSync(new URL('../spec/host-bridge.json', import.meta.url), 'utf8'));
  assert.deepEqual(spec.commands['file.open'].args, { name: 'string', mime: 'string', data: 'string' }, 'file.open is declared in the bridge spec');
  assert.equal(spec.commands['file.open'].returns, 'boolean');
});

test('the viewer shows a document with Open in and Save, and a PDF with its pages, its page count and its zoom', () => {
  const viewer = components['app-image-viewer'].prototype;
  const host = (kind, o) => Object.assign(Object.create(viewer), { items: [{ id: 'att-d', attachmentId: 'att-d', kind, name: 'booking.pdf', mime: 'application/pdf', document: true }], index: 0, kind, alt: 'booking.pdf', src: '', docState: 'ready', docText: '', docPages: 2, docScale: 1, view: { scale: 1, x: 0, y: 0 } }, o);
  const pdf = words(viewer.render.call(host('pdf')));
  assert.ok(pdf.includes('class="viewer-doc viewer-pages"') && pdf.includes('data-kind=pdf'), 'a PDF is a view of pages');
  assert.ok(pdf.includes('2 pages') && pdf.includes('aria-label="Zoom in"') && pdf.includes('aria-label="Zoom out"') && pdf.includes('100%'), 'with its page count and zoom');
  assert.ok(pdf.includes('aria-label=Open booking.pdf in another app') && pdf.includes('Open in') && pdf.includes('aria-label=Save booking.pdf'), 'Open in and Save sit in the bar');
  assert.ok(!pdf.includes('viewer-prev') && !pdf.includes('<img'), 'a document is not one of the media to step through');
  const text = words(viewer.render.call(host('text', { docText: 'a,b\n1,2' })));
  assert.ok(text.includes('<pre class="viewer-text">a,b\n1,2</pre>') && !text.includes('Zoom in'), 'text is shown as text, with no zoom of its own');
  const audio = words(viewer.render.call(host('audio', { src: 'blob:a' })));
  assert.ok(audio.includes('<audio class="viewer-audio"') && audio.includes('controls'), 'audio gets a player');
  const failed = words(viewer.render.call(host('pdf', { docState: 'failed' })));
  assert.ok(failed.includes('could not be shown here') && failed.includes('Open in'), 'a file the viewer cannot read says so, and Open in still offers it');
});

test('pdf.js is bundled: loaded from the app, its worker from the app, and pinned', () => {
  const kit = readFileSync(new URL('../kit/pdf.js', import.meta.url), 'utf8');
  assert.match(kit, /import\(VENDOR \+ 'pdf\.min\.js'\)/, 'the library is the vendored copy');
  assert.match(kit, /workerSrc = new URL\(VENDOR \+ 'pdf\.worker\.min\.js', import\.meta\.url\)/, 'the worker is the vendored copy beside it');
  assert.ok(!/https?:\/\//.test(kit), 'nothing is fetched from the network');
  const readme = readFileSync(new URL('../kit/vendor/README.md', import.meta.url), 'utf8');
  assert.match(readme, /pdf\.js 6\.4\.299/);
  assert.match(readme, /Apache-2\.0/, 'the licence is noted');
  assert.ok(readFileSync(new URL('../kit/vendor/pdfjs/LICENSE', import.meta.url), 'utf8').includes('Apache License'), 'and shipped beside it');
});
