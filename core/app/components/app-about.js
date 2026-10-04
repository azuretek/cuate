import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { press, emit } from '../../kit/press.js';
import { aboutModel, bugReportBlock } from '../../kit/rules/build.js';
import { copyToClipboard } from '../clipboard.js';
import { BUILD_SPEC } from '../rules/build-spec.js';
import { aboutRows, aboutLinks } from '../rules/settings.js';
import { appIconChoices } from '../rules/app-icons.js';
import { aboutUpdate } from '../rules/updates.js';
import { durationMs } from '../../kit/rules/press.js';
import './app-sheet.js';

// The one line the page says about itself, under its title.
const INTRO = 'The build this device is running and the server it talks to. Select a value to copy it.';

// The app's own icon, Flor de muerto in the default theme, generated from the masters in core/spec/icon by the shared
// icon pipeline (desktop/scripts/icons.mjs, checked by pnpm run build), so every shell bundles the same picture the
// desktop's window and installers carry.
const APP_ICON = 'assets/app-icon.png';

// The icon on About is the choice in force, not one fixed drawing (issue 246): the same list Settings offers
// (rules/app-icons.js over the generated spec mirror), so the picture matches the chosen icon. Follow theme's is the
// live drawing app-root makes in the theme in force; until it has drawn, and where the page has no canvas, the
// default theme's shipped picture stands in. values and themePicture are handed down by app-root and are reactive,
// so the picture follows a change the moment the server's settings deliver it, with no reload.

// The About page (issue 171): a page of its own on every platform, drawn in the same sheet chrome as Settings (a back
// strip, a title and its one line), reached from Settings' last row and from the tray's and the app menu's About. The
// same component draws it on the desktop and on a phone, so the two cannot drift apart.
//
// It opens with the app's icon, its name and version, then Check for updates, which runs the same check the tray's
// item runs and whose answer arrives as the app notice; the page only asks (app-root makes the call), and the press
// shows the check until the shell answers. Every value below comes from the half that owns it: the client's own build
// is what the shell reported on app.info, the server's is what the server reported on its info route, and the rows,
// their labels and their order come from rules/settings.js (aboutRows) over the one spec in core/spec/build.json. It
// says plainly when the pair is not on one commit.
//
// Each value is a button that copies it, and the whole report still copies in one press for a bug report. The links
// go to the source, the licence and the issue tracker, from the repository the server reports; a press is handed to
// the shell (open.external) by app-root, so it opens in the browser on every platform rather than in the app.
class AppAbout extends KitElement {
  static properties = { info: { attribute: false }, host: { attribute: false }, release: { attribute: false }, values: { attribute: false }, themePicture: { attribute: false }, backLabel: {}, copied: { state: true }, copiedKey: { state: true }, copying: { state: true } };

  constructor() {
    super();
    this.info = null;
    this.host = null;
    this.release = null;
    this.values = {};
    this.themePicture = null;
    this.backLabel = 'Back to app';
    this.copied = '';
    this.copiedKey = '';
    // The copy button is disabled while a copy is in flight and for a short beat after it, so a double press cannot
    // fire two copies; the beat's timer is held here.
    this.copying = false;
    this.copyBeat = null;
  }

  // The page may answer with the work it started, which the press that raised the event shows (core/kit/press.js).
  fire(name, detail) {
    return emit(this, name, detail);
  }

  async copy() {
    // A press that lands while the last copy is still in its beat does nothing, so a double press can never fire two.
    if (this.copying) return false;
    this.copying = true;
    const product = (this.host && this.host.product) || (this.info && this.info.product) || '';
    const text = bugReportBlock(BUILD_SPEC, this.host || {}, this.info || {}, product);
    const ok = await copyToClipboard(text);
    this.copied = ok ? 'copied' : 'failed';
    // Disabled for a short beat after the copy settles, matching the kit press's own hold, so the second half of a
    // double press is dropped rather than copying again.
    clearTimeout(this.copyBeat);
    this.copyBeat = setTimeout(() => { this.copying = false; }, this.copyBeatMs());
    return ok;
  }

