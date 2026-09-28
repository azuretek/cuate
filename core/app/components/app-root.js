import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { createApiClient } from '../../kit/api.js';
import { orderChats, applyMessageToChats, chatTitle } from '../rules/chats.js';
import { mergeMessages, applyReaction } from '../rules/messages.js';
import { connectionSentence } from '../rules/connection.js';
import './app-onboarding.js';
import './app-chat-list.js';
import './app-conversation.js';

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
    this.pending = new Map();
    this.client = null;
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
      const { chats } = await client.chats({ limit: 200 });
      this.client = client;
      this.sending = Boolean(info.sending);
      this.chats = orderChats(chats);
      this.phase = 'ready';
      client.connect();
      if (this.chats.length) await this.open(this.chats[0].id);
      this.dataset.state = 'ready';
    } catch (e) {
      client.close();
      this.phase = 'onboarding';
      this.problem = this.describe(e);
    }
  }

  onConnState(s) {
    this.conn = s;
    if (s === 'unauthorized') this.signOut("The server no longer accepts this device's token. Connect again with a new one.");
    if (s === 'open' && this.client) this.client.info().then((info) => { this.sending = Boolean(info.sending); }, () => {});
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
    delete this.dataset.state;
    this.phase = 'onboarding';
    this.problem = reason || '';
  }

  async open(chatId) {
    this.openChatId = chatId;
    this.messages = [];
    this.hasMore = false;
    this.chats = this.chats.map((c) => (c.id === chatId && c.unread ? { ...c, unread: 0 } : c));
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
      const { chats } = await this.client.chats({ limit: 200 });
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
    } else if (name === 'server.state') {
      this.sending = Boolean(data.sending);
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

  render() {
    if (this.phase === 'boot' || this.phase === 'loading') return html`<div class="splash" aria-busy="true"><div class="spinner" role="img" aria-label="Loading"></div></div>`;
    if (this.phase === 'onboarding') return html`<app-onboarding .problem=${this.problem} .busy=${this.busy} @connect=${(e) => this.onConnect(e.detail)}></app-onboarding>`;
    const chat = this.chats.find((c) => c.id === this.openChatId) || null;
    const sentence = connectionSentence(this.conn);
    return html`<div class="shell">
      <aside class="sidebar" aria-label="Conversations">
        <header class="sidebar-head"><h1 class="title">Messages</h1><button class="text-button" @click=${() => this.signOut('')}>Sign out</button></header>
        ${sentence ? html`<div class="banner" role="status">${sentence}</div>` : nothing}
        ${this.problem ? html`<div class="banner problem" role="alert">${this.problem}</div>` : nothing}
        <app-chat-list .chats=${this.chats} .selected=${this.openChatId} @select=${(e) => this.open(e.detail)}></app-chat-list>
      </aside>
      <main class="main">${chat
        ? html`<app-conversation .chat=${chat} .messages=${this.messages} .hasMore=${this.hasMore} .loadingOlder=${this.loadingOlder} .sending=${this.sending} .client=${this.client} @send=${(e) => this.send(e.detail)} @older=${() => this.loadOlder()}></app-conversation>`
        : html`<div class="empty">No conversation selected.</div>`}</main>
    </div>`;
  }
}

customElements.define('app-root', AppRoot);
