import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { press, emit } from '../../kit/press.js';
import { dismissable } from '../../kit/dismiss.js';
import { parseRecipients, recipientSuggestions } from '../rules/chats.js';

// Starting a conversation (issue 326). The person names one or more people, by a name this list already shows or by
// a phone number or email; one person opens or starts the conversation with them, several start a group conversation,
// which may be named. The Mac creates it, so it is the same conversation on the phone. The same sheet makes
// a group from a selection in Edit, starting from the people of the chosen conversations.
class AppCompose extends KitElement {
  static properties = {
    chats: { attribute: false }, client: { attribute: false }, preset: { attribute: false }, mode: {},
    recipients: { state: true }, draft: { state: true }, name: { state: true }, problem: { state: true },
  };

  constructor() {
    super();
    this.chats = [];
    this.client = null;
    this.preset = [];
    this.mode = 'new';
    this.recipients = [];
    this.draft = '';
    this.name = '';
    this.problem = '';
    dismissable(this, { name: 'compose', open: () => true, close: () => emit(this, 'close') });
  }

  connectedCallback() {
    super.connectedCallback();
    this.recipients = [...new Set(Array.isArray(this.preset) ? this.preset : [])];
    this.updateComplete.then(() => this.querySelector('.compose-to')?.focus());
  }

  // The people the list knows, by the name it shows, for an address already chosen.
  nameOf(address) {
    const hit = recipientSuggestions(this.chats, '', { limit: 10000 }).find((s) => s.address === address);
    return hit ? hit.name : address;
  }

  add(address) {
    if (!this.recipients.includes(address)) this.recipients = [...this.recipients, address];
    this.draft = '';
    this.problem = '';
    this.querySelector('.compose-to')?.focus();
  }

  // Never named remove(): that is the element's own Element.remove(), which the page's renderer calls to take this sheet
  // away, and an override drops a person instead and leaves the sheet up (issue 326).
  dropPerson(address) {
    this.recipients = this.recipients.filter((a) => a !== address);
  }

  // Enter or a comma commits what is typed: the first suggestion when the text names someone the list knows, otherwise
  // the addresses it holds. Text that is neither is said back, never sent.
  commit() {
    const text = this.draft.trim();
    if (!text) return;
    const hit = recipientSuggestions(this.chats, text, { exclude: this.recipients, limit: 1 })[0];
    const parsed = parseRecipients(text);
    if (parsed.addresses.length) { for (const a of parsed.addresses) this.add(a); }
    else if (hit) this.add(hit.address);
    if (parsed.invalid.length && !hit) this.problem = 'Not a phone number or email: ' + parsed.invalid.join(', ');
  }

  onKey(e) {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); this.commit(); }
    else if (e.key === 'Backspace' && !this.draft && this.recipients.length) this.dropPerson(this.recipients[this.recipients.length - 1]);
  }

  async start() {
    this.commit();
    if (!this.recipients.length) { this.problem = 'Add at least one person.'; return; }
    const group = this.recipients.length > 1;
    try {
      const chat = await this.client.createChat({ addresses: this.recipients, ...(group && this.name.trim() ? { name: this.name.trim() } : {}) });
      emit(this, 'created', chat);
    } catch (e) {
      this.problem = (e && e.message) || 'The Mac did not start the conversation.';
      throw e;
    }
  }

  render() {
    const group = this.recipients.length > 1 || this.mode === 'group';
    const suggestions = recipientSuggestions(this.chats, this.draft, { exclude: this.recipients });
    const title = this.mode === 'group' ? 'New group' : 'New conversation';
    return html`<div class="sheet-scrim confirm-scrim">
      <section class="confirm-modal compose" data-dismiss="compose" role="dialog" aria-modal="true" aria-labelledby="compose-title">
        <h2 id="compose-title">${title}</h2>
        <div class="compose-field" role="group" aria-label="To">
          <span class="compose-label" aria-hidden="true">To</span>
          ${this.recipients.map((a) => html`<span class="active-chip compose-person" data-address=${a}>${this.nameOf(a)}<button type="button" class="chip-clear" aria-label=${'Remove ' + this.nameOf(a)} @click=${press(() => this.dropPerson(a))}>×</button></span>`)}
          <input class="compose-to" type="text" autocomplete="off" placeholder=${this.recipients.length ? 'Add someone' : 'Name, number or email'} aria-label="Add a person by name, number or email"
            .value=${this.draft} @input=${(e) => { this.draft = e.currentTarget.value; this.problem = ''; }} @keydown=${(e) => this.onKey(e)}>
        </div>
        ${suggestions.length && this.draft.trim() ? html`<ul class="compose-suggestions" role="listbox" aria-label="People">
          ${suggestions.map((s) => html`<li><button type="button" class="compose-suggestion" role="option" @click=${press(() => this.add(s.address))}><span class="compose-suggestion-name">${s.name}</span><span class="muted small">${s.address}</span></button></li>`)}
        </ul>` : nothing}
        ${group ? html`<input class="compose-name" type="text" placeholder="Group name (optional)" aria-label="Group name, optional" .value=${this.name} @input=${(e) => { this.name = e.currentTarget.value; }}>` : nothing}
        ${this.problem ? html`<p class="compose-problem" role="alert">${this.problem}</p>` : nothing}
        <div class="confirm-actions">
          <button type="button" class="chip" @click=${press(() => emit(this, 'close'))}>Cancel</button>
          <button type="button" class="button primary compose-start" ?disabled=${!this.recipients.length && !this.draft.trim()} @click=${press(() => this.start())}>${group ? 'Create group' : 'Start'}</button>
        </div>
      </section>
    </div>`;
  }
}

customElements.define('app-compose', AppCompose);
