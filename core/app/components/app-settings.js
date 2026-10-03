import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { settingsFields, settingsGroups, settingValue, coerceSetting, optionLabel } from '../rules/settings.js';
import { importTheme, importSummary, addTheme, themeChoices, swatchVars, SWATCH_TOKENS } from '../rules/theme.js';
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
  static properties = {
    values: { attribute: false }, serverUrl: {}, busy: {}, problem: {}, scheme: {}, urlNote: {}, urlBusy: {},
    importText: { state: true }, importName: { state: true }, importNote: { state: true }, importUrl: { state: true },
  };

  constructor() {
    super();
    this.values = {};
    this.serverUrl = '';
    this.busy = false;
    this.problem = '';
    this.importText = '';
    this.importName = '';
    this.importNote = '';
    this.importUrl = '';
    // The scheme the app resolved, so each theme card shows the colours that scheme would draw.
    this.scheme = 'light';
    // What the last URL import said, and whether one is in flight; app-root owns the call and sets both.
    this.urlNote = '';
    this.urlBusy = false;
  }

  // Called by app-root when a URL import lands, so the field empties only on success and keeps a URL that failed.
  urlImported() {
    this.importUrl = '';
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

  // Every handler here is an arrow that closes over THIS page, never a bare method reference: the template this
  // method returns is drawn by app-sheet (this page's body is passed to it as .content), so lit binds a bare
  // `@change=${this.onSelect}` to app-sheet as the render host, and `this.field` would not exist there. The arrows
  // keep the page's own `this`, the same reason the buttons below wrap their handlers too.
  control(field) {
    const value = settingValue(field, this.values);
    const disabled = this.busy;
    if (field.type === 'choice') {
      return html`<select class="setting-control" data-key=${field.key} ?disabled=${disabled} @change=${(e) => this.onSelect(e)}>
        ${field.options.map((o) => html`<option value=${o} ?selected=${o === value}>${o}</option>`)}
      </select>`;
    }
    if (field.type === 'segmented') {
      // A three-position switch: one radio per choice under one name, drawn as a track with a thumb that slides to
      // the choice in force. data-at says which position the thumb sits at and data-segments how many there are, and
      // the stylesheet turns them into --at and --segments, so the CSS needs no width of its own. They were written as
      // a style attribute, which the page's Content-Security-Policy (style-src 'self') drops, so the thumb never left
      // System and a Light or Dark choice drew its on-accent label on the bare track (issue 135).
      // The label on the thumb is marked from the same value the thumb is placed by (data-selected), never from the
      // radio's own checked state, which flips the moment it is pressed and before the write lands: keyed to the
      // radio, the pressed label turned on-accent while the thumb still sat elsewhere, and read as nothing on the
      // bare track (issue 135).
      const at = Math.max(0, field.options.indexOf(value));
      return html`<div class="segmented setting-control-wide" role="radiogroup" aria-label=${field.label} data-key=${field.key} data-at=${at} data-segments=${field.options.length}>
        <span class="segment-thumb" aria-hidden="true"></span>
        ${field.options.map((o) => html`<label class="segment" ?data-selected=${o === value}><input type="radio" name=${field.key} data-key=${field.key} value=${o} .checked=${o === value} ?disabled=${disabled} @change=${(e) => this.onSelect(e)}><span>${optionLabel(field, o)}</span></label>`)}
      </div>`;
    }
    if (field.type === 'scale') {
      return html`<div class="scale-choices" role="radiogroup" aria-label=${field.label} data-key=${field.key}>
        ${field.options.map((o) => html`<label class="scale-choice" ?data-selected=${Number(o) === Number(value)}><input type="radio" name=${field.key} data-key=${field.key} value=${o} .checked=${Number(o) === Number(value)} ?disabled=${disabled} @change=${(e) => this.onSelect(e)}><span>${optionLabel(field, o)}</span></label>`)}
      </div>`;
    }
    if (field.type === 'toggle') {
      return html`<input type="checkbox" class="setting-control" data-key=${field.key} ?checked=${value === true} ?disabled=${disabled} @change=${(e) => this.onToggle(e)}>`;
    }
    if (field.type === 'number') {
      return html`<input type="number" class="setting-control" data-key=${field.key} min=${field.min} max=${field.max} step=${field.step} .value=${String(value)} ?disabled=${disabled} @change=${(e) => this.onSelect(e)}>`;
    }
    return html`<input type="text" class="setting-control" data-key=${field.key} .value=${String(value)} ?disabled=${disabled} @change=${(e) => this.onSelect(e)}>`;
  }

  // A pasted tweakcn export is converted here, added to the themes the server holds and put in force in one write,
  // so every client draws it from the event stream and offers it in the picker. What the import refused is said on
  // the page.
  onImport() {
    const result = importTheme(this.importText, { name: this.importName.trim() || 'Imported theme' });
    const summary = importSummary(result);
    this.importNote = summary.text;
    if (!summary.ok) return;
    const added = addTheme(this.values && this.values['appearance.themes'], result.theme);
    if (!added.ok) { this.importNote = added.reason; return; }
    this.importText = '';
    this.fire('settings', { 'appearance.themes': added.themes, 'appearance.theme': added.theme });
  }

  // A theme URL is fetched and converted by the server (POST /api/v1/themes), which adds it to the picker and
  // answers with what it carried and refused. The page only asks; app-root makes the call and reports back.
  onImportUrl() {
    const url = this.importUrl.trim();
    if (!url) return;
    this.fire('theme-import', { url });
  }

  pick(card) {
    this.importNote = '';
    this.fire('setting', { key: 'appearance.theme', value: card.theme });
  }

  onThemeDefault() {
    this.importNote = '';
    this.fire('setting', { key: 'appearance.theme', value: null });
  }

  // Each card carries the colours of the theme it offers, set on the card itself as the same custom properties the
  // root takes, so the swatches and the card's own surface are drawn exactly as the theme would draw the app. A card
  // also carries data-palette="default", so a colour the theme leaves out shows the default rather than the theme in
  // force on the root. Set with setProperty, never written into a style attribute as text.
  updated(changed) {
    super.updated?.(changed);
    const choices = themeChoices(this.values || {});
    for (const card of this.querySelectorAll('.theme-card[data-theme-id]')) {
      const choice = choices.find((c) => c.id === card.dataset.themeId);
      for (const name of [...card.style]) if (name.startsWith('--color-')) card.style.removeProperty(name);
      for (const [name, value] of swatchVars(choice && choice.theme, this.scheme)) card.style.setProperty(name, value);
    }
  }

  // The picker: a grid of cards, the default palette first, each showing its own colours, with the one in force marked.
  picker() {
    const cards = themeChoices(this.values || {});
    return html`<div class="theme-grid" role="radiogroup" aria-label="Theme">
      ${cards.map((card) => html`<button type="button" class="theme-card" role="radio" aria-checked=${card.selected ? 'true' : 'false'} data-palette="default" data-theme-id=${card.id}
          data-action=${card.theme ? 'theme-pick' : 'theme-default'} ?disabled=${this.busy} @click=${() => (card.theme ? this.pick(card) : this.onThemeDefault())}>
        <span class="theme-swatches" aria-hidden="true">${SWATCH_TOKENS.map((t) => html`<span class="theme-swatch" data-token=${t}></span>`)}</span>
        <span class="theme-card-name">${card.name}</span>
      </button>`)}
    </div>`;
  }

  // The theme rows belong to the Appearance section and draw inside its surface, so the section holds one subject
  // rather than two headings for one thing.
  theme() {
    return html`<div class="setting-row setting-row-stack"><span class="setting-label">Theme</span>${this.picker()}</div>
      <div class="setting-row theme-import theme-url">
        <span class="setting-label">Import a theme from a URL</span>
        <input type="url" class="setting-control theme-url-input" placeholder="https://tweakcn.com/editor/theme?theme=..." aria-label="Theme URL" .value=${this.importUrl} ?disabled=${this.busy || this.urlBusy}
          @input=${(e) => { this.importUrl = e.currentTarget.value; }} @keydown=${(e) => { if (e.key === 'Enter') this.onImportUrl(); }}>
        <button class="text-button theme-url-action" data-action="theme-import-url" ?disabled=${this.busy || this.urlBusy || !this.importUrl.trim()} @click=${() => this.onImportUrl()}>${this.urlBusy ? 'Importing' : 'Import'}</button>
        ${this.urlNote ? html`<p class="theme-import-note theme-url-note" role="status">${this.urlNote}</p>` : nothing}
      </div>
      <div class="setting-row theme-import">
        <span class="setting-label">Or paste a tweakcn theme</span>
        <input type="text" class="setting-control theme-import-name" placeholder="Theme name" aria-label="Theme name" .value=${this.importName} ?disabled=${this.busy} @input=${(e) => { this.importName = e.currentTarget.value; }}>
        <textarea class="setting-control theme-import-text" rows="6" placeholder="Paste the theme's CSS" aria-label="Theme CSS" .value=${this.importText} ?disabled=${this.busy} @input=${(e) => { this.importText = e.currentTarget.value; }}></textarea>
        <button class="text-button theme-import-action" data-action="theme-import" ?disabled=${this.busy || !this.importText.trim()} @click=${() => this.onImport()}>Import</button>
        ${this.importNote ? html`<p class="theme-import-note" role="status">${this.importNote}</p>` : nothing}
      </div>`;
  }

  // A row of radios is not wrapped in a label (a label holds one control); it is a row whose radiogroup is named by the
  // field's label. The percentage choices sit under their label rather than beside it, so seven of them fit a phone.
  row(field) {
    if (field.type === 'segmented') return html`<div class="setting-row"><span class="setting-label">${field.label}</span>${this.control(field)}</div>`;
    if (field.type === 'scale') return html`<div class="setting-row setting-row-stack"><span class="setting-label">${field.label}</span>${this.control(field)}</div>`;
    return html`<label class="setting-row"><span class="setting-label">${field.label}</span>${this.control(field)}</label>`;
  }

  section(group) {
    return html`<section class="sheet-section">
      <h3 class="sheet-section-title">${group.label}</h3>
      ${group.description ? html`<p class="sheet-section-desc">${group.description}</p>` : nothing}
      <div class="sheet-rows">
        ${group.fields.map((field) => this.row(field))}
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
