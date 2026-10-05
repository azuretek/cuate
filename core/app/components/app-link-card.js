import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { press } from '../../kit/press.js';
import './app-attachment.js';

// A plugin payload drawn as the link it is (issue 238): the site read as a domain, the URL, and the title and picture
// the payload itself carried. The picture is one of our own stored attachments, read from the server, so nothing is
// fetched from a third party to decorate a message on render; opening the link stays the reader's own action.
//
// When the link is playable (issue 243) the card is the player surface, and it is still one object: the same still,
// the same site and URL, but a press opens the app's own viewer, which owns its controls, instead of leaving for the
// site. The viewer asks the server for the media, so the client never reaches the third party and nothing is fetched
// until a person presses play. A payload that carries the video itself plays through the attachment's own preview,
// with no server involved. A link we cannot play is a plain card, exactly as issue 238 left it.
class AppLinkCard extends KitElement {
  static properties = { link: { attribute: false }, client: { attribute: false } };

  // The player surface's own press: a link with no picture to press has a play button, and it goes through the kit so
  // a double press is one play.
  play() {
    const l = this.link;
    if (!l) return undefined;
    this.dispatchEvent(new CustomEvent('play-link', { bubbles: true, composed: true, detail: { url: l.url, site: l.site, poster: l.image || null } }));
    return undefined;
  }

  render() {
    const l = this.link;
    if (!l) return nothing;
    const title = String(l.title || '').trim();
    const preview = l.video || l.image;
    const playable = Boolean(l.play || l.video);
    const body = html`<span class="link-card-body">
        <span class="link-card-site">${l.site || l.url}</span>
        ${title ? html`<span class="link-card-title">${title}</span>` : nothing}
        <span class="link-card-url">${l.url}</span>
      </span>`;
    // A video we hold plays through the attachment's preview; a link we do not hold hands the viewer the link so it
    // loads the server's copy; no picture leaves a play button drawing the body.
    const media = preview ? html`<span class="link-card-image"><app-attachment .attachment=${preview} .client=${this.client} .linkUrl=${l.play && !l.video ? l.url : ''}></app-attachment></span>` : nothing;
    const classes = 'link-card' + (preview ? ' has-image' : '') + (playable ? ' playable' : '');
    if (playable) {
      const inner = preview ? html`${media}${body}` : html`<button type="button" class="link-card-play" @click=${press(() => this.play())} aria-label=${'Play ' + (l.site || l.url)}>${body}</button>`;
      return html`<div class=${classes} @click=${(e) => e.stopPropagation()}>${inner}</div>`;
    }
    return html`<a class=${classes} href=${l.url} target="_blank" rel="noopener noreferrer" @click=${(e) => e.stopPropagation()}>${media}${body}</a>`;
  }
}

customElements.define('app-link-card', AppLinkCard);
