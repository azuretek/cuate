import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { insertEmoji, deleteGrapheme, isEmoji } from '../rules/emoji.js';
import { ATTACH_ACTIONS, sizeLabel, stageCheck } from '../rules/attach.js';
import './app-emoji-picker.js';

const FREQUENT_KEY = 'emoji.frequent';

class AppComposer extends KitElement {
  static properties = {
    disabled: {}, placeholder: {}, maxBytes: {},
    emojiOpen: { state: true }, attachOpen: { state: true }, frequent: { state: true }, staged: { state: true }, stageProblem: { state: true },
  };

  constructor() {
    super();
    this.disabled = false;
    this.placeholder = '';
    this.maxBytes = undefined;
    this.emojiOpen = false;
    this.attachOpen = false;
    this.frequent = [];
    this.staged = null;
    this.stageProblem = '';
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
    const file = this.staged;
    if ((!text && !file) || this.disabled) return;
    this.dispatchEvent(new CustomEvent('send', { detail: { text, file } }));
    this.staged = null;
    this.stageProblem = '';
    t.value = '';
    t.style.height = '';
    t.focus();
  }

  key(e) {
    if (e.key === 'Escape' && (this.emojiOpen || this.attachOpen)) {
      this.emojiOpen = false;
      this.attachOpen = false;
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
    this.attachOpen = false;
    if (this.emojiOpen) this.field()?.focus();
  }

  // The attach menu is a small list beside the composer, and each entry opens the system picker with its own filter.
  toggleAttach() {
    this.attachOpen = !this.attachOpen;
    this.emojiOpen = false;
  }

  choose(action) {
    this.attachOpen = false;
    const input = this.querySelector('input[type=file]');
    if (!input) return;
    input.accept = action.accept;
    input.value = '';
    input.click();
  }

  picked(e) {
    const file = e.currentTarget.files && e.currentTarget.files[0];
    if (file) this.stage(file);
  }

  // One file at a time, as a send carries one. A file the server would refuse is named as refused before any upload.
  stage(file) {
    const check = stageCheck(file, this.maxBytes);
    this.staged = check.ok ? file : null;
    this.stageProblem = check.ok ? '' : check.reason;
    this.field()?.focus();
  }

  unstage() {
    this.staged = null;
    this.stageProblem = '';
    this.field()?.focus();
  }

  // A pasted file stages as if it had been picked; pasted text, emoji included, is left to the field.
  paste(e) {
    const file = e.clipboardData && e.clipboardData.files && e.clipboardData.files[0];
    if (!file || this.disabled) return;
    e.preventDefault();
    this.stage(file);
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
    const s = this.staged;
    return html`${s || this.stageProblem
      ? html`<div class="composer-staged" role="status">
          ${s ? html`<span class="staged-file"><span class="staged-name">${s.name}</span><span class="muted small">${sizeLabel(s.size)}</span><button type="button" class="staged-remove" aria-label=${'Remove ' + s.name} @click=${() => this.unstage()}>\u00D7</button></span>` : nothing}
          ${this.stageProblem ? html`<span class="staged-problem small">${this.stageProblem}</span>` : nothing}
        </div>`
      : nothing}<form class="composer" @submit=${this.submit}>
      <div class="composer-tools">
        <button type="button" class="tool" aria-label="Attach" aria-haspopup="menu" aria-expanded=${this.attachOpen ? 'true' : 'false'} ?disabled=${this.disabled} @click=${() => this.toggleAttach()}>+</button>
        <input type="file" hidden @change=${this.picked}>
        <button type="button" class="tool" aria-label="Emoji" aria-haspopup="dialog" aria-expanded=${this.emojiOpen ? 'true' : 'false'} ?disabled=${this.disabled} @click=${() => this.toggleEmoji()}>\u{1F642}</button>
      </div>
      <textarea rows="1" aria-label="Message" .placeholder=${this.placeholder} ?disabled=${this.disabled} @keydown=${this.key} @input=${this.grow} @paste=${this.paste}></textarea>
      <button class="send" type="submit" aria-label="Send" ?disabled=${this.disabled}>\u2191</button>
      ${this.attachOpen
        ? html`<div class="attach-menu" role="menu" aria-label="Attach">${ATTACH_ACTIONS.map((a) => html`<button type="button" role="menuitem" class="attach-item" @click=${() => this.choose(a)}>${a.label}</button>`)}</div>`
        : nothing}
      ${this.emojiOpen ? html`<app-emoji-picker .frequent=${this.frequent} @pick=${(e) => this.insert(e.detail)}></app-emoji-picker>` : nothing}
    </form>`;
  }
}

customElements.define('app-composer', AppComposer);
