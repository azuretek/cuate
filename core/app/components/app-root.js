import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { createApiClient } from '../../kit/api.js';
import { orderChats, applyMessageToChats, chatTitle, emptyFilters } from '../rules/chats.js';
import { mergeMessages, applyReaction } from '../rules/messages.js';
import { connectionSentence } from '../rules/connection.js';
import './app-onboarding.js';
import './app-chat-list.js';
import './app-conversation.js';
import './app-settings.js';
import './app-about.js';

const API_VERSION = 1;
const newKey = () => crypto.randomUUID().replaceAll('-', '');
const normalizeUrl = (u) => {
  const s = String(u || '').trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(s) ? s : 'https://' + s;
};

class AppRoot extends KitElement {
  static properties = {
    phase: { state: true }, chats: { state: true }, openChatId: { state: true }, messages: { state: true },
    conn: { state: true }, problem: { state: true }, busy: { state: true }, hasMore: { state: true },
    loadingOlder: { state: true }, sending: { state: true },
    // The phone keeps one pane at a time: the list slides in over the conversation, and listOpen says which pane is
    // showing. view says which page the main pane draws (the conversation, settings or about).
    view: { state: true }, listOpen: { state: true },
    settings: { state: true }, info: { state: true }, serverUrl: { state: true },
    settingsBusy: { state: true }, settingsProblem: { state: true },
    // The chat list's filters live on the page, not on the server: they are a way of looking, not an arrangement.
    filters: { state: true },
  };

  constructor() {
    super();
    this.phase = 'boot';
    this.chats = [];
    this.openChatId = null;
    this.messages = [];
    this.conn = 'connecting';
    this.problem = '';
    this.busy = false;
    this.hasMore = false;
    this.loadingOlder = false;
    this.sending = false;
    this.view = 'messages';
    this.listOpen = true;
    this.settings = {};
    this.info = null;
    this.serverUrl = '';
    this.settingsBusy = false;
    this.settingsProblem = '';
    this.pending = new Map();
    this.client = null;
    this.filters = emptyFilters();
  }

  connectedCallback() {
    super.connectedCallback();
    this.boot();
  }

  bridge(name, args) {
    return window.bridge.call(name, args);
  }

  describe(e) {
    if (e.code === 'unreachable') return connectionSentence('unreachable');
    if (e.status === 401 || e.status === 403) return 'The server refused this token.';
    return e.message || 'Something went wrong.';
  }

  async boot() {
    try {
      const url = await this.bridge('storage.get', { key: 'server.url' });
      const token = await this.bridge('storage.get', { key: 'server.token' });
      if (!url || !token) { this.phase = 'onboarding'; return; }
      await this.start(url, token);
    } catch (e) {
      this.phase = 'onboarding';
      this.problem = this.describe(e);
    }
  }

  async start(url, token) {
    this.phase = 'loading';
    this.problem = '';
    if (this.client) this.client.close();
    const client = createApiClient({ baseUrl: url, token, onEvent: (e) => this.onEvent(e), onState: (s) => this.onConnState(s) });
    try {
      const info = await client.info();
      if (info.apiVersion !== API_VERSION) throw new Error(connectionSentence('version-mismatch'));
      const { chats } = await client.chats();
      this.client = client;
      this.info = info;
      this.serverUrl = url;
      this.sending = Boolean(info.sending);
      this.chats = orderChats(chats);
      this.phase = 'ready';
      client.connect();
      if (this.chats.length) await this.open(this.chats[0].id);
      this.settings = await this.readSettings();
      this.dataset.state = 'ready';
    } catch (e) {
      client.close();
      this.phase = 'onboarding';
      this.problem = this.describe(e);
    }
  }

  // The server holds every setting; the page only draws what it holds. A read that fails leaves the schema defaults.
  async readSettings() {
    try {
      const { values } = await this.client.settings();
      return values || {};
    } catch {
      return {};
    }
  }

  onConnState(s) {
    this.conn = s;
    if (s === 'unauthorized') this.signOut("The server no longer accepts this device's token. Connect again with a new one.");
    if (s === 'open' && this.client) this.client.info().then((info) => { this.info = info; this.sending = Boolean(info.sending); }, () => {});
  }

  async onConnect({ url, token }) {
    this.busy = true;
    this.problem = '';
    const base = normalizeUrl(url);
    const probe = createApiClient({ baseUrl: base, token });
    try {
      await probe.info();
      await probe.chats({ limit: 1 });
    } catch (e) {
      this.busy = false;
      this.problem = this.describe(e);
      return;
    }
    await this.bridge('storage.set', { key: 'server.url', value: base });
    await this.bridge('storage.set', { key: 'server.token', value: token });
    this.busy = false;
    await this.start(base, token);
  }

  async signOut(reason) {
    if (this.client) this.client.close();
    this.client = null;
    await this.bridge('storage.delete', { key: 'server.token' });
    this.chats = [];
    this.messages = [];
    this.openChatId = null;
    this.settings = {};
    this.view = 'messages';
    this.listOpen = true;
    delete this.dataset.state;
    this.phase = 'onboarding';
    this.problem = reason || '';
  }

