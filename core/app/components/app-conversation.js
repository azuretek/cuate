import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { press, runPress, emit, respond } from '../../kit/press.js';
import { keepScroll } from '../../kit/scroll.js';
import { dismissable } from '../../kit/dismiss.js';
import { aimCarets } from '../../kit/popover.js';
import { play, growFrom, cssVar } from '../../kit/motion.js';
import { newArrivals } from '../../kit/rules/motion.js';
import { chatTitle, eventText } from '../rules/chats.js';
import { hasContactEditor, handleKey } from '../rules/contacts.js';
import './app-avatar.js';
import './app-backdrop.js';
import { groupMessages, deliveryLabel, summarizeReactions, reactionGlyph, myReaction, messageActions, threadIds, threadRoot, threadMarks, replyCountLabel, editRefusal, editVersions } from '../rules/messages.js';
import { platformOf, platformCapabilities, serviceNote } from '../rules/platform.js';
import { formatSeparator } from '../rules/time.js';
import { rememberPlace, placeFor } from '../rules/places.js';
import { typingNote, typingBubble, typingPulse, TYPING_BUBBLE_LABEL } from '../rules/typing.js';
import { windowControlsHtml } from './window-controls.js';
import { closeButtonHtml } from './close-button.js';
import './app-composer.js';
import { saveAttachment } from './app-attachment.js';
import './app-link-card.js';
import { messageLinks, styledParts } from '../rules/links.js';
import { letters, LETTER_EFFECTS, TEXT_FORMATS } from '../rules/text-styles.js';
import { sendEffectLine, sendEffectName, sendEffectKind, INK_EFFECT } from '../rules/send-effects.js';
import { playBubbleEffect, playScreenEffect } from './send-effects.js';
import { emojiFallbackParts } from '../rules/emoji.js';
import { canDrawEmoji } from '../emoji-support.js';
import { copyToClipboard } from '../clipboard.js';

// The link a press or a right click landed on, or null.
const linkAt = (target) => (target && target.closest ? target.closest('a.message-link')?.dataset.href || null : null);

// A message's text with each web address in it a link (core/app/rules/links.js). The text parts stay plain text, so
// nothing in a message is ever read as markup. An emoji this device cannot draw shows its name instead of an empty box
// (issue 392), marked as an image of that emoji, so the reader and a screen reader both know what was sent.
const drawnText = (text) => emojiFallbackParts(text, canDrawEmoji).map((p) => (p.emoji
  ? html`<span class="emoji-fallback" role="img" aria-label=${p.name} title=${p.emoji}>${p.name}</span>`
  : p.text));
// A stretch the sender laid a text effect over (issue 433): marked with the effect it plays, and for a letter effect cut
// into its letters so each moves on its own.
const effectText = (p) => (LETTER_EFFECTS.includes(p.effect)
  ? html`<span class="text-effect" data-effect=${p.effect}>${letters(p.text).map((ch) => html`<span class="fx-letter">${drawnText(ch)}</span>`)}</span>`
  : html`<span class="text-effect" data-effect=${p.effect}>${drawnText(p.text)}</span>`);
