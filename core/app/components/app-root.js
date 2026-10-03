import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { createApiClient } from '../../kit/api.js';
import { press, respond } from '../../kit/press.js';
import {
  orderChats, applyMessageToChats, chatTitle, emptyFilters, UNGROUPED, SORT_ORDERS, SORT_LABELS,
  sortChats, filterChats, setAllChecked, allChecked, checkedCount,
  addChatsToGroup, groupFromSelection, removeGroup, clearGroupPlacement, hideChats, forgetChats,
  requestDelete, requestDeleteGroup, resolveDelete,
} from '../rules/chats.js';
import { mergeMessages, applyReaction } from '../rules/messages.js';
import { localAttachment, toBase64 } from '../rules/attach.js';
import { connectionSentence } from '../rules/connection.js';
import { noticeEnabled, updateNotice, updateNoticeKey, autoDownloadEnabled, messageNotice, serverUpdateNotice } from '../rules/notifications.js';
import { updateBanner, DISMISS } from '../rules/updates.js';
import { screenFor } from '../rules/screens.js';
import { SLOP, isEdgeStart, isHorizontal, progressFor, settlesOpen } from '../rules/drawer.js';
import { controlLayout } from '../rules/bar-layout.js';
import { resolveScheme, themeVars, textScaleVars, TYPE_SIZE_VARS } from '../rules/theme.js';
import { settingsAfterWrite, settingsAfterRefusal } from '../rules/settings.js';
import { backdropReturns } from '../rules/sheet.js';
import './app-onboarding.js';
import './app-chat-list.js';
import './app-conversation.js';
import './app-settings.js';
import './app-about.js';
import './app-image-viewer.js';

const API_VERSION = 1;
const newKey = () => crypto.randomUUID().replaceAll('-', '');
const newGroupId = () => 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const normalizeUrl = (u) => {
  const s = String(u || '').trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(s) ? s : 'https://' + s;
};

class AppRoot extends KitElement {
  static properties = {
    phase: { state: true }, chats: { state: true }, openChatId: { state: true }, messages: { state: true },
    conn: { state: true }, problem: { state: true }, hasMore: { state: true }, sending: { state: true },
    // The chat a press asked for while its page is on the way: the list marks it at once, and the pane keeps the
    // conversation it is drawing until the new one is ready, then swaps in one step (issue 142).
    selecting: { state: true },
    // The phone keeps one pane at a time: the list slides in over the conversation, and listOpen says which pane is
    // showing. view says which page the main pane draws (the conversation, settings or about).
    view: { state: true }, listOpen: { state: true },
    // The sheet's leaving state has to be reactive: the departure is driven from body.surface--leaving, which updated()
    // writes after a render, so a plain field would never repaint and the leave would never begin.
    sheetLeaving: { state: true }, pendingSheet: { state: true },
    settings: { state: true }, info: { state: true }, serverUrl: { state: true },
    settingsBusy: { state: true }, settingsProblem: { state: true },
    // The scheme applyTheme resolved, handed to the settings page so each theme card shows that scheme's colours.
    scheme: { state: true },
    // The update the shell last reported, drawn as a banner while a download runs. The name must NOT be "update":
    // Lit writes this.update for any reactive property of that name, which shadows LitElement's own update() method
    // and the element throws "this.update is not a function" on its next render.
    updateStatus: { state: true },
    // host is what the shell says it is (product, version, platform), so core can draw a window bar where the
    // platform had a frame; maximized is the window's own state, which the shell reports.
    host: { state: true }, maximized: { state: true },
    // The chat list's filters live on the page, not on the server: they are a way of looking, not an arrangement.
    filters: { state: true }, filterOpen: { state: true }, sortOpen: { state: true },
    // The edit mode and its selection also live on the page: the list draws the checkboxes, the header selects all
    // and acts on the count, and the confirm gate names what a delete will remove before it removes anything.
    editing: { state: true }, checked: { state: true }, pendingDelete: { state: true },
    // The picture open in the viewer ({ src, alt }), raised by a preview in a message or in the composer.
    viewing: { state: true },
    // The message whose reaction is with the server, and a line said under one message when a reaction did not go.
    reacting: { state: true }, messageNote: { state: true },
  };

  constructor() {
    super();
    this.phase = 'boot';
    this.chats = [];
    this.openChatId = null;
    this.messages = [];
    this.conn = 'connecting';
    this.problem = '';
    this.hasMore = false;
    this.selecting = null;
    this.sending = false;
    this.view = 'messages';
    this.listOpen = true;
    this.sheetLeaving = false;
    this.pendingSheet = null;
    // A press on the backdrop is a second way back only when it both starts and ends there (rules/sheet.js).
    this.downOnBackdrop = false;
    this.settings = {};
    this.info = null;
    this.serverUrl = '';
    this.settingsBusy = false;
    this.settingsProblem = '';
    this.scheme = 'light';
    // Never name this `update`: Lit's own lifecycle method is update(), and an own property of
    // that name shadows it, so the element throws "this.update is not a function" on its next
    // render and the app never becomes ready.
    this.updateStatus = null;
    this.pending = new Map();
    this.client = null;
    this.drag = null;
    this.filters = emptyFilters();
    this.filterOpen = false;
    this.sortOpen = false;
    this.editing = false;
    this.checked = [];
    this.pendingDelete = null;
    this.viewing = null;
    this.reacting = null;
    this.messageNote = null;
    // Escape dismisses the confirm modal, bound once so the same function is added and removed.
    this.confirmKey = (event) => { if (event.key === 'Escape') { event.preventDefault(); this.cancelDelete(); } };
    // The custom properties last written from a theme, so a change removes the ones it no longer sets.
    this.themeApplied = [];
    this.schemeQuery = null;
    // The shell's update states arrive here; the page, which holds the server's settings, decides the notice.
    this.offUpdate = null;
    // Until the server's settings are read, a switch turned off there reads as its default (on), so an update state that
    // arrives first is held and decided once they are. The notices already raised, so one release is announced once.
    this.settingsRead = false;
    this.heldUpdate = null;
    this.noticedUpdates = new Set();
    // What the shell says it is (product, version, platform), and the window's own maximized state.
    this.host = {};
    this.maximized = false;
    this.offWindow = null;
    // The shell's tray asks for a screen over app.open; one asked for before the app is ready is answered once it is.
    this.offOpen = null;
    this.heldScreen = null;
  }

