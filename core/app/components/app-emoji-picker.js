import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { press } from '../../kit/press.js';
import { keepScroll } from '../../kit/scroll.js';
import { aimCarets } from '../../kit/popover.js';
import { dismissable } from '../../kit/dismiss.js';
import { growFrom } from '../../kit/motion.js';
import { EMOJI_CATEGORIES } from '../rules/emoji-data.js';
import { emojiInCategory, searchEmoji, frequentEmoji, emojiPickerSections, pickerSide, isEmoji, panelEmoji, toneChoices, chooseTone, cleanTones } from '../rules/emoji.js';
import { canDrawEmoji } from '../emoji-support.js';

// The recently used list is the shell's storage, shared by every place the picker opens (the composer, and a
// message's reaction), so an emoji used in one is recent in the other, and it outlives a restart. Every shell stores
// text only (core/spec/host-bridge.json): the list was handed over as an array, which the desktop's keychain encryption
// threw on, iOS refused and Android kept as a string the load then discarded, so it never outlived the app. It goes
// as JSON now, trimmed from its oldest end to fit the smallest shell's limit (iOS, 8 KB), and a value that is not a
// JSON list, such as one from before, reads as empty. A plain browser keeps it for the page, and a missing bridge or a
// rejected read leaves the list empty rather than failing.
const FREQUENT_KEY = 'emoji.frequent';
const FREQUENT_MAX = 200;
const FREQUENT_BYTES = 8000;

export function encodeFrequent(list) {
  let kept = list.slice(-FREQUENT_MAX);
  let text = JSON.stringify(kept);
  while (kept.length && new TextEncoder().encode(text).length > FREQUENT_BYTES) {
    kept = kept.slice(Math.max(1, Math.ceil(kept.length / 10)));
    text = JSON.stringify(kept);
  }
  return text;
}

export function decodeFrequent(text) {
  if (typeof text !== 'string') return [];
  try {
    const list = JSON.parse(text);
    return Array.isArray(list) ? list.filter((c) => typeof c === 'string' && isEmoji(c)) : [];
  } catch {
    return [];
  }
}

export async function loadRecentEmoji() {
  try {
    return decodeFrequent(await window.bridge?.call('storage.get', { key: FREQUENT_KEY }));
  } catch {
    return [];
  }
}

export async function rememberEmoji(list, char) {
  const next = [...list, char].slice(-FREQUENT_MAX);
  try {
    await window.bridge?.call('storage.set', { key: FREQUENT_KEY, value: encodeFrequent(next) });
  } catch {
    /* page only */
  }
  return next;
}

// The tone chosen for each emoji (issue 392) is the shell's storage too, under its own key, as a JSON object from the
// yellow emoji to the toned sequence last chosen for it, so the choice holds in every panel and after a restart. A
// value that is not such an object, or names a tone of some other emoji, reads as no choice.
const TONES_KEY = 'emoji.tones';

// Trimmed from its oldest choice to fit the smallest shell's limit, as the recently used list is.
export function encodeTones(chosen) {
  let kept = Object.entries(cleanTones(chosen));
  let text = JSON.stringify(Object.fromEntries(kept));
  while (kept.length && new TextEncoder().encode(text).length > FREQUENT_BYTES) {
    kept = kept.slice(Math.max(1, Math.ceil(kept.length / 10)));
    text = JSON.stringify(Object.fromEntries(kept));
  }
  return text;
}

export function decodeTones(text) {
  if (typeof text !== 'string') return {};
  try {
    return cleanTones(JSON.parse(text));
  } catch {
    return {};
  }
}

export async function loadEmojiTones() {
  try {
    return decodeTones(await window.bridge?.call('storage.get', { key: TONES_KEY }));
  } catch {
    return {};
  }
}

export async function rememberTone(chosen, char) {
  const next = chooseTone(chosen, char);
  try {
    await window.bridge?.call('storage.set', { key: TONES_KEY, value: encodeTones(next) });
  } catch {
    /* page only */
  }
  return next;
}

// How long a finger or the mouse button rests on an emoji before its tones open, the same rest that opens a
// message's menu (app-conversation.js). An interaction timing, not a style.
const LONG_PRESS_MS = 500;
// How far a resting finger may drift and still be a long press rather than the start of a scroll, in CSS pixels.
const PRESS_SLOP = 10;

// The emoji panel: the grid, a search field, the categories and a recently used row. It owns nothing but what it is
// told: it takes the frequent list as a property and hands every pick back as an event, so the composer stays the one
// place that knows how a character reaches the message.
class AppEmojiPicker extends KitElement {
  // `dismiss` is the name its host registered the panel under with the kit's dismiss behaviour (core/kit/dismiss.js),
  // drawn on the panel's root so a press inside it is inside that host's panel.
  static properties = { frequent: { attribute: false }, dismiss: {}, query: { state: true }, category: { state: true }, side: { state: true }, tones: { state: true }, toneFor: { state: true } };

