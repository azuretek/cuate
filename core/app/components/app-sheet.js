import { html } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';

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
//
// `reveal` asks for one section of the body to be brought to the top of the scrolling body: { id } names the section
// by its data-section. Settings uses it for its About section, which the tray's About opens (issue 134). A new object
// each time, so asking for the same section twice brings it back twice.
class AppSheet extends KitElement {
  static properties = {
    title: {},
    description: {},
    label: {},
    content: { attribute: false },
    reveal: { attribute: false },
  };

  constructor() {
    super();
    this.title = '';
    this.description = '';
    this.label = 'Back';
    this.content = null;
    this.reveal = null;
  }

  // The section is scrolled to on the next frame rather than at once: the body's own elements (About's rows) render in
  // their own update after this one, and until they have, the body is too short to scroll the last section up.
  updated(changed) {
    super.updated?.(changed);
    if (!changed.has('reveal') || !this.reveal || !this.reveal.id) return;
    const want = this.reveal;
    requestAnimationFrame(() => {
      if (this.reveal !== want) return;
      const body = this.querySelector('.sheet-body');
      const target = body && [...body.querySelectorAll('[data-section]')].find((el) => el.dataset.section === want.id);
      if (!target) return;
      body.scrollTop += target.getBoundingClientRect().top - body.getBoundingClientRect().top;
    });
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
    return html`<button type="button" class="sheet-back" @click=${() => this.back()}>
        <span class="sheet-back-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m12 19-7-7 7-7"></path><path d="M19 12H5"></path></svg></span>
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
