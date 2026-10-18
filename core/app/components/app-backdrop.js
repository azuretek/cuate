import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { heldMedia, holdMedia, fetchPicture, canFetchPicture } from './app-attachment.js';

// A conversation's backdrop (issue 417): the background a participant set for it, drawn behind the messages and never
// as a picture in the timeline. The picture is fetched once and held with the conversation's other pictures, so a
// conversation that re-renders draws it at once; one that cannot be read leaves the surface as it was.
class AppBackdrop extends KitElement {
  static properties = { picture: { attribute: false }, client: { attribute: false }, src: { state: true } };

  constructor() {
    super();
    this.picture = null;
    this.client = null;
    this.src = '';
  }

  willUpdate(changed) {
    if (changed.has('picture') && changed.get('picture')?.id !== this.picture?.id) this.src = this.picture ? heldMedia(this.picture) || '' : '';
  }

  updated(changed) {
    if ((changed.has('picture') || changed.has('client')) && this.picture && !this.src) this.load();
    this.toggleAttribute('drawn', Boolean(this.src));
  }

  async load() {
    const p = this.picture;
    if (!p || !canFetchPicture(this.client) || this.loading === p.id) return;
    this.loading = p.id;
    try {
      const blob = await fetchPicture(this.client, p);
      const url = heldMedia(p) || URL.createObjectURL(blob);
      holdMedia(p, url);
      if (this.picture?.id === p.id) this.src = url;
    } catch {
      // The surface stands in.
    } finally {
      this.loading = null;
    }
  }

  render() {
    return this.src ? html`<img class="conv-backdrop-picture" src=${this.src} alt="" draggable="false">` : nothing;
  }
}

customElements.define('app-backdrop', AppBackdrop);
