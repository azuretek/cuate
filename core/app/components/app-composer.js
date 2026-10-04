import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { press, emit } from '../../kit/press.js';
import { dismissable } from '../../kit/dismiss.js';
import { aimCarets } from '../../kit/popover.js';
import { insertEmoji, deleteGrapheme, isEmoji } from '../rules/emoji.js';
import { ATTACH_ACTIONS, sizeLabel, stageCheck } from '../rules/attach.js';
import { loadRecentEmoji, rememberEmoji } from './app-emoji-picker.js';

class AppComposer extends KitElement {
  static properties = {
    disabled: {}, placeholder: {}, maxBytes: {},
    // The message being replied to ({ id }), or null, and the message the emoji panel is choosing a reaction for, or
    // null. The composer repeats neither message's text: the conversation shows the thread itself (issue 169).
    replyTo: { attribute: false }, reactFor: { attribute: false },
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
    this.reactFor = null;
    this.emojiOpen = false;
    this.attachOpen = false;
    this.frequent = [];
    this.staged = null;
    this.stageProblem = '';
    this.preview = '';
    // Send is one press however it is made, the button or Enter: both run through this, so the send button shows the
    // send working and a second press while it runs is dropped rather than sending twice (core/kit/press.js).
    this.onSubmit = press((e) => this.submit(e), { on: () => this.querySelector('button.send') });
    // The attach menu and the emoji panel close on a press outside them and on Escape, through the kit's one behaviour
    // (core/kit/dismiss.js). Each tool button keeps both names, so pressing one while the other's panel is open
    // switches panels rather than only closing the open one.
    dismissable(this, { name: 'attach', open: () => this.attachOpen, close: () => { this.attachOpen = false; } });
    dismissable(this, { name: 'emoji', open: () => this.emojiOpen, close: () => this.closeEmoji() });
  }

