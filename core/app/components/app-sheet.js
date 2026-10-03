import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { press } from '../../kit/press.js';
import { keepScroll } from '../../kit/scroll.js';

// The chrome Settings and About draw inside their sheet: a top strip that is itself the back control, the page's
// title and its one-line description, then the page's sections. The pages supply the words and the body; this
// supplies the way out, so the two pages cannot drift into two different ways back.
//
// The strip is the WHOLE top of the card rather than a small button at its leading edge: it carries the arrow, the
// label and the key that does the same thing, and it spans the card's full width, so anywhere on the strip goes
// back. Escape does the same, and a press on the backdrop outside the card is a third; the page registers the card
// with the kit's one dismiss behaviour (core/kit/dismiss.js) for both, because the backdrop is its own element beside
// this one.
//
// It takes its body as a property rather than a <slot>, because components here render into light DOM and a slot
// only projects in a shadow root.
//
// On a phone the sheet is a page that fills the screen (issue 167), and a page that returns to the chats list says so
// with the chats icon from the shared set and a label naming where it goes (issue 168): narrowLabel and narrowIcon are
// that way back, drawn in place of the arrow and the desktop's label below the phone breakpoint. The stylesheet picks
// one of the two, so the strip is one control with one press on every width. A page with no narrow way back (About,
// whose back returns to Settings) keeps its arrow everywhere. nav is drawn between the heading and the scrolled body,
// so Settings' tabs stay in place while a section scrolls.
class AppSheet extends KitElement {
  static properties = {
    title: {},
    description: {},
    label: {},
    narrowLabel: {},
    narrowIcon: {},
    nav: { attribute: false },
    content: { attribute: false },
  };

  constructor() {
    super();
    this.title = '';
    this.description = '';
    this.label = 'Back';
    this.narrowLabel = '';
    this.narrowIcon = '';
    this.nav = null;
    this.content = null;
    // The page's body scrolls, and keeps its place on a section across a re-render and a resize (issue 142). Only the
    // section on show is an anchor: a tab's hidden panels have no place on screen to keep.
    this.keep = keepScroll(this, { scroller: '.sheet-body', items: '.sheet-section:not([hidden])' });
  }

  // The way back, raised as an event the page above catches and the app turns into the real move, so the sheet
  // never decides where back goes.
  back() {
    this.dispatchEvent(new CustomEvent('back', { bubbles: true, composed: true }));
  }

  render() {
    const narrow = Boolean(this.narrowLabel && this.narrowIcon);
    return html`<button type="button" class="sheet-back" ?data-narrow=${narrow} @click=${press(() => this.back())}>
        <span class="sheet-back-wide">
          <span class="sheet-back-icon" aria-hidden="true"><span class="icon" data-icon="arrow-left" aria-hidden="true"></span></span>
          <span class="sheet-back-label">${this.label}</span>
        </span>
        ${narrow ? html`<span class="sheet-back-narrow">
          <span class="sheet-back-icon" aria-hidden="true"><span class="icon" data-icon=${this.narrowIcon} aria-hidden="true"></span></span>
          <span class="sheet-back-label">${this.narrowLabel}</span>
        </span>` : nothing}
        <kbd class="sheet-esc" aria-hidden="true">esc</kbd>
      </button>
      <header class="sheet-head">
        <h2 class="sheet-title">${this.title}</h2>
        <p class="sheet-desc">${this.description}</p>
      </header>
      ${this.nav ? html`<div class="sheet-nav">${this.nav}</div>` : nothing}
      <div class="sheet-body">${this.content}</div>`;
  }
}

customElements.define('app-sheet', AppSheet);