// A stretch the sender formatted (issue 447): one span naming every format laid on it, around the effect it shares.
const formattedText = (p, inner) => {
  const formats = TEXT_FORMATS.filter((f) => p[f]);
  return formats.length ? html`<span class="${'fmt ' + formats.map((f) => 'fmt-' + f).join(' ')}">${inner}</span>` : inner;
};
const linkedText = (text, open, styles = []) => styledParts(text, styles).map((p) => {
  const inner = formattedText(p, p.effect ? effectText(p) : drawnText(p.text));
  return p.href
    ? html`<a class="message-link" href=${p.href} data-href=${p.href} rel="noopener noreferrer" @click=${(e) => open(e, p.href)}>${inner}</a>`
    : inner;
});

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
    chat: { attribute: false }, host: { attribute: false }, messages: { attribute: false }, historyWindow: { attribute: false }, hasMore: {}, sending: {}, uploadMaxBytes: {}, client: { attribute: false }, windowControls: { attribute: false }, maximized: {}, phone: {},
    // The message whose reaction is with the server, and a line said under one message (a refused reaction), both
    // owned by the page.
    reacting: {}, note: { attribute: false },
    // The message a pressed notice leads to ({ id, seq }, issue 331), brought into view and given focus, never marked
    // (issue 368): revealedId names it until the person presses somewhere in the conversation or another one opens.
    reveal: { attribute: false }, revealedId: { state: true },
    // A note of the conversation's own under one message, such as Link copied: { id, text }, cleared after a moment.
    ownNote: { state: true },
    // The live typing state of the conversation on screen (issue 230): another of our signed-in devices, a quiet note in
    // the header, or the other person when the engine reports it, a bubble of three dots at the foot of the conversation
    // (issue 390). Cleared by the page when it stops or goes stale.
    typing: { attribute: false },
    // The menu open on one message ({ id, kind: 'menu', side }), the thread open over the conversation and being
    // replied to ({ id } of its first message), and the message the composer's emoji panel is choosing a reaction for
    // (issues 169 and 183).
    pop: { state: true }, replyingTo: { state: true }, reactFor: { state: true },
    // Whether the engine can edit a message (issue 391), handed down from the page, and the message being edited
    // ({ id, text }) while its words are in the composer.
    canEdit: {}, editing: { state: true },
    // The messages sent with Invisible Ink whose words have been pressed into view (issue 442); every other one is veiled.
    inkShown: { state: true },
    // The edited messages whose earlier versions are shown above them (issue 437), by id.
    shownEdits: { state: true },
  };

  constructor() {
    super();
    this.messages = [];
    this.shownEdits = new Set();
    this.hasMore = false;
    this.sending = false;
    // What the contact header draws for the platform, and the window's own state for the middle button's glyph, both
    // handed down from the page. A phone passes neither, so the header draws no window controls there.
    this.windowControls = null;
    this.maximized = false;
    // The shell's report, so the contact header draws the Edit contact control only where the shell has an editor.
    this.host = null;
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
    this.ownNote = null;
    this.pressLink = null;
    this.typing = null;
    this.pop = null;
    this.replyingTo = null;
    this.reactFor = null;
    this.canEdit = false;
    this.editing = null;
    this.inkShown = new Set();
    this.pressTimer = null;
    this.swallowClick = { handleEvent: (e) => this.swallow(e), capture: true };
    // The message menu and an open thread close on a press outside them and on Escape, through the kit's one behaviour
    // (core/kit/dismiss.js). The composer keeps the thread open, since replying in it is typing there.
    dismissable(this, { name: 'pop', open: () => Boolean(this.pop), close: () => this.closePop() });
    dismissable(this, { name: 'thread', open: () => Boolean(this.replyingTo), close: () => this.closeThread() });
  }

  // Edit contact (issue 393): the shell opens the system's own editor on the person this conversation is with. The
  // control is drawn only where the shell reports one, so a desktop with no contact editor shows nothing at all.
  editContact() {
    const handle = Array.isArray(this.chat?.participants) ? this.chat.participants[0] : null;
    const bridge = globalThis.window?.bridge;
    if (!handle || !bridge || typeof bridge.call !== 'function') return Promise.resolve(false);
    return bridge.call('contacts.edit', { handle });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearTimeout(this.pressTimer);
  }

  // The page may answer with the work it started, which the press that raised the event shows (core/kit/press.js).
  fire(name, detail) {
    return emit(this, name, detail);
  }

  // Older messages load as the person scrolls up to them, before they reach the top, so the history reads as one long
  // conversation rather than a page with a button at its head: within a screen of the top, the next page is asked for
  // once, and the place the person is on stays where it is while it lands above (the keep's anchor holds the message).
  // The button stays for a keyboard and for a page that is shorter than its view.
  async nearTop(e) {
    const el = e.currentTarget;
    if (this.olderPending || !el) return;
    this.olderPending = true;
    const deadline = Date.now() + 15000;
    try {
      while (el.isConnected && Date.now() < deadline) {
        const state = this.historyWindow;
        const direction = this.hasMore && el.scrollTop <= (state?.beforeHeight || 0) + el.clientHeight
          ? 'older' : state?.hasNewer && el.scrollTop + el.clientHeight >= el.scrollHeight - state.afterHeight - el.clientHeight ? 'newer' : null;
        if (!direction) break;
        const before = this.messages[0]?.id + ':' + this.messages.at(-1)?.id;
        const advanced = await this.fire(direction, this.historyMeasurements());
        await this.updateComplete;
        if (!advanced || before === this.messages[0]?.id + ':' + this.messages.at(-1)?.id) break;
      }
    } finally { this.olderPending = false; }
  }

  historyMeasurements() {
    const rows = [...this.querySelectorAll('.messages > .bubble-row')];
    const heights = rows.map((row, index) => {
      const rect = row.getBoundingClientRect();
      const next = rows[index + 1]?.getBoundingClientRect();
      return [row.dataset.id, Math.max(1, next ? next.top - rect.top : rect.height)];
    });
    const estimate = heights.length ? heights.reduce((sum, row) => sum + row[1], 0) / heights.length : 1;
    return { heights, estimate };
  }

  sizeHistory() {
    const state = this.historyWindow;
    for (const side of ['before', 'after']) {
      const el = this.querySelector('.history-space-' + side);
      if (el) el.style.setProperty('--history-height', String(state?.[side + 'Height'] || 0) + 'px');
    }
    if (state && state.estimate <= 1 && this.messages.length) this.fire('history-measured', this.historyMeasurements());
    this.keep.restore();
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
      this.editing = null;
      this.revealedId = null;
      this.inkShown = new Set();
    }
  }

  updated(changed) {
    this.sizeHistory();
    // A pressed notice's message still on its way (issue 414) moves nothing; it is revealed once it lands.
    if (changed.has('reveal') && this.reveal && !this.reveal.pending) this.revealMessage(this.reveal.id);
    if (changed.has('pop')) this.placePop();
    // The message menu wears the shared caret, aimed at the message it opened on (issue 217).
    aimCarets(this);
    this.arrive(changed);
    this.animateTyping();
  }

  // The other person's typing bubble rises into the foot of the conversation the way an arriving message does, and its
  // dots pulse in turn for as long as it is up (issue 390). Both play through the kit, so under reduced motion the
  // bubble still shows and its dots are still. A bubble that goes and comes back is a new element, and plays again.
  animateTyping() {
    const row = this.querySelector('.messages > .typing-row');
    if (!row) {
      this.typingRow = null;
      return;
    }
    if (this.typingRow === row) return;
    this.typingRow = row;
    const bubble = row.querySelector('.typing-bubble');
    const rise = parseFloat(cssVar(bubble, '--space-4')) || 0;
    play(bubble, [{ opacity: 0, translate: '0px ' + rise + 'px', scale: '0.96' }, { opacity: 1, translate: '0px 0px', scale: '1' }]);
    const lift = parseFloat(cssVar(bubble, '--space-1')) || 0;
    const dots = [...row.querySelectorAll('.typing-dot')];
    dots.forEach((dot, i) => play(dot, typingPulse(i, dots.length, lift), { duration: 'typing', easing: 'ease', iterations: Infinity }));
  }

  // Motion comes from where a thing came from (issue 316, docs/CONVENTIONS.md). Another conversation slides in from
  // the side it was chosen from; a message we send rises out of the composer's field into its place; a message that
  // arrives slides up into the end of the list. A first draw and a page of older history are a place, not news, so
  // they do not move (newArrivals).
  arrive(changed) {
    const chatChanged = changed.has('chat') && changed.get('chat')?.id !== this.chat?.id;
    if (chatChanged && changed.get('chat')) {
      const list = this.querySelector('.messages');
      const step = parseFloat(cssVar(list, '--space-6')) || 0;
      play(list, [{ opacity: 0, translate: step + 'px 0px' }, { opacity: 1, translate: '0px 0px' }], { duration: 'screen', easing: 'sheet-ease' });
    }
    if (!changed.has('messages')) return;
    const fresh = newArrivals(changed.get('messages'), this.messages, { sameChat: !chatChanged });
    if (!fresh.length) return;
    const field = this.querySelector('app-composer textarea');
    for (const { id, sent } of fresh) {
      const row = this.rowOf(id);
      const bubble = row && (row.querySelector('.bubble') || row);
      if (!bubble) continue;
      // A message sent with an effect plays it as it arrives (issue 442): a bubble effect is the way its bubble arrives,
      // and a screen effect plays over the conversation while the message slides in as any other does.
      const m = (this.messages || []).find((x) => x.id === id);
      if (m && m.sendEffect) this.playEffect(m);
      if (m && sendEffectKind(m.sendEffect) === 'bubble' && m.sendEffect !== INK_EFFECT) continue;
      if (sent && field) {
        // From where its text was typed: the field's start, at the field's line height, then out to its own place.
        const r = field.getBoundingClientRect();
        const b = bubble.getBoundingClientRect();
        const s = b.height > 0 ? Math.min(1, r.height / b.height) : 1;
        growFrom(bubble, { left: r.left, top: r.top + (r.height - b.height * s) / 2, width: b.width * s, height: b.height * s });
      } else {
        const rise = parseFloat(cssVar(bubble, '--space-4')) || 0;
        play(bubble, [{ opacity: 0, translate: '0px ' + rise + 'px', scale: '0.96' }, { opacity: 1, translate: '0px 0px', scale: '1' }]);
      }
    }
  }

  // The effect a message was sent with, as it arrives or on a press of Replay (issue 442): a bubble effect on its bubble,
  // a screen effect over the conversation, and Invisible Ink veiled again. The kit plays nothing under reduced motion.
  playEffect(m) {
    if (!m || !m.sendEffect) return;
    if (m.sendEffect === INK_EFFECT && this.inkShown.has(m.id)) this.toggleInk(m.id);
    const row = this.rowOf(m.id);
    const bubble = row && row.querySelector('.bubble');
    if (sendEffectKind(m.sendEffect) === 'bubble') playBubbleEffect(bubble, m.sendEffect);
    else playScreenEffect(this.querySelector('.screen-effect'), m.sendEffect, { bubble, text: m.text });
  }

  // A press on a bubble sent with Invisible Ink shows its words, and another veils them again.
  toggleInk(id) {
    const next = new Set(this.inkShown);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.inkShown = next;
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
  // A menu opened on a link (a right click on it, or a press held on it) copies that link; opened anywhere else on the
  // message it copies the message's first link.
  openMenu(m, e) {
    if (e) e.preventDefault();
    const on = e ? linkAt(e.target) : this.pressLink;
    this.pop = { id: m.id, kind: 'menu', side: 'above', link: on };
  }

  // A link in a message opens in the platform's browser through the shell, never in the app; app-root hands it on. A
  // click that only ends a long press is swallowed before it reaches here (swallow), so holding a link never opens it.
  openLink(e, href) {
    e.preventDefault();
    e.stopPropagation();
    this.dispatchEvent(new CustomEvent('open-external', { bubbles: true, composed: true, detail: { url: href } }));
  }

  // Copy link puts the address on the clipboard and says so under the message for a moment.
  async copyLink(m, href) {
    this.pop = null;
    const ok = await copyToClipboard(href);
    clearTimeout(this.ownNoteTimer);
    this.ownNote = { id: m.id, text: ok ? 'Link copied' : 'The link could not be copied.' };
    this.ownNoteTimer = setTimeout(() => { this.ownNote = null; }, 2500);
    return ok;
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
    this.revealedId = null;
    const held = e.pointerType === 'touch' || (e.pointerType === 'mouse' && e.button === 0);
    if (!held || e.target?.closest?.('.message-pop')) return;
    clearTimeout(this.pressTimer);
    this.held = false;
    this.pressLink = linkAt(e.target);
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

// A pressed notice's message (issue 331), brought into view and never marked (issue 368). A reply in a thread opens its thread, where
  // it is drawn; any other message is held a third of the way down the conversation, the place the keep holds it at
  // while pictures above it load, and given focus so a screen reader starts there.
  async revealMessage(id) {
    const m = (this.messages || []).find((x) => x.id === id);
    if (!m) return;
    const inThread = threadRoot(this.messages, id) !== id && platformCapabilities(platformOf(this.chat)).thread;
    if (inThread) this.openThread(m);
    else this.replyingTo = null;
    this.revealedId = id;
    await this.updateComplete;
    const row = this.rowOf(id);
    if (!row) return;
    if (inThread) {
      row.scrollIntoView({ block: 'center' });
    } else {
      const list = this.querySelector('.messages');
      this.keep.anchor = { key: String(id), offset: Math.round((list ? list.clientHeight : 0) / 3) };
      this.keep.restore();
    }
    row.focus({ preventScroll: true });
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
    if (detail && detail.editOf) {
      const messageId = detail.editOf;
      this.editing = null;
      return this.fire('edit', { messageId, text: detail.text });
    }
    this.replyingTo = null;
    return this.fire('send', detail);
  }

  // Edit puts the message's words in the composer (issue 391); Send saves the change and Escape leaves it as it was. The
  // window is checked again when Edit is pressed, so a menu left open past it offers nothing that would be refused.
  startEdit(m) {
    this.pop = null;
    this.reactFor = null;
    if (editRefusal(m, { platform: platformOf(this.chat), now: Date.now() })) return;
    this.editing = { id: m.id, text: m.text };
  }

  cancelEdit() {
    this.editing = null;
  }

  // The menu: when the message arrived (or was sent), then Reply in thread and React as icons from the shared set.
  menu(m) {
    const actions = messageActions(m, { sending: this.sending, platform: platformOf(this.chat), edit: Boolean(this.canEdit), now: Date.now() });
    // The lock sits beside the time, seen only when the menu is open, so it is there to check rather than to notice
    // (Abi, 2026-10-14).
    const lock = Boolean(serviceNote(this.chat)?.encrypted);
    const when = formatSeparator(m.sentAt, { now: Date.now(), locale: navigator.language });
    const links = messageLinks(m);
    const link = this.pop.link && links.includes(this.pop.link) ? this.pop.link : links[0] || null;
    return html`<div class="message-pop message-menu" role="toolbar" aria-label="Message" data-dismiss="pop" data-side=${this.pop.side} data-popover data-popover-edge=${this.pop.side === 'below' ? 'top' : 'bottom'} data-popover-align=${m.fromMe ? 'end' : 'start'}>
      ${lock ? html`<span class="icon message-lock" data-icon="lock" role="img" aria-label="End-to-end encrypted" title="End-to-end encrypted"></span>` : nothing}<time class="message-time" datetime="${m.sentAt}" aria-label="${(m.fromMe ? 'Sent ' : 'Received ') + when}">${when}</time>
      ${link ? html`<button type="button" class="message-action" aria-label="Copy link" title="Copy link" data-link=${link} @click=${press(() => this.copyLink(m, link))}><span class="icon" data-icon="link" aria-hidden="true"></span></button>` : nothing}
      ${actions.includes('save') ? html`<button type="button" class="message-action" aria-label="Save" title="Save" @click=${press(() => this.save(m))}><span class="icon" data-icon="download" aria-hidden="true"></span></button>` : nothing}
      ${actions.includes('reply') ? html`<button type="button" class="message-action" aria-label="Reply in thread" title="Reply in thread" @click=${press(() => this.openThread(m))}><span class="icon" data-icon="reply" aria-hidden="true"></span></button>` : nothing}
      ${actions.includes('react') ? html`<button type="button" class="message-action" aria-label="React" title="React" @click=${press(() => this.openReact(m))}><span class="icon" data-icon="smile-plus" aria-hidden="true"></span></button>` : nothing}
      ${actions.includes('edit') ? html`<button type="button" class="message-action" aria-label="Edit" title="Edit" @click=${press(() => this.startEdit(m))}><span class="icon" data-icon="pencil" aria-hidden="true"></span></button>` : nothing}
    </div>`;
  }

  // The other person typing (issue 390): an incoming bubble of three dots under the newest message. It is not a
  // message (no .bubble-row), so no message selector, menu or scroll anchor ever takes it, and the conversation's keep
  // follows it at the end like any growth there while a reader scrolled up stays on the message they were on.
  typingRowHtml() {
    return html`<div class="typing-row" data-key="typing"><div class="bubble them typing-bubble" role="status" aria-label=${TYPING_BUBBLE_LABEL}><span class="typing-dot" aria-hidden="true"></span><span class="typing-dot" aria-hidden="true"></span><span class="typing-dot" aria-hidden="true"></span></div></div>`;
  }

  // What the composer's field says: Reply while a thread is open, as on the phone (issue 195).
  composerPlaceholder() {
    if (!this.sending) return 'Sending is off on the server';
    if (this.editing) return 'Edit message';
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
  bubble(it, lastMine, where = 'list') {
    const m = it.message;
    // An event in the conversation (issue 341), such as a group photo changing, is a quiet line across it rather than a
    // bubble: who did it and what changed, with the new photo beside the words.
    if (m.event) {
      return html`<div class="bubble-row event" data-id=${m.id}><div class="conv-event">${m.event.photo ? html`<app-avatar .photo=${m.event.photo} .client=${this.client}></app-avatar>` : nothing}<span>${eventText(m)}</span></div></div>`;
    }
    const mine = m.fromMe;
    const front = where === 'thread' || !this.replyingTo;
    const targeted = this.reactFor === m.id;
    const mark = where === 'list' ? marksOf(this.messages).get(m.id) || null : null;
    const isReply = Boolean(mark && mark.root);
    const row = ['bubble-row', mine ? 'mine' : 'theirs', it.first ? 'first' : '', it.last ? 'last' : '', targeted || (this.editing && this.editing.id === m.id) ? 'targeted' : '', isReply ? 'thread-reply' : '', this.revealedId === m.id ? 'revealed' : ''].filter(Boolean).join(' ');
    // Every message we send wears the theme's own colour, whatever the platform (Abi, 2026-10-12): who is on the other
    // end is told by serviceNote, never by a second bubble colour.
    const kind = mine ? 'me' : 'them';
    const label = mine && (m.state || m === lastMine) ? deliveryLabel(m) : '';
    const own = myReaction(m);
    const ownGlyph = own ? reactionGlyph(own) : null;
    const busy = this.reacting === m.id;
    const open = front && this.pop && this.pop.id === m.id ? this.pop.kind : null;
    const note = this.ownNote && this.ownNote.id === m.id ? this.ownNote.text : this.note && this.note.id === m.id ? this.note.text : '';
    // Invisible Ink (issue 442): the words are drawn under a veil until the bubble is pressed.
    const ink = m.sendEffect === INK_EFFECT;
    const veiled = ink && !this.inkShown.has(m.id);
    const words = linkedText(m.text, (e, href) => this.openLink(e, href), m.styles);
    // What an edited message said before, shown above it oldest first once its Edited control is pressed (issue 437).
    const versions = m.edited ? editVersions(m) : [];
    const showEdits = versions.length > 0 && Boolean(this.shownEdits && this.shownEdits.has(m.id));
    return html`<div class=${row} data-id=${m.id} data-thread=${isReply ? mark.root : nothing} tabindex=${front ? '0' : '-1'} aria-haspopup="true" data-dismiss-keep=${open ? 'pop' : ''} aria-expanded=${open ? 'true' : 'false'} aria-busy=${busy ? 'true' : 'false'} @click=${this.swallowClick} @contextmenu=${(e) => this.openMenu(m, e)} @pointerdown=${(e) => this.pressStart(m, e)} @pointerup=${() => this.pressEnd()} @pointercancel=${() => this.pressEnd()} @pointermove=${(e) => this.pressMove(e)}>
      ${!mine && this.chat.isGroup && it.first ? html`<div class="sender">${(this.chat.members || []).find((member) => handleKey(member.handle) === handleKey(m.sender))?.name || m.sender || ''}</div>` : nothing}
      <div class="bubble-body">
        ${m.attachments.map((a) => html`<app-attachment .attachment=${a} .client=${this.client} .mine=${mine}></app-attachment>`)}
        ${m.link ? html`<app-link-card .link=${m.link} .client=${this.client}></app-link-card>` : nothing}
        ${showEdits ? versions.map((v) => html`<div class="bubble edit-version ${kind}">${v.text}</div>`) : nothing}
        ${m.text && !(m.link && m.text.trim() === m.link.url) ? html`<div class=${'bubble ' + kind + (m.state ? ' state-' + m.state : '')} data-send-effect=${m.sendEffect || nothing} data-ink=${ink ? (this.inkShown.has(m.id) ? 'shown' : 'veiled') : nothing} @click=${ink ? () => this.toggleInk(m.id) : isReply ? () => this.openThread(m) : nothing}>${ink ? html`<span class="ink-words" aria-hidden=${veiled ? 'true' : nothing}>${words}</span>${veiled ? html`<span class="ink-veil" role="img" aria-label="Invisible Ink, press to reveal"></span>` : nothing}` : words}</div>` : nothing}
        ${m.payloads ? html`<div class="attachment-file payload-quiet"><span class="attachment-name">Attachment</span></div>` : nothing}
        ${m.reactions.length ? html`<div class="reactions">${summarizeReactions(m.reactions).map((r) => html`<span class=${'reaction' + (r.glyph === ownGlyph ? ' mine' : '')} title=${r.glyph === ownGlyph ? 'Your reaction' : nothing}>${r.glyph}${r.count > 1 ? ' ' + r.count : ''}</span>`)}</div>` : nothing}
        ${open === 'menu' ? this.menu(m) : nothing}
      </div>
      ${m.edited && versions.length ? html`<button type="button" class="edited-mark edited-toggle" aria-expanded="${showEdits ? 'true' : 'false'}" @click=${press(() => this.toggleEdits(m.id))}>${showEdits ? 'Hide edits' : 'Edited'}</button>` : m.edited ? html`<div class="edited-mark">Edited</div>` : nothing}
      ${sendEffectLine(m.sendEffect) ? html`<div class="send-effect-line"><span class="send-effect-name">${sendEffectLine(m.sendEffect)}</span><button type="button" class="send-effect-replay" aria-label=${'Replay ' + sendEffectName(m.sendEffect)} @click=${press(() => this.playEffect(m))}>Replay</button></div>` : nothing}
      ${label ? html`<div class="delivery">${label}${m.note ? ' \u00b7 ' + m.note : ''}</div>` : nothing}
      ${note ? html`<div class="message-note" role="status">${note}</div>` : nothing}
    </div>`;
  }

  // Edited under a message with history shows its earlier versions, and Hide edits folds them away (issue 437).
  toggleEdits(id) {
    const next = new Set(this.shownEdits);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.shownEdits = next;
  }

  // The open thread: only its original and every reply, in order, each under its day and time, with the delivery status
  // of your last message in it, as a conversation of their own (issue 195).
  threadView() {
    const ids = threadIds(this.messages, this.replyingTo.id);
    const thread = (this.messages || []).filter((m) => ids.has(m.id));
    const lastMine = [...thread].reverse().find((m) => m.fromMe) || null;
    const now = Date.now();
    const locale = navigator.language;
    const items = groupMessages(thread, { gapMs: 0 });
    return html`<div class="thread-view">
      <div class="thread-list" role="dialog" aria-label="Thread" data-dismiss="thread"><div class="thread-card-head">${closeButtonHtml({ owner: 'thread', label: 'Close thread', onClose: () => this.closeThread() })}</div>${items.map((it) => (it.kind === 'separator' ? html`<div class="separator">${formatSeparator(it.at, { now, locale })}</div>` : this.bubble(it, lastMine, 'thread')))}</div>
    </div>`;
  }

  render() {
    const now = Date.now();
    const locale = navigator.language;
    const items = groupMessages(this.messages || []);
    const lastMine = [...(this.messages || [])].reverse().find((m) => m.fromMe) || null;
    const note = serviceNote(this.chat);
    const thread = Boolean(this.replyingTo);
    const title = chatTitle(this.chat);
    const detail = this.chat.isGroup ? this.chat.participants.length + ' people' : '';
    const typing = typingNote(this.typing, now);
    // On a phone the way back to the chats list is the chats icon from the shared set, named for where it goes, never a
    // back arrow (issue 168); the same control Settings draws. An open thread leaves the contact header as it is, way
    // back included: its close control is in the thread card (issue 213).
    return html`<header class="conv-head"><button class="conv-back" aria-label="Back to chats" @click=${press(() => this.fire('back'))}><span class="icon" data-icon="messages-square" aria-hidden="true"></span></button><app-avatar .title=${title} .photo=${this.chat?.photo || null} .client=${this.client}></app-avatar><div class="conv-title"><div class="chat-name-row"><div class="chat-name" title=${note && !note.apple ? note.label : nothing}>${title}</div>${note && note.apple ? html`<span class="icon service-mark" data-icon="smartphone" role="img" tabindex="0" aria-label=${note.label} title=${note.label}></span>` : nothing}</div>${typing ? html`<div class="muted small typing" role="status">${typing}</div>` : detail ? html`<div class="muted small">${detail}</div>` : nothing}</div>${this.chat && this.chat.isGroup ? html`<button type="button" class="conv-info" aria-label="Group details" title="Group details" @click=${press(() => this.fire('groupinfo'))}><span class="icon" data-icon="info" aria-hidden="true"></span></button>` : nothing}${this.chat && !this.chat.isGroup && hasContactEditor(this.host) && (this.chat.participants || []).length ? html`<button type="button" class="conv-info conv-edit-contact" aria-label="Edit contact" title="Edit contact" @click=${press(() => this.editContact())}><span class="icon" data-icon="pencil" aria-hidden="true"></span></button>` : nothing}${this.windowControls && this.windowControls.drawn ? windowControlsHtml({ order: this.windowControls.order, maximized: this.maximized, onAction: (name) => this.fire('window-action', name) }) : nothing}</header>
      <div class="conv-body" data-thread=${thread ? this.replyingTo.id : nothing} data-reacting=${this.reactFor || nothing} data-backdrop=${this.chat?.background ? this.chat.background.id : nothing}>
        ${this.chat?.background ? html`<app-backdrop class="conv-backdrop" aria-hidden="true" .picture=${this.chat.background} .client=${this.client}></app-backdrop>` : nothing}
        <div class=${'messages' + (thread ? ' behind' : '')} role="log" aria-live="polite" ?inert=${thread} aria-hidden=${thread ? 'true' : nothing} @scroll=${this.nearTop}>
          <div class="history-space history-space-before" aria-hidden="true"></div>
          ${this.hasMore ? html`<button class="load-older" @click=${press(() => this.fire('older', this.historyMeasurements()))}>Load earlier messages</button>` : nothing}
          ${items.map((it) => (it.kind === 'separator' ? html`<div class="separator">${formatSeparator(it.at, { now, locale })}</div>` : [this.bubble(it, lastMine, 'list'), this.threadSummary(it.message)]))}
          ${this.historyWindow?.hasNewer ? html`<button class="load-older" @click=${press(() => this.fire('newer', this.historyMeasurements()))}>Load newer messages</button>` : nothing}
          <div class="history-space history-space-after" aria-hidden="true"></div>
          ${typingBubble(this.typing, now) ? this.typingRowHtml() : nothing}
          ${this.reveal?.pending ? html`<div class="reveal-pending" role="status">The message you opened is still loading.</div>` : nothing}
        </div>
        <div class="screen-effect" aria-hidden="true"></div>
        ${thread ? this.threadView() : nothing}
      </div>
      <app-composer data-dismiss-keep="thread" .disabled=${!this.sending} .maxBytes=${this.uploadMaxBytes} .phone=${this.phone} .placeholder=${this.composerPlaceholder()} .replyTo=${this.replyingTo} .reactFor=${this.reactFor} .editing=${this.editing} @send=${(e) => respond(e, this.onSend(e.detail))} @edit-cancel=${() => this.cancelEdit()} @reply-cancel=${() => this.closeThread()} @react-pick=${(e) => this.reactPicked(e.detail)} @react-cancel=${() => { this.reactFor = null; }}></app-composer>`;
  }
}

customElements.define('app-conversation', AppConversation);
