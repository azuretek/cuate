import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { EMOJI_CATEGORIES, emojiInCategory, searchEmoji, frequentEmoji } from '../rules/emoji.js';

// The emoji panel: a search field, the categories, a frequently used row and the
// grid. It owns nothing but what it is told: it takes the frequent list as a
// property and hands every pick back as an event, so the composer stays the one
// place that knows how a character reaches the message.
class AppEmojiPicker extends KitElement {
  static properties = { frequent: { attribute: false }, query: { state: true }, category: { state: true } };

  constructor() {
    super();
    this.frequent = [];
    this.query = '';
    this.category = EMOJI_CATEGORIES[0].id;
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
    return html`<button type="button" class="emoji-cell" title=${label} aria-label=${label} @click=${() => this.pick(char)}>${char}</button>`;
  }

  // The grid draws first, the frequently used row above it, and the search field
  // and the categories come after it. The field sits below the results so that
  // narrowing them never moves the thing the reader is pointing at, and the order
  // the eye reads is the order the keyboard walks: the results, then the field,
  // then the tabs. The panel keeps one height, so the composer below never shifts.
  render() {
    const frequent = frequentEmoji(this.frequent);
    const searching = Boolean(this.query.trim());
    const list = this.results();
    return html`<div class="emoji-picker" role="dialog" aria-label="Emoji">
      ${frequent.length ? html`<div class="emoji-row" aria-label="Frequently used">${frequent.map((c) => this.cell(c))}</div>` : nothing}
      ${list.length ? html`<div class="emoji-grid">${list.map((e) => this.cell(e.char, e.name))}</div>` : html`<div class="emoji-empty muted small">No emoji found</div>`}
      <input class="emoji-search" type="search" placeholder="Search emoji" aria-label="Search emoji" .value=${this.query} @input=${this.setQuery}>
      <div class="emoji-tabs" role="tablist">
        ${EMOJI_CATEGORIES.map((c) => html`<button type="button" role="tab" class=${'emoji-tab' + (c.id === this.category && !searching ? ' active' : '')} aria-selected=${c.id === this.category && !searching ? 'true' : 'false'} @click=${() => this.setCategory(c.id)}>${c.label}</button>`)}
      </div>
    </div>`;
  }
}

customElements.define('app-emoji-picker', AppEmojiPicker);
