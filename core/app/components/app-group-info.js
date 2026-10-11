import { html } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { press, emit } from '../../kit/press.js';
import { dismissable } from '../../kit/dismiss.js';
import { chatTitle, isAddress } from '../rules/chats.js';

// A group conversation's own details (issue 326): its name and its people. A rename, an added person and a removed one
// go through the Mac, so every member and every device sees the same group; the page hears the changed
// chat back and redraws it here.
class AppGroupInfo extends KitElement {
  static properties = {
    chat: { attribute: false }, client: { attribute: false },
    name: { state: true }, adding: { state: true }, problem: { state: true },
  };

  constructor() {
    super();
    this.chat = null;
    this.client = null;
    this.name = null;
    this.adding = '';
    this.problem = '';
    dismissable(this, { name: 'groupinfo', open: () => true, close: () => emit(this, 'close') });
  }

  async run(work, failed) {
    this.problem = '';
    try {
      const chat = await work();
      emit(this, 'changed', chat);
      return chat;
    } catch (e) {
      this.problem = (e && e.message) || failed;
      throw e;
    }
  }

  rename() {
    const name = String(this.name ?? this.chat.name ?? '').trim();
    return this.run(() => this.client.renameGroup(this.chat.id, name), 'The Mac did not rename the group.').then(() => { this.name = null; });
  }

  add() {
    const address = this.adding.trim();
    if (!isAddress(address)) { this.problem = 'Not a phone number or email: ' + address; return undefined; }
    return this.run(() => this.client.addMember(this.chat.id, address), 'The Mac did not add the person.').then(() => { this.adding = ''; });
  }

  remove(address) {
    return this.run(() => this.client.removeMember(this.chat.id, address), 'The Mac did not remove the person.');
  }

  render() {
    const c = this.chat;
    if (!c) return html``;
    const name = this.name ?? (/^chat[0-9]+$/i.test(c.name || '') ? '' : c.name || '');
    const people = Array.isArray(c.participants) ? c.participants : [];
    return html`<div class="sheet-scrim confirm-scrim">
      <section class="confirm-modal group-info" data-dismiss="groupinfo" role="dialog" aria-modal="true" aria-labelledby="group-info-title">
        <h2 id="group-info-title">${chatTitle(c)}</h2>
        <div class="group-info-row">
          <input class="group-info-name" type="text" placeholder="Group name" aria-label="Group name" .value=${name}
            @input=${(e) => { this.name = e.currentTarget.value; }} @keydown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); this.querySelector('.group-info-rename')?.click(); } }}>
          <button type="button" class="chip group-info-rename" ?disabled=${this.name === null} @click=${press(() => this.rename())}>Rename</button>
        </div>
        <h3 class="group-info-heading">${people.length} ${people.length === 1 ? 'person' : 'people'}</h3>
        <ul class="group-info-people">
          ${people.map((a) => html`<li class="group-info-person" data-address=${a}><span>${a}</span>
            <button type="button" class="text-button danger group-info-remove" aria-label=${'Remove ' + a} ?disabled=${people.length <= 2} @click=${press(() => this.remove(a))}>Remove</button></li>`)}
        </ul>
        <div class="group-info-row">
          <input class="group-info-add" type="text" placeholder="Add a number or email" aria-label="Add a person by number or email" .value=${this.adding}
            @input=${(e) => { this.adding = e.currentTarget.value; this.problem = ''; }} @keydown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); this.querySelector('.group-info-add-button')?.click(); } }}>
          <button type="button" class="chip group-info-add-button" ?disabled=${!this.adding.trim()} @click=${press(() => this.add())}>Add</button>
        </div>
        ${this.problem ? html`<p class="compose-problem" role="alert">${this.problem}</p>` : ''}
        <div class="confirm-actions"><button type="button" class="button primary" @click=${press(() => emit(this, 'close'))}>Done</button></div>
      </section>
    </div>`;
  }
}

customElements.define('app-group-info', AppGroupInfo);
