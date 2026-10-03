import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { press, emit } from '../../kit/press.js';
import { keepScroll } from '../../kit/scroll.js';
import {
  chatTitle, chatPreview, initials, sortChats, filterChats, groupSections, emptyFilters, emptyListText,
  UNGROUPED, renameGroup, moveGroup, placeChat,
} from '../rules/chats.js';
import { formatListTime } from '../rules/time.js';

// The chat list: it draws the chats sorted, filtered and gathered into the person's groups. It holds no state of its
// own: a sort, a group or a placement is sent up to the page, which writes it to the server, and the page hands the
// server's own answer back here to draw. In edit mode each row carries a checkbox and a click checks the row instead
// of opening it; the selection itself lives with the page, so the header can select all and act on the count.
class AppChatList extends KitElement {
  static properties = {
    chats: { attribute: false }, selected: {}, texts: { attribute: false },
    sort: {}, groups: { attribute: false }, placement: { attribute: false },
    filters: { attribute: false }, editing: { attribute: false }, checked: { attribute: false },
  };

  constructor() {
    super();
    this.chats = [];
    this.selected = null;
    this.sort = 'recent';
    this.groups = [];
    this.placement = {};
    this.texts = {};
    this.filters = emptyFilters();
    this.editing = false;
    this.checked = [];
    this.renaming = null;
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

  patch(settings) { return this.fire('chatsettings', { patch: settings }); }

  startRename(id) {
    this.renaming = id;
    this.updateComplete.then(() => {
      const el = this.querySelector('.group-rename');
      if (el) { el.focus(); if (el.select) el.select(); }
    });
  }

  commitRename(e) {
    const el = e.currentTarget;
    const id = el.dataset.id;
    if (this.renaming !== id) return;
    const name = String(el.value || '').trim();
    this.renaming = null;
    if (name) this.patch({ 'chats.groups': renameGroup(this.groups, id, name) });
  }

  onRenameKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); this.commitRename(e); }
    else if (e.key === 'Escape') { e.preventDefault(); this.renaming = null; }
  }

  moveGroupBy(section, delta) { return this.patch({ 'chats.groups': moveGroup(this.groups, section.id, delta) }); }
  setPlacement(chatId, groupId) { return this.patch({ 'chats.placement': placeChat(this.placement, chatId, groupId) }); }

  sectionHead(section) {
    if (section.id === UNGROUPED) return html`<header class="section-head"><span class="section-name">${section.name}</span></header>`;
    const i = (this.groups || []).findIndex((g) => g.id === section.id);
    return html`<header class="section-head">
      ${this.renaming === section.id
        ? html`<input class="group-rename" data-id=${section.id} .value=${section.name} aria-label="Group name" @keydown=${this.onRenameKey} @blur=${this.commitRename}>`
        : html`<span class="section-name">${section.name}</span>`}
      <span class="section-actions">
        <button type="button" class="icon-button" aria-label=${'Move ' + section.name + ' up'} ?disabled=${i <= 0} @click=${press(() => this.moveGroupBy(section, -1))}><span class="icon" data-icon="chevron-up" aria-hidden="true"></span></button>
        <button type="button" class="icon-button" aria-label=${'Move ' + section.name + ' down'} ?disabled=${i >= (this.groups.length - 1)} @click=${press(() => this.moveGroupBy(section, 1))}><span class="icon" data-icon="chevron-down" aria-hidden="true"></span></button>
        <button type="button" class="icon-button" aria-label=${'Rename ' + section.name} @click=${press(() => this.startRename(section.id))}><span class="icon" data-icon="pencil" aria-hidden="true"></span></button>
        ${this.editing ? html`<button type="button" class="icon-button" aria-label=${'Delete ' + section.name} @click=${press(() => this.fire('groupdelete', { id: section.id, name: section.name }))}><span class="icon" data-icon="x" aria-hidden="true"></span></button>` : nothing}
      </span>
    </header>`;
  }

  row(c, now, locale) {
    const title = chatTitle(c);
    const editing = this.editing === true;
    const checked = editing && this.checkedIds.includes(c.id);
    const sel = !editing && c.id === this.selected;
    const groups = this.groups || [];
    const placed = (this.placement || {})[c.id] || UNGROUPED;
    return html`<li class=${'chat-row' + (sel ? ' selected' : '') + (checked ? ' checked' : '') + (c.unread ? ' unread' : '')} role="option" tabindex="0" aria-selected=${(editing ? checked : sel) ? 'true' : 'false'} data-chat=${c.id} @click=${() => this.activate(c.id)} @keydown=${(e) => this.key(e, c.id)}>
      ${editing ? html`<input type="checkbox" class="chat-check" aria-label=${'Select ' + title} .checked=${checked} @click=${(e) => e.stopPropagation()} @change=${(e) => this.toggleCheck(c.id, e.currentTarget.checked)}>` : nothing}
      <span class="avatar" aria-hidden="true">${initials(title)}</span>
      <span class="chat-main">
        <span class="chat-top"><span class="chat-name">${title}</span><span class="chat-time">${formatListTime(c.lastMessageAt, { now, locale })}</span></span>
        <span class="chat-preview">${chatPreview(c)}</span>
      </span>
      ${!editing && c.unread ? html`<span class="unread-dot" role="img" aria-label=${c.unread + ' unread'}></span>` : nothing}
      ${!editing && groups.length ? html`<select class="row-group" aria-label=${'Group for ' + title} @click=${(e) => e.stopPropagation()} @keydown=${(e) => e.stopPropagation()} @change=${(e) => this.setPlacement(c.id, e.currentTarget.value)}>
        <option value=${UNGROUPED} ?selected=${placed === UNGROUPED}>No group</option>
        ${groups.map((g) => html`<option value=${g.id} ?selected=${placed === g.id}>${g.name}</option>`)}
      </select>` : nothing}
    </li>`;
  }

  section(section, split, now, locale) {
    if (split && section.id === UNGROUPED && !section.chats.length) return nothing;
    const body = section.chats.length
      ? html`<ul class="chat-list" role="listbox" aria-label=${section.name}>${section.chats.map((c) => this.row(c, now, locale))}</ul>`
      : html`<p class="section-empty" role="status">Nothing in ${section.name}.</p>`;
    if (!split) return body;
    return html`<section class="chat-section">${this.sectionHead(section)}${body}</section>`;
  }

  render() {
    const now = Date.now();
    const locale = navigator.language;
    const groups = this.groups || [];
    const placement = this.placement || {};
    const sorted = sortChats(this.chats, { sort: this.sort || 'recent', locale });
    const visible = filterChats(sorted, this.f, { placement, texts: this.texts || {} });
    const sections = groupSections(visible, { groups, placement });
    const split = groups.length > 0;
    return html`${visible.length === 0
        ? html`<p class="list-empty" role="status">${emptyListText(this.f)}</p>`
        : html`<div class="chat-sections">${sections.map((s) => this.section(s, split, now, locale))}</div>`}`;
  }
}

customElements.define('app-chat-list', AppChatList);
