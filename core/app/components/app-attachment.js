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
    if (!a || a.missing || !isImage(a) || !this.client) return;
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

  render() {
    const a = this.attachment;
    if (!a) return nothing;
    if (isImage(a) && !a.missing && !this.failed) {
      return this.src
        ? html`<img class=${'attachment-image' + (a.sticker ? ' sticker' : '')} src=${this.src} alt=${a.name} @load=${this.loaded}>`
        : html`<div class="attachment-image placeholder" role="img" aria-label="Loading image"></div>`;
    }
    return html`<div class="attachment-file"><span class="attachment-name">${a.name}</span>${a.missing ? html`<span class="muted small"> Not on the Mac</span>` : nothing}</div>`;
  }
}

customElements.define('app-attachment', AppAttachment);
