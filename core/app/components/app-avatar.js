import { html } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { heldMedia, holdMedia } from './app-attachment.js';
import { initials } from '../rules/chats.js';

// A conversation's avatar (issue 341): the group's own photo when it has one, else the initials of its title. The
// photo is fetched once and held with the conversation's other pictures, so a list that re-renders draws it at once; a
// photo that cannot be read falls back to the initials rather than an empty circle.
class AppAvatar extends KitElement {
  static properties = { title: {}, photo: { attribute: false }, client: { attribute: false }, src: { state: true } };

  constructor() {
    super();
    this.title = '';
    this.photo = null;
    this.client = null;
    this.src = '';
  }

  willUpdate(changed) {
    if (changed.has('photo') && changed.get('photo')?.id !== this.photo?.id) this.src = this.photo ? heldMedia(this.photo) : '';
  }

  updated(changed) {
    if ((changed.has('photo') || changed.has('client')) && this.photo && !this.src) this.load();
  }

  async load() {
    const p = this.photo;
    if (!p || !this.client || this.loading === p.id) return;
    this.loading = p.id;
    try {
      const blob = await this.client.attachment(p.id);
      const url = heldMedia(p) || URL.createObjectURL(blob);
      holdMedia(p, url);
      if (this.photo?.id === p.id) this.src = url;
    } catch {
      // The initials stand in.
    } finally {
      this.loading = null;
    }
  }

  render() {
    return this.src
      ? html`<span class="avatar photo" aria-hidden="true"><img src=${this.src} alt=""></span>`
      : html`<span class="avatar" aria-hidden="true">${initials(this.title)}</span>`;
  }
}

customElements.define('app-avatar', AppAvatar);
