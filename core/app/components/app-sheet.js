import { html } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { press } from '../../kit/press.js';
import { keepScroll } from '../../kit/scroll.js';

// The chrome Settings and About draw inside their sheet: a top strip that is itself the back control, the page's
// title and its one-line description, then the page's sections. The pages supply the words and the body; this
// supplies the way out, so the two pages cannot drift into two different ways back.
//
// The strip is the WHOLE top of the card rather than a small button at its leading edge: it carries the arrow, the
// label and the key that does the same thing, and it spans the card's full width, so anywhere on the strip goes
// back. Escape does the same, and a press on the backdrop outside the card is a third; the sheet itself owns that
// press (rules/sheet.js), because the backdrop is its own element beside this one.
//
// It takes its body as a property rather than a <slot>, because components here render into light DOM and a slot
// only projects in a shadow root.
class AppSheet extends KitElement {
  static properties = {
    title: {},
    description: {},
    label: {},
    content: { attribute: false },
  };

  constructor() {
    super();
    this.title = '';
    this.description = '';
    this.label = 'Back';
    this.content = null;
    // The page's body scrolls, and keeps its place on a section across a re-render and a resize (issue 142).
    this.keep = keepScroll(this, { scroller: '.sheet-body', items: '.sheet-section' });
  }

  connectedCallback() {
    super.connectedCallback();
    this.onKey = (e) => { if (e.key === 'Escape') this.back(); };
    document.addEventListener('keydown', this.onKey);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this.onKey);
  }

  // The way back, raised as an event the page above catches and the app turns into the real move, so the sheet
  // never decides where back goes.
  back() {
    this.dispatchEvent(new CustomEvent('back', { bubbles: true, composed: true }));
  }

  render() {
    return html`<button type="button" class="sheet-back" @click=${press(() => this.back())}>
        <span class="sheet-back-icon" aria-hidden="true"><span class="icon" data-icon="arrow-left" aria-hidden="true"></span></span>
        <span class="sheet-back-label">${this.label}</span>
        <kbd class="sheet-esc" aria-hidden="true">esc</kbd>
      </button>
      <header class="sheet-head">
        <h2 class="sheet-title">${this.title}</h2>
        <p class="sheet-desc">${this.description}</p>
      </header>
      <div class="sheet-body">${this.content}</div>`;
  }
}

customElements.define('app-sheet', AppSheet);