  connectedCallback() {
    super.connectedCallback();
    if (typeof window !== 'undefined' && window.matchMedia) {
      this.schemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
      this.onSchemeChange = () => this.applyTheme();
      this.schemeQuery.addEventListener('change', this.onSchemeChange);
    }
    // The shell names its platform and product before the page boots, so the bar is drawn with the first paint and
    // only where a window exists. A phone answers call but installs no event stream, so the bar is desktop only.
    if (typeof window !== 'undefined' && window.bridge && typeof window.bridge.call === 'function') {
      this.bridge('app.info').then((info) => { this.host = info || {}; }, () => {});
    }
    if (typeof window !== 'undefined' && window.bridge && typeof window.bridge.on === 'function') {
      this.offUpdate = window.bridge.on('update.state', (data) => this.onUpdate(data || {}));
      // The window's maximized state comes from the shell, so the platform's own double-click and the control's own
      // toggle redraw the same glyph.
      this.offWindow = window.bridge.on('window.state', (data) => { this.maximized = Boolean(data && data.maximized); });
      this.offOpen = window.bridge.on('app.open', (data) => this.openScreen(data && data.screen));
    }
    this.boot();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.schemeQuery && this.onSchemeChange) this.schemeQuery.removeEventListener('change', this.onSchemeChange);
    if (this.offUpdate) { this.offUpdate(); this.offUpdate = null; }
    if (this.offWindow) { this.offWindow(); this.offWindow = null; }
    if (this.offOpen) { this.offOpen(); this.offOpen = null; }
  }

  // The server holds the theme and the skin; the page writes them onto the root as custom properties, so a theme
  // chosen on any device is what this page draws, and light and dark both come from it. No client carries its own copy.
  applyTheme() {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const scheme = resolveScheme(this.settings['appearance.skin'], Boolean(this.schemeQuery && this.schemeQuery.matches));
    root.dataset.scheme = scheme;
    this.scheme = scheme;
    for (const [name] of this.themeApplied) root.style.removeProperty(name);
    const themed = themeVars(this.settings['appearance.theme'], scheme);
    for (const [name, value] of themed) root.style.setProperty(name, value);
    // Text size scales the type sizes the theme and the tokens resolve to, read back once the theme is in place, so a
    // theme's own type sizes are scaled too. At 100% nothing is written and the tokens draw what they always did.
    const style = getComputedStyle(root);
    const base = Object.fromEntries(TYPE_SIZE_VARS.map((name) => [name, style.getPropertyValue(name)]));
    const scaled = textScaleVars(this.settings['appearance.textScale'], base);
    for (const [name, value] of scaled) root.style.setProperty(name, value);
    this.themeApplied = [...themed, ...scaled];
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
      // The settings are read before the event stream opens, so no notice, a message's or an update's, is decided
      // against defaults the server has already overridden.
      this.settings = await this.readSettings();
      this.settingsRead = true;
      this.applyUpdateSetting();
      this.applyTheme();
      this.chats = orderChats(chats);
      this.phase = 'ready';
      client.connect();
      this.releaseHeldUpdate();
      this.noticeServerUpdate(info.serverUpdate);
      this.releaseHeldScreen();
      if (this.chats.length) await this.open(this.chats[0].id);
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
    if (s === 'open' && this.client) this.client.info().then((info) => { this.info = info; this.sending = Boolean(info.sending); this.noticeServerUpdate(info.serverUpdate); }, () => {});
  }

  // The press that called this shows it working (core/kit/press.js); a probe the server refuses answers false.
  async onConnect({ url, token }) {
    this.problem = '';
    const base = normalizeUrl(url);
    const probe = createApiClient({ baseUrl: base, token });
    try {
      await probe.info();
      await probe.chats({ limit: 1 });
    } catch (e) {
      this.problem = this.describe(e);
      return false;
    }
    await this.bridge('storage.set', { key: 'server.url', value: base });
    await this.bridge('storage.set', { key: 'server.token', value: token });
    await this.start(base, token);
    return this.phase === 'ready';
  }

  async signOut(reason) {
    if (this.client) this.client.close();
    this.client = null;
    await this.bridge('storage.delete', { key: 'server.token' });
    this.chats = [];
    this.messages = [];
    this.openChatId = null;
    this.selecting = null;
    this.settings = {};
    this.settingsRead = false;
    this.view = 'messages';
    this.listOpen = true;
    delete this.dataset.state;
    this.phase = 'onboarding';
    this.problem = reason || '';
  }

  // Nothing is ever emptied to be refilled (issue 142). The conversation already open is refetched in place, and what
  // is on screen stays until the fresh page replaces it in one step, so a resync (every first connection that missed
  // an event, and every reconnect) never blanks it. Another conversation is marked in the list at once, while the pane
  // keeps drawing the one it has until the new page arrives, and then the header, the messages and the phone's pane
  // change together.
  async open(chatId, { show = false } = {}) {
    const refresh = this.openChatId === chatId;
    this.selecting = refresh ? null : chatId;
    if (refresh && show) this.listOpen = false;
    const wasUnread = this.chats.some((c) => c.id === chatId && c.unread);
    this.chats = this.chats.map((c) => (c.id === chatId && c.unread ? { ...c, unread: 0 } : c));
    // Reading a conversation clears it on the Mac too, so the next client that asks sees the same count.
    if (wasUnread && this.client) this.client.markRead(chatId).catch(() => {});
    try {
      const { messages, hasMore } = await this.client.messages(chatId, { limit: 50 });
      if (refresh ? this.openChatId !== chatId : this.selecting !== chatId) return;
      if (!refresh) this.messageNote = null;
      this.openChatId = chatId;
      this.selecting = null;
      this.messages = mergeMessages([], messages);
      this.hasMore = hasMore;
      this.problem = '';
      if (show) this.listOpen = false;
    } catch (e) {
      if (this.selecting === chatId) this.selecting = null;
      this.problem = this.describe(e);
    }
  }

  // The Load earlier press shows itself working and drops a second press (core/kit/press.js), so no flag is kept here.
  async loadOlder() {
    if (!this.hasMore || !this.messages.length) return undefined;
    const chatId = this.openChatId;
    try {
      const { messages, hasMore } = await this.client.messages(chatId, { limit: 50, before: this.messages[0].sentAt });
      if (this.openChatId === chatId) {
        this.messages = mergeMessages(this.messages, messages);
        this.hasMore = hasMore;
      }
      return true;
    } catch (e) {
      this.problem = this.describe(e);
      return false;
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
      if (!m.fromMe && (document.hidden || m.chatId !== this.openChatId) && noticeEnabled(this.settings, 'newMessage')) {
        const chat = this.chats.find((c) => c.id === m.chatId);
        const title = chat ? chatTitle(chat) : m.senderName || m.sender || 'New message';
        this.bridge('notify', messageNotice(title, m)).catch(() => {});
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
    } else if (name === 'server.update') {
      this.noticeServerUpdate(data);
    } else if (name === 'settings.changed') {
      // A change made on any device arrives here and the page redraws from it, so it never holds its own copy.
      this.settings = { ...this.settings, ...(data.values || {}) };
      this.applyUpdateSetting();
      this.applyTheme();
    }
  }

  // An update the shell reports becomes a notice through the same bridge as a message, unless its own switch is off.
  // The download and stall states draw no native notice (a notice cannot show a moving bar), so they become the
  // in-app banner instead, which is where the progress is visible on a platform whose notices cannot update.
  onUpdate(data) {
    const { state, version, percent, detail, canInstall } = data || {};
    this.updateStatus = state ? { state, version: version ?? null, percent: percent ?? null, detail: detail ?? null, canInstall: Boolean(canInstall) } : null;
    if (!this.settingsRead) { this.heldUpdate = data || null; return; }
    this.noticeUpdate(data);
  }

  // The latest state that arrived before the settings did, decided now that they have.
  releaseHeldUpdate() {
    const held = this.heldUpdate;
    this.heldUpdate = null;
    if (held) this.noticeUpdate(held);
  }

  noticeUpdate({ state, version, detail } = {}) {
    const notice = updateNotice(state, version, detail);
    if (!notice || !noticeEnabled(this.settings, notice.type)) return;
    const key = updateNoticeKey(state, version);
    if (key && this.noticedUpdates.has(key)) return;
    if (key) this.noticedUpdates.add(key);
    this.bridge('notify', { title: notice.title, body: notice.body }).catch(() => {});
  }

  // The installed server's refused or rolled-back update raises the existing update-error notice, under its own switch,
  // once per outcome however often info reports it.
  noticeServerUpdate(outcome) {
    const notice = serverUpdateNotice(outcome);
    if (!notice || !this.settingsRead || !noticeEnabled(this.settings, notice.type) || this.noticedUpdates.has(notice.key)) return;
    this.noticedUpdates.add(notice.key);
    this.bridge('notify', { title: notice.title, body: notice.body }).catch(() => {});
  }

  // The page holds the server's settings, so it is the page that tells the shell whether a found release may be
  // fetched and applied on its own. A setting the server has never seen keeps the schema default (off).
  applyUpdateSetting() {
    if (typeof window === 'undefined' || !window.bridge || typeof window.bridge.call !== 'function') return;
    this.bridge('updates.configure', { autoDownload: autoDownloadEnabled(this.settings) }).catch(() => {});
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

  // A staged file is uploaded first and then sent by the id the server gives it, with the text as its caption, so the
  // send itself keeps one client key and the server's once only rule whatever it carries. The answer is the Send
  // press's outcome: false when the send failed, which the bubble says in words.
  async send({ text = '', file = null, replyTo = null } = {}) {
    const chatId = this.openChatId;
    if (!chatId || !this.client) return false;
    const clientKey = newKey();
    const localId = 'local:' + clientKey;
    this.pending.set(clientKey, { localId, chatId, text, messageId: null });
    const local = { id: localId, chatId, fromMe: true, sender: null, senderName: null, text, sentAt: new Date().toISOString(), replyTo: replyTo || null, read: null, attachments: file ? [localAttachment(file)] : [], reactions: [], state: 'sending' };
    this.messages = mergeMessages(this.messages, [local]);
    try {
      const upload = file ? await this.client.upload({ name: file.name || 'file', mime: file.type || undefined, data: toBase64(new Uint8Array(await file.arrayBuffer())) }) : null;
      const r = await this.client.send(chatId, { text, file: upload ? upload.id : undefined, clientKey, replyTo: replyTo || undefined });
      const p = this.pending.get(clientKey);
      if (!p) return true;
      if (r.status === 'uncertain') {
        this.pending.delete(clientKey);
        this.mark(localId, 'uncertain');
        return true;
      }
      p.messageId = r.messageId || null;
      if (p.messageId && this.messages.some((x) => x.id === p.messageId)) {
        this.pending.delete(clientKey);
        this.messages = this.messages.filter((x) => x.id !== localId);
        return true;
      }
      this.mark(localId, 'sent');
      return true;
    } catch (e) {
      this.pending.delete(clientKey);
      this.mark(localId, 'failed', e.code === 'sending_off' ? 'Sending is switched off on the server.' : this.describe(e));
      return false;
    }
  }

  // A reaction is sent through the server like a message. It shows at once on success, and the event stream's copy of
  // it lands on the same slot (one reaction per person per message). A refusal is said under the message.
  async react({ messageId, emoji, remove = false }) {
    const chatId = this.openChatId;
    if (!chatId || !this.client || this.reacting) return false;
    this.reacting = messageId;
    this.messageNote = null;
    try {
      const r = await this.client.react(chatId, messageId, { emoji, remove });
      if (chatId !== this.openChatId) return;
      if (r.status === 'uncertain') this.messageNote = { id: messageId, text: 'The reaction may not have sent.' };
      else this.messages = applyReaction(this.messages, { targetId: messageId, type: r.type, emoji: null, add: r.add, fromMe: true, sender: null });
      return r.status !== 'uncertain';
    } catch (e) {
      if (chatId === this.openChatId) this.messageNote = { id: messageId, text: e.code === 'sending_off' ? 'Sending is switched off on the server.' : this.describe(e) };
      return false;
    } finally {
      this.reacting = null;
    }
  }

  openSettings() {
    this.openSheet('settings');
    this.settingsProblem = '';
  }

  openAbout() {
    this.openSheet('about');
  }

  // Settings and About are ONE sheet surface, so the two pages can never be on screen together: asking for About
  // while Settings is up runs Settings' page down and only then brings About's up. The motion and the dim are
  // Chela's own conventions, so a reader who uses both apps sees one design rather than two; this only sequences.
  openSheet(next) {
    if (!this.sheetShowing) this.view = next;
    else if (this.view !== next) { this.pendingSheet = next; this.leaveSheet(); }
  }

  closeView() {
    this.pendingSheet = null;
    this.leaveSheet();
  }

  // A screen the shell asked for (the tray's Settings, About and Check for updates). The shell has already raised the
  // window; rules/screens.js says what the page shows, and the sheets open through the same path the gear does.
  openScreen(screen) {
    const target = screenFor(screen, { phase: this.phase });
    if (target === 'hold') { this.heldScreen = screen; return; }
    this.heldScreen = null;
    if (target === 'settings') this.openSettings();
    else if (target === 'about') this.openAbout();
    else if (target === 'main' && this.sheetShowing) this.closeView();
  }

  releaseHeldScreen() {
    const screen = this.heldScreen;
    this.heldScreen = null;
    if (screen) this.openScreen(screen);
  }

  // The backdrop beside the card is the second way back, and it only takes a press that both begins and ends on it:
  // a press inside the card is the page's own, and a drag that starts inside and is released over the backdrop (a
  // selection dragged past the edge) is not a return. The rule lives in rules/sheet.js; these only read the targets.
  onBackdropDown = (e) => {
    this.downOnBackdrop = e.target === e.currentTarget;
  };

  onBackdropUp = (e) => {
    const endsOnBackdrop = e.target === e.currentTarget;
    const startsOnBackdrop = this.downOnBackdrop;
    this.downOnBackdrop = false;
    if (backdropReturns(startsOnBackdrop, endsOnBackdrop)) this.closeView();
  };

  onBackdropCancel = () => {
    this.downOnBackdrop = false;
  };

  leaveSheet() {
    if (!this.sheetLeaving) this.sheetLeaving = true;
  }

  // The departure has finished, so the surface changes now: the next page arrives from the bottom edge, or the
  // conversation does. Waiting for the event is what keeps a half-drawn page off the screen.
  onSheetAnimationEnd = (e) => {
    if (!this.sheetLeaving || e.target !== e.currentTarget) return;
    this.sheetLeaving = false;
    const next = this.pendingSheet;
    this.pendingSheet = null;
    this.view = next || 'messages';
  };

  get sheetShowing() {
    return this.view === 'settings' || this.view === 'about';
  }

  // The drawer's scrim closes it, the same thing the conversation's back control does: show the pane behind it.
  closeDrawer() {
    if (this.openChatId) this.listOpen = false;
  }

  // The phone's drawer is dragged, not tapped: a drag from the left edge opens it, a drag back closes it, and the
  // panel and the scrim follow the finger between them. The rules live in rules/drawer.js; this only drives them.
  onPointerDown = (e) => {
    if (this.phase !== 'ready' || this.view !== 'messages') return;
    const sidebar = this.querySelector('.sidebar');
    if (!sidebar || getComputedStyle(sidebar).position !== 'fixed') return;   // the drawer exists only on the phone
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const open = this.listOpen;
    if (!open && !isEdgeStart(e.clientX)) return;   // only an edge drag opens the list
    this.drag = { shell: e.currentTarget, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, open, active: false, width: 0 };
    window.addEventListener('pointermove', this.onPointerMove, { passive: false });
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerCancel);
  };

  onPointerMove = (e) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.active) {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      if (!isHorizontal(dx, dy)) { this.endDrag(); return; }   // the scroll or the selection keeps the gesture
      d.active = true;
      d.width = this.drawerWidth();
      d.shell.dataset.drawer = 'drag';
    }
    e.preventDefault();
    d.shell.style.setProperty('--drawer-progress', String(progressFor({ open: d.open, startX: d.startX, x: e.clientX, width: d.width })));
  };

  onPointerUp = (e) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    if (d.active) this.settleDrawer(d, Number(d.shell.style.getPropertyValue('--drawer-progress')) || 0);
    this.endDrag();
  };

  onPointerCancel = (e) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    // A cancelled drag (the browser took the pointer) returns to where it started rather than deciding.
    if (d.active) this.settleDrawer(d, d.open ? 1 : 0);
    this.endDrag();
  };

  // The finger is up: hand the panel's position back to the stylesheet, which animates it from where the finger left
  // it to where it settled. Clearing the drag flag and the inline position together lets the transition run.
  settleDrawer(d, progress) {
    const open = settlesOpen(progress);
    d.shell.style.removeProperty('--drawer-progress');
    delete d.shell.dataset.drawer;
    d.shell.dataset.pane = open ? 'list' : 'conversation';
    this.listOpen = open;
  }

  endDrag() {
    this.drag = null;
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerCancel);
  }

  drawerWidth() {
    const el = this.querySelector('.sidebar');
    const w = el ? el.getBoundingClientRect().width : 0;
    return w > 0 ? w : window.innerWidth;
  }

  // A setting is written to the server first; the server's answer for that key, not this page, becomes what the page
  // draws, and a rejected write is rolled back so the control never disagrees with the server. Keys the write did not
  // name keep what the event stream last delivered (settingsAfterWrite says why).
  async setSetting({ key, value }) {
    return this.setSettings({ [key]: value });
  }

  // A theme URL is handed to the server, which fetches it, converts it and adds it to the held list. The answer's list
  // is taken for that one key (the event stream brings it too), and the page says what was carried or why it was not.
  // The Import press shows the call working (core/kit/press.js), and a refusal answers false.
  async importThemeUrl({ url }) {
    const page = this.querySelector('app-settings');
    if (!this.client || !page) return false;
    page.urlNote = '';
    try {
      const out = await this.client.themeImport({ url });
      this.settings = settingsAfterWrite(this.settings, { 'appearance.themes': true }, out.values);
      page.urlNote = (out.theme && out.theme.name ? out.theme.name + ': ' : '') + out.summary;
      page.urlImported();
      return true;
    } catch (e) {
      page.urlNote = this.describe(e);
      return false;
    }
  }

  // Several keys are written in one patch, so they land together: a chat group and what it holds, or an imported theme
  // and the choice of it. The answer is the outcome of the press that asked: false when the server refused it.
  async setSettings(patch) {
    if (!this.client || !patch) return false;
    const before = this.settings;
    this.settings = { ...this.settings, ...patch };
    this.settingsBusy = true;
    this.settingsProblem = '';
    try {
      const { values } = await this.client.settingsWrite(patch);
      this.settings = settingsAfterWrite(this.settings, patch, values);
      this.applyTheme();
      this.applyUpdateSetting();
      return true;
    } catch (e) {
      this.settings = settingsAfterRefusal(this.settings, before, patch);
      this.settingsProblem = this.describe(e);
      return false;
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

  // The header is a search field, a filter menu and the gear that opens settings, and no label text at all. Filtering
  // is a way of looking, so its state and its controls live on the page; the list only draws what it is handed.
  setFilters(patch) {
    this.filters = { ...this.filters, ...patch };
  }

  // Clearing one filter leaves the others alone.
  clearFilter(key) {
    const value = key === 'text' ? '' : key === 'unread' ? false : null;
    this.setFilters({ [key]: value });
  }

  // The filters in force, drawn so a person sees what is narrowing the list and can clear one alone.
  activeFilters() {
    const f = this.filters || emptyFilters();
    const chips = [];
    if (f.unread) chips.push({ key: 'unread', label: 'Unread' });
    if (f.kind) chips.push({ key: 'kind', label: f.kind === 'direct' ? 'Direct' : 'Group chats' });
    if (f.group) {
      const g = this.chatGroups().find((x) => x.id === f.group);
      chips.push({ key: 'group', label: g ? g.name : 'Ungrouped' });
    }
    if (f.text) chips.push({ key: 'text', label: 'Search: ' + f.text });
    if (!chips.length) return nothing;
    return html`<div class="active-filters" aria-label="Active filters">${chips.map((c) => html`<span class="active-chip">${c.label}<button type="button" class="chip-clear" aria-label=${'Clear ' + c.label} @click=${press(() => this.clearFilter(c.key))}>×</button></span>`)}</div>`;
  }

  // The dropdown the filter icon opens: everything filterChats supports, which is unread, direct, group chats and the
  // person's own groups. A filter that is on reads as pressed, and pressing it again turns it off.
  filterMenu() {
    const f = this.filters || emptyFilters();
    const groups = this.chatGroups();
    const toggle = (key, value) => this.setFilters({ [key]: f[key] === value ? null : value });
    return html`<div class="filter-menu" role="group" aria-label="Filter conversations">
      <div class="filter-menu-row">
        <button type="button" class="chip" aria-pressed=${f.unread ? 'true' : 'false'} @click=${press(() => this.setFilters({ unread: !f.unread }))}>Unread</button>
        <button type="button" class="chip" aria-pressed=${f.kind === 'direct' ? 'true' : 'false'} @click=${press(() => toggle('kind', 'direct'))}>Direct</button>
        <button type="button" class="chip" aria-pressed=${f.kind === 'group' ? 'true' : 'false'} @click=${press(() => toggle('kind', 'group'))}>Group chats</button>
      </div>
      <div class="filter-menu-row">
        <button type="button" class="chip" aria-pressed=${!f.group ? 'true' : 'false'} @click=${press(() => this.setFilters({ group: null }))}>All groups</button>
        ${groups.map((g) => html`<button type="button" class="chip" aria-pressed=${f.group === g.id ? 'true' : 'false'} @click=${press(() => toggle('group', g.id))}>${g.name}</button>`)}
        <button type="button" class="chip" aria-pressed=${f.group === UNGROUPED ? 'true' : 'false'} @click=${press(() => toggle('group', UNGROUPED))}>Ungrouped</button>
      </div>
    </div>`;
  }

  // The sort choices the icon opens, the current one marked. Picking one writes it to the server through the page,
  // the same setting the list has always read.
  sortMenu() {
    const current = this.settings['chats.sort'] || 'recent';
    return html`<div class="sort-menu" role="menu" aria-label="Sort conversations">
      ${SORT_ORDERS.map((o) => html`<button type="button" class="sort-choice" role="menuitemradio" aria-checked=${o === current ? 'true' : 'false'} @click=${press(() => this.chooseSort(o))}>
        <span class="sort-check" aria-hidden="true">${o === current ? '✓' : ''}</span>${SORT_LABELS[o]}
      </button>`)}
    </div>`;
  }

  chooseSort(sort) {
    this.sortOpen = false;
    return this.setSetting({ key: 'chats.sort', value: sort });
  }

  // --- Edit mode. The page owns the selection, so the header can select all and act on the count, and a delete is
  // held behind the confirm gate before anything is hidden. ---

  chatHidden() {
    const h = this.settings['chats.hidden'];
    return Array.isArray(h) ? h : [];
  }

  // What the list is drawn from: the server's chats minus the ones this client has hidden.
  visibleChats() {
    const hidden = new Set(this.chatHidden());
    return this.chats.filter((c) => !hidden.has(c.id));
  }

  // The rows an edit action can act on, computed with the same rules the list draws with, so the count and the rows
  // can never disagree.
  selectableIds() {
    const sorted = sortChats(this.visibleChats(), { sort: this.settings['chats.sort'] || 'recent', order: this.chatOrder() });
    const visible = filterChats(sorted, this.filters || emptyFilters(), { placement: this.chatPlacement() });
    return visible.map((c) => c.id);
  }

  selectionCount() { return checkedCount(this.checked, this.selectableIds()); }

  toggleEditing() {
    this.editing = !this.editing;
    this.checked = [];
    this.filterOpen = false;
    this.sortOpen = false;
  }

  exitEdit() {
    this.editing = false;
    this.checked = [];
  }

  setChecked(id, checked) {
    this.checked = setAllChecked(this.checked, [id], checked === true);
  }

  toggleAllChecked() {
    const ids = this.selectableIds();
    this.checked = setAllChecked(this.checked, ids, !allChecked(this.checked, ids));
  }

  addSelectionToGroup(groupId) {
    if (!groupId || !this.checked.length) return undefined;
    const work = this.setSettings({ 'chats.placement': addChatsToGroup(this.chatPlacement(), this.checked, groupId) });
    this.exitEdit();
    return work;
  }

  newGroupFromSelection() {
    const input = this.querySelector('.selection-group-name');
    const name = String((input && input.value) || '').trim();
    if (!name || !this.checked.length) return undefined;
    const { groups, placement } = groupFromSelection(this.chatGroups(), this.chatPlacement(), this.checked, { id: newGroupId(), name });
    if (input) input.value = '';
    const work = this.setSettings({ 'chats.groups': groups, 'chats.placement': placement });
    this.exitEdit();
    return work;
  }

  // The first press opens the gate; only the modal's own press, a second one, resolves it. The modal is drawn only
  // while a delete is pending, so a delete cannot complete without that press.
  requestDeleteSelection() {
    this.pendingDelete = requestDelete(this.checked);
    this.holdConfirm();
  }

  requestGroupDelete(id, name) {
    this.pendingDelete = requestDeleteGroup(id, name);
    this.holdConfirm();
  }

  holdConfirm() {
    if (!this.pendingDelete || typeof window === 'undefined') return;
    window.addEventListener('keydown', this.confirmKey);
    this.updateComplete.then(() => { const el = this.querySelector('.confirm-delete'); if (el) el.focus(); });
  }

  cancelDelete() {
    this.pendingDelete = null;
    if (typeof window !== 'undefined') window.removeEventListener('keydown', this.confirmKey);
  }

  confirmDeleteSelection() {
    const pending = resolveDelete(this.pendingDelete, true);
    this.cancelDelete();
    if (!pending) return undefined;
    if (pending.kind === 'group') {
      return this.setSettings({ 'chats.groups': removeGroup(this.chatGroups(), pending.id), 'chats.placement': clearGroupPlacement(this.chatPlacement(), pending.id) });
    }
    const forget = forgetChats(this.chatOrder(), this.chatPlacement(), pending.ids);
    const work = this.setSettings({ 'chats.hidden': hideChats(this.chatHidden(), pending.ids), 'chats.order': forget.order, 'chats.placement': forget.placement });
    this.exitEdit();
    return work;
  }

  // The header while editing: select-all, the count, and the group actions. Delete is held by the gate above.
  editBar() {
    if (!this.editing) return nothing;
    const groups = this.chatGroups();
    const ids = this.selectableIds();
    const count = checkedCount(this.checked, ids);
    const all = allChecked(this.checked, ids);
    return html`<div class="edit-bar" role="group" aria-label="Edit conversations">
      <label class="edit-all"><input type="checkbox" class="select-all" .checked=${all} .indeterminate=${count > 0 && !all} ?disabled=${ids.length === 0} @change=${() => this.toggleAllChecked()}> <span>Select all</span></label>
      <span class="edit-count" role="status">${count} selected</span>
      <div class="edit-actions">
        <select class="selection-group" aria-label="Add to a group" ?disabled=${groups.length === 0}>
          <option value="">Add to group</option>
          ${groups.map((g) => html`<option value=${g.id}>${g.name}</option>`)}
        </select>
        <button type="button" class="chip" ?disabled=${groups.length === 0 || count === 0} @click=${press(() => this.addSelectionToGroup(this.querySelector('.selection-group').value))}>Add</button>
        <input class="selection-group-name" type="text" placeholder="New group" aria-label="New group name">
        <button type="button" class="chip" ?disabled=${count === 0} @click=${press(() => this.newGroupFromSelection())}>New group</button>
        <button type="button" class="danger-button" ?disabled=${count === 0} @click=${press(() => this.requestDeleteSelection())}>Delete</button>
      </div>
    </div>`;
  }

  // The confirm gate drawn: it names what it will remove, says what it will not touch, and only its own Delete
  // resolves it. Escape and Cancel leave everything as it was.
  confirmModal() {
    const pending = this.pendingDelete;
    const isGroup = pending.kind === 'group';
    const n = isGroup ? 1 : pending.ids.length;
    const title = isGroup ? 'Delete the group "' + pending.name + '"?' : 'Delete ' + n + ' conversation' + (n === 1 ? '' : 's') + '?';
    const body = isGroup
      ? "The group leaves this client's list. Its conversations stay, and no message is deleted on the Mac."
      : "They leave this client's list only. No message is deleted on the Mac.";
    return html`<div class="confirm-scrim" @click=${() => this.cancelDelete()}></div>
      <section class="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 id="confirm-title">${title}</h2>
        <p>${body}</p>
        <div class="confirm-actions">
          <button type="button" class="chip" @click=${press(() => this.cancelDelete())}>Cancel</button>
          <button type="button" class="danger-button confirm-delete" @click=${press(() => this.confirmDeleteSelection())}>Delete</button>
        </div>
      </section>`;
  }

  sidebarHead() {
    const f = this.filters || emptyFilters();
    return html`<header class="sidebar-head">
      <input class="chat-search" type="search" placeholder="Search" aria-label="Search conversations" .value=${f.text || ''} @input=${(e) => this.setFilters({ text: e.currentTarget.value })}>
      <button type="button" class="filter-button" aria-label="Filter conversations" aria-haspopup="true" aria-expanded=${this.filterOpen ? 'true' : 'false'} @click=${press(() => { this.filterOpen = !this.filterOpen; this.sortOpen = false; })}>≡</button>
      <button type="button" class="sort-button" aria-label="Sort conversations" aria-haspopup="true" aria-expanded=${this.sortOpen ? 'true' : 'false'} @click=${press(() => { this.sortOpen = !this.sortOpen; this.filterOpen = false; })}>⇅</button>
      <button type="button" class="edit-button" aria-label=${this.editing ? 'Done editing' : 'Edit conversations'} aria-pressed=${this.editing ? 'true' : 'false'} @click=${press(() => this.toggleEditing())}>✎</button>
      <button type="button" class="gear-button" aria-label="Settings" @click=${press(() => this.openSettings())}>⚙</button>
      ${this.sortOpen ? this.sortMenu() : nothing}
      ${this.filterOpen ? this.filterMenu() : nothing}
    </header>`;
  }

  pane() {
    if (this.view !== 'messages') return 'conversation';
    return this.listOpen || !this.openChatId ? 'list' : 'conversation';
  }

  // The settings page and the about page are sheets, so they are drawn by sheetBody and never in the main pane.
  sheetBody() {
    if (this.view === 'about') return html`<app-about .info=${this.info} .host=${this.host} @back=${() => this.openSheet('settings')}></app-about>`;
    return html`<app-settings .values=${this.settings} .serverUrl=${this.serverUrl} .busy=${this.settingsBusy} .problem=${this.settingsProblem} .scheme=${this.scheme}
      @setting=${(e) => respond(e, this.setSetting(e.detail))} @settings=${(e) => respond(e, this.setSettings(e.detail))} @theme-import=${(e) => respond(e, this.importThemeUrl(e.detail))} @signout=${(e) => respond(e, this.signOut(''))} @about=${() => this.openAbout()} @back=${() => this.closeView()}></app-settings>`;
  }

  mainView(chat) {
    return chat
      ? html`<app-conversation .chat=${chat} .messages=${this.messages} .hasMore=${this.hasMore} .sending=${this.sending} .uploadMaxBytes=${this.info?.uploadMaxBytes} .client=${this.client} .windowControls=${this.windowControls()} .maximized=${this.maximized} .reacting=${this.reacting} .note=${this.messageNote} @react=${(e) => respond(e, this.react(e.detail))} @send=${(e) => respond(e, this.send(e.detail))} @older=${(e) => respond(e, this.loadOlder())} @window-action=${(e) => this.windowAction(e.detail)} @back=${() => { this.listOpen = true; }}></app-conversation>`
      : html`<div class="empty">No conversation selected.</div>`;
  }

  // The shell's product and platform; the app draws window chrome only where the platform has a window.
  isDesktop() {
    return ['darwin', 'win32', 'linux'].includes(String(this.host && this.host.platform || '').toLowerCase());
  }

  // The banner's action asks the shell to start a download or apply a downloaded update. The command is the one the
  // rules drew into the banner, so the button and what it does cannot drift; a refusal leaves the banner as it is.
  async updateAction(command) {
    if (!command) return undefined;
    if (command === DISMISS) { this.updateStatus = null; return true; }
    try { await this.bridge(command, {}); return true; } catch { return false; /* the shell refused; the banner keeps the state it last drew */ }
  }

  // The three controls ask the shell; the shell owns the BrowserWindow and answers the new maximized state. The
  // contact header names the middle button maximize, the one shape that changes, so it is mapped to the shell's own
  // toggleMaximize command.
  async windowAction(name) {
    const command = name === 'maximize' ? 'toggleMaximize' : name;
    if (!['minimize', 'toggleMaximize', 'close'].includes(command)) return;
    try {
      const result = await this.bridge('window.' + command, {});
      if (command === 'toggleMaximize') this.maximized = Boolean(result);
    } catch { /* the shell refused the command; the bar keeps the state it last drew */ }
  }

  // What the contact header draws: nothing where the platform keeps its own window buttons (macOS), and our controls
  // at the right on Windows and Linux, in the platform's order. The side and the order are rules/bar-layout.js.
  windowControls() {
    if (!this.isDesktop()) return null;
    return controlLayout({ platform: String(this.host && this.host.platform || '').toLowerCase() });
  }

  // The one class the stylesheet keys off: it says a surface is leaving, so the sheet and its dim leave together.
  updated() {
    document.body.classList.toggle('surface--leaving', this.sheetLeaving === true);
  }

  render() {
    const platform = String(this.host && this.host.platform || '').toLowerCase();
    // No bar, no title and no icon: the app's surfaces run to the top edge of the window. macOS floats its traffic
    // lights over the top left, so the stylesheet pushes the content below down; every other platform draws its window
    // controls in the contact header instead (see mainView).
    return html`<div class="app-window" data-platform=${platform}>
      <div class="app-body">${this.body()}</div>
    </div>`;
  }

  body() {
    if (this.phase === 'boot' || this.phase === 'loading') return html`<div class="splash" aria-busy="true"><div class="spinner" role="img" aria-label="Loading"></div></div>`;
    if (this.phase === 'onboarding') return html`<app-onboarding .problem=${this.problem} @connect=${(e) => respond(e, this.onConnect(e.detail))}></app-onboarding>`;
    const chat = this.chats.find((c) => c.id === this.openChatId) || null;
    const sentence = connectionSentence(this.conn);
    const banner = this.updateStatus ? updateBanner(this.updateStatus.state, { version: this.updateStatus.version, percent: this.updateStatus.percent, detail: this.updateStatus.detail, canInstall: this.updateStatus.canInstall }) : null;
    return html`<div class="shell" data-pane=${this.pane()} @pointerdown=${this.onPointerDown} @view-image=${(e) => { this.viewing = e.detail && e.detail.src ? e.detail : null; }}>
      <aside class="sidebar" aria-label="Conversations">
        ${this.sidebarHead()}
        ${this.editBar()}
        ${sentence ? html`<div class="banner" role="status">${sentence}</div>` : nothing}
        ${this.problem ? html`<div class="banner problem" role="alert">${this.problem}</div>` : nothing}
        ${this.activeFilters()}
        <app-chat-list .chats=${this.visibleChats()} .selected=${this.selecting || this.openChatId}
          .sort=${this.settings['chats.sort'] || 'recent'} .groups=${this.chatGroups()}
          .placement=${this.chatPlacement()} .order=${this.chatOrder()} .filters=${this.filters}
          .editing=${this.editing} .checked=${this.checked}
          @select=${(e) => { this.view = 'messages'; this.open(e.detail, { show: true }); }}
          @check=${(e) => this.setChecked(e.detail.id, e.detail.checked)}
          @groupdelete=${(e) => this.requestGroupDelete(e.detail.id, e.detail.name)}
          @chatsettings=${(e) => respond(e, this.setSettings(e.detail.patch))}></app-chat-list>
      </aside>
      ${chat ? html`<button type="button" class="scrim" aria-label="Close the conversation list" @click=${press(() => this.closeDrawer())}></button>` : nothing}
      <main class="main">${banner ? html`<div class="banner update" role="status"><span>${banner.message} ${banner.detail}</span>${banner.percent === null ? nothing : html`<progress class="update-progress" max="1" value=${banner.percent}></progress>`}${banner.action ? html`<button type="button" class="banner-action" data-command=${banner.action.command} @click=${press(() => this.updateAction(banner.action.command))}>${banner.action.label}</button>` : nothing}</div>` : nothing}${this.mainView(chat)}</main>
      ${this.sheetShowing ? html`<div class="sheet-scrim" @pointerdown=${this.onBackdropDown} @pointerup=${this.onBackdropUp} @pointercancel=${this.onBackdropCancel}><section class="sheet" role="dialog" aria-modal="true" aria-label=${this.view === 'about' ? 'About' : 'Settings'} @animationend=${this.onSheetAnimationEnd}>${this.sheetBody()}</section></div>` : nothing}
      ${this.pendingDelete ? this.confirmModal() : nothing}
      ${this.viewing ? html`<app-image-viewer .src=${this.viewing.src} .alt=${this.viewing.alt || ''} @close=${() => { this.viewing = null; }}></app-image-viewer>` : nothing}
    </div>`;
  }
}

customElements.define('app-root', AppRoot);
