import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { emit } from '../../kit/press.js';
import { keepScroll } from '../../kit/scroll.js';
import {
  chatTitle, chatPreview, initials, sortChats, filterChats, listSections, emptyFilters, emptyListText,
} from '../rules/chats.js';
import { formatListTime } from '../rules/time.js';

// The chat list: it draws the chats sorted, filtered and in the sections the sort gives them. A group is the message
// service's own group conversation and draws as one row like any other (issue 326). It holds no state of its own: the page hands it
// the server's own answer to draw. In edit mode each row carries a checkbox and a click checks the row instead
// of opening it; the selection itself lives with the page, so the header can select all and act on the count.
class AppChatList extends KitElement {
  static properties = {
    chats: { attribute: false }, selected: {}, texts: { attribute: false },
    sort: {},
    filters: { attribute: false }, editing: { attribute: false }, checked: { attribute: false },
  };

  constructor() {
    super();
    this.chats = [];
    this.selected = null;
    this.sort = 'recent';
    this.texts = {};
    this.filters = emptyFilters();
    this.editing = false;
    this.checked = [];
    // The list is its own scroll container, and keeps its place on a row across a re-render and a resize (issue 142).
    this.keep = keepScroll(this, { scroller: 'app-chat-list', items: '.chat-row' });
  }

  get f() {
    return this.filters || emptyFilters();
  }

  get checkedIds() {
    return Array.isArray(this.checked) ? this.checked : [];
  }

  // The page may answer with the work it started, which the press that raised the event shows (core/kit/press.js).
  fire(name, detail) {
    return emit(this, name, detail);
  }

  pick(id) {
    this.fire('select', id);
  }

  key(e, id) {
    // A control inside the row keeps its own keys; only the row itself acts.
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.activate(id);
    }
  }

  // In edit mode a row toggles its checkbox; otherwise it opens the conversation.
  activate(id) {
    if (this.editing) this.fire('check', { id, checked: !this.checkedIds.includes(id) });
    else this.pick(id);
  }

  toggleCheck(id, checked) {
    this.fire('check', { id, checked });
  }

  sectionHead(section) {
    return html`<header class="section-head"><span class="section-name">${section.name}</span></header>`;
  }

  row(c, now, locale) {
    const title = chatTitle(c);
    const editing = this.editing === true;
    const checked = editing && this.checkedIds.includes(c.id);
    const sel = !editing && c.id === this.selected;
    return html`<li class=${'chat-row' + (sel ? ' selected' : '') + (checked ? ' checked' : '') + (c.unread ? ' unread' : '')} role="option" tabindex="0" aria-selected=${(editing ? checked : sel) ? 'true' : 'false'} data-chat=${c.id} @click=${() => this.activate(c.id)} @keydown=${(e) => this.key(e, c.id)}>
      ${editing ? html`<input type="checkbox" class="chat-check" aria-label=${'Select ' + title} .checked=${checked} @click=${(e) => e.stopPropagation()} @change=${(e) => this.toggleCheck(c.id, e.currentTarget.checked)}>` : nothing}
      <span class="avatar" aria-hidden="true">${initials(title)}</span>
      <span class="chat-main">
        <span class="chat-top"><span class="chat-name">${title}</span><span class="chat-time">${formatListTime(c.lastMessageAt, { now, locale })}</span></span>
        <span class="chat-preview">${chatPreview(c)}</span>
      </span>
      ${!editing && c.unread ? html`<span class="unread-dot" role="img" aria-label=${c.unread + ' unread'}></span>` : nothing}
    </li>`;
  }

  section(section, split, now, locale) {
    const body = section.chats.length
      ? html`<ul class="chat-list" role="listbox" aria-label=${section.name}>${section.chats.map((c) => this.row(c, now, locale))}</ul>`
      : html`<p class="section-empty" role="status">Nothing in ${section.name}.</p>`;
    if (!split) return body;
    return html`<section class="chat-section">${this.sectionHead(section)}${body}</section>`;
  }

  render() {
    const now = Date.now();
    const locale = navigator.language;
    const sorted = sortChats(this.chats, { sort: this.sort || 'recent', locale });
    const visible = filterChats(sorted, this.f, { texts: this.texts || {} });
    // The sections follow the sort in force (issue 217). A single section draws as plain rows, so a small list gets no
    // more than the dividers.
    const sections = listSections(visible, { sort: this.sort || 'recent', now });
    const split = sections.length > 1;
    return html`${visible.length === 0
        ? html`<p class="list-empty" role="status">${emptyListText(this.f)}</p>`
        : html`<div class="chat-sections">${sections.map((s) => this.section(s, split, now, locale))}</div>`}`;
  }
}

customElements.define('app-chat-list', AppChatList);
