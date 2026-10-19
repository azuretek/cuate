import { html } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { loadQueue } from '../../kit/load-order.js';
import { heldMedia, holdMedia, fetchPicture, canFetchPicture } from './app-attachment.js';
import { initials } from '../rules/chats.js';

// A conversation's avatar (issue 341): the group's own photo when it has one, else the initials of its title. The
// photo is fetched once and held with the conversation's other pictures, so a list that re-renders draws it at once; a
// photo that cannot be read falls back to the initials rather than an empty circle.
//
// The photo is fetched in the order the person sees it (issue 426), through the page's one load queue: an avatar on
// screen first, one a screen away once the screen is done, and one further out never, so a fresh start does not ask
// for every group photo in a long list, nor for the ones behind an open conversation on a phone. An avatar scrolled out
// of reach before its photo lands is cancelled and keeps its initials until it comes back.
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
    if (!changed.has('photo') && !changed.has('client')) return;
    if (this.photo && !this.src) this.fetchWhenSeen();
    else this.stopFetch();
  }

  connectedCallback() {
    super.connectedCallback();
    if (this.hasUpdated && this.photo && !this.src) this.fetchWhenSeen();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.stopFetch();
  }

  // One request per photo: a render that hands over the same photo again leaves the one already queued alone.
  fetchWhenSeen() {
    const p = this.photo;
    if (!p || !canFetchPicture(this.client) || this.asking === p.id) return;
    this.stopFetch();
    this.asking = p.id;
    if (!this.isConnected) {
      this.load();
      return;
    }
    // The element draws no box of its own (display: contents), and an observer never sees an element with none, so the
    // queue watches the circle it renders.
    const face = this.querySelector?.(':scope > .avatar') || this;
    this.ticket = loadQueue().request(face, (signal) => this.load(signal));
  }

  stopFetch() {
    this.ticket?.cancel();
    this.ticket = null;
    this.asking = null;
  }

  async load(signal) {
    const p = this.photo;
    if (!p || !canFetchPicture(this.client)) return;
    try {
      const blob = await fetchPicture(this.client, p, signal);
      if (signal?.aborted) return;
      const url = heldMedia(p) || URL.createObjectURL(blob);
      holdMedia(p, url);
      if (this.photo?.id === p.id) this.src = url;
    } catch {
      // The initials stand in, and a fetch the queue cancelled is asked for again when the avatar comes back.
    } finally {
      if (!signal?.aborted && this.asking === p.id) this.asking = null;
    }
  }

  render() {
    return this.src
      ? html`<span class="avatar photo" aria-hidden="true"><img src=${this.src} alt=""></span>`
      : html`<span class="avatar" aria-hidden="true">${initials(this.title)}</span>`;
  }
}

customElements.define('app-avatar', AppAvatar);
