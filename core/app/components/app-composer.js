import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { insertEmoji, deleteGrapheme, isEmoji } from '../rules/emoji.js';
import './app-emoji-picker.js';

const FREQUENT_KEY = 'emoji.frequent';

class AppComposer extends KitElement {
  static properties = { disabled: {}, placeholder: {}, emojiOpen: { state: true }, frequent: { state: true } };

  constructor() {
    super();
    this.disabled = false;
    this.placeholder = '';
    this.emojiOpen = false;
    this.frequent = [];
  }

  connectedCallback() {
    super.connectedCallback();
    this.loadFrequent();
  }

  field() {
    return this.querySelector('textarea');
  }

  // The frequent row is the shell's storage; a plain browser keeps it for the page.
  // A missing bridge or a rejected read leaves the row empty rather than failing.
  async loadFrequent() {
    try {
      const saved = await window.bridge?.call('storage.get', { key: FREQUENT_KEY });
      if (Array.isArray(saved)) this.frequent = saved.filter(isEmoji);
    } catch {
      /* no storage, start empty */
    }
  }

  async remember(char) {
    const next = [...this.frequent, char].slice(-200);
    this.frequent = next;
    try {
      await window.bridge?.call('storage.set', { key: FREQUENT_KEY, value: next });
    } catch {
      /* page only */
    }
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
    if (e.key === 'Escape' && this.emojiOpen) {
      this.emojiOpen = false;
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      this.trim(e);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) this.submit(e);
  }

  // Backspace and Delete remove one whole character, so a flag or a skin tone
  // goes in one press rather than leaving half of itself behind. Anything the
  // grapheme rule cannot change is left to the field itself.
  trim(e) {
    if (e.isComposing) return;
    const t = e.currentTarget;
    if (t.selectionStart !== t.selectionEnd) return;
    const dir = e.key === 'Backspace' ? -1 : 1;
    const r = deleteGrapheme(t.value, t.selectionStart, t.selectionEnd, dir);
    if (r.text === t.value) return;
    e.preventDefault();
    t.value = r.text;
    t.setSelectionRange(r.caret, r.caret);
    this.grow({ currentTarget: t });
  }

  grow(e) {
    const t = e.currentTarget;
    t.style.height = 'auto';
    t.style.height = t.scrollHeight + 'px';
  }

  toggleEmoji() {
    this.emojiOpen = !this.emojiOpen;
    if (this.emojiOpen) this.field()?.focus();
  }

  // Insert at the caret, replacing any selection, and put the caret back after
  // the character so several in a row land in order.
  insert(char) {
    if (!isEmoji(char)) return;
    const t = this.field();
    if (!t) return;
    const r = insertEmoji(t.value, t.selectionStart, t.selectionEnd, char);
    t.value = r.text;
    t.setSelectionRange(r.caret, r.caret);
    this.grow({ currentTarget: t });
    t.focus();
    this.remember(char);
  }

  render() {
    return html`<form class="composer" @submit=${this.submit}>
      <div class="composer-tools">
        <button type="button" class="tool" aria-label="Emoji" aria-haspopup="dialog" aria-expanded=${this.emojiOpen ? 'true' : 'false'} ?disabled=${this.disabled} @click=${() => this.toggleEmoji()}>\u{1F642}</button>
      </div>
      <textarea rows="1" aria-label="Message" .placeholder=${this.placeholder} ?disabled=${this.disabled} @keydown=${this.key} @input=${this.grow}></textarea>
      <button class="send" type="submit" aria-label="Send" ?disabled=${this.disabled}>\u2191</button>
      ${this.emojiOpen ? html`<app-emoji-picker .frequent=${this.frequent} @pick=${(e) => this.insert(e.detail)}></app-emoji-picker>` : nothing}
    </form>`;
  }
}

customElements.define('app-composer', AppComposer);
