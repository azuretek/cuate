// A PDF is freed through its loading task, the way the vendored pdf.js 6 has it (issue 408). Its document object has no
// destroy(), so the viewer's doc.destroy() threw on every PDF it left: show() stopped before the next item loaded, and
// a close stopped before the viewer released its requests, its blob URLs and the reader's focus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const defined = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { defined[name] = cls; }, get() {} };
globalThis.document = { createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
await import('../app/components/app-image-viewer.js');
const proto = defined['app-image-viewer'].prototype;

// A document shaped as pdf.js 6.4.299 shapes one: destroy() lives on its loading task, never on the document.
function pdfDocument() {
  const task = { destroyed: false, destroy() { this.destroyed = true; return Promise.resolve(); } };
  return { numPages: 1, loadingTask: task, getPage: async () => ({}) };
}

function viewer(client) {
  const value = { client, items: [{ id: 'pdf', attachmentId: 'pdf', kind: 'pdf' }, { id: 'next', attachmentId: 'next', kind: 'image' }], index: 0, isConnected: true,
    urls: new Map(), loadingMedia: new Map(), mediaRequests: new Map(), updateComplete: Promise.resolve(), isDocument: (item) => item?.kind === 'pdf' };
  for (const name of ['closeDocument', 'load', 'loadMedia', 'neighbourItems', 'pruneMedia', 'warmNeighbours', 'show', 'growDocument', 'loadDocument']) value[name] = proto[name];
  value.growDocument = () => {};
  return value;
}

test('closing a PDF frees it through its loading task and never throws (issue 408)', () => {
  const value = viewer();
  const doc = pdfDocument();
  value.pdf = doc;
  assert.doesNotThrow(() => value.closeDocument());
  assert.equal(value.pdf, null);
  assert.equal(doc.loadingTask.destroyed, true, 'the loading task, which owns the worker, is destroyed');
});

test('moving from a PDF to the next item still loads that item (issue 408)', async () => {
  const requested = [];
  const value = viewer({ attachment: async (id) => { requested.push(id); return new Blob(['synthetic-' + id], { type: 'image/png' }); } });
  value.pdf = pdfDocument();
  await value.show(1);
  assert.ok(requested.includes('next'), 'the next item was asked for: ' + JSON.stringify(requested));
  for (const url of value.urls.values()) URL.revokeObjectURL(url);
});

test('the stand-in has the vendored pdf.js document shape: no destroy() of its own, a loading task that has one (issue 408)', () => {
  const bundle = readFileSync(new URL('../kit/vendor/pdfjs/pdf.min.js', import.meta.url), 'utf8');
  const body = (name) => { const at = bundle.indexOf('class ' + name + '{'); assert.ok(at >= 0, name + ' is in the bundle'); return bundle.slice(at, bundle.indexOf('class ', at + 10)); };
  const docClass = body('PDFDocumentProxy');
  assert.doesNotMatch(docClass, /[{}]destroy\(/, 'PDFDocumentProxy has no destroy()');
  assert.match(docClass, /get loadingTask\(\)/, 'a document reaches its loading task');
  assert.match(body('PDFDocumentLoadingTask'), /async destroy\(\)/, 'the loading task destroys');
});
