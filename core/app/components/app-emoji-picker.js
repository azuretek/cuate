import { html } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { press } from '../../kit/press.js';
import { keepScroll } from '../../kit/scroll.js';
import { aimCarets } from '../../kit/popover.js';
import { EMOJI_CATEGORIES } from '../rules/emoji-data.js';
import { emojiInCategory, searchEmoji, frequentEmoji, emojiPickerSections, pickerSide, isEmoji } from '../rules/emoji.js';

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

// The emoji panel: the grid, a search field, the categories and a recently used row. It owns nothing but what it is
// told: it takes the frequent list as a property and hands every pick back as an event, so the composer stays the one
// place that knows how a character reaches the message.
class AppEmojiPicker extends KitElement {
  // `dismiss` is the name its host registered the panel under with the kit's dismiss behaviour (core/kit/dismiss.js),
  // drawn on the panel's root so a press inside it is inside that host's panel.
  static properties = { frequent: { attribute: false }, dismiss: {}, query: { state: true }, category: { state: true }, side: { state: true } };

  constructor() {
    super();
    this.frequent = [];
    this.dismiss = '';
    this.query = '';
    this.category = EMOJI_CATEGORIES[0].id;
    this.side = 'above';
    // The grid and the recents row each keep their place on an emoji across a re-render and a resize (issue 142).
    const glyph = (el) => el.textContent;
    this.keepGrid = keepScroll(this, { scroller: '.emoji-grid', items: '.emoji-cell', key: glyph });
    this.keepRow = keepScroll(this, { scroller: '.emoji-row', items: '.emoji-cell', key: glyph });
  }

  // The panel is drawn beside the composer that holds the emoji button, so where it landed relative to that
  // composer says which edge faces the button. The panel keeps one height, so moving the recents row never moves
  // the panel and this settles after one pass.
  updated() {
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

  results() {
    return this.query.trim() ? searchEmoji(this.query, { limit: 96 }) : emojiInCategory(this.category);
  }

  cell(char, name) {
    const label = name || char;
    return html`<button type="button" class="emoji-cell" title=${label} aria-label=${label} @click=${press(() => this.pick(char), { repeat: true })}>${char}</button>`;
  }

  section(id, frequent, list, searching) {
    if (id === 'recents') {
      const edge = this.side === 'below' ? 'at-top' : 'at-bottom';
      return html`<div class=${'emoji-row ' + edge} aria-label="Frequently used">${frequent.map((c) => this.cell(c))}</div>`;
    }
    if (id === 'grid') {
      return list.length
        ? html`<div class="emoji-grid">${list.map((e) => this.cell(e.char, e.name))}</div>`
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
    </div>`;
  }
}

customElements.define('app-emoji-picker', AppEmojiPicker);