  async open(chatId, { show = false } = {}) {
    this.openChatId = chatId;
    if (show) this.listOpen = false;
    this.messages = [];
    this.hasMore = false;
    const wasUnread = this.chats.some((c) => c.id === chatId && c.unread);
    this.chats = this.chats.map((c) => (c.id === chatId && c.unread ? { ...c, unread: 0 } : c));
    // Reading a conversation clears it on the Mac too, so the next client that asks sees the same count.
    if (wasUnread && this.client) this.client.markRead(chatId).catch(() => {});
    try {
      const { messages, hasMore } = await this.client.messages(chatId, { limit: 50 });
      if (this.openChatId !== chatId) return;
      this.messages = mergeMessages([], messages);
      this.hasMore = hasMore;
      this.problem = '';
    } catch (e) {
      this.problem = this.describe(e);
    }
  }

  async loadOlder() {
    if (!this.hasMore || this.loadingOlder || !this.messages.length) return;
    const chatId = this.openChatId;
    this.loadingOlder = true;
    try {
      const { messages, hasMore } = await this.client.messages(chatId, { limit: 50, before: this.messages[0].sentAt });
      if (this.openChatId === chatId) {
        this.messages = mergeMessages(this.messages, messages);
        this.hasMore = hasMore;
      }
    } catch (e) {
      this.problem = this.describe(e);
    } finally {
      this.loadingOlder = false;
    }
  }

  async reload() {
    if (!this.client) return;
    try {
      const { chats } = await this.client.chats();
      this.chats = orderChats(chats);
      if (this.openChatId) await this.open(this.openChatId);
    } catch (e) {
      this.problem = this.describe(e);
    }
  }

  onEvent({ name, data }) {
    if (name === 'resync') { this.reload(); return; }
    if (name === 'message.new') {
      const m = data.message;
      this.reconcile(m);
      const r = applyMessageToChats(this.chats, m, { openChatId: this.openChatId });
      if (r.known) this.chats = r.chats;
      else this.reload();
      if (m.chatId === this.openChatId) this.messages = mergeMessages(this.messages, [m]);
      if (!m.fromMe && (document.hidden || m.chatId !== this.openChatId)) {
        const chat = this.chats.find((c) => c.id === m.chatId);
        const title = chat ? chatTitle(chat) : m.senderName || m.sender || 'New message';
        this.bridge('notify', { title, body: m.text || 'Attachment' }).catch(() => {});
      }
    } else if (name === 'reaction') {
      if (data.chatId === this.openChatId) this.messages = applyReaction(this.messages, data);
    } else if (name === 'chat.read') {
      // A chat read on any device clears here too, so the count is the server's and not this page's own idea.
      const id = String(data.chatId);
      const unread = Number.isFinite(data.unread) ? data.unread : 0;
      this.chats = this.chats.map((c) => (c.id === id ? { ...c, unread } : c));
    } else if (name === 'server.state') {
      this.sending = Boolean(data.sending);
    } else if (name === 'settings.changed') {
      // A change made on any device arrives here and the page redraws from it, so it never holds its own copy.
      this.settings = { ...this.settings, ...(data.values || {}) };
    }
  }

  // A confirmed outgoing message replaces the bubble drawn when Send was pressed.
  reconcile(m) {
    if (!m.fromMe) return;
    for (const [key, p] of this.pending) {
      if (p.chatId !== m.chatId) continue;
      if ((p.messageId && p.messageId === m.id) || (!p.messageId && p.text === m.text)) {
        this.pending.delete(key);
        this.messages = this.messages.filter((x) => x.id !== p.localId);
        return;
      }
    }
  }

  mark(localId, state, note = '') {
    this.messages = this.messages.map((x) => (x.id === localId ? { ...x, state, note } : x));
  }

  async send(text) {
    const chatId = this.openChatId;
    if (!chatId || !this.client) return;
    const clientKey = newKey();
    const localId = 'local:' + clientKey;
    this.pending.set(clientKey, { localId, chatId, text, messageId: null });
    const local = { id: localId, chatId, fromMe: true, sender: null, senderName: null, text, sentAt: new Date().toISOString(), replyTo: null, read: null, attachments: [], reactions: [], state: 'sending' };
    this.messages = mergeMessages(this.messages, [local]);
    try {
      const r = await this.client.send(chatId, { text, clientKey });
      const p = this.pending.get(clientKey);
      if (!p) return;
      if (r.status === 'uncertain') {
        this.pending.delete(clientKey);
        this.mark(localId, 'uncertain');
        return;
      }
      p.messageId = r.messageId || null;
      if (p.messageId && this.messages.some((x) => x.id === p.messageId)) {
        this.pending.delete(clientKey);
        this.messages = this.messages.filter((x) => x.id !== localId);
        return;
      }
      this.mark(localId, 'sent');
    } catch (e) {
      this.pending.delete(clientKey);
      this.mark(localId, 'failed', e.code === 'sending_off' ? 'Sending is switched off on the server.' : this.describe(e));
    }
  }

