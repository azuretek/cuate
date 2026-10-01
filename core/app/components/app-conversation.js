import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { chatTitle, initials } from '../rules/chats.js';
import { groupMessages, deliveryLabel, summarizeReactions } from '../rules/messages.js';
import { formatSeparator } from '../rules/time.js';
import './app-composer.js';
import './app-attachment.js';

class AppConversation extends KitElement {
  static properties = { chat: { attribute: false }, messages: { attribute: false }, hasMore: {}, loadingOlder: {}, sending: {}, client: { attribute: false } };

  constructor() {
    super();
    this.messages = [];
    this.hasMore = false;
    this.loadingOlder = false;
    this.sending = false;
    this.stick = true;
  }

  fire(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  list() {
    return this.querySelector('.messages');
  }

  willUpdate(changed) {
    const el = this.list();
    this.before = el ? { h: el.scrollHeight, top: el.scrollTop } : null;
    if (changed.has('chat') && changed.get('chat')?.id !== this.chat?.id) this.stick = true;
  }

  updated(changed) {
    if (!changed.has('messages')) return;
    const el = this.list();
    if (!el) return;
    const prev = changed.get('messages') || [];
    const cur = this.messages || [];
    const lastChanged = !prev.length || !cur.length || prev[prev.length - 1].id !== cur[cur.length - 1].id;
    if (lastChanged) {
      if (this.stick) el.scrollTop = el.scrollHeight;
    } else if (this.before && cur.length > prev.length) {
      el.scrollTop = this.before.top + (el.scrollHeight - this.before.h);
    }
  }

  onScroll(e) {
    const el = e.currentTarget;
    this.stick = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  onMedia() {
    const el = this.list();
    if (el && this.stick) el.scrollTop = el.scrollHeight;
  }

  bubble(it, lastMine, sms) {
    const m = it.message;
    const mine = m.fromMe;
    const row = ['bubble-row', mine ? 'mine' : 'theirs', it.first ? 'first' : '', it.last ? 'last' : ''].filter(Boolean).join(' ');
    const kind = mine ? (sms ? 'sms' : 'me') : 'them';
    const label = mine && (m.state || m === lastMine) ? deliveryLabel(m) : '';
    return html`<div class=${row} data-id=${m.id}>
      ${!mine && this.chat.isGroup && it.first ? html`<div class="sender">${m.senderName || m.sender || ''}</div>` : nothing}
      ${m.attachments.map((a) => html`<app-attachment .attachment=${a} .client=${this.client}></app-attachment>`)}
      ${m.text ? html`<div class=${'bubble ' + kind + (m.state ? ' state-' + m.state : '')}>${m.text}</div>` : nothing}
      ${m.reactions.length ? html`<div class="reactions">${summarizeReactions(m.reactions).map((r) => html`<span class="reaction">${r.glyph}${r.count > 1 ? ' ' + r.count : ''}</span>`)}</div>` : nothing}
      ${label ? html`<div class="delivery">${label}${m.note ? ' \u00b7 ' + m.note : ''}</div>` : nothing}
    </div>`;
  }

  render() {
    const now = Date.now();
    const locale = navigator.language;
    const items = groupMessages(this.messages || []);
    const lastMine = [...(this.messages || [])].reverse().find((m) => m.fromMe) || null;
    const sms = this.chat.service === 'SMS' || this.chat.service === 'RCS';
    const title = chatTitle(this.chat);
    const detail = this.chat.isGroup ? this.chat.participants.length + ' people' : '';
    return html`<header class="conv-head"><button class="conv-back" aria-label="Conversations" @click=${() => this.fire('back')}>←</button><span class="avatar" aria-hidden="true">${initials(title)}</span><div class="conv-title"><div class="chat-name">${title}</div>${detail ? html`<div class="muted small">${detail}</div>` : nothing}</div></header>
      <div class="messages" role="log" aria-live="polite" @scroll=${this.onScroll} @media-loaded=${this.onMedia}>
        ${this.hasMore ? html`<button class="load-older" ?disabled=${this.loadingOlder} @click=${() => this.fire('older')}>${this.loadingOlder ? 'Loading\u2026' : 'Load earlier messages'}</button>` : nothing}
        ${items.map((it) => (it.kind === 'separator' ? html`<div class="separator">${formatSeparator(it.at, { now, locale })}</div>` : this.bubble(it, lastMine, sms)))}
      </div>
      <app-composer .disabled=${!this.sending} .placeholder=${this.sending ? 'Message' : 'Sending is off on the server'} @send=${(e) => this.fire('send', e.detail)}></app-composer>`;
  }
}

customElements.define('app-conversation', AppConversation);
