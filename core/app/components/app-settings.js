import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { press, emit } from '../../kit/press.js';
import { settingsFields, settingsGroups, settingsTabs, settingValue, coerceSetting, optionLabel } from '../rules/settings.js';
import { appIconChoices } from '../rules/app-icons.js';
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
// with a divider between them. A group may name its own sections (Behavior draws Notices and then Updates, issue 244),
// each a small block with its own heading, rather than one long list. The page and its chrome (the full-width back
// strip, the title, the description) are drawn by app-sheet.
//
// The About row is not a section and not a tab: it sits at the bottom of every Settings page, under the tab in force,
// so the About page is reachable from any tab (issue 244). It is one row, its label, the version on the right, and the
// chevron that opens About, a page of its own drawn by app-about.
//
// The sections are tabs (issue 167): one tab per group, from settingsTabs(), so the schema is still the one list, and
// the page shows one section at a time on every width, which is what lets each section fit a phone. The page is the
// same component on the desktop and the phones, so every setting the desktop offers is on the phone too; the inventory
// test (core/test/settings-tabs.test.js) and the smoke's walk through every tab at a phone's width hold that. The tab in
// force is app-root's, handed down as .tab, so returning from About lands on the tab it was opened from.
class AppSettings extends KitElement {
  static properties = {
    values: { attribute: false }, themePicture: { attribute: false }, serverUrl: {}, busy: {}, problem: {}, scheme: {}, urlNote: {},
    info: { attribute: false }, host: { attribute: false }, tab: {},
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
    // What the last URL import said; app-root owns the call and sets it. The Import button shows the call in flight,
    // and the URL field's Enter is the same press, so a second one while it runs is dropped (core/kit/press.js).
    this.urlNote = '';
    this.importUrlPress = press(() => this.onImportUrl(), { on: () => this.querySelector('.theme-url-action') });
    // The shell's own report, whose version the About row shows beside its label.
    this.info = null;
    this.host = null;
    // The tab on show; app-root holds it across a push to About and back. Null shows the first.
    this.tab = null;
  }

  // The tab on show: the one app-root handed down when it is a tab the schema has, else the first.
  current() {
    const tabs = settingsTabs();
    return tabs.some((t) => t.id === this.tab) ? this.tab : tabs[0].id;
  }

  // A tab press shows its section from the top. The choice is raised for app-root to hold, so it outlives this page.
  // It is an instant action, so it returns no work and the tab never shows a pending or a success state.
  selectTab(id) {
    if (id === this.current()) return;
    this.tab = id;
    this.dispatchEvent(new CustomEvent('tab', { detail: id, bubbles: true, composed: true }));
    this.updateComplete.then(() => {
      const body = this.querySelector('.sheet-body');
      if (body) body.scrollTop = 0;
      const tab = this.querySelector('.settings-tab[aria-selected="true"]');
      if (tab && this.contains(document.activeElement)) tab.focus();
    });
  }

  // The tab list's own keys, as a tablist takes them: the arrows move to the neighbouring tab, Home and End to the ends.
  onTabKey(e) {
    const ids = settingsTabs().map((t) => t.id);
    const at = ids.indexOf(this.current());
    const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: ids.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    this.selectTab(ids[(to + ids.length) % ids.length]);
  }

  nav() {
    const current = this.current();
    return html`<div class="settings-tabs" role="tablist" aria-label="Settings sections" @keydown=${(e) => this.onTabKey(e)}>
      ${settingsTabs().map((t) => html`<button type="button" class="settings-tab" role="tab" id=${'settings-tab-' + t.id} data-tab=${t.id}
          aria-controls=${'settings-panel-' + t.id} aria-selected=${t.id === current ? 'true' : 'false'} tabindex=${t.id === current ? '0' : '-1'}
          @click=${press(() => this.selectTab(t.id))}>${t.label}</button>`)}
    </div>`;
  }

  // Called by app-root when a URL import lands, so the field empties only on success and keeps a URL that failed.
  urlImported() {
    this.importUrl = '';
  }