  openSettings() {
    this.view = 'settings';
    this.settingsProblem = '';
  }

  openAbout() {
    this.view = 'about';
  }

  closeView() {
    this.view = 'messages';
  }

  // The drawer's scrim closes it, the same thing the conversation's back control does: show the pane behind it.
  closeDrawer() {
    if (this.openChatId) this.listOpen = false;
  }

  // A setting is written to the server first; the server's answer, not this page, becomes what the page draws, and a
  // rejected write is rolled back so the control never disagrees with the server.
  async setSetting({ key, value }) {
    if (!this.client) return;
    const before = this.settings;
    this.settings = { ...this.settings, [key]: value };
    this.settingsBusy = true;
    this.settingsProblem = '';
    try {
      const { values } = await this.client.settingsWrite({ [key]: value });
      this.settings = values || this.settings;
    } catch (e) {
      this.settings = before;
      this.settingsProblem = this.describe(e);
    } finally {
      this.settingsBusy = false;
    }
  }

  chatGroups() {
    const g = this.settings['chats.groups'];
    return Array.isArray(g) ? g : [];
  }

  chatPlacement() {
    const p = this.settings['chats.placement'];
    return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
  }

  chatOrder() {
    const o = this.settings['chats.order'];
    return Array.isArray(o) ? o : [];
  }

  // The chat list's arrangement is written to the server in one patch, so a group and what it holds land together.
  async setSettings(patch) {
    if (!this.client || !patch) return;
    const before = this.settings;
    this.settings = { ...this.settings, ...patch };
    this.settingsBusy = true;
    this.settingsProblem = '';
    try {
      const { values } = await this.client.settingsWrite(patch);
      this.settings = values || this.settings;
    } catch (e) {
      this.settings = before;
      this.settingsProblem = this.describe(e);
    } finally {
      this.settingsBusy = false;
    }
  }

  pane() {
    if (this.view !== 'messages') return 'conversation';
    return this.listOpen || !this.openChatId ? 'list' : 'conversation';
  }

  mainView(chat) {
    if (this.view === 'settings') return html`<app-settings .values=${this.settings} .serverUrl=${this.serverUrl} .busy=${this.settingsBusy} .problem=${this.settingsProblem}
      @setting=${(e) => this.setSetting(e.detail)} @signout=${() => this.signOut('')} @about=${() => this.openAbout()} @back=${() => this.closeView()}></app-settings>`;
    if (this.view === 'about') return html`<app-about .info=${this.info} @back=${() => this.openSettings()}></app-about>`;
    return chat
      ? html`<app-conversation .chat=${chat} .messages=${this.messages} .hasMore=${this.hasMore} .loadingOlder=${this.loadingOlder} .sending=${this.sending} .client=${this.client} @send=${(e) => this.send(e.detail)} @older=${() => this.loadOlder()} @back=${() => { this.listOpen = true; }}></app-conversation>`
      : html`<div class="empty">No conversation selected.</div>`;
  }

  render() {
    if (this.phase === 'boot' || this.phase === 'loading') return html`<div class="splash" aria-busy="true"><div class="spinner" role="img" aria-label="Loading"></div></div>`;
    if (this.phase === 'onboarding') return html`<app-onboarding .problem=${this.problem} .busy=${this.busy} @connect=${(e) => this.onConnect(e.detail)}></app-onboarding>`;
    const chat = this.chats.find((c) => c.id === this.openChatId) || null;
    const sentence = connectionSentence(this.conn);
    return html`<div class="shell" data-pane=${this.pane()}>
      <aside class="sidebar" aria-label="Conversations">
        <header class="sidebar-head"><h1 class="title">Chats</h1><button class="text-button" @click=${() => this.openSettings()}>Settings</button></header>
        ${sentence ? html`<div class="banner" role="status">${sentence}</div>` : nothing}
        ${this.problem ? html`<div class="banner problem" role="alert">${this.problem}</div>` : nothing}
        <app-chat-list .chats=${this.chats} .selected=${this.openChatId}
          .sort=${this.settings['chats.sort'] || 'recent'} .groups=${this.chatGroups()}
          .placement=${this.chatPlacement()} .order=${this.chatOrder()} .filters=${this.filters}
          @select=${(e) => { this.view = 'messages'; this.open(e.detail, { show: true }); }}
          @sort=${(e) => this.setSetting({ key: 'chats.sort', value: e.detail.sort })}
          @filter=${(e) => { this.filters = e.detail.filters; }}
          @chatsettings=${(e) => this.setSettings(e.detail.patch)}></app-chat-list>
      </aside>
      ${chat ? html`<button type="button" class="scrim" aria-label="Close the conversation list" @click=${() => this.closeDrawer()}></button>` : nothing}
      <main class="main">${this.mainView(chat)}</main>
    </div>`;
  }
}

customElements.define('app-root', AppRoot);
