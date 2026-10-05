import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { press } from '../../kit/press.js';
import { actionButtonLabels } from '../../kit/button.js';
import { keepScroll } from '../../kit/scroll.js';
import { closeButtonHtml } from './close-button.js';

// The sibling's card anatomy, in this document rather than a native overlay view.
// Each tone draws the sibling's own glyph for it from the shared icon set in core/spec/tokens.json.
const TONE_ICONS = { ok: 'check', warn: 'alert-triangle', error: 'circle-x', info: 'info' };
class AppNotices extends KitElement {
  static properties = { notices: {}, runAction: {} };
  constructor() {
    super();
    this.notices = [];
    this.keep = keepScroll(this, { scroller: '.app-notice-stack' });
  }
  // A press on a card's body is that notice's own action and nothing else (issue 253): the card takes the press, so it
  // never falls through to the conversation or dismisses the sheet under it, and the close control and the in-card action
  // keep their own presses.
  onCard(e, notice) {
    if (!notice.action) return;
    const hit = e.target && typeof e.target.closest === 'function' ? e.target : null;
    if (hit && (hit.closest('.close-button') || hit.closest('.app-notice-action'))) return;
    this.runAction?.(notice.action.command);
  }

  render() {
    const visible = this.notices.filter((n) => !n.read);
    return html`<section class="app-notice-stack" aria-label="App notices" aria-live="polite" aria-relevant="additions text">${visible.map((n) => html`<article class="app-notice" data-id=${n.id} data-tone=${n.tone} @click=${(e) => this.onCard(e, n)}>
      <span class="app-notice-icon icon" data-icon=${TONE_ICONS[n.tone] || TONE_ICONS.info} aria-hidden="true"></span>
      <div class="app-notice-body"><span>${n.message}</span>${n.detail ? html`<span class="muted">${n.detail}</span>` : nothing}${n.percent === null ? nothing : html`<progress class="app-notice-progress" aria-label="Download progress" max="1" value=${n.percent}></progress>`}
      ${n.action ? html`<button type="button" class="action-button app-notice-action" data-command=${n.action.command} @click=${press(() => this.runAction?.(n.action.command))}>${actionButtonLabels({ idle: n.action.label, pending: 'Working\u2026', failure: 'Could not' })}</button>` : nothing}</div>
      ${closeButtonHtml({ owner: 'notice', label: 'Dismiss notice', title: 'Mark read. Progress stays dismissed until the state changes.', onClose: () => this.dispatchEvent(new CustomEvent('notice-dismiss', { detail: { id: n.id }, bubbles: true, composed: true })) })}
    </article>`)}</section>`;
  }
}
customElements.define('app-notices', AppNotices);
