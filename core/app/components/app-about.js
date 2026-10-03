import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { press } from '../../kit/press.js';
import { aboutModel, bugReportBlock } from '../../kit/rules/build.js';
import { copyToClipboard } from '../clipboard.js';
import { BUILD_SPEC } from '../rules/build-spec.js';
import { aboutRows, aboutLinks } from '../rules/settings.js';

// The About section, the last section of Settings (issue 134), with chela's full details inline rather than on a page
// of its own. Every value comes from the half that owns it: the client's own build is what the shell reported on
// app.info, the server's is what the server reported on its info route, and the rows, their labels and their order
// come from rules/settings.js (aboutRows) over the one spec in core/spec/build.json. It says plainly when the pair is
// not on one commit.
//
// Each value is a button that copies it, and the whole report still copies in one press for a bug report. The links
// go to the source, the licence and the issue tracker, from the repository the server reports; a press is handed to
// the shell (open.external) by app-root, so it opens in the browser on every platform rather than in the app.
//
// The buttons here are kept simple: issue 140 (one debounce and pending state for every button) has not landed, and
// when it does these take it like every other.
class AppAbout extends KitElement {
  static properties = { info: { attribute: false }, host: { attribute: false }, copied: { state: true }, copiedKey: { state: true } };

  constructor() {
    super();
    this.info = null;
    this.host = null;
    this.copied = '';
    this.copiedKey = '';
  }

  async copy() {
    const product = (this.host && this.host.product) || (this.info && this.info.product) || '';
    const text = bugReportBlock(BUILD_SPEC, this.host || {}, this.info || {}, product);
    const ok = await copyToClipboard(text);
    this.copied = ok ? 'copied' : 'failed';
    return ok;
  }

  async copyValue(row) {
    const ok = await copyToClipboard(row.value);
    this.copiedKey = ok ? row.key : '';
    if (!ok) this.copied = 'failed';
    return ok;
  }

  open(e, href) {
    e.preventDefault();
    this.dispatchEvent(new CustomEvent('open-external', { detail: { url: href }, bubbles: true, composed: true }));
  }

  row(row) {
    const copied = this.copiedKey === row.key;
    return html`<div class="setting-row about-row" data-key=${row.key}>
      <span class="setting-label">${row.label}</span>
      <button type="button" class="about-value" data-copy=${row.key} title="Copy" aria-label=${'Copy ' + row.label + ': ' + row.value} @click=${press(() => this.copyValue(row))}>
        <span class="about-value-text">${row.value}</span>${copied ? html`<span class="about-copied" role="status">Copied</span>` : nothing}
      </button>
    </div>`;
  }

  render() {
    const { commit } = aboutModel(BUILD_SPEC, this.host || {}, this.info || {});
    const rows = aboutRows(this.host || {}, this.info || {});
    const links = aboutLinks(this.info && this.info.repository);
    return html`
      <div class="sheet-rows">
        ${rows.map((row) => this.row(row))}
        ${links.length ? html`<div class="setting-row about-links" data-key="links">
          <span class="setting-label">Links</span>
          <span class="about-link-list">${links.map((link) => html`<a class="text-button about-link" data-link=${link.key} href=${link.href} target="_blank" rel="noopener noreferrer" @click=${(e) => this.open(e, link.href)}>${link.label}</a>`)}</span>
        </div>` : nothing}
      </div>
      <p class="about-compare ${commit.state}">${commit.text}</p>
      <button type="button" class="button primary about-copy" @click=${press(() => this.copy())}>${this.copied === 'copied' ? 'Copied' : 'Copy for a bug report'}</button>
      ${this.copied === 'failed' ? html`<p class="problem">The clipboard is not available.</p>` : nothing}`;
  }
}

customElements.define('app-about', AppAbout);
