import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { press, runPress, emit, respond } from '../../kit/press.js';
import { keepScroll } from '../../kit/scroll.js';
import { chatTitle, initials } from '../rules/chats.js';
import { groupMessages, deliveryLabel, summarizeReactions, reactionGlyph, myReaction, replyQuote, canTarget, TAPBACKS } from '../rules/messages.js';
import { formatSeparator } from '../rules/time.js';
import { windowControlsHtml } from './window-controls.js';
import { loadRecentEmoji, rememberEmoji } from './app-emoji-picker.js';
import './app-composer.js';
import './app-attachment.js';

// How long a finger rests on a message before its menu opens, and how long a quoted parent stays lit after the
// quote is pressed. Interaction timings, not styles: the light itself is a token-driven animation in app.css.
const LONG_PRESS_MS = 500;
const FLASH_MS = 1600;
// How far a resting finger may drift and still be a long press rather than the start of a scroll, in CSS pixels.
const PRESS_SLOP = 10;

class AppConversation extends KitElement {
  static properties = {
    chat: { attribute: false }, messages: { attribute: false }, hasMore: {}, sending: {}, uploadMaxBytes: {}, client: { attribute: false }, windowControls: { attribute: false }, maximized: {},
    // The message whose reaction is with the server, and a line said under one message (a refused reaction), both
    // owned by the page.
    reacting: {}, note: { attribute: false },
    // The menu or the emoji panel open on one message ({ id, kind: 'menu' | 'picker', side }), the message being
    // replied to as the composer quotes it, and the parent a pressed quote lit.
    pop: { state: true }, replyingTo: { state: true }, flashId: { state: true }, frequent: { state: true },
  };

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
    this.reacting = null;
    this.note = null;
    this.pop = null;
    this.replyingTo = null;
    this.flashId = null;
    this.frequent = [];
    this.pressTimer = null;
    this.onDocKey = (e) => { if (e.key === 'Escape' && this.pop) this.closePop(); };
    this.onDocDown = (e) => { if (this.pop && !e.target.closest?.('.message-pop, .message-action')) this.closePop(); };
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('keydown', this.onDocKey);
    document.addEventListener('pointerdown', this.onDocDown, true);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this.onDocKey);
    document.removeEventListener('pointerdown', this.onDocDown, true);
    clearTimeout(this.pressTimer);
    clearTimeout(this.flashTimer);
  }

  // The page may answer with the work it started, which the press that raised the event shows (core/kit/press.js).
  fire(name, detail) {
    return emit(this, name, detail);
  }

  // Another conversation starts at its latest message.
  willUpdate(changed) {
    if (changed.has('chat') && changed.get('chat')?.id !== this.chat?.id) {
      this.keep.reset();
      this.pop = null;
      this.replyingTo = null;
    }
  }

  updated(changed) {
    if (changed.has('pop')) this.placePop();
  }

  // A menu or panel opens above its message, and below it when the list has no room above (the first messages), so
  // it is never clipped by the top of the scrolling list. Below, the list scrolls to show all of it.
  placePop() {
    const pop = this.querySelector('.message-pop');
    const el = this.querySelector('.messages');
    if (!pop || !el || !this.pop) return;
    if (this.pop.side === 'above' && pop.getBoundingClientRect().top < el.getBoundingClientRect().top) {
      this.pop = { ...this.pop, side: 'below' };
      return;
    }
    pop.scrollIntoView({ block: 'nearest' });
  }

  openMenu(m, e) {
    if (e) e.preventDefault();
    if (!canTarget(m) || !this.sending) return;
    this.pop = { id: m.id, kind: 'menu', side: 'above' };
  }

  async openPicker(m) {
    this.pop = { id: m.id, kind: 'picker', side: 'above' };
    this.frequent = await loadRecentEmoji();
  }

  closePop() {
    this.pop = null;
  }

  // A finger held on a message opens its menu, as a right click does with a mouse. Moving or lifting first cancels.
  pressStart(m, e) {
    if (e.pointerType !== 'touch') return;
    clearTimeout(this.pressTimer);
    this.pressAt = { x: e.clientX, y: e.clientY };
    this.pressTimer = setTimeout(() => this.openMenu(m), LONG_PRESS_MS);
  }

  pressMove(e) {
    if (this.pressAt && Math.hypot(e.clientX - this.pressAt.x, e.clientY - this.pressAt.y) > PRESS_SLOP) this.pressEnd();
  }

  pressEnd() {
    clearTimeout(this.pressTimer);
    this.pressAt = null;
  }

  // Pressing the reaction already yours takes it off; any other replaces it, one reaction per person.
  react(m, emoji) {
    const mine = myReaction(m);
    const remove = Boolean(mine) && reactionGlyph(mine).replace(/\ufe0f/g, '') === String(emoji).replace(/\ufe0f/g, '');
    this.pop = null;
    const control = [...this.querySelectorAll('.bubble-row')].find((row) => row.dataset.id === m.id)?.querySelector('.message-action[aria-label="React"]');
    return runPress(control, () => this.fire('react', { messageId: m.id, emoji, remove }));
  }

  async pickEmoji(m, char) {
    this.react(m, char);
    this.frequent = await rememberEmoji(this.frequent, char);
  }

  startReply(m) {
    this.pop = null;
    this.replyingTo = replyQuote([m], { replyTo: m.id });
  }

  onSend(detail) {
    this.replyingTo = null;
    return this.fire('send', detail);
  }

  // A quote takes the reader to the message it answers and lights it for a moment.
  goTo(id) {
    const row = [...this.querySelectorAll('.bubble-row')].find((r) => r.dataset.id === id);
    if (!row) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    row.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
    this.flashId = id;
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => { this.flashId = null; }, FLASH_MS);
  }

  menu(m) {
    const mine = myReaction(m);
    const chosen = mine ? reactionGlyph(mine).replace(/\ufe0f/g, '') : null;
    return html`<div class="message-pop message-menu" role="menu" aria-label="React or reply" data-side=${this.pop.side}>
      <div class="tapback-row">
        ${TAPBACKS.map((t) => html`<button type="button" role="menuitemcheckbox" class="tapback" aria-checked=${chosen === t.glyph.replace(/\ufe0f/g, '') ? 'true' : 'false'} aria-label=${t.type} title=${t.type} @click=${press(() => this.react(m, t.glyph))}>${t.glyph}</button>`)}
        <button type="button" role="menuitem" class="tapback tapback-more" aria-label="More emoji" title="More emoji" @click=${press(() => this.openPicker(m))}>+</button>
      </div>
      <button type="button" role="menuitem" class="menu-item" @click=${press(() => this.startReply(m))}>Reply</button>
      ${mine ? html`<button type="button" role="menuitem" class="menu-item" @click=${press(() => this.react(m, reactionGlyph(mine)))}>Remove reaction</button>` : nothing}
    </div>`;
  }

  picker(m) {
    return html`<div class="message-pop message-picker" data-side=${this.pop.side}><app-emoji-picker .frequent=${this.frequent} @pick=${(e) => this.pickEmoji(m, e.detail)}></app-emoji-picker></div>`;
  }

  bubble(it, lastMine, sms) {
    const m = it.message;
    const mine = m.fromMe;
    const flash = this.flashId === m.id;
    const row = ['bubble-row', mine ? 'mine' : 'theirs', it.first ? 'first' : '', it.last ? 'last' : '', flash ? 'flash' : ''].filter(Boolean).join(' ');
    const kind = mine ? (sms ? 'sms' : 'me') : 'them';
    const label = mine && (m.state || m === lastMine) ? deliveryLabel(m) : '';
    const quote = replyQuote(this.messages, m);
    const own = myReaction(m);
    const ownGlyph = own ? reactionGlyph(own) : null;
    const target = canTarget(m);
    const busy = this.reacting === m.id;
    const open = this.pop && this.pop.id === m.id ? this.pop.kind : null;
    const note = this.note && this.note.id === m.id ? this.note.text : '';
    return html`<div class=${row} data-id=${m.id} aria-busy=${busy ? 'true' : 'false'} @contextmenu=${(e) => this.openMenu(m, e)} @pointerdown=${(e) => this.pressStart(m, e)} @pointerup=${() => this.pressEnd()} @pointercancel=${() => this.pressEnd()} @pointermove=${(e) => this.pressMove(e)}>
      ${!mine && this.chat.isGroup && it.first ? html`<div class="sender">${m.senderName || m.sender || ''}</div>` : nothing}
      ${quote ? html`<button type="button" class="reply-quote" aria-label=${quote.found ? 'Go to the message replied to' : 'Replied to an earlier message'} ?disabled=${!quote.found} @click=${press(() => this.goTo(quote.id))}>${quote.who ? html`<span class="reply-who">${quote.who}</span>` : nothing}<span class="reply-text">${quote.text}</span></button>` : nothing}
      <div class="bubble-body">
        ${m.attachments.map((a) => html`<app-attachment .attachment=${a} .client=${this.client}></app-attachment>`)}
        ${m.text ? html`<div class=${'bubble ' + kind + (m.state ? ' state-' + m.state : '')}>${m.text}</div>` : nothing}
        ${target ? html`<div class="message-actions">
          <button type="button" class="message-action" aria-label="React" title="React" aria-haspopup="menu" aria-expanded=${open ? 'true' : 'false'} ?disabled=${!this.sending} @click=${press(() => (open ? this.closePop() : this.openMenu(m)))}>\u{1F642}</button>
          <button type="button" class="message-action" aria-label="Reply" title="Reply" ?disabled=${!this.sending} @click=${press(() => this.startReply(m))}>\u21A9\uFE0E</button>
        </div>` : nothing}
        ${open === 'menu' ? this.menu(m) : nothing}
        ${open === 'picker' ? this.picker(m) : nothing}
      </div>
      ${m.reactions.length ? html`<div class="reactions">${summarizeReactions(m.reactions).map((r) => html`<span class=${'reaction' + (r.glyph === ownGlyph ? ' mine' : '')} title=${r.glyph === ownGlyph ? 'Your reaction' : nothing}>${r.glyph}${r.count > 1 ? ' ' + r.count : ''}</span>`)}</div>` : nothing}
      ${label ? html`<div class="delivery">${label}${m.note ? ' \u00b7 ' + m.note : ''}</div>` : nothing}
      ${note ? html`<div class="message-note" role="status">${note}</div>` : nothing}
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
      <app-composer .disabled=${!this.sending} .maxBytes=${this.uploadMaxBytes} .placeholder=${this.sending ? 'Message' : 'Sending is off on the server'} .replyTo=${this.replyingTo} @send=${(e) => respond(e, this.onSend(e.detail))} @reply-cancel=${() => { this.replyingTo = null; }}></app-composer>`;
  }
}

customElements.define('app-conversation', AppConversation);
