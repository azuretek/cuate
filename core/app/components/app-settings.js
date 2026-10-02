import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { settingsFields, settingsGroups, settingValue, coerceSetting } from '../rules/settings.js';
import { importTweakcn, importSummary, themeName } from '../rules/theme.js';
import './app-sheet.js';

// The one line the page says about itself, under its title.
const INTRO = 'Choose how this app looks and which notices it raises.';

// The settings page: it draws one section per group the schema declares and one control per key, reads what the
// server holds and writes every change straight back to the server, so the value lands once and every device sees it,
// the event stream included. The connection details and sign out live here now, not in the list header.
//
// Every section comes from settingsGroups(), so the schema is the one owner of the group list and the page keeps no
// second one. Each group carries its own one-line description from the schema, and a group's rows sit on one surface
// with a divider between them. The page and its chrome (the full-width back strip, the title, the description) are
// drawn by app-sheet, which both this page and About use.
class AppSettings extends KitElement {
  static properties = { values: { attribute: false }, serverUrl: {}, busy: {}, problem: {}, importText: { state: true }, importName: { state: true }, importNote: { state: true } };

  constructor() {
    super();
    this.values = {};
    this.serverUrl = '';
    this.busy = false;
    this.problem = '';
    this.importText = '';
    this.importName = '';
    this.importNote = '';
  }

  fire(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  field(key) {
    return settingsFields().find((f) => f.key === key);
  }

  onSelect(e) {
    const field = this.field(e.currentTarget.dataset.key);
    if (field) this.fire('setting', { key: field.key, value: coerceSetting(field, e.currentTarget.value) });
  }

  onToggle(e) {
    const field = this.field(e.currentTarget.dataset.key);
    if (field) this.fire('setting', { key: field.key, value: coerceSetting(field, e.currentTarget.checked) });
  }

  control(field) {
    const value = settingValue(field, this.values);
    const disabled = this.busy;
    if (field.type === 'choice') {
      return html`<select class="setting-control" data-key=${field.key} ?disabled=${disabled} @change=${this.onSelect}>
        ${field.options.map((o) => html`<option value=${o} ?selected=${o === value}>${o}</option>`)}
      </select>`;
    }
    if (field.type === 'toggle') {
      return html`<input type="checkbox" class="setting-control" data-key=${field.key} ?checked=${value === true} ?disabled=${disabled} @change=${this.onToggle}>`;
    }
    if (field.type === 'number') {
      return html`<input type="number" class="setting-control" data-key=${field.key} min=${field.min} max=${field.max} step=${field.step} .value=${String(value)} ?disabled=${disabled} @change=${this.onSelect}>`;
    }
    return html`<input type="text" class="setting-control" data-key=${field.key} .value=${String(value)} ?disabled=${disabled} @change=${this.onSelect}>`;
  }

  // A pasted tweakcn export is converted here and written to the server under appearance.theme like any other setting,
  // so the server holds it and every client draws it from the event stream. What the import refused is said on the page.
  onImport() {
    const result = importTweakcn(this.importText, { name: this.importName.trim() || 'Imported theme' });
    const summary = importSummary(result);
    this.importNote = summary.text;
    if (!summary.ok) return;
    this.importText = '';
    this.fire('setting', { key: 'appearance.theme', value: result.theme });
  }

  onThemeDefault() {
    this.importNote = '';
    this.fire('setting', { key: 'appearance.theme', value: null });
  }

  // The theme rows belong to the Appearance section and draw inside its surface, so the section holds one subject
  // rather than two headings for one thing.
  theme() {
    const current = themeName(this.values && this.values['appearance.theme']);
    const held = Boolean(this.values && this.values['appearance.theme']);
    return html`<div class="setting-row"><span class="setting-label">Theme</span><span class="setting-value theme-current">${current || (held ? 'Custom' : 'Default')}</span>
        ${held ? html`<button class="text-button" data-action="theme-default" ?disabled=${this.busy} @click=${this.onThemeDefault}>Use default</button>` : nothing}</div>
      <div class="setting-row theme-import">
        <span class="setting-label">Import a tweakcn theme</span>
        <input type="text" class="setting-control theme-import-name" placeholder="Theme name" aria-label="Theme name" .value=${this.importName} ?disabled=${this.busy} @input=${(e) => { this.importName = e.currentTarget.value; }}>
        <textarea class="setting-control theme-import-text" rows="6" placeholder="Paste the theme's CSS" aria-label="Theme CSS" .value=${this.importText} ?disabled=${this.busy} @input=${(e) => { this.importText = e.currentTarget.value; }}></textarea>
        <button class="text-button theme-import-action" data-action="theme-import" ?disabled=${this.busy || !this.importText.trim()} @click=${this.onImport}>Import</button>
        ${this.importNote ? html`<p class="theme-import-note" role="status">${this.importNote}</p>` : nothing}
      </div>`;
  }

  section(group) {
    return html`<section class="sheet-section">
      <h3 class="sheet-section-title">${group.label}</h3>
      ${group.description ? html`<p class="sheet-section-desc">${group.description}</p>` : nothing}
      <div class="sheet-rows">
        ${group.fields.map((field) => html`<label class="setting-row"><span class="setting-label">${field.label}</span>${this.control(field)}</label>`)}
        ${group.id === 'appearance' ? this.theme() : nothing}
      </div>
    </section>`;
  }

  body() {
    return html`
      ${this.problem ? html`<div class="banner problem" role="alert">${this.problem}</div>` : nothing}
      ${settingsGroups().map((group) => this.section(group))}
      <section class="sheet-section">
        <h3 class="sheet-section-title">This device</h3>
        <p class="sheet-section-desc">The server this app talks to, and the way out of it.</p>
        <div class="sheet-rows">
          <div class="setting-row"><span class="setting-label">Server</span><span class="setting-value">${this.serverUrl || 'Not connected'}</span></div>
          <div class="setting-row"><span class="setting-label">About</span><button class="text-button" data-action="about" @click=${() => this.fire('about')}>About this app</button></div>
          <div class="setting-row"><span class="setting-label">Connection</span><button class="text-button" data-action="signout" @click=${() => this.fire('signout')}>Sign out</button></div>
        </div>
      </section>`;
  }

  render() {
    return html`<app-sheet .title=${'Settings'} .description=${INTRO} .label=${'Back to app'} .content=${this.body()}></app-sheet>`;
  }
}

customElements.define('app-settings', AppSettings);
