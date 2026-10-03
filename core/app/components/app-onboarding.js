import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { press, emit } from '../../kit/press.js';

class AppOnboarding extends KitElement {
  static properties = { problem: {} };

  constructor() {
    super();
    this.problem = '';
    // Connect shows the probe working on its own button and drops a second press while it runs (core/kit/press.js).
    this.onSubmit = press((e) => this.submit(e), { on: () => this.querySelector('button[type=submit]') });
  }

  submit(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    return emit(this, 'connect', { url: String(f.get('url') || ''), token: String(f.get('token') || '').trim() });
  }

  render() {
    return html`<div class="onboarding-wrap"><form class="onboarding" @submit=${this.onSubmit}>
      <h1 class="title">Connect to your Mac</h1>
      <p class="muted">Enter your server's address and a device token. On the Mac, <code>token create --scope device</code> prints one.</p>
      <label class="field"><span>Server address</span><input name="url" required autocomplete="off" spellcheck="false" placeholder="https://your-mac.example.com"></label>
      <label class="field"><span>Device token</span><input name="token" type="password" required autocomplete="off" spellcheck="false"></label>
      ${this.problem ? html`<p class="problem" role="alert">${this.problem}</p>` : nothing}
      <button class="button primary" type="submit">Connect</button>
    </form></div>`;
  }
}

customElements.define('app-onboarding', AppOnboarding);
