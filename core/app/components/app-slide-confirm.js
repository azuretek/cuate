import { html } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { slideProgress, slideRelease, slideKey } from '../rules/slide.js';

// Slide to confirm: a track with a thumb that has to be carried to the far end before the action runs (issue 137). It
// fires `confirm` once, when the thumb reaches the end by drag or by key, and never on a press alone. The thumb's place
// is a custom property written through the CSSOM, which the page's style policy allows where a style attribute is not.
class AppSlideConfirm extends KitElement {
  static properties = { label: {}, progress: { state: true }, dragging: { state: true } };

  constructor() {
    super();
    this.label = 'Slide to confirm';
    this.progress = 0;
    this.dragging = false;
    this.drag = null;
    this.done = false;
  }

  travel() {
    const track = this.querySelector('.slide-track');
    const thumb = this.querySelector('.slide-thumb');
    return track && thumb ? Math.max(0, track.clientWidth - thumb.offsetWidth) : 0;
  }

  down(e) {
    if (this.done || e.button > 0) return;
    e.preventDefault();
    const thumb = e.currentTarget;
    if (thumb.setPointerCapture) thumb.setPointerCapture(e.pointerId);
    thumb.focus();
    const travel = this.travel();
    this.drag = { x: e.clientX, from: this.progress * travel, travel };
    this.dragging = true;
  }

  move(e) {
    if (!this.drag) return;
    this.progress = slideProgress(this.drag.from + e.clientX - this.drag.x, this.drag.travel);
  }

  up() {
    if (!this.drag) return;
    this.drag = null;
    this.dragging = false;
    this.progress = slideRelease(this.progress);
    if (this.progress === 1) this.finish();
  }

  // A cancelled pointer or a lost capture never confirms: the thumb goes back to the start.
  cancel() {
    if (!this.drag) return;
    this.drag = null;
    this.dragging = false;
    this.progress = 0;
  }

  key(e) {
    if (this.done) return;
    const next = slideKey(this.progress, e.key);
    if (next === null) return;
    e.preventDefault();
    this.progress = next;
    if (next >= 1) this.finish();
  }

  finish() {
    if (this.done) return;
    this.done = true;
    this.dispatchEvent(new CustomEvent('confirm'));
  }

  updated() {
    this.style.setProperty('--slide-progress', String(this.progress));
  }

  render() {
    const percent = Math.round(this.progress * 100);
    return html`<div class=${'slide-track' + (this.dragging ? ' dragging' : '')}>
      <span class="slide-fill" aria-hidden="true"></span>
      <span class="slide-label" aria-hidden="true">${this.label}</span>
      <span class="slide-thumb" role="slider" tabindex="0" aria-label=${this.label} aria-valuemin="0" aria-valuemax="100" aria-valuenow=${percent}
        @pointerdown=${this.down} @pointermove=${this.move} @pointerup=${this.up} @pointercancel=${this.cancel} @lostpointercapture=${this.cancel} @keydown=${this.key}>›</span>
    </div>`;
  }
}

customElements.define('app-slide-confirm', AppSlideConfirm);
