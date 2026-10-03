import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { press, runPress, emit, respond } from '../../kit/press.js';
import { keepScroll } from '../../kit/scroll.js';
import { chatTitle, initials } from '../rules/chats.js';
import { groupMessages, deliveryLabel, summarizeReactions, reactionGlyph, myReaction, replyQuote, messageActions, threadIds } from '../rules/messages.js';
import { formatSeparator } from '../rules/time.js';
import { windowControlsHtml } from './window-controls.js';
import './app-composer.js';
import './app-attachment.js';

// How long a finger or the mouse button rests on a message before its menu opens, and how long a quoted parent stays lit after the
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
    // The menu open on one message ({ id, kind: 'menu', side }), the message being replied to ({ id }), whose thread
    // stays in view while the rest fades, the message the composer's emoji panel is choosing a reaction for, and the
    // parent a pressed reply link lit (issue 169).
    pop: { state: true }, replyingTo: { state: true }, reactFor: { state: true }, flashId: { state: true },
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
    this.reactFor = null;
    this.flashId = null;
    this.pressTimer = null;
    // A long press that opened the menu swallows the click its release makes, so it does not also press the bubble.
    this.swallowClick = { handleEvent: (e) => { if (this.held) { this.held = false; e.preventDefault(); e.stopPropagation(); } }, capture: true };
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
      this.reactFor = null;
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

  // The one menu a message has: its time on any message, and whatever messageActions offers on it.
  openMenu(m, e) {
    if (e) e.preventDefault();
    this.pop = { id: m.id, kind: 'menu', side: 'above' };
  }

  // React chooses from the composer's own emoji panel, the one used for typing, rather than a second picker. The list
  // makes room above the panel and brings the message into that room, so the panel never covers what it reacts to.
  async openReact(m) {
    this.pop = null;
    this.reactFor = m.id;
    await this.updateComplete;
    this.rowOf?.(m.id)?.scrollIntoView({ block: 'nearest' });
  }

  reactPicked(char) {
    const m = (this.messages || []).find((x) => x.id === this.reactFor);
    this.reactFor = null;
    return m ? this.react(m, char) : undefined;
  }

  closePop() {
    this.pop = null;
  }

  // A finger or the main mouse button held on a message opens its menu, as a right click does. Moving or lifting
  // first cancels, so a drag still scrolls and a click is still a click.
  pressStart(m, e) {
    const held = e.pointerType === 'touch' || (e.pointerType === 'mouse' && e.button === 0);
    if (!held || e.target?.closest?.('.message-pop')) return;
    clearTimeout(this.pressTimer);
    this.held = false;
    this.pressAt = { x: e.clientX, y: e.clientY };
    this.pressTimer = setTimeout(() => { this.held = true; this.openMenu(m); }, LONG_PRESS_MS);
  }

  pressMove(e) {
    if (this.pressAt && Math.hypot(e.clientX - this.pressAt.x, e.clientY - this.pressAt.y) > PRESS_SLOP) this.pressEnd();
  }

  pressEnd() {
    clearTimeout(this.pressTimer);
    this.pressAt = null;
  }

  // Choosing the reaction already yours takes it off; any other replaces it, one reaction per person. The work shows on
  // the composer's emoji button, the control the reaction was chosen from, since the panel itself has closed.
  react(m, emoji) {
    const mine = myReaction(m);
    const remove = Boolean(mine) && reactionGlyph(mine).replace(/\ufe0f/g, '') === String(emoji).replace(/\ufe0f/g, '');
    this.pop = null;
    const control = this.querySelector('app-composer button.tool[aria-label="Emoji"]');
    return runPress(control, () => this.fire('react', { messageId: m.id, emoji, remove }));
  }

  // Replying in a thread keeps that thread in view and fades the rest; the composer says it is replying and repeats
  // none of the message (issue 169).
  async startReply(m) {
    this.pop = null;
    this.reactFor = null;
    this.replyingTo = { id: m.id };
    await this.updateComplete;
    this.rowOf(m.id)?.scrollIntoView({ block: 'nearest' });
  }

  rowOf(id) {
    return [...this.querySelectorAll('.bubble-row')].find((r) => r.dataset.id === id) || null;
  }

  onSend(detail) {
    this.replyingTo = null;
    return this.fire('send', detail);
  }

  // A quote takes the reader to the message it answers and lights it for a moment.
  goTo(id) {
    const row = this.rowOf(id);
    if (!row) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    row.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
    this.flashId = id;
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => { this.flashId = null; }, FLASH_MS);
  }

  // The menu: when the message arrived (or was sent), then Reply in thread and React as icons from the shared set.
  menu(m) {
    const actions = messageActions(m, { sending: this.sending });
    const when = formatSeparator(m.sentAt, { now: Date.now(), locale: navigator.language });
    return html`<div class="message-pop message-menu" role="toolbar" aria-label="Message" data-side=${this.pop.side}>
      <time class="message-time" datetime="${m.sentAt}" aria-label="${(m.fromMe ? 'Sent ' : 'Received ') + when}">${when}</time>
      ${actions.includes('reply') ? html`<button type="button" class="message-action" aria-label="Reply in thread" title="Reply in thread" @click=${press(() => this.startReply(m))}><span class="icon" data-icon="reply" aria-hidden="true"></span></button>` : nothing}
      ${actions.includes('react') ? html`<button type="button" class="message-action" aria-label="React" title="React" @click=${press(() => this.openReact(m))}><span class="icon" data-icon="smile-plus" aria-hidden="true"></span></button>` : nothing}
    </div>`;
  }

  // thread is the set of ids that stay in view while a reply is written, or null when none is.
  bubble(it, lastMine, sms, thread) {
    const m = it.message;
    const mine = m.fromMe;
    const flash = this.flashId === m.id;
    const faded = Boolean(thread) && !thread.has(m.id);
    const targeted = this.reactFor === m.id;
    const row = ['bubble-row', mine ? 'mine' : 'theirs', it.first ? 'first' : '', it.last ? 'last' : '', flash ? 'flash' : '', faded ? 'faded' : '', targeted ? 'targeted' : ''].filter(Boolean).join(' ');
    const kind = mine ? (sms ? 'sms' : 'me') : 'them';
    const label = mine && (m.state || m === lastMine) ? deliveryLabel(m) : '';
    const quote = replyQuote(this.messages, m);
    const own = myReaction(m);
    const ownGlyph = own ? reactionGlyph(own) : null;
    const busy = this.reacting === m.id;
    const open = this.pop && this.pop.id === m.id ? this.pop.kind : null;
    const note = this.note && this.note.id === m.id ? this.note.text : '';
    return html`<div class=${row} data-id=${m.id} tabindex=${faded ? '-1' : '0'} aria-haspopup="true" aria-expanded=${open ? 'true' : 'false'} aria-busy=${busy ? 'true' : 'false'} ?inert=${faded} aria-hidden=${faded ? 'true' : nothing} @click=${this.swallowClick} @contextmenu=${(e) => this.openMenu(m, e)} @pointerdown=${(e) => this.pressStart(m, e)} @pointerup=${() => this.pressEnd()} @pointercancel=${() => this.pressEnd()} @pointermove=${(e) => this.pressMove(e)}>
      ${!mine && this.chat.isGroup && it.first ? html`<div class="sender">${m.senderName || m.sender || ''}</div>` : nothing}
      ${quote ? html`<button type="button" class="reply-link" aria-label=${quote.found ? 'Go to the message replied to' : 'Replied to an earlier message'} ?disabled=${!quote.found} @click=${press(() => this.goTo(quote.id))}><span aria-hidden="true">↩</span><span>${quote.who ? 'Reply to ' + quote.who : 'Reply to earlier message'}</span></button>` : nothing}
      <div class="bubble-body">
        ${m.attachments.map((a) => html`<app-attachment .attachment=${a} .client=${this.client}></app-attachment>`)}
        ${m.text ? html`<div class=${'bubble ' + kind + (m.state ? ' state-' + m.state : '')}>${m.text}</div>` : nothing}
        ${open === 'menu' ? this.menu(m) : nothing}
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
    const thread = this.replyingTo ? threadIds(this.messages, this.replyingTo.id) : null;
    const title = chatTitle(this.chat);
    const detail = this.chat.isGroup ? this.chat.participants.length + ' people' : '';
    return html`<header class="conv-head"><button class="conv-back" aria-label="Conversations" @click=${press(() => this.fire('back'))}>←</button><span class="avatar" aria-hidden="true">${initials(title)}</span><div class="conv-title"><div class="chat-name">${title}</div>${detail ? html`<div class="muted small">${detail}</div>` : nothing}</div>${this.windowControls && this.windowControls.drawn ? windowControlsHtml({ order: this.windowControls.order, maximized: this.maximized, onAction: (name) => this.fire('window-action', name) }) : nothing}</header>
      <div class="messages" role="log" aria-live="polite" data-thread=${thread ? this.replyingTo.id : nothing} data-reacting=${this.reactFor || nothing}>
        ${this.hasMore ? html`<button class=${'load-older' + (thread ? ' faded' : '')} ?inert=${Boolean(thread)} @click=${press(() => this.fire('older'))}>Load earlier messages</button>` : nothing}
        ${items.map((it) => (it.kind === 'separator' ? html`<div class=${'separator' + (thread ? ' faded' : '')}>${formatSeparator(it.at, { now, locale })}</div>` : this.bubble(it, lastMine, sms, thread)))}
      </div>
      <app-composer .disabled=${!this.sending} .maxBytes=${this.uploadMaxBytes} .placeholder=${this.sending ? 'Message' : 'Sending is off on the server'} .replyTo=${this.replyingTo} .reactFor=${this.reactFor} @send=${(e) => respond(e, this.onSend(e.detail))} @reply-cancel=${() => { this.replyingTo = null; }} @react-pick=${(e) => this.reactPicked(e.detail)} @react-cancel=${() => { this.reactFor = null; }}></app-composer>`;
  }
}

customElements.define('app-conversation', AppConversation);
