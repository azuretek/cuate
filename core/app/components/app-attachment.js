import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';

const isImage = (a) => /^image\//i.test(a.mime);
const needsJpeg = (a) => /heic|heif/i.test(a.mime);

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

  async load() {
    const a = this.attachment;
    if (!a || a.local || a.missing || !isImage(a) || !this.client) return;
    try {
      const blob = await this.client.attachment(a.id, { format: needsJpeg(a) ? 'jpeg' : undefined });
      if (this.attachment === a) this.src = URL.createObjectURL(blob);
    } catch {
      this.failed = true;
    }
  }

  loaded() {
    this.dispatchEvent(new CustomEvent('media-loaded', { bubbles: true }));
  }

  // Pressing a preview opens it in the viewer, which the page draws over everything (app-image-viewer).
  open() {
    if (!this.src) return;
    this.dispatchEvent(new CustomEvent('view-image', { bubbles: true, composed: true, detail: { src: this.src, alt: this.attachment?.name || '' } }));
  }

  render() {
    const a = this.attachment;
    if (!a) return nothing;
    if (isImage(a) && !a.local && !a.missing && !this.failed) {
      // A sticker is drawn as it is, on the bubble's background; a picture is a preview at its own aspect ratio, sized
      // to fit, dressed with a shadow, a rounded edge and a hairline border, and pressing it opens the viewer.
      if (this.src && a.sticker) return html`<img class="attachment-image sticker" src=${this.src} alt=${a.name} @load=${this.loaded}>`;
      return this.src
        ? html`<button type="button" class="attachment-preview" aria-label=${'Open ' + a.name} @click=${() => this.open()}><img class="attachment-image" src=${this.src} alt=${a.name} @load=${this.loaded}></button>`
        : html`<div class="attachment-image placeholder" role="img" aria-label="Loading image"></div>`;
    }
    return html`<div class="attachment-file"><span class="attachment-name">${a.name}</span>${a.missing ? html`<span class="muted small"> Not on the Mac</span>` : nothing}</div>`;
  }
}

customElements.define('app-attachment', AppAttachment);