  // How long the copy button stays disabled after a press: the kit press's own hold, so the beat matches the state the
  // button already shows and a theme can change both together.
  copyBeatMs() {
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(this) : null;
    return durationMs(style ? style.getPropertyValue('--motion-press-hold') : '', 900);
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

  // Every handler in the body is an arrow that closes over THIS page: the body is drawn by app-sheet (as .content), so
  // lit binds a bare method reference to app-sheet as the render host.
  row(row) {
    const copied = this.copiedKey === row.key;
    return html`<div class="setting-row about-row" data-key=${row.key}>
      <span class="setting-label">${row.label}</span>
      <button type="button" class="about-value" data-copy=${row.key} title="Copy" aria-label=${'Copy ' + row.label + ': ' + row.value} @click=${press(() => this.copyValue(row))}>
        <span class="about-value-text">${row.value}</span>${copied ? html`<span class="about-copied" role="status">Copied</span>` : nothing}
      </button>
    </div>`;
  }

  // The picture of the icon in force: the selected choice's src, Follow theme's being the live drawing app-root
  // made (themePicture), else the default theme's shipped picture.
  currentIcon() {
    const chosen = appIconChoices(this.values || {}, { themePicture: this.themePicture }).find((c) => c.selected);
    return chosen && chosen.src ? chosen.src : APP_ICON;
  }

  body() {
    const { commit } = aboutModel(BUILD_SPEC, this.host || {}, this.info || {});
    const rows = aboutRows(this.host || {}, this.info || {});
    const links = aboutLinks(this.info && this.info.repository);
    const name = rows.find((r) => r.key === 'product');
    const version = rows.find((r) => r.key === 'version');
    // The button follows the update state the notice draws (issue 192; held as release, since update is the element's
    // own render step): the button is the step the notice offers, or the check. The outcome is reported in ONE place,
    // the notice banner, never beside the control that triggered it (PR 257), so the page draws no line and no bar
    // of its own; the button's own states (idle, checking, the disabled beat) are the press the kit draws.
    const update = aboutUpdate(this.release);
    return html`
      <header class="about-head" data-section="identity">
        <img class="about-icon" src=${this.currentIcon()} alt="">
        <span class="about-name">${name ? name.value : ''}</span>
        <span class="about-version">${version ? version.value : ''}</span>
      </header>
      <section class="sheet-section" data-section="updates">
        <h3 class="sheet-section-title">Updates</h3>
        <p class="sheet-section-desc">Look for a newer version now. The answer appears as a notice.</p>
        <button type="button" class="button primary about-check" data-action="check-updates" data-command=${update.command || 'check'} @click=${press(() => this.fire('check-updates', { command: update.command }))}>${update.label}</button>
      </section>
      <section class="sheet-section" data-section="build">
        <h3 class="sheet-section-title">This build</h3>
        <div class="sheet-rows">
          ${rows.map((row) => this.row(row))}
          ${links.length ? html`<div class="setting-row about-links" data-key="links">
            <span class="setting-label">Links</span>
            <span class="about-link-list">${links.map((link) => html`<a class="text-button about-link" data-link=${link.key} href=${link.href} target="_blank" rel="noopener noreferrer" @click=${(e) => this.open(e, link.href)}>${link.label}</a>`)}</span>
          </div>` : nothing}
        </div>
        <p class="about-compare ${commit.state}">${commit.text}</p>
        <button type="button" class="button about-copy" ?disabled=${this.copying} @click=${press(() => this.copy())}>${this.copied === 'copied' ? 'Copied' : this.copied === 'failed' ? 'Could not copy' : 'Copy for a bug report'}</button>
      </section>`;
  }

  render() {
    return html`<app-sheet .title=${'About'} .description=${INTRO} .label=${this.backLabel} .content=${this.body()}></app-sheet>`;
  }
}

customElements.define('app-about', AppAbout);
