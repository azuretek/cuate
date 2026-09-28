import { html } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';

class AppComposer extends KitElement {
  static properties = { disabled: {}, placeholder: {} };

  constructor() {
    super();
    this.disabled = false;
    this.placeholder = '';
  }

  field() {
    return this.querySelector('textarea');
  }

  submit(e) {
    e.preventDefault();
    const t = this.field();
    const text = t.value.trim();
    if (!text || this.disabled) return;
    this.dispatchEvent(new CustomEvent('send', { detail: text }));
    t.value = '';
    t.style.height = '';
    t.focus();
  }

  key(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) this.submit(e);
  }

  grow(e) {
    const t = e.currentTarget;
    t.style.height = 'auto';
    t.style.height = t.scrollHeight + 'px';
  }

  render() {
    return html`<form class="composer" @submit=${this.submit}>
      <textarea rows="1" aria-label="Message" .placeholder=${this.placeholder} ?disabled=${this.disabled} @keydown=${this.key} @input=${this.grow}></textarea>
      <button class="send" type="submit" aria-label="Send" ?disabled=${this.disabled}>\u2191</button>
    </form>`;
  }
}

customElements.define('app-composer', AppComposer);
