import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { settingsFields, settingsGroups, settingValue, coerceSetting } from '../rules/settings.js';

// The settings page: it draws one section per group the schema declares and one control per key, reads what the
// server holds and writes every change straight back to the server, so the value lands once and every device sees it,
// the event stream included. The connection details and sign out live here now, not in the list header.
class AppSettings extends KitElement {
  static properties = { values: { attribute: false }, serverUrl: {}, busy: {}, problem: {} };

  constructor() {
    super();
    this.values = {};
    this.serverUrl = '';
    this.busy = false;
    this.problem = '';
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

  group(section) {
    return html`<div class="setting-group">
      <h3 class="setting-group-label">${section.label}</h3>
      ${section.fields.map((field) => html`<label class="setting-row"><span class="setting-label">${field.label}</span>${this.control(field)}</label>`)}
    </div>`;
  }

  render() {
    return html`<section class="page" aria-label="Settings">
      <header class="page-head"><button class="back" aria-label="Back" @click=${() => this.fire('back')}>←</button><h2 class="page-title">Settings</h2></header>
      ${this.problem ? html`<div class="banner problem" role="alert">${this.problem}</div>` : nothing}
      <div class="page-body">
        ${settingsGroups().map((group) => this.group(group))}
        <div class="setting-group">
          <div class="setting-row"><span class="setting-label">Server</span><span class="setting-value">${this.serverUrl || 'Not connected'}</span></div>
          <div class="setting-row"><span class="setting-label">About</span><button class="text-button" data-action="about" @click=${() => this.fire('about')}>About this app</button></div>
          <div class="setting-row"><span class="setting-label">Connection</span><button class="text-button" data-action="signout" @click=${() => this.fire('signout')}>Sign out</button></div>
        </div>
      </div>
    </section>`;
  }
}

customElements.define('app-settings', AppSettings);
