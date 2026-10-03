import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { insertEmoji, deleteGrapheme, isEmoji } from '../rules/emoji.js';
import { ATTACH_ACTIONS, sizeLabel, stageCheck } from '../rules/attach.js';
import { loadRecentEmoji, rememberEmoji } from './app-emoji-picker.js';

class AppComposer extends KitElement {
  static properties = {
    disabled: {}, placeholder: {}, maxBytes: {},
    // The message being replied to, as the conversation quotes it ({ id, who, text }), or null.
    replyTo: { attribute: false },
    emojiOpen: { state: true }, attachOpen: { state: true }, frequent: { state: true }, staged: { state: true }, stageProblem: { state: true },
    // A staged picture's preview, as an object URL the composer owns and revokes when the file leaves.
    preview: { state: true },
  };

  constructor() {
    super();
    this.disabled = false;
    this.placeholder = '';
    this.maxBytes = undefined;
    this.replyTo = null;
    this.emojiOpen = false;
    this.attachOpen = false;
    this.frequent = [];
    this.staged = null;
    this.stageProblem = '';
    this.preview = '';
  }

  connectedCallback() {
    super.connectedCallback();
    this.loadFrequent();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.setPreview(null);
  }

  // A staged picture shows the picture itself, not only its name; anything else, or a picture this engine cannot
  // draw (a HEIC on the desktop), keeps the name chip.
  setPreview(file) {
    if (this.preview) URL.revokeObjectURL(this.preview);
    this.preview = file && /^image\//i.test(file.type || '') ? URL.createObjectURL(file) : '';
  }

  openPreview() {
    if (!this.preview || !this.staged) return;
    this.dispatchEvent(new CustomEvent('view-image', { bubbles: true, composed: true, detail: { src: this.preview, alt: this.staged.name } }));
  }

  field() {
    return this.querySelector('textarea');
  }

  async loadFrequent() {
    this.frequent = await loadRecentEmoji();
  }

  async remember(char) {
    const before = this.frequent;
    this.frequent = [...before, char].slice(-200);
    await rememberEmoji(before, char);
  }

  // Choosing a message to reply to puts the caret in the field, ready to type the reply.
  updated(changed) {
    if (changed.has('replyTo') && this.replyTo) this.field()?.focus();
  }

  submit(e) {
    e.preventDefault();
    const t = this.field();
    const text = t.value.trim();
    const file = this.staged;
    if ((!text && !file) || this.disabled) return;
    this.dispatchEvent(new CustomEvent('send', { detail: { text, file, replyTo: this.replyTo ? this.replyTo.id : null } }));
    this.staged = null;
    this.stageProblem = '';
    this.setPreview(null);
    t.value = '';
    this.grow({ currentTarget: t });
    t.focus();
  }

  key(e) {
    if (e.key === 'Escape' && (this.emojiOpen || this.attachOpen)) {
      this.emojiOpen = false;
      this.attachOpen = false;
      return;
    }
    if (e.key === 'Escape' && this.replyTo) {
      this.cancelReply();
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

  // The field grows a line at a time with its text, up to the composer's maximum height, and nothing scrolls while it
  // fits (issue 139). The height is the text's own plus the field's border, since the box is sized border-box and the
  // text's height leaves the border out: the field set to that alone was a border short and drew the platform's bar
  // over a single line. Past the maximum it scrolls, and only then does it carry the app's themed bar. It is measured
  // with scrolling off, so a bar's own width never changes where the lines wrap.
  grow(e) {
    const t = e.currentTarget;
    t.classList.remove('scrolls');
    t.style.height = 'auto';
    const want = t.scrollHeight + t.offsetHeight - t.clientHeight;
    t.style.height = want + 'px';
    t.classList.toggle('scrolls', want > parseFloat(getComputedStyle(t).maxHeight));
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
    this.setPreview(this.staged);
    this.field()?.focus();
  }

  unstage() {
    this.staged = null;
    this.stageProblem = '';
    this.setPreview(null);
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

  cancelReply() {
    this.dispatchEvent(new CustomEvent('reply-cancel'));
    this.field()?.focus();
  }

  render() {
    const s = this.staged;
    const q = this.replyTo;
    return html`${q
      ? html`<div class="composer-reply" role="status"><span class="reply-meta"><span class="reply-who small">${q.who ? 'Replying to ' + q.who : 'Replying'}</span><span class="reply-text muted small">${q.text}</span></span><button type="button" class="staged-remove" aria-label="Cancel reply" @click=${() => this.cancelReply()}>\u00D7</button></div>`
      : nothing}${s || this.stageProblem
      ? html`<div class="composer-staged" role="status">
          ${s && this.preview ? html`<span class="staged-image"><button type="button" class="attachment-preview staged-preview" aria-label=${'Open ' + s.name} @click=${() => this.openPreview()}><img class="staged-preview-image" src=${this.preview} alt=${s.name} @error=${() => this.setPreview(null)}></button><span class="staged-meta"><span class="staged-name">${s.name}</span><span class="muted small">${sizeLabel(s.size)}</span></span><button type="button" class="staged-remove" aria-label=${'Remove ' + s.name} @click=${() => this.unstage()}>\u00D7</button></span>` : nothing}
          ${s && !this.preview ? html`<span class="staged-file"><span class="staged-name">${s.name}</span><span class="muted small">${sizeLabel(s.size)}</span><button type="button" class="staged-remove" aria-label=${'Remove ' + s.name} @click=${() => this.unstage()}>\u00D7</button></span>` : nothing}
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
