import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { press, runPress, emit, respond } from '../../kit/press.js';
import { keepScroll } from '../../kit/scroll.js';
import { dismissable } from '../../kit/dismiss.js';
import { chatTitle, initials } from '../rules/chats.js';
import { groupMessages, deliveryLabel, summarizeReactions, reactionGlyph, myReaction, replyQuote, messageActions, threadIds, threadRoot, threadMarks, replyCountLabel } from '../rules/messages.js';
import { formatSeparator } from '../rules/time.js';
import { windowControlsHtml } from './window-controls.js';
import './app-composer.js';
import './app-attachment.js';

// How long a finger or the mouse button rests on a message before its menu opens. An interaction timing, not a style.
const LONG_PRESS_MS = 500;
// How far a resting finger may drift and still be a long press rather than the start of a scroll, in CSS pixels.
const PRESS_SLOP = 10;

// The thread marks of one message list, worked out once per list rather than once per bubble.
const markCache = new WeakMap();
function marksOf(messages) {
  const list = messages || [];
  let marks = markCache.get(list);
  if (!marks) {
    marks = threadMarks(list);
    markCache.set(list, marks);
  }
  return marks;
}

class AppConversation extends KitElement {
  static properties = {
    chat: { attribute: false }, messages: { attribute: false }, hasMore: {}, sending: {}, uploadMaxBytes: {}, client: { attribute: false }, windowControls: { attribute: false }, maximized: {},
    // The message whose reaction is with the server, and a line said under one message (a refused reaction), both
    // owned by the page.
    reacting: {}, note: { attribute: false },
    // The menu open on one message ({ id, kind: 'menu', side }), the thread open over the conversation and being
    // replied to ({ id } of its first message), and the message the composer's emoji panel is choosing a reaction for
    // (issues 169 and 183).
    pop: { state: true }, replyingTo: { state: true }, reactFor: { state: true },
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
    // An open thread keeps its own place the same way.
    this.keepThread = keepScroll(this, { scroller: '.thread-view', items: '.bubble-row' });
    this.reacting = null;
    this.note = null;
    this.pop = null;
    this.replyingTo = null;
    this.reactFor = null;
    this.pressTimer = null;
    this.swallowClick = { handleEvent: (e) => this.swallow(e), capture: true };
    // The message menu and an open thread close on a press outside them and on Escape, through the kit's one behaviour
    // (core/kit/dismiss.js). The composer keeps the thread open, since replying in it is typing there.
    dismissable(this, { name: 'pop', open: () => Boolean(this.pop), close: () => this.closePop() });
    dismissable(this, { name: 'thread', open: () => Boolean(this.replyingTo), close: () => this.closeThread() });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearTimeout(this.pressTimer);
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

  // Releasing a long press may click what it was held on (a mouse always does, a finger usually does not); that one
  // click is swallowed, and only that one, so the next press, in the menu or anywhere, is a press.
  pressEnd() {
    clearTimeout(this.pressTimer);
    this.pressAt = null;
    if (this.held) setTimeout(() => { this.held = false; }, 0);
  }

  swallow(e) {
    if (!this.held || e.target?.closest?.('.message-pop')) return;
    this.held = false;
    e.preventDefault();
    e.stopPropagation();
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

  // Reply in thread, or a reply, its line, its thread's ghost original or the reply count, opens the thread as its own conversation over the rest, which blurs
  // behind it, and the composer replies into it. A thread is one level deep, as on the Mac: it is named by its first
  // message, so answering a reply joins the same thread (issues 169 and 183).
  openThread(m) {
    this.pop = null;
    this.reactFor = null;
    this.replyingTo = { id: threadRoot(this.messages, m.id) };
  }

  closeThread() {
    this.replyingTo = null;
  }

  // The row for a message where it is showing: in the thread while one is open, in the conversation otherwise.
  rowOf(id) {
    const scope = (this.replyingTo && this.querySelector('.thread-view')) || this;
    return [...scope.querySelectorAll('.bubble-row')].find((r) => r.dataset.id === id) || null;
  }

  onSend(detail) {
    this.replyingTo = null;
    return this.fire('send', detail);
  }

  // The menu: when the message arrived (or was sent), then Reply in thread and React as icons from the shared set.
  menu(m) {
    const actions = messageActions(m, { sending: this.sending });
    const when = formatSeparator(m.sentAt, { now: Date.now(), locale: navigator.language });
    return html`<div class="message-pop message-menu" role="toolbar" aria-label="Message" data-dismiss="pop" data-side=${this.pop.side}>
      <time class="message-time" datetime="${m.sentAt}" aria-label="${(m.fromMe ? 'Sent ' : 'Received ') + when}">${when}</time>
      ${actions.includes('reply') ? html`<button type="button" class="message-action" aria-label="Reply in thread" title="Reply in thread" @click=${press(() => this.openThread(m))}><span class="icon" data-icon="reply" aria-hidden="true"></span></button>` : nothing}
      ${actions.includes('react') ? html`<button type="button" class="message-action" aria-label="React" title="React" @click=${press(() => this.openReact(m))}><span class="icon" data-icon="smile-plus" aria-hidden="true"></span></button>` : nothing}
    </div>`;
  }

  // What the composer's field says: Reply while a thread is open, as on the phone (issue 195).
  composerPlaceholder() {
    if (!this.sending) return 'Sending is off on the server';
    return this.replyingTo ? 'Reply' : 'Message';
  }

  // Above the run of replies that holds a thread's newest reply, the thread's original as a small outlined ghost on its
  // own side, with the reply count under it; either opens the thread (issue 195). Nothing for any other message.
  ghost(m) {
    const mark = marksOf(this.messages).get(m.id);
    if (!mark || !mark.ghost) return nothing;
    const original = (this.messages || []).find((x) => x.id === mark.root) || null;
    const q = replyQuote(this.messages, { replyTo: mark.root });
    const side = original && original.fromMe ? 'mine' : 'theirs';
    const open = () => this.openThread(m);
    return html`<div class=${'thread-ghost-row ' + side} data-thread=${mark.root}>
      <button type="button" class="thread-ghost" aria-label=${'Original message' + (q.who ? ' from ' + q.who : '') + ': ' + q.text + '. Open the thread'} @click=${press(open)}>${q.text}</button>
      <button type="button" class="thread-count" @click=${press(open)}>${replyCountLabel(mark.ghost.count)}</button>
    </div>`;
  }

  // where is 'list' for the conversation and 'thread' for the open thread. Only the surface in front draws a menu. In the
  // conversation a reply from the other side carries a thin line toward its thread's ghost original, and tapping any
  // reply opens its thread; every other message carries nothing (issue 195).
  bubble(it, lastMine, sms, where = 'list') {
    const m = it.message;
    const mine = m.fromMe;
    const front = where === 'thread' || !this.replyingTo;
    const targeted = this.reactFor === m.id;
    const mark = where === 'list' ? marksOf(this.messages).get(m.id) || null : null;
    const row = ['bubble-row', mine ? 'mine' : 'theirs', it.first ? 'first' : '', it.last ? 'last' : '', targeted ? 'targeted' : '', mark ? 'thread-reply' : ''].filter(Boolean).join(' ');
    const kind = mine ? (sms ? 'sms' : 'me') : 'them';
    const label = mine && (m.state || m === lastMine) ? deliveryLabel(m) : '';
    const own = myReaction(m);
    const ownGlyph = own ? reactionGlyph(own) : null;
    const busy = this.reacting === m.id;
    const open = front && this.pop && this.pop.id === m.id ? this.pop.kind : null;
    const note = this.note && this.note.id === m.id ? this.note.text : '';
    return html`<div class=${row} data-id=${m.id} tabindex=${front ? '0' : '-1'} aria-haspopup="true" data-dismiss-keep=${open ? 'pop' : ''} aria-expanded=${open ? 'true' : 'false'} aria-busy=${busy ? 'true' : 'false'} @click=${this.swallowClick} @contextmenu=${(e) => this.openMenu(m, e)} @pointerdown=${(e) => this.pressStart(m, e)} @pointerup=${() => this.pressEnd()} @pointercancel=${() => this.pressEnd()} @pointermove=${(e) => this.pressMove(e)}>
      ${!mine && this.chat.isGroup && it.first ? html`<div class="sender">${m.senderName || m.sender || ''}</div>` : nothing}
      <div class="bubble-body">
        ${mark && mark.connector ? html`<button type="button" class="thread-line" aria-label="Open the thread" title="Open the thread" @click=${press(() => this.openThread(m))}></button>` : nothing}
        ${m.attachments.map((a) => html`<app-attachment .attachment=${a} .client=${this.client}></app-attachment>`)}
        ${m.text ? html`<div class=${'bubble ' + kind + (m.state ? ' state-' + m.state : '')} @click=${mark ? () => this.openThread(m) : nothing}>${m.text}</div>` : nothing}
        ${m.reactions.length ? html`<div class="reactions">${summarizeReactions(m.reactions).map((r) => html`<span class=${'reaction' + (r.glyph === ownGlyph ? ' mine' : '')} title=${r.glyph === ownGlyph ? 'Your reaction' : nothing}>${r.glyph}${r.count > 1 ? ' ' + r.count : ''}</span>`)}</div>` : nothing}
        ${open === 'menu' ? this.menu(m) : nothing}
      </div>
      ${label ? html`<div class="delivery">${label}${m.note ? ' \u00b7 ' + m.note : ''}</div>` : nothing}
      ${note ? html`<div class="message-note" role="status">${note}</div>` : nothing}
    </div>`;
  }

  // The open thread: only its original and every reply, in order, each under its day and time, with the delivery status
  // of your last message in it, as a conversation of their own (issue 195).
  threadView(sms) {
    const ids = threadIds(this.messages, this.replyingTo.id);
    const thread = (this.messages || []).filter((m) => ids.has(m.id));
    const lastMine = [...thread].reverse().find((m) => m.fromMe) || null;
    const now = Date.now();
    const locale = navigator.language;
    const items = groupMessages(thread, { gapMs: 0 });
    return html`<div class="thread-view">
      <div class="thread-list" role="dialog" aria-label="Thread" data-dismiss="thread">${items.map((it) => (it.kind === 'separator' ? html`<div class="separator">${formatSeparator(it.at, { now, locale })}</div>` : this.bubble(it, lastMine, sms, 'thread')))}</div>
    </div>`;
  }

  render() {
    const now = Date.now();
    const locale = navigator.language;
    const items = groupMessages(this.messages || []);
    const lastMine = [...(this.messages || [])].reverse().find((m) => m.fromMe) || null;
    const sms = this.chat.service === 'SMS' || this.chat.service === 'RCS';
    const thread = Boolean(this.replyingTo);
    const title = chatTitle(this.chat);
    const detail = this.chat.isGroup ? this.chat.participants.length + ' people' : '';
    // An open thread keeps the contact header, with a close control in place of the way back (issue 195).
    return html`<header class="conv-head">${thread ? nothing : html`<button class="conv-back" aria-label="Conversations" @click=${press(() => this.fire('back'))}>←</button>`}<span class="avatar" aria-hidden="true">${initials(title)}</span><div class="conv-title"><div class="chat-name">${title}</div>${detail ? html`<div class="muted small">${detail}</div>` : nothing}</div>${thread ? html`<button type="button" class="thread-close" aria-label="Close thread" title="Close thread" data-dismiss-keep="thread" @click=${press(() => this.closeThread())}><span class="icon" data-icon="x" aria-hidden="true"></span></button>` : nothing}${this.windowControls && this.windowControls.drawn ? windowControlsHtml({ order: this.windowControls.order, maximized: this.maximized, onAction: (name) => this.fire('window-action', name) }) : nothing}</header>
      <div class="conv-body" data-thread=${thread ? this.replyingTo.id : nothing} data-reacting=${this.reactFor || nothing}>
        <div class=${'messages' + (thread ? ' behind' : '')} role="log" aria-live="polite" ?inert=${thread} aria-hidden=${thread ? 'true' : nothing}>
          ${this.hasMore ? html`<button class="load-older" @click=${press(() => this.fire('older'))}>Load earlier messages</button>` : nothing}
          ${items.map((it) => (it.kind === 'separator' ? html`<div class="separator">${formatSeparator(it.at, { now, locale })}</div>` : [this.ghost(it.message), this.bubble(it, lastMine, sms, 'list')]))}
        </div>
        ${thread ? this.threadView(sms) : nothing}
      </div>
      <app-composer data-dismiss-keep="thread" .disabled=${!this.sending} .maxBytes=${this.uploadMaxBytes} .placeholder=${this.composerPlaceholder()} .replyTo=${this.replyingTo} .reactFor=${this.reactFor} @send=${(e) => respond(e, this.onSend(e.detail))} @reply-cancel=${() => this.closeThread()} @react-pick=${(e) => this.reactPicked(e.detail)} @react-cancel=${() => { this.reactFor = null; }}></app-composer>`;
  }
}

customElements.define('app-conversation', AppConversation);
