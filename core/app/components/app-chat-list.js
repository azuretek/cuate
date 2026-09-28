import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { chatTitle, chatPreview, initials } from '../rules/chats.js';
import { formatListTime } from '../rules/time.js';

class AppChatList extends KitElement {
  static properties = { chats: { attribute: false }, selected: {} };

  constructor() {
    super();
    this.chats = [];
    this.selected = null;
  }

  pick(id) {
    this.dispatchEvent(new CustomEvent('select', { detail: id }));
  }

  key(e, id) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.pick(id);
    }
  }

  render() {
    const now = Date.now();
    const locale = navigator.language;
    return html`<ul class="chat-list" role="listbox" aria-label="Conversations">${this.chats.map((c) => {
      const title = chatTitle(c);
      const sel = c.id === this.selected;
      return html`<li class=${'chat-row' + (sel ? ' selected' : '') + (c.unread ? ' unread' : '')} role="option" tabindex="0" aria-selected=${sel ? 'true' : 'false'} data-chat=${c.id} @click=${() => this.pick(c.id)} @keydown=${(e) => this.key(e, c.id)}>
        <span class="avatar" aria-hidden="true">${initials(title)}</span>
        <span class="chat-main">
          <span class="chat-top"><span class="chat-name">${title}</span><span class="chat-time">${formatListTime(c.lastMessageAt, { now, locale })}</span></span>
          <span class="chat-preview">${chatPreview(c)}</span>
        </span>
        ${c.unread ? html`<span class="unread-dot" role="img" aria-label=${c.unread + ' unread'}></span>` : nothing}
      </li>`;
    })}</ul>`;
  }
}

customElements.define('app-chat-list', AppChatList);
