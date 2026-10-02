import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { aboutModel, bugReportBlock } from '../../kit/rules/build.js';
import { copyToClipboard } from '../clipboard.js';
import { BUILD_SPEC } from '../rules/build-spec.js';

// The about page: every value comes from the half that owns it. The client's own build is what the shell reported on
// app.info, the server's is what the server reported on its info route, and the rows and labels come from the one spec
// in core/spec/build.json. The page never mixes the two, and it says plainly when the pair is not on one commit.
const row = ({ label, value }) => html`<div class="setting-row"><span class="setting-label">${label}</span><span class="setting-value">${value}</span></div>`;

class AppAbout extends KitElement {
  static properties = { info: { attribute: false }, host: { attribute: false }, copied: { state: true } };

  constructor() {
    super();
    this.info = null;
    this.host = null;
    this.copied = '';
  }

  report() {
    return aboutModel(BUILD_SPEC, this.host || {}, this.info || {});
  }

  async copy() {
    const product = (this.host && this.host.product) || (this.info && this.info.product) || '';
    const text = bugReportBlock(BUILD_SPEC, this.host || {}, this.info || {}, product);
    const ok = await copyToClipboard(text);
    this.copied = ok ? 'copied' : 'failed';
  }

  render() {
    const { clientRows, serverRows, commit } = this.report();
    return html`<section class="page" aria-label="About">
      <header class="page-head"><button class="back" aria-label="Back" @click=${() => this.dispatchEvent(new CustomEvent('back'))}>←</button><h2 class="page-title">About</h2></header>
      <div class="page-body">
        <div class="setting-group">${clientRows.map(row)}</div>
        <div class="setting-group">${serverRows.map(row)}</div>
        <p class="about-compare ${commit.state}">${commit.text}</p>
        <button class="button primary about-copy" @click=${() => this.copy()}>${this.copied === 'copied' ? 'Copied' : 'Copy for a bug report'}</button>
        ${this.copied === 'failed' ? html`<p class="problem">The clipboard is not available.</p>` : nothing}
      </div>
    </section>`;
  }
}

customElements.define('app-about', AppAbout);