  constructor() {
    super();
    this.frequent = [];
    this.dismiss = '';
    this.query = '';
    this.category = EMOJI_CATEGORIES[0].id;
    this.side = 'above';
    // The tone chosen for each emoji, read from the shell, and the yellow emoji whose tones are open, or null.
    this.tones = {};
    this.toneFor = null;
    this.hold = null;
    this.held = null;
    loadEmojiTones().then((t) => { this.tones = t; });
    // The tones open over the panel and close through the kit like every popover, above the panel in the stack, so a
    // press elsewhere in the panel or Escape closes the tones and leaves the panel open.
    dismissable(this, { name: 'emoji-tones', open: () => Boolean(this.toneFor), close: () => { this.toneFor = null; } });
    // The grid and the recents row each keep their place on an emoji across a re-render and a resize (issue 142).
    const glyph = (el) => el.textContent;
    this.keepGrid = keepScroll(this, { scroller: '.emoji-grid', items: '.emoji-cell', key: glyph });
    this.keepRow = keepScroll(this, { scroller: '.emoji-row', items: '.emoji-cell', key: glyph });
    this.keepTones = keepScroll(this, { scroller: '.emoji-tones', items: '.emoji-cell', key: glyph });
  }

  // The panel is drawn beside the composer that holds the emoji button, so where it landed relative to that
  // composer says which edge faces the button. The panel keeps one height, so moving the recents row never moves
  // the panel and this settles after one pass.
  updated(changed) {
    if (changed && changed.has('toneFor')) this.placeTones(changed.get('toneFor'));
    const panel = this.querySelector('.emoji-picker');
    // The panel wears the shared caret, aimed at the composer's emoji button that opened it (issue 217).
    if (panel) aimCarets(this);
    const anchor = this.parentElement;
    if (!panel || !anchor) return;
    const side = pickerSide(panel.getBoundingClientRect(), anchor.getBoundingClientRect());
    if (side !== this.side) this.side = side;
  }

  setQuery(e) {
    this.query = e.currentTarget.value;
  }

  setCategory(id) {
    this.query = '';
    this.category = id;
    const field = this.parentElement?.querySelector('.emoji-search');
    if (field) field.value = '';
  }

  pick(char) {
    this.dispatchEvent(new CustomEvent('pick', { detail: char }));
  }

  // Choosing a tone remembers it for that emoji and is a pick of the toned character, so the slot draws it from now on.
  async pickTone(char) {
    this.toneFor = null;
    this.tones = await rememberTone(this.tones, char);
    this.pick(char);
  }

  // Each emoji once, in the tone chosen for it, and only the emoji this device draws (issue 392). A search may name a
  // toned emoji; it folds onto its slot, so the limit counts slots rather than tones.
  results() {
    const list = this.query.trim() ? searchEmoji(this.query) : emojiInCategory(this.category);
    const slots = panelEmoji(list, { chosen: this.tones, drawable: canDrawEmoji });
    return this.query.trim() ? slots.slice(0, 96) : slots;
  }

  openTones(base, cell) {
    if (!toneChoices(base).some((e) => e.char !== base && canDrawEmoji(e.char))) return false;
    this.toneCell = cell || null;
    this.toneFor = base;
    return true;
  }

  // A long press: a finger or the mouse button resting on a toned emoji opens its tones, and the release that ends the
  // rest is not also a pick. A drift past the slop is a scroll, which cancels it.
  holdStart(e, base) {
    if (e.button !== undefined && e.button !== 0) return;
    this.holdCancel();
    const cell = e.currentTarget;
    const at = { x: e.clientX, y: e.clientY };
    const timer = setTimeout(() => {
      this.hold = null;
      if (this.openTones(base, cell)) this.held = cell;
    }, LONG_PRESS_MS);
    this.hold = { timer, at };
  }

  holdMove(e) {
    if (!this.hold) return;
    if (Math.hypot(e.clientX - this.hold.at.x, e.clientY - this.hold.at.y) > PRESS_SLOP) this.holdCancel();
  }

  holdCancel() {
    if (this.hold) clearTimeout(this.hold.timer);
    this.hold = null;
  }

  // A right click, or the platform's own long press, opens the tones in place of the system menu.
  contextTones(e, base) {
    e.preventDefault();
    this.holdCancel();
    if (this.openTones(base, e.currentTarget) && e.pointerType === 'touch') this.held = e.currentTarget;
  }

  // The press that ended a long press is the long press's; any other is a pick of what the slot draws.
  pressCell(e, char) {
    if (this.held && e && this.held === e.currentTarget) {
      this.held = null;
      e.preventDefault();
      return undefined;
    }
    this.held = null;
    return this.pick(char);
  }