  // The page may answer with the work it started, which the press that raised the event shows (core/kit/press.js).
  fire(name, detail) {
    return emit(this, name, detail);
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

  // A slider move writes the stop the thumb lands on and paints the reading beside it at once, so the size is shown as
  // it changes (the live preview). The control's own value is an index into the schema's stops, so no move can land
  // between two of them; the stop's percentage is what the setting carries, unchanged from the chips it replaces.
  onSlide(e, field, stops) {
    const at = Math.max(0, Math.min(stops.length - 1, Number(e.currentTarget.value)));
    const value = stops[at];
    e.currentTarget.setAttribute('aria-valuetext', value + ' percent');
    const out = e.currentTarget.parentElement.querySelector('.scale-value');
    if (out) { out.textContent = optionLabel(field, value); out.dataset.value = String(value); }
    this.fire('setting', { key: field.key, value });
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
      // Text size is a slider (issue 244). Its positions are the schema's stops' indexes, so a key press or a drag can
      // only land on an offered percentage; the value in force is written beside it, and aria-valuetext reads the
      // percentage rather than the index, so a screen reader announces the size and not a position. The stops are drawn
      // as ticks from the datalist, and the stored value is unchanged: still one of the schema's percentages.
      const stops = field.options.map(Number);
      const at = Math.max(0, stops.indexOf(Number(value)));
      const listId = 'scale-stops-' + field.key;
      return html`<div class="scale-slider setting-control-wide" data-key=${field.key}>
        <input type="range" class="scale-range" min="0" max=${stops.length - 1} step="1" .value=${String(at)} list=${listId}
          aria-label=${field.label} aria-valuetext=${stops[at] + ' percent'} ?disabled=${disabled}
          @input=${(e) => this.onSlide(e, field, stops)}>
        <datalist id=${listId}>${stops.map((o, i) => html`<option value=${String(i)} label=${optionLabel(field, o)}></option>`)}</datalist>
        <output class="scale-value" data-value=${String(stops[at])}>${optionLabel(field, stops[at])}</output>
      </div>`;
    }
    if (field.type === 'icon') {
      // The app icon (issue 167): each choice is its own picture, the one in force marked, and a press writes the
      // choice to the server like any other setting; the shell applies it from there (rules/app-icons.js).
      return html`<div class="app-icon-choices" role="radiogroup" aria-label=${field.label} data-key=${field.key}>
        ${appIconChoices(this.values, { themePicture: this.themePicture }).map((c) => html`<button type="button" class="app-icon-choice" role="radio" aria-checked=${c.selected ? 'true' : 'false'} data-icon-id=${c.id} ?disabled=${disabled}
            @click=${press(() => (c.selected ? undefined : this.fire('setting', { key: field.key, value: c.id })))}>
          <img class="app-icon-picture" src=${c.src} alt="" draggable="false">
          <span class="app-icon-name">${c.label}</span>
        </button>`)}
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
    if (!summary.ok) return false;
    const added = addTheme(this.values && this.values['appearance.themes'], result.theme);
    if (!added.ok) { this.importNote = added.reason; return false; }
    this.importText = '';
    return this.fire('settings', { 'appearance.themes': added.themes, 'appearance.theme': added.theme });
  }

  // A theme URL is fetched and converted by the server (POST /api/v1/themes), which adds it to the picker and
  // answers with what it carried and refused. The page only asks; app-root makes the call and reports back.
  onImportUrl() {
    const url = this.importUrl.trim();
    if (!url) return undefined;
    return this.fire('theme-import', { url });
  }

  pick(card) {
    this.importNote = '';
    return this.fire('setting', { key: 'appearance.theme', value: card.theme });
  }

  onThemeDefault() {
    this.importNote = '';
    return this.fire('setting', { key: 'appearance.theme', value: null });
  }

  // Each card carries the colours of the theme it offers, set on the card itself as the same custom properties the
  // root takes, so the swatches and the card's own surface are drawn exactly as the theme would draw the app. A card
  // also carries data-palette="default", so a colour the theme leaves out shows the default rather than the theme in
  // force on the root. Set with setProperty, never written into a style attribute as text.
  //
  // The cards are drawn by app-sheet, which renders this page's body in its own update, AFTER this page's updated()
  // has run: painting only here found no card on a fresh open (and missed every card added since), so every card fell
  // back to the default palette and all of them looked alike (issue 186). The cards are painted now, for the ones
  // already on the page, and again once the sheet has drawn this render.
  updated(changed) {
    super.updated?.(changed);
    this.paintCards();
    const sheet = this.querySelector('app-sheet');
    if (sheet && sheet.updateComplete) sheet.updateComplete.then(() => this.paintCards());
  }

  paintCards() {
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
          data-action=${card.theme ? 'theme-pick' : 'theme-default'} @click=${press(() => (card.theme ? this.pick(card) : this.onThemeDefault()))}>
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
        <input type="url" class="setting-control theme-url-input" placeholder="https://tweakcn.com/editor/theme?theme=..." aria-label="Theme URL" .value=${this.importUrl} ?disabled=${this.busy}
          @input=${(e) => { this.importUrl = e.currentTarget.value; }} @keydown=${(e) => { if (e.key === 'Enter') this.importUrlPress(e); }}>
        <button class="text-button theme-url-action" data-action="theme-import-url" ?disabled=${!this.importUrl.trim()} @click=${this.importUrlPress}>Import</button>
        ${this.urlNote ? html`<p class="theme-import-note theme-url-note" role="status">${this.urlNote}</p>` : nothing}
      </div>
      <div class="setting-row theme-import">
        <span class="setting-label">Or paste a tweakcn theme</span>
        <input type="text" class="setting-control theme-import-name" placeholder="Theme name" aria-label="Theme name" .value=${this.importName} ?disabled=${this.busy} @input=${(e) => { this.importName = e.currentTarget.value; }}>
        <textarea class="setting-control theme-import-text" rows="6" placeholder="Paste the theme's CSS" aria-label="Theme CSS" .value=${this.importText} ?disabled=${this.busy} @input=${(e) => { this.importText = e.currentTarget.value; }}></textarea>
        <button class="text-button theme-import-action" data-action="theme-import" ?disabled=${!this.importText.trim()} @click=${press(() => this.onImport())}>Import</button>
        ${this.importNote ? html`<p class="theme-import-note" role="status">${this.importNote}</p>` : nothing}
      </div>`;
  }

  // A row of radios is not wrapped in a label (a label holds one control); it is a row whose radiogroup is named by the
  // field's label. The percentage choices sit under their label rather than beside it, so seven of them fit a phone.
  row(field) {
    if (field.type === 'segmented') return html`<div class="setting-row"><span class="setting-label">${field.label}</span>${this.control(field)}</div>`;
    if (field.type === 'scale' || field.type === 'icon') return html`<div class="setting-row setting-row-stack"><span class="setting-label">${field.label}</span>${this.control(field)}</div>`;
    return html`<label class="setting-row"><span class="setting-label">${field.label}</span>${this.control(field)}</label>`;
  }

  // The rows a section draws: a settings group's keys, This device's server and sign out, or, for a group that names
  // its own sections (Behavior), one small block per section rather than one long list.
  sectionBody(group) {
    if (group.kind === 'device') {
      return html`<div class="sheet-rows">
        <div class="setting-row"><span class="setting-label">Server</span><span class="setting-value">${this.serverUrl || 'Not connected'}</span></div>
        <div class="setting-row"><span class="setting-label">Connection</span><button class="text-button" data-action="signout" @click=${press(() => this.fire('signout'))}>Sign out</button></div>
      </div>`;
    }
    if (group.sections) {
      return group.sections.map((s) => html`<div class="settings-subsection" data-subsection=${s.id}>
        <h4 class="settings-subsection-title">${s.label}</h4>
        ${s.description ? html`<p class="settings-subsection-desc">${s.description}</p>` : nothing}
        <div class="sheet-rows">${s.fields.map((field) => this.row(field))}</div>
      </div>`);
    }
    return html`<div class="sheet-rows">
      ${group.fields.map((field) => this.row(field))}
      ${group.id === 'appearance' ? this.theme() : nothing}
    </div>`;
  }

  // Each section is the panel of its tab. Every panel is drawn and the ones not on show are hidden, so a tab's
  // aria-controls always names a panel that exists and a hidden section keeps what was typed into it.
  section(group) {
    return html`<section class="sheet-section" data-section=${group.id} role="tabpanel" id=${'settings-panel-' + group.id} aria-labelledby=${'settings-tab-' + group.id} ?hidden=${group.id !== this.current()}>
      <h3 class="sheet-section-title">${group.label}</h3>
      ${group.description ? html`<p class="sheet-section-desc">${group.description}</p>` : nothing}
      ${this.sectionBody(group)}
    </section>`;
  }

  // The About row, at the bottom of every Settings page (issue 244): one row, its label, the version on the right and
  // the chevron that opens the About page, reached from the tab in force.
  aboutRow() {
    const version = (this.host && this.host.version) || '';
    return html`<div class="sheet-rows settings-about-row" data-section="about">
      <button type="button" class="setting-row setting-nav" data-action="about" @click=${press(() => this.fire('about'))}>
        <span class="setting-label">About</span>
        <span class="setting-nav-value">${version}</span>
        <span class="icon" data-icon="chevron-right" aria-hidden="true"></span>
      </button>
    </div>`;
  }

  body() {
    return html`
      ${this.problem ? html`<div class="banner problem" role="alert">${this.problem}</div>` : nothing}
      ${settingsGroups().map((group) => this.section(group))}
      ${this.aboutRow()}`;
  }

  render() {
    // On a phone Settings is a page reached from the chats list, so its way back is the chats control (issue 168).
    return html`<app-sheet .title=${'Settings'} .description=${INTRO} .label=${'Back to app'} .narrowLabel=${'Back to chats'} .narrowIcon=${'messages-square'} .nav=${this.nav()} .content=${this.body()}></app-sheet>`;
  }
}
customElements.define('app-settings', AppSettings);
