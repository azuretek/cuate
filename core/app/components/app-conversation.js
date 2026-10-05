import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { press, runPress, emit, respond } from '../../kit/press.js';
import { keepScroll } from '../../kit/scroll.js';
import { dismissable } from '../../kit/dismiss.js';
import { aimCarets } from '../../kit/popover.js';
import { chatTitle, initials } from '../rules/chats.js';
import { groupMessages, deliveryLabel, summarizeReactions, reactionGlyph, myReaction, messageActions, threadIds, threadRoot, threadMarks, replyCountLabel } from '../rules/messages.js';
import { platformOf, platformCapabilities } from '../rules/platform.js';
import { formatSeparator } from '../rules/time.js';
import { rememberPlace, placeFor } from '../rules/places.js';
import { typingLabel } from '../rules/typing.js';
import { windowControlsHtml } from './window-controls.js';
import { closeButtonHtml } from './close-button.js';
import './app-composer.js';
import { saveAttachment } from './app-attachment.js';
import './app-link-card.js';

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
    // The live typing state of the conversation on screen (issue 230): another of our signed-in devices, or the
    // contact when the engine can report it. Drawn in the header, cleared by the page when it goes stale.
    typing: { attribute: false },
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
    // The place each conversation was left at, so switching back returns to it rather than to its newest message
    // (issue 200). Keyed by chat id, and never cleared here.
    this.places = new Map();
    // An open thread keeps its own place the same way.
    this.keepThread = keepScroll(this, { scroller: '.thread-view', items: '.bubble-row' });
    this.reacting = null;
    this.note = null;
    this.typing = null;
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

  // Another conversation starts where it was left, or at its latest message the first time it is opened (issue 200).
  // The conversation being left keeps the place it was last at; the one being entered is put back on its own. Because
  // this runs before the new conversation is drawn, the place read for the old one is still the old one's, never a frame
  // of the new layout.
  willUpdate(changed) {
    if (changed.has('chat') && changed.get('chat')?.id !== this.chat?.id) {
      this.places = rememberPlace(this.places, changed.get('chat')?.id, this.keep.anchor);
      this.keep.anchor = placeFor(this.places, this.chat?.id, { follow: this.keep.follow });
      this.pop = null;
      this.replyingTo = null;
      this.reactFor = null;
    }
  }

  updated(changed) {
    if (changed.has('pop')) this.placePop();
    // The message menu wears the shared caret, aimed at the message it opened on (issue 217).
    aimCarets(this);
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

  // Save writes a message's file, a picture or a video or a document, to where the platform keeps it, through the same
  // control a document's own press uses (app-attachment's saveAttachment): the shell's save dialog on the desktop and
  // its share or save sheet on a phone, a download in a plain browser (issue 181).
  save(m) {
    const a = (m.attachments || []).find((x) => x && !x.local && !x.missing);
    return a ? saveAttachment(a, { client: this.client }) : false;
  }

  // Reply in thread, or a reply, its line, its thread's ghost original or the reply count, opens the thread as its own conversation over the rest, which blurs
  // behind it, and the composer replies into it. A thread is one level deep, as on the Mac: it is named by its first
  // message, so answering a reply joins the same thread (issues 169 and 183).
  openThread(m) {
    // Only a platform that carries threads offers one (issue 184): on any other, answering is a plain message, so no
    // thread is opened here and nothing is sent as a reply the recipient cannot read.
    if (!platformCapabilities(platformOf(this.chat)).thread) return;
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
    const actions = messageActions(m, { sending: this.sending, platform: platformOf(this.chat) });
    const when = formatSeparator(m.sentAt, { now: Date.now(), locale: navigator.language });
    return html`<div class="message-pop message-menu" role="toolbar" aria-label="Message" data-dismiss="pop" data-side=${this.pop.side} data-popover data-popover-edge=${this.pop.side === 'below' ? 'top' : 'bottom'} data-popover-align=${m.fromMe ? 'end' : 'start'}>
      <time class="message-time" datetime="${m.sentAt}" aria-label="${(m.fromMe ? 'Sent ' : 'Received ') + when}">${when}</time>
      ${actions.includes('save') ? html`<button type="button" class="message-action" aria-label="Save" title="Save" @click=${press(() => this.save(m))}><span class="icon" data-icon="download" aria-hidden="true"></span></button>` : nothing}
      ${actions.includes('reply') ? html`<button type="button" class="message-action" aria-label="Reply in thread" title="Reply in thread" @click=${press(() => this.openThread(m))}><span class="icon" data-icon="reply" aria-hidden="true"></span></button>` : nothing}
      ${actions.includes('react') ? html`<button type="button" class="message-action" aria-label="React" title="React" @click=${press(() => this.openReact(m))}><span class="icon" data-icon="smile-plus" aria-hidden="true"></span></button>` : nothing}
    </div>`;
  }

  // What the composer's field says: Reply while a thread is open, as on the phone (issue 195).
  composerPlaceholder() {
    if (!this.sending) return 'Sending is off on the server';
    return this.replyingTo ? 'Reply' : 'Message';
  }

  // A message that has replies is marked once and clearly (issue 208): one quiet line under it reading the reply count,
  // which opens the thread. The count is the replies present in the conversation, worked out from the stored pointer
  // alone; a message with no replies, and every reply itself, draws nothing here.
  threadSummary(m) {
    const mark = marksOf(this.messages).get(m.id);
    if (!mark || !mark.replies) return nothing;
    const open = () => this.openThread(m);
    return html`<div class=${'thread-replies ' + (m.fromMe ? 'mine' : 'theirs')} data-thread=${m.id}>
      <button type="button" class="thread-count" aria-label=${replyCountLabel(mark.replies) + '. Open the thread'} @click=${press(open)}><span class="icon" data-icon="reply" aria-hidden="true"></span>${replyCountLabel(mark.replies)}</button>
    </div>`;
  }

  // where is 'list' for the conversation and 'thread' for the open thread. Only the surface in front draws a menu. In the
  // conversation a reply opens its thread when pressed, the message it answers carries the reply count (threadSummary),
  // and every other message carries nothing: no line is drawn between two messages, so no pairing is implied that the
  // stored pointer does not support (issue 208).
  bubble(it, lastMine, sms, where = 'list') {
    const m = it.message;
    const mine = m.fromMe;
    const front = where === 'thread' || !this.replyingTo;
    const targeted = this.reactFor === m.id;
    const mark = where === 'list' ? marksOf(this.messages).get(m.id) || null : null;
    const isReply = Boolean(mark && mark.root);
    const row = ['bubble-row', mine ? 'mine' : 'theirs', it.first ? 'first' : '', it.last ? 'last' : '', targeted ? 'targeted' : '', isReply ? 'thread-reply' : ''].filter(Boolean).join(' ');
    const kind = mine ? (sms ? 'sms' : 'me') : 'them';
    const label = mine && (m.state || m === lastMine) ? deliveryLabel(m) : '';
    const own = myReaction(m);
    const ownGlyph = own ? reactionGlyph(own) : null;
    const busy = this.reacting === m.id;
    const open = front && this.pop && this.pop.id === m.id ? this.pop.kind : null;
    const note = this.note && this.note.id === m.id ? this.note.text : '';
    return html`<div class=${row} data-id=${m.id} data-thread=${isReply ? mark.root : nothing} tabindex=${front ? '0' : '-1'} aria-haspopup="true" data-dismiss-keep=${open ? 'pop' : ''} aria-expanded=${open ? 'true' : 'false'} aria-busy=${busy ? 'true' : 'false'} @click=${this.swallowClick} @contextmenu=${(e) => this.openMenu(m, e)} @pointerdown=${(e) => this.pressStart(m, e)} @pointerup=${() => this.pressEnd()} @pointercancel=${() => this.pressEnd()} @pointermove=${(e) => this.pressMove(e)}>
      ${!mine && this.chat.isGroup && it.first ? html`<div class="sender">${m.senderName || m.sender || ''}</div>` : nothing}
      <div class="bubble-body">
        ${m.attachments.map((a) => html`<app-attachment .attachment=${a} .client=${this.client}></app-attachment>`)}
        ${m.link ? html`<app-link-card .link=${m.link} .client=${this.client}></app-link-card>` : nothing}
        ${m.text && !(m.link && m.text.trim() === m.link.url) ? html`<div class=${'bubble ' + kind + (m.state ? ' state-' + m.state : '')} @click=${isReply ? () => this.openThread(m) : nothing}>${m.text}</div>` : nothing}
        ${m.payloads ? html`<div class="attachment-file payload-quiet"><span class="attachment-name">Attachment</span></div>` : nothing}
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
      <div class="thread-list" role="dialog" aria-label="Thread" data-dismiss="thread"><div class="thread-card-head">${closeButtonHtml({ owner: 'thread', label: 'Close thread', onClose: () => this.closeThread() })}</div>${items.map((it) => (it.kind === 'separator' ? html`<div class="separator">${formatSeparator(it.at, { now, locale })}</div>` : this.bubble(it, lastMine, sms, 'thread')))}</div>
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
    const typing = typingLabel(this.typing, now);
    // On a phone the way back to the chats list is the chats icon from the shared set, named for where it goes, never a
    // back arrow (issue 168); the same control Settings draws. An open thread leaves the contact header as it is, way
    // back included: its close control is in the thread card (issue 213).
    return html`<header class="conv-head"><button class="conv-back" aria-label="Back to chats" @click=${press(() => this.fire('back'))}><span class="icon" data-icon="messages-square" aria-hidden="true"></span></button><span class="avatar" aria-hidden="true">${initials(title)}</span><div class="conv-title"><div class="chat-name">${title}</div>${typing ? html`<div class="muted small typing" role="status">${typing}</div>` : detail ? html`<div class="muted small">${detail}</div>` : nothing}</div>${this.windowControls && this.windowControls.drawn ? windowControlsHtml({ order: this.windowControls.order, maximized: this.maximized, onAction: (name) => this.fire('window-action', name) }) : nothing}</header>
      <div class="conv-body" data-thread=${thread ? this.replyingTo.id : nothing} data-reacting=${this.reactFor || nothing}>
        <div class=${'messages' + (thread ? ' behind' : '')} role="log" aria-live="polite" ?inert=${thread} aria-hidden=${thread ? 'true' : nothing}>
          ${this.hasMore ? html`<button class="load-older" @click=${press(() => this.fire('older'))}>Load earlier messages</button>` : nothing}
          ${items.map((it) => (it.kind === 'separator' ? html`<div class="separator">${formatSeparator(it.at, { now, locale })}</div>` : [this.bubble(it, lastMine, sms, 'list'), this.threadSummary(it.message)]))}
        </div>
        ${thread ? this.threadView(sms) : nothing}
      </div>
      <app-composer data-dismiss-keep="thread" .disabled=${!this.sending} .maxBytes=${this.uploadMaxBytes} .placeholder=${this.composerPlaceholder()} .replyTo=${this.replyingTo} .reactFor=${this.reactFor} @send=${(e) => respond(e, this.onSend(e.detail))} @reply-cancel=${() => this.closeThread()} @react-pick=${(e) => this.reactPicked(e.detail)} @react-cancel=${() => { this.reactFor = null; }}></app-composer>`;
  }
}

customElements.define('app-conversation', AppConversation);