  cell(char, name, slot = null) {
    const label = name || char;
    if (!slot || !slot.toned) {
      return html`<button type="button" class="emoji-cell" title=${label} aria-label=${label} @click=${press(() => this.pick(char), { repeat: true })}>${char}</button>`;
    }
    const open = this.toneFor === slot.base;
    return html`<button type="button" class="emoji-cell toned" title=${label} aria-label=${label} aria-haspopup="menu" aria-expanded=${open ? 'true' : 'false'} data-dismiss-keep="emoji-tones" data-base=${slot.base}
      @pointerdown=${(e) => this.holdStart(e, slot.base)} @pointermove=${(e) => this.holdMove(e)} @pointerup=${() => this.holdCancel()} @pointercancel=${() => this.holdCancel()} @pointerleave=${() => this.holdCancel()}
      @contextmenu=${(e) => this.contextTones(e, slot.base)}
      @click=${press((e) => this.pressCell(e, char), { repeat: true })}>${char}</button>`;
  }

  // The tones of one emoji: the yellow one first, then every tone this device draws, the one in use marked. It opens
  // over its emoji and grows out of it, and its caret points at it.
  toneMenu() {
    const base = this.toneFor;
    if (!base) return nothing;
    const current = this.tones[base] || base;
    const choices = toneChoices(base).filter((e) => canDrawEmoji(e.char));
    return html`<div class="emoji-tones" role="menu" aria-label="Skin tone" data-dismiss="emoji-tones" data-popover data-popover-edge=${this.toneEdge || 'bottom'}>
      ${choices.map((e) => html`<button type="button" role="menuitemradio" class="emoji-cell" aria-checked=${e.char === current ? 'true' : 'false'} title=${e.name} aria-label=${e.name} @click=${press(() => this.pickTone(e.char))}>${e.char}</button>`)}
    </div>`;
  }

  // Where the tones sit: over their emoji, centred on it and kept inside the panel, or under it when there is no room
  // above. Placed through custom properties, since the page's policy drops a style attribute.
  placeTones(before) {
    const pop = this.querySelector('.emoji-tones');
    const panel = this.querySelector('.emoji-picker');
    if (!pop || !panel || !this.toneFor) return;
    const cell = this.toneCell && this.toneCell.isConnected ? this.toneCell : this.querySelector('.emoji-cell.toned[aria-expanded="true"]');
    if (!cell) return;
    const p = panel.getBoundingClientRect();
    const c = cell.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const gap = parseFloat(getComputedStyle(pop).getPropertyValue('--size-caret')) || 0;
    const pad = parseFloat(getComputedStyle(panel).paddingLeft) || 0;
    const left = Math.min(Math.max(c.left - p.left + c.width / 2 - w / 2, pad), Math.max(pad, p.width - w - pad));
    let top = c.top - p.top - h - gap;
    let edge = 'bottom';
    if (top < 0) {
      top = c.bottom - p.top + gap;
      edge = 'top';
    }
    pop.style.setProperty('--tones-x', left + 'px');
    pop.style.setProperty('--tones-y', top + 'px');
    this.toneEdge = edge;
    pop.dataset.popoverEdge = edge;
    aimCarets(this);
    if (!before) growFrom(pop, c, { fade: true, duration: 'grow', easing: 'ease' });
  }

  section(id, frequent, list, searching) {
    if (id === 'recents') {
      const edge = this.side === 'below' ? 'at-top' : 'at-bottom';
      return html`<div class=${'emoji-row ' + edge} aria-label="Frequently used">${frequent.filter((c) => canDrawEmoji(c)).map((c) => this.cell(c))}</div>`;
    }
    if (id === 'grid') {
      return list.length
        ? html`<div class="emoji-grid">${list.map((e) => this.cell(e.char, e.name, e))}</div>`
        : html`<div class="emoji-empty muted small">No emoji found</div>`;
    }
    if (id === 'search') {
      return html`<input class="emoji-search" type="search" placeholder="Search emoji" aria-label="Search emoji" .value=${this.query} @input=${this.setQuery}>`;
    }
    return html`<div class="emoji-tabs" role="tablist">
      ${EMOJI_CATEGORIES.map((c) => html`<button type="button" role="tab" class=${'emoji-tab' + (c.id === this.category && !searching ? ' active' : '')} aria-selected=${c.id === this.category && !searching ? 'true' : 'false'} @click=${press(() => this.setCategory(c.id))}>${c.label}</button>`)}
    </div>`;
  }

  // The sections draw in the order emojiPickerSections gives: the grid, then the search field and the categories,
  // with the recently used row on the edge facing the emoji button. The field sits below the results so that
  // narrowing them never moves the thing the reader is pointing at, and the order the eye reads is the order the
  // keyboard walks. The panel keeps one height, so the composer below never shifts.
  render() {
    const frequent = frequentEmoji(this.frequent);
    const searching = Boolean(this.query.trim());
    const list = this.results();
    const sections = emojiPickerSections({ side: this.side, recents: frequent.length > 0 });
    return html`<div class="emoji-picker" role="dialog" aria-label="Emoji" data-dismiss=${this.dismiss} data-side=${this.side} data-popover data-popover-edge=${this.side === 'below' ? 'top' : 'bottom'}>
      ${sections.map((id) => this.section(id, frequent, list, searching))}
      ${this.toneMenu()}
    </div>`;
  }
}

customElements.define('app-emoji-picker', AppEmojiPicker);
