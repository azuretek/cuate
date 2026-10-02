import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { createApiClient } from '../../kit/api.js';
import { orderChats, applyMessageToChats, chatTitle, emptyFilters, UNGROUPED } from '../rules/chats.js';
import { mergeMessages, applyReaction } from '../rules/messages.js';
import { localAttachment, toBase64 } from '../rules/attach.js';
import { connectionSentence } from '../rules/connection.js';
import { noticeEnabled, updateNotice, autoDownloadEnabled, messageNotice } from '../rules/notifications.js';
import { updateBanner } from '../rules/updates.js';
import { SLOP, isEdgeStart, isHorizontal, progressFor, settlesOpen } from '../rules/drawer.js';
import { resolveScheme, themeVars } from '../rules/theme.js';
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

// The window controls' glyphs, drawn in currentColor so a control follows the theme like every other mark.
const ICON_MINIMIZE = html`<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5h10" fill="none" stroke="currentColor" stroke-width="1"></path></svg>`;
const ICON_MAXIMIZE = html`<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"></rect></svg>`;
const ICON_RESTORE = html`<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 2.5V0.5h7v7h-2" fill="none" stroke="currentColor" stroke-width="1"></path><rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1"></rect></svg>`;
const ICON_CLOSE = html`<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0.5 0.5l9 9M9.5 0.5l-9 9" fill="none" stroke="currentColor" stroke-width="1"></path></svg>`;

