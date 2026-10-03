import { html } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { press } from '../../kit/press.js';
import { keepScroll } from '../../kit/scroll.js';
import { EMOJI_CATEGORIES, emojiInCategory, searchEmoji, frequentEmoji, emojiPickerSections, pickerSide } from '../rules/emoji.js';

// The emoji panel: the grid, a search field, the categories and a recently used row. It owns nothing but what it is
// told: it takes the frequent list as a property and hands every pick back as an event, so the composer stays the one
// place that knows how a character reaches the message.
class AppEmojiPicker extends KitElement {
  static properties = { frequent: { attribute: false }, query: { state: true }, category: { state: true }, side: { state: true } };

  constructor() {
    super();
    this.frequent = [];
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
    return html`<div class="emoji-picker" role="dialog" aria-label="Emoji" data-side=${this.side}>
      ${sections.map((id) => this.section(id, frequent, list, searching))}
    </div>`;
  }
}

customElements.define('app-emoji-picker', AppEmojiPicker);