  connectedCallback() {
    super.connectedCallback();
    this.loadFrequent();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.setPreview(null);
    if (this.fit) this.fit.disconnect();
    this.fit = null;
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

  // React on a message opens this composer's own emoji panel, the one used for typing, to choose the reaction.
  willUpdate(changed) {
    if (changed.has('reactFor') && this.reactFor) {
      this.emojiOpen = true;
      this.attachOpen = false;
    }
  }

  // Choosing a message to reply to puts the caret in the field, ready to type the reply.
  updated(changed) {
    if (changed.has('replyTo') && this.replyTo) this.field()?.focus();
    this.watchFit();
    // The attach menu and the emoji panel wear the shared caret, aimed at the tool button that opened each (issue 217).
    aimCarets(this);
  }

  // The field's height is set from its text, so anything that moves where its lines wrap or how tall they are sets it
  // again: a new width (a resized window, a rotated phone, the sidebar) or a new text size or font, which the hidden
  // ruler beside the field follows. Without it the field kept the height of its old width or size and hid the lines
  // that no longer fit, with no bar to reach them (issue 139). Only a change of the field's own width or the ruler's
  // size counts, never the height the field is given here, and the field is set in the next frame, outside the
  // observer's own delivery.
  watchFit() {
    if (this.fit || typeof ResizeObserver !== 'function') return;
    const t = this.field();
    const ruler = this.querySelector('.composer-ruler');
    if (!t || !ruler) return;
    let seen = '';
    this.fit = new ResizeObserver(() => {
      const now = t.offsetWidth + ' ' + ruler.offsetWidth + ' ' + ruler.offsetHeight;
      if (now === seen) return;
      seen = now;
      requestAnimationFrame(() => {
        if (t.isConnected && t.offsetWidth) this.grow({ currentTarget: t });
      });
    });
    this.fit.observe(t);
    this.fit.observe(ruler);
  }

  submit(e) {
    e.preventDefault();
    const t = this.field();
    const text = t.value.trim();
    const file = this.staged;
    if ((!text && !file) || this.disabled) return undefined;
    const work = emit(this, 'send', { text, file, replyTo: this.replyTo ? this.replyTo.id : null });
    this.staged = null;
    this.stageProblem = '';
    this.setPreview(null);
    t.value = '';
    this.grow({ currentTarget: t });
    t.focus();
    return work;
  }

  // Escape with a panel open is the kit's, which closes the panel before the field sees the key.
  key(e) {
    if (e.key === 'Escape' && this.replyTo) {
      this.cancelReply();
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      this.trim(e);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) this.onSubmit(e);
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
  // with scrolling off, so a bar's own width never changes where the lines wrap. While it is measured the field drops to
  // one line, so the composer holds its own height until the field has its new one: a composer that shrank for that
  // moment made the conversation above it taller, the browser pulled a conversation at its end back by the difference,
  // and the conversation took that as the person scrolling away from the end.
  grow(e) {
    const t = e.currentTarget;
    const box = t.parentElement;
    if (box) box.style.minHeight = box.offsetHeight + 'px';
    t.classList.remove('scrolls');
    t.style.height = 'auto';
    const want = t.scrollHeight + t.offsetHeight - t.clientHeight;
    t.style.height = want + 'px';
    t.classList.toggle('scrolls', want > parseFloat(getComputedStyle(t).maxHeight));
    if (box) box.style.minHeight = '';
  }

  toggleEmoji() {
    if (this.emojiOpen) {
      this.closeEmoji();
      return;
    }
    this.emojiOpen = true;
    this.attachOpen = false;
    this.field()?.focus();
  }

  // Closing the panel while it was choosing a reaction ends that reaction without one.
  closeEmoji() {
    this.emojiOpen = false;
    if (this.reactFor) this.dispatchEvent(new CustomEvent('react-cancel'));
  }

  // A pick is the reaction while the panel is choosing one, and text at the caret otherwise. Either way it is recently
  // used, in the one list every panel shares.
  pickEmoji(char) {
    if (!this.reactFor) {
      this.insert(char);
      return;
    }
    this.emojiOpen = false;
    this.remember(char);
    this.dispatchEvent(new CustomEvent('react-pick', { detail: char }));
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
    // An open thread shows in the conversation and in the field's own Reply placeholder; the composer adds no row of its
    // own, and Escape or the thread's close control leaves it (issue 195).
    return html`${s || this.stageProblem
      ? html`<div class="composer-staged" role="status">
          ${s && this.preview ? html`<span class="staged-image"><button type="button" class="attachment-preview staged-preview" aria-label=${'Open ' + s.name} @click=${press(() => this.openPreview())}><img class="staged-preview-image" src=${this.preview} alt=${s.name} @error=${() => this.setPreview(null)}></button><span class="staged-meta"><span class="staged-name">${s.name}</span><span class="muted small">${sizeLabel(s.size)}</span></span><button type="button" class="staged-remove" aria-label=${'Remove ' + s.name} @click=${press(() => this.unstage())}>\u00D7</button></span>` : nothing}
          ${s && !this.preview ? html`<span class="staged-file"><span class="staged-name">${s.name}</span><span class="muted small">${sizeLabel(s.size)}</span><button type="button" class="staged-remove" aria-label=${'Remove ' + s.name} @click=${press(() => this.unstage())}>\u00D7</button></span>` : nothing}
          ${this.stageProblem ? html`<span class="staged-problem small">${this.stageProblem}</span>` : nothing}
        </div>`
      : nothing}<form class="composer" @submit=${this.onSubmit}>
      <div class="composer-tools">
        <button type="button" class="tool" aria-label="Attach" aria-haspopup="menu" data-dismiss-keep="attach emoji" aria-expanded=${this.attachOpen ? 'true' : 'false'} ?disabled=${this.disabled} @click=${press(() => this.toggleAttach())}>+</button>
        <input type="file" hidden @change=${this.picked}>
        <button type="button" class="tool" aria-label="Emoji" aria-haspopup="dialog" data-dismiss-keep="attach emoji" aria-expanded=${this.emojiOpen ? 'true' : 'false'} ?disabled=${this.disabled} @click=${press(() => this.toggleEmoji())}>\u{1F642}</button>
      </div>
      <span class="composer-ruler" aria-hidden="true">M</span>
      <textarea rows="1" aria-label="Message" .placeholder=${this.placeholder} ?disabled=${this.disabled} @keydown=${this.key} @input=${this.grow} @paste=${this.paste}></textarea>
      <button class="send" type="submit" aria-label="Send" ?disabled=${this.disabled}><span class="icon" data-icon="arrow-up" aria-hidden="true"></span></button>
      ${this.attachOpen
        ? html`<div class="attach-menu" role="menu" aria-label="Attach" data-dismiss="attach" data-popover data-popover-edge="bottom">${ATTACH_ACTIONS.map((a) => html`<button type="button" role="menuitem" class="attach-item" @click=${press(() => this.choose(a))}>${a.label}</button>`)}</div>`
        : nothing}
      ${this.emojiOpen ? html`<app-emoji-picker dismiss="emoji" .frequent=${this.frequent} aria-label=${this.reactFor ? 'React with an emoji' : nothing} @pick=${(e) => this.pickEmoji(e.detail)}></app-emoji-picker>` : nothing}
    </form>`;
  }
}

customElements.define('app-composer', AppComposer);