class AppRoot extends KitElement {
  static properties = {
    phase: { state: true }, chats: { state: true }, openChatId: { state: true }, messages: { state: true },
    conn: { state: true }, problem: { state: true }, busy: { state: true }, hasMore: { state: true },
    loadingOlder: { state: true }, sending: { state: true },
    // The phone keeps one pane at a time: the list slides in over the conversation, and listOpen says which pane is
    // showing. view says which page the main pane draws (the conversation, settings or about).
    view: { state: true }, listOpen: { state: true },
    // The sheet's leaving state has to be reactive: the departure is driven from body.surface--leaving, which updated()
    // writes after a render, so a plain field would never repaint and the leave would never begin.
    sheetLeaving: { state: true }, pendingSheet: { state: true },
    settings: { state: true }, info: { state: true }, serverUrl: { state: true },
    settingsBusy: { state: true }, settingsProblem: { state: true },
    // The update the shell last reported, drawn as a banner while a download runs. The name must NOT be "update":
    // Lit writes this.update for any reactive property of that name, which shadows LitElement's own update() method
    // and the element throws "this.update is not a function" on its next render.
    updateStatus: { state: true },
    // host is what the shell says it is (product, version, platform), so core can draw a window bar where the
    // platform had a frame; maximized is the window's own state, which the shell reports.
    host: { state: true }, maximized: { state: true },
    // The chat list's filters live on the page, not on the server: they are a way of looking, not an arrangement.
    filters: { state: true }, filterOpen: { state: true },
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
    this.sheetLeaving = false;
    this.pendingSheet = null;
    this.settings = {};
    this.info = null;
    this.serverUrl = '';
    this.settingsBusy = false;
    this.settingsProblem = '';
    // Never name this `update`: Lit's own lifecycle method is update(), and an own property of
    // that name shadows it, so the element throws "this.update is not a function" on its next
    // render and the app never becomes ready.
    this.updateStatus = null;
    this.pending = new Map();
    this.client = null;
    this.drag = null;
    this.filters = emptyFilters();
    this.filterOpen = false;
    // The custom properties last written from a theme, so a change removes the ones it no longer sets.
    this.themeApplied = [];
    this.schemeQuery = null;
    // The shell's update states arrive here; the page, which holds the server's settings, decides the notice.
    this.offUpdate = null;
    // What the shell says it is (product, version, platform), and the window's own maximized state.
    this.host = {};
    this.maximized = false;
    this.offWindow = null;
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
    }
    this.boot();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.schemeQuery && this.onSchemeChange) this.schemeQuery.removeEventListener('change', this.onSchemeChange);
    if (this.offUpdate) { this.offUpdate(); this.offUpdate = null; }
    if (this.offWindow) { this.offWindow(); this.offWindow = null; }
  }

  // The server holds the theme and the skin; the page writes them onto the root as custom properties, so a theme
  // chosen on any device is what this page draws, and light and dark both come from it. No client carries its own copy.
  applyTheme() {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const scheme = resolveScheme(this.settings['appearance.skin'], Boolean(this.schemeQuery && this.schemeQuery.matches));
    root.dataset.scheme = scheme;
    for (const [name] of this.themeApplied) root.style.removeProperty(name);
    this.themeApplied = themeVars(this.settings['appearance.theme'], scheme);
    for (const [name, value] of this.themeApplied) root.style.setProperty(name, value);
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
      this.applyUpdateSetting();
      this.applyTheme();
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
    const notice = updateNotice(state, version, detail);
    if (!notice || !noticeEnabled(this.settings, notice.type)) return;
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
  // send itself keeps one client key and the server's once only rule whatever it carries.
  async send({ text = '', file = null } = {}) {
    const chatId = this.openChatId;
    if (!chatId || !this.client) return;
    const clientKey = newKey();
    const localId = 'local:' + clientKey;
    this.pending.set(clientKey, { localId, chatId, text, messageId: null });
    const local = { id: localId, chatId, fromMe: true, sender: null, senderName: null, text, sentAt: new Date().toISOString(), replyTo: null, read: null, attachments: file ? [localAttachment(file)] : [], reactions: [], state: 'sending' };
    this.messages = mergeMessages(this.messages, [local]);
    try {
      const upload = file ? await this.client.upload({ name: file.name || 'file', mime: file.type || undefined, data: toBase64(new Uint8Array(await file.arrayBuffer())) }) : null;
      const r = await this.client.send(chatId, { text, file: upload ? upload.id : undefined, clientKey });
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
      this.applyUpdateSetting();
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
    return html`<div class="active-filters" aria-label="Active filters">${chips.map((c) => html`<span class="active-chip">${c.label}<button type="button" class="chip-clear" aria-label=${'Clear ' + c.label} @click=${() => this.clearFilter(c.key)}>×</button></span>`)}</div>`;
  }

  // The dropdown the filter icon opens: everything filterChats supports, which is unread, direct, group chats and the
  // person's own groups. A filter that is on reads as pressed, and pressing it again turns it off.
  filterMenu() {
    const f = this.filters || emptyFilters();
    const groups = this.chatGroups();
    const toggle = (key, value) => this.setFilters({ [key]: f[key] === value ? null : value });
    return html`<div class="filter-menu" role="group" aria-label="Filter conversations">
      <div class="filter-menu-row">
        <button type="button" class="chip" aria-pressed=${f.unread ? 'true' : 'false'} @click=${() => this.setFilters({ unread: !f.unread })}>Unread</button>
        <button type="button" class="chip" aria-pressed=${f.kind === 'direct' ? 'true' : 'false'} @click=${() => toggle('kind', 'direct')}>Direct</button>
        <button type="button" class="chip" aria-pressed=${f.kind === 'group' ? 'true' : 'false'} @click=${() => toggle('kind', 'group')}>Group chats</button>
      </div>
      <div class="filter-menu-row">
        <button type="button" class="chip" aria-pressed=${!f.group ? 'true' : 'false'} @click=${() => this.setFilters({ group: null })}>All groups</button>
        ${groups.map((g) => html`<button type="button" class="chip" aria-pressed=${f.group === g.id ? 'true' : 'false'} @click=${() => toggle('group', g.id)}>${g.name}</button>`)}
        <button type="button" class="chip" aria-pressed=${f.group === UNGROUPED ? 'true' : 'false'} @click=${() => toggle('group', UNGROUPED)}>Ungrouped</button>
      </div>
    </div>`;
  }

  sidebarHead() {
    const f = this.filters || emptyFilters();
    return html`<header class="sidebar-head">
      <input class="chat-search" type="search" placeholder="Search" aria-label="Search conversations" .value=${f.text || ''} @input=${(e) => this.setFilters({ text: e.currentTarget.value })}>
      <button type="button" class="filter-button" aria-label="Filter conversations" aria-haspopup="true" aria-expanded=${this.filterOpen ? 'true' : 'false'} @click=${() => { this.filterOpen = !this.filterOpen; }}>≡</button>
      <button type="button" class="gear-button" aria-label="Settings" @click=${() => this.openSettings()}>⚙</button>
      ${this.filterOpen ? this.filterMenu() : nothing}
    </header>`;
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

  // The settings page and the about page are sheets, so they are drawn by sheetBody and never in the main pane.
  sheetBody() {
    if (this.view === 'about') return html`<app-about .info=${this.info} .host=${this.host} @back=${() => this.openSheet('settings')}></app-about>`;
    return html`<app-settings .values=${this.settings} .serverUrl=${this.serverUrl} .busy=${this.settingsBusy} .problem=${this.settingsProblem}
      @setting=${(e) => this.setSetting(e.detail)} @signout=${() => this.signOut('')} @about=${() => this.openAbout()} @back=${() => this.closeView()}></app-settings>`;
  }

  mainView(chat) {
    return chat
      ? html`<app-conversation .chat=${chat} .messages=${this.messages} .hasMore=${this.hasMore} .loadingOlder=${this.loadingOlder} .sending=${this.sending} .uploadMaxBytes=${this.info?.uploadMaxBytes} .client=${this.client} @send=${(e) => this.send(e.detail)} @older=${() => this.loadOlder()} @back=${() => { this.listOpen = true; }}></app-conversation>`
      : html`<div class="empty">No conversation selected.</div>`;
  }

  // The shell's product and platform; the window bar is drawn only where the platform had a frame.
  isDesktop() {
    return ['darwin', 'win32', 'linux'].includes(String(this.host && this.host.platform || '').toLowerCase());
  }

  // The banner's action asks the shell to start a download or apply a downloaded update. The command is the one the
  // rules drew into the banner, so the button and what it does cannot drift; a refusal leaves the banner as it is.
  async updateAction(command) {
    if (!command) return;
    try { await this.bridge(command, {}); } catch { /* the shell refused; the banner keeps the state it last drew */ }
  }

  // The three controls ask the shell; the shell owns the BrowserWindow and answers the new maximized state.
  async windowAction(name) {
    if (!['minimize', 'toggleMaximize', 'close'].includes(name)) return;
    try {
      const result = await this.bridge('window.' + name, {});
      if (name === 'toggleMaximize') this.maximized = Boolean(result);
    } catch { /* the shell refused the command; the bar keeps the state it last drew */ }
  }

  // Our own bar: the title area is the drag region and the controls opt out of it, so a drag moves the window and a
  // click still acts. The controls come from tokens and sit on the side the platform drew them.
  windowBar() {
    const platform = String(this.host && this.host.platform || '').toLowerCase();
    const product = this.host && this.host.product ? this.host.product : '';
    const maximizeLabel = this.maximized ? 'Restore' : 'Maximize';
    return html`<header class="window-bar" data-platform=${platform}>
      <div class="window-title">${product}</div>
      <div class="window-controls" role="group" aria-label="Window controls">
        <button type="button" class="window-control minimize" aria-label="Minimize" title="Minimize" @click=${() => this.windowAction('minimize')}>${ICON_MINIMIZE}</button>
        <button type="button" class="window-control maximize" aria-label=${maximizeLabel} title=${maximizeLabel} @click=${() => this.windowAction('toggleMaximize')}>${this.maximized ? ICON_RESTORE : ICON_MAXIMIZE}</button>
        <button type="button" class="window-control close" aria-label="Close" title="Close" @click=${() => this.windowAction('close')}>${ICON_CLOSE}</button>
      </div>
    </header>`;
  }

  // The one class the stylesheet keys off: it says a surface is leaving, so the sheet and its dim leave together.
  updated() {
    document.body.classList.toggle('surface--leaving', this.sheetLeaving === true);
  }

  render() {
    return html`<div class="app-window">
      ${this.isDesktop() ? this.windowBar() : nothing}
      <div class="app-body">${this.body()}</div>
    </div>`;
  }

  body() {
    if (this.phase === 'boot' || this.phase === 'loading') return html`<div class="splash" aria-busy="true"><div class="spinner" role="img" aria-label="Loading"></div></div>`;
    if (this.phase === 'onboarding') return html`<app-onboarding .problem=${this.problem} .busy=${this.busy} @connect=${(e) => this.onConnect(e.detail)}></app-onboarding>`;
    const chat = this.chats.find((c) => c.id === this.openChatId) || null;
    const sentence = connectionSentence(this.conn);
    const banner = this.updateStatus ? updateBanner(this.updateStatus.state, { version: this.updateStatus.version, percent: this.updateStatus.percent, detail: this.updateStatus.detail, canInstall: this.updateStatus.canInstall }) : null;
    return html`<div class="shell" data-pane=${this.pane()} @pointerdown=${this.onPointerDown}>
      <aside class="sidebar" aria-label="Conversations">
        ${this.sidebarHead()}
        ${sentence ? html`<div class="banner" role="status">${sentence}</div>` : nothing}
        ${this.problem ? html`<div class="banner problem" role="alert">${this.problem}</div>` : nothing}
        ${this.activeFilters()}
        <app-chat-list .chats=${this.chats} .selected=${this.openChatId}
          .sort=${this.settings['chats.sort'] || 'recent'} .groups=${this.chatGroups()}
          .placement=${this.chatPlacement()} .order=${this.chatOrder()} .filters=${this.filters}
          @select=${(e) => { this.view = 'messages'; this.open(e.detail, { show: true }); }}
          @sort=${(e) => this.setSetting({ key: 'chats.sort', value: e.detail.sort })}
          @chatsettings=${(e) => this.setSettings(e.detail.patch)}></app-chat-list>
      </aside>
      ${chat ? html`<button type="button" class="scrim" aria-label="Close the conversation list" @click=${() => this.closeDrawer()}></button>` : nothing}
      <main class="main">${banner ? html`<div class="banner update" role="status"><span>${banner.message} ${banner.detail}</span>${banner.percent === null ? nothing : html`<progress class="update-progress" max="1" value=${banner.percent}></progress>`}${banner.action ? html`<button type="button" class="banner-action" data-command=${banner.action.command} @click=${() => this.updateAction(banner.action.command)}>${banner.action.label}</button>` : nothing}</div>` : nothing}${this.mainView(chat)}</main>
      ${this.sheetShowing ? html`<div class="sheet-scrim" @click=${() => this.closeView()}></div><section class="sheet" role="dialog" aria-modal="true" @animationend=${this.onSheetAnimationEnd}>${this.sheetBody()}</section>` : nothing}
    </div>`;
  }
}

customElements.define('app-root', AppRoot);
