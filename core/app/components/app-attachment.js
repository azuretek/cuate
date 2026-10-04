import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { press } from '../../kit/press.js';

const isImage = (a) => /^image\//i.test(a.mime);
const needsJpeg = (a) => /heic|heif/i.test(a.mime);

// A document (a PDF or any other file that is not a picture) is saved rather than viewed (issue 219): the page hands
// the shell the file's bytes under its real name, and the shell offers to keep it, a save dialog on the desktop and the
// share or save sheet on a phone. A page with no shell (a plain browser) downloads it under that name.
export function bytesToBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

export async function saveAttachment(a, { client, bridge = globalThis.window?.bridge, doc = globalThis.document } = {}) {
  if (!a || a.local || a.missing || !client) return false;
  const blob = await client.attachment(a.id);
  const name = String(a.name || 'Attachment');
  const mime = String(a.mime || blob.type || 'application/octet-stream');
  if (bridge && typeof bridge.call === 'function') {
    const data = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
    return bridge.call('file.save', { name, mime, data });
  }
  const href = URL.createObjectURL(blob);
  try {
    const link = doc.createElement('a');
    link.href = href;
    link.download = name;
    link.click();
    return true;
  } finally {
    setTimeout(() => URL.revokeObjectURL(href), 0);
  }
}

class AppAttachment extends KitElement {
  static properties = { attachment: { attribute: false }, client: { attribute: false }, src: { state: true }, failed: { state: true } };

  constructor() {
    super();
    this.src = '';
    this.failed = false;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.release();
  }

  release() {
    if (this.src) URL.revokeObjectURL(this.src);
    this.src = '';
  }

  updated(changed) {
    if (changed.has('attachment') && changed.get('attachment')?.id !== this.attachment?.id) {
      this.release();
      this.failed = false;
      this.load();
    }
  }

  // A load lands while the element still shows the attachment it asked for, matched by id as updated() matches it: a
  // resync refetches the open conversation in place, so the same attachment arrives as a new object mid-load, and an
  // identity check dropped the blob with no second load to replace it, leaving the placeholder up for good.
  async load() {
    const a = this.attachment;
    if (!a || a.local || a.missing || !isImage(a) || !this.client) return;
    try {
      const blob = await this.client.attachment(a.id, { format: needsJpeg(a) ? 'jpeg' : undefined });
      if (this.attachment?.id === a.id) this.src = URL.createObjectURL(blob);
    } catch {
      if (this.attachment?.id === a.id) this.failed = true;
    }
  }

  // Pressing a preview opens it in the viewer, which the page draws over everything (app-image-viewer).
  open() {
    if (!this.src) return;
    this.dispatchEvent(new CustomEvent('view-image', { bubbles: true, composed: true, detail: { src: this.src, alt: this.attachment?.name || '' } }));
  }

  // Pressing a document offers to save it under its real name. The press stops here, so the message it sits in never
  // takes it as a press of its own (a thread reply's text opens its thread; an attachment never does).
  save(e) {
    e?.stopPropagation?.();
    return saveAttachment(this.attachment, { client: this.client });
  }

  render() {
    const a = this.attachment;
    if (!a) return nothing;
    if (isImage(a) && !a.local && !a.missing && !this.failed) {
      // A sticker is drawn as it is, on the bubble's background; a picture is a preview at its own aspect ratio, sized
      // to fit, dressed with a shadow, a rounded edge and a hairline border, and pressing it opens the viewer.
      if (this.src && a.sticker) return html`<img class="attachment-image sticker" src=${this.src} alt=${a.name}>`;
      return this.src
        ? html`<button type="button" class="attachment-preview" aria-label=${'Open ' + a.name} @click=${press(() => this.open())}><img class="attachment-image" src=${this.src} alt=${a.name}></button>`
        : html`<div class="attachment-image placeholder" role="img" aria-label="Loading image"></div>`;
    }
    if (a.missing || a.local || !this.client) return html`<div class="attachment-file"><span class="attachment-name">${a.name}</span>${a.missing ? html`<span class="muted small"> Not on the Mac</span>` : nothing}</div>`;
    return html`<button type="button" class="attachment-file" aria-label=${'Save ' + a.name} title=${'Save ' + a.name} @click=${press((e) => this.save(e))}><span class="icon" data-icon="download" aria-hidden="true"></span><span class="attachment-name">${a.name}</span></button>`;
  }
}

customElements.define('app-attachment', AppAttachment);
