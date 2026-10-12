import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { press } from '../../kit/press.js';
import { keepScroll } from '../../kit/scroll.js';
import { play } from '../../kit/motion.js';
import { closeButtonHtml } from './close-button.js';
import { dragOutcome } from '../rules/sheet-drag.js';

// The chrome Settings and About draw inside their sheet (issue 338): a grab handle, then a header with the page's
// title and one-line description, a round back arrow at its start when the sheet is stacked over another, and the
// round X at its end, then the page's sections. Both buttons are drawn as the send button is, so the sheet's ways out
// read as one family with the composer's one action. The pages supply the words and the body; this supplies the ways
// out, so the two pages cannot drift into two different ways back.
//
// The handle and the whole header drag the card down: let go far enough down, or with a downward flick, and the sheet
// goes back the way the back arrow would (rules/sheet-drag.js decides), otherwise it springs back into place. The card
// follows the finger through its own translate, which the sheet's leaving animation adds to, so a sheet let go mid-drag
// carries on down from where it is rather than jumping back first. Escape and a press on the backdrop are the other
// ways back; the page registers the card with the kit's one dismiss behaviour (core/kit/dismiss.js) for both.
//
// It takes its body as a property rather than a <slot>, because components here render into light DOM and a slot
// only projects in a shadow root. nav is drawn between the heading and the scrolled body, so Settings' tabs stay in
// place while a section scrolls.
class AppSheet extends KitElement {
  static properties = {
    title: {},
    description: {},
    backLabel: {},
    closeLabel: {},
    nav: { attribute: false },
    content: { attribute: false },
  };

  constructor() {
    super();
    this.title = '';
    this.description = '';
    // The way back to the sheet underneath, named for where it goes; none when nothing is underneath, so the X is the
    // one way out.
    this.backLabel = '';
    this.closeLabel = 'Close';
    this.nav = null;
    this.content = null;
    this.drag = null;
    // The page's body scrolls, and keeps its place on a section across a re-render and a resize (issue 142). Only the
    // section on show is an anchor: a tab's hidden panels have no place on screen to keep.
    this.keep = keepScroll(this, { scroller: '.sheet-body', items: '.sheet-section:not([hidden])' });
  }

  // The way back, raised as an event the page above catches and the app turns into the real move, so the sheet
  // never decides where back goes.
  back() {
    this.dispatchEvent(new CustomEvent('back', { bubbles: true, composed: true }));
  }

  // The X takes every sheet down, the one underneath included.
  close() {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  card() {
    return this.closest('.sheet');
  }

  // A drag starts on the handle or the header, never on one of its buttons, and only with the primary button.
  onDragStart(e) {
    if (e.button !== 0 || e.target.closest('button')) return;
    const card = this.card();
    if (!card) return;
    this.drag = { id: e.pointerId, y0: e.clientY, dy: 0, t: e.timeStamp, v: 0, height: card.getBoundingClientRect().height };
    // Captured, so the drag follows the finger past the card's edge; a pointer the page did not see go down cannot be.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* the move and up events still reach the grip */ }
    card.dataset.dragging = '';
  }

  onDragMove(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const dy = Math.max(0, e.clientY - d.y0);
    const dt = e.timeStamp - d.t;
    if (dt > 0) d.v = (dy - d.dy) / dt;
    d.dy = dy;
    d.t = e.timeStamp;
    const card = this.card();
    if (card) card.style.setProperty('--sheet-drag', dy + 'px');
  }

  onDragEnd(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    const card = this.card();
    if (!card) return;
    delete card.dataset.dragging;
    if (e.type === 'pointerup' && dragOutcome({ dy: d.dy, velocity: d.v, height: d.height }) === 'dismiss') {
      this.back();
      return;
    }
    card.style.removeProperty('--sheet-drag');
    if (d.dy) play(card, [{ translate: '0 ' + d.dy + 'px' }, { translate: '0 0' }], { duration: 'sheet-in', easing: 'sheet-ease' });
  }

  render() {
    const down = (e) => this.onDragStart(e);
    const move = (e) => this.onDragMove(e);
    const up = (e) => this.onDragEnd(e);
    return html`<div class="sheet-grip" @pointerdown=${down} @pointermove=${move} @pointerup=${up} @pointercancel=${up}>
        <span class="sheet-handle" aria-hidden="true"></span>
        <header class="sheet-head">
          ${this.backLabel ? html`<button type="button" class="sheet-back" aria-label=${this.backLabel} title=${this.backLabel} @click=${press(() => this.back())}><span class="icon" data-icon="arrow-left" aria-hidden="true"></span></button>` : nothing}
          <div class="sheet-heading">
            <h2 class="sheet-title">${this.title}</h2>
            <p class="sheet-desc">${this.description}</p>
          </div>
          ${closeButtonHtml({ owner: 'sheet', label: this.closeLabel, look: 'solid', onClose: () => this.close() })}
        </header>
      </div>
      ${this.nav ? html`<div class="sheet-nav">${this.nav}</div>` : nothing}
      <div class="sheet-body">${this.content}</div>`;
  }
}

customElements.define('app-sheet', AppSheet);
