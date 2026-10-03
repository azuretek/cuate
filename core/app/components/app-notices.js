import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { press } from '../../kit/press.js';
import { keepScroll } from '../../kit/scroll.js';

// The sibling's card anatomy, in this document rather than a native overlay view.
class AppNotices extends KitElement {
  static properties = { notices: {}, runAction: {} };
  constructor() {
    super();
    this.notices = [];
    this.keep = keepScroll(this, { scroller: '.app-notice-stack' });
  }
  render() {
    const visible = this.notices.filter((n) => !n.read);
    return html`<section class="app-notice-stack" aria-label="App notices" aria-live="polite" aria-relevant="additions text">${visible.map((n) => html`<article class="app-notice" data-id=${n.id} data-tone=${n.tone}>
      <span class="app-notice-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${n.tone === 'ok' ? html`<path d="M20 6 9 17l-5-5"></path>` : n.tone === 'warn' ? html`<path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"></path><path d="M12 9v4M12 17h.01"></path>` : html`<circle cx="12" cy="12" r="10"></circle>${n.tone === 'error' ? html`<path d="m15 9-6 6m0-6 6 6"></path>` : html`<path d="M12 16v-4M12 8h.01"></path>`}`}</svg></span>
      <div class="app-notice-body"><span>${n.message}</span>${n.detail ? html`<span class="muted">${n.detail}</span>` : nothing}${n.percent === null ? nothing : html`<progress class="app-notice-progress" aria-label="Download progress" max="1" value=${n.percent}></progress>`}
      ${n.action ? html`<button type="button" class="app-notice-action" data-command=${n.action.command} @click=${press(() => this.runAction?.(n.action.command))}>${n.action.label}</button>` : nothing}</div>
      <button type="button" class="app-notice-dismiss" aria-label="Dismiss notice" title="Mark read. Progress stays dismissed until the state changes." @click=${press(() => this.dispatchEvent(new CustomEvent('notice-dismiss', { detail: { id: n.id }, bubbles: true, composed: true })))}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"></path></svg></button>
    </article>`)}</section>`;
  }
}
customElements.define('app-notices', AppNotices);
