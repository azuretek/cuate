import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { aboutModel, bugReportBlock } from '../../kit/rules/build.js';
import { copyToClipboard } from '../clipboard.js';
import { BUILD_SPEC } from '../rules/build-spec.js';

// The about page: every value comes from the half that owns it. The client's own build is what the shell reported on
// app.info, the server's is what the server reported on its info route, and the rows and labels come from the one spec
// in core/spec/build.json. The page never mixes the two, and it says plainly when the pair is not on one commit.
//
// The two halves are two sections with their own one-line description, so the page reads the way Settings does, and
// the chrome (the full-width back strip, the title, the description) is drawn by app-sheet.
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

  body() {
    const { clientRows, serverRows, commit } = this.report();
    return html`
      <section class="sheet-section">
        <h3 class="sheet-section-title">This app</h3>
        <p class="sheet-section-desc">The client you are using, and what it runs on.</p>
        <div class="sheet-rows">${clientRows.map(row)}</div>
      </section>
      <section class="sheet-section">
        <h3 class="sheet-section-title">Server</h3>
        <p class="sheet-section-desc">The server this app is connected to.</p>
        <div class="sheet-rows">${serverRows.map(row)}</div>
      </section>
      <p class="about-compare ${commit.state}">${commit.text}</p>
      <button class="button primary about-copy" @click=${() => this.copy()}>${this.copied === 'copied' ? 'Copied' : 'Copy for a bug report'}</button>
      ${this.copied === 'failed' ? html`<p class="problem">The clipboard is not available.</p>` : nothing}`;
  }

  render() {
    return html`<app-sheet .title=${'About'} .description=${'The build this device is running.'} .label=${'Back to settings'} .content=${this.body()}></app-sheet>`;
  }
}

customElements.define('app-about', AppAbout);
