import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { press, emit, respond } from '../../kit/press.js';
import { keepScroll } from '../../kit/scroll.js';
import { chatTitle, initials } from '../rules/chats.js';
import { groupMessages, deliveryLabel, summarizeReactions } from '../rules/messages.js';
import { formatSeparator } from '../rules/time.js';
import { windowControlsHtml } from './window-controls.js';
import './app-composer.js';
import './app-attachment.js';

class AppConversation extends KitElement {
  static properties = { chat: { attribute: false }, messages: { attribute: false }, hasMore: {}, sending: {}, uploadMaxBytes: {}, client: { attribute: false }, windowControls: { attribute: false }, maximized: {} };

  constructor() {
    super();
    this.messages = [];
    this.hasMore = false;
    this.sending = false;
    // What the contact header draws for the platform, and the window's own state for the middle button's glyph, both
    // handed down from the page. A phone passes neither, so the header draws no window controls there.
    this.windowControls = null;
    this.maximized = false;
    // The conversation follows its latest message while it is there, and otherwise stays on the message it was on,
    // through new messages, older ones loading above, a picture loading, a resize and a new text size (issue 142).
    this.keep = keepScroll(this, { scroller: '.messages', items: '.bubble-row', follow: true });
  }

  // The page may answer with the work it started, which the press that raised the event shows (core/kit/press.js).
  fire(name, detail) {
    return emit(this, name, detail);
  }

  // Another conversation starts at its latest message.
  willUpdate(changed) {
    if (changed.has('chat') && changed.get('chat')?.id !== this.chat?.id) this.keep.reset();
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
    return html`<header class="conv-head"><button class="conv-back" aria-label="Conversations" @click=${press(() => this.fire('back'))}>←</button><span class="avatar" aria-hidden="true">${initials(title)}</span><div class="conv-title"><div class="chat-name">${title}</div>${detail ? html`<div class="muted small">${detail}</div>` : nothing}</div>${this.windowControls && this.windowControls.drawn ? windowControlsHtml({ order: this.windowControls.order, maximized: this.maximized, onAction: (name) => this.fire('window-action', name) }) : nothing}</header>
      <div class="messages" role="log" aria-live="polite">
        ${this.hasMore ? html`<button class="load-older" @click=${press(() => this.fire('older'))}>Load earlier messages</button>` : nothing}
        ${items.map((it) => (it.kind === 'separator' ? html`<div class="separator">${formatSeparator(it.at, { now, locale })}</div>` : this.bubble(it, lastMine, sms)))}
      </div>
      <app-composer .disabled=${!this.sending} .maxBytes=${this.uploadMaxBytes} .placeholder=${this.sending ? 'Message' : 'Sending is off on the server'} @send=${(e) => respond(e, this.fire('send', e.detail))}></app-composer>`;
  }
}

customElements.define('app-conversation', AppConversation);
