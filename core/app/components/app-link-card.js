import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import './app-attachment.js';

// A plugin payload drawn as the link it is (issue 238): the site read as a domain, the URL, and the title and picture
// the payload itself carried. The picture is one of our own stored attachments, read from the server, so nothing is
// fetched from a third party to decorate a message on render; opening the link stays the reader's own action.
class AppLinkCard extends KitElement {
  static properties = { link: { attribute: false }, client: { attribute: false } };

  render() {
    const l = this.link;
    if (!l) return nothing;
    const title = String(l.title || '').trim();
    return html`<a class=${'link-card' + (l.image ? ' has-image' : '')} href=${l.url} target="_blank" rel="noopener noreferrer" @click=${(e) => e.stopPropagation()}>
      ${l.image ? html`<span class="link-card-image"><app-attachment .attachment=${l.image} .client=${this.client}></app-attachment></span>` : nothing}
      <span class="link-card-body">
        <span class="link-card-site">${l.site || l.url}</span>
        ${title ? html`<span class="link-card-title">${title}</span>` : nothing}
        <span class="link-card-url">${l.url}</span>
      </span>
    </a>`;
  }
}
customElements.define('app-link-card', AppLinkCard);
