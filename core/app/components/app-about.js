import { html } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';

// The about page: everything it shows comes from the server's info route, so a version change in the repository
// changes what it draws without the page being edited.
const row = (label, value) => html`<div class="setting-row"><span class="setting-label">${label}</span><span class="setting-value">${value === undefined || value === null || value === '' ? 'Unknown' : value}</span></div>`;

class AppAbout extends KitElement {
  static properties = { info: { attribute: false } };

  constructor() {
    super();
    this.info = null;
  }

  render() {
    const info = this.info || {};
    const engine = info.engine || {};
    return html`<section class="page" aria-label="About">
      <header class="page-head"><button class="back" aria-label="Back" @click=${() => this.dispatchEvent(new CustomEvent('back'))}>←</button><h2 class="page-title">About</h2></header>
      <div class="page-body"><div class="setting-group">
        ${row('Product', info.product)}
        ${row('Server version', info.serverVersion)}
        ${row('API version', info.apiVersion)}
        ${row('Engine', engine.kind)}
        ${row('Engine version', engine.version)}
        ${row('Sending', info.sending ? 'On' : 'Off')}
        ${row('Epoch', info.epoch)}
      </div></div>
    </section>`;
  }
}

customElements.define('app-about', AppAbout);
