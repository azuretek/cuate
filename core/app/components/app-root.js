import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { createApiClient } from '../../kit/api.js';
import { press, respond } from '../../kit/press.js';
import { revealField } from '../../kit/scroll.js';
import {
  orderChats, applyMessageToChats, chatTitle, emptyFilters, UNGROUPED, SORT_ORDERS, SORT_LABELS, normalizeSort,
  SEARCH_MODES, SEARCH_MODE_LABELS, addTerm, removeTerm, setTermMode,
  sortChats, filterChats, setAllChecked, allChecked, checkedCount,
  groupFromSelection, removeGroup, clearGroupPlacement, hideChats, forgetChats,
  requestDelete, requestDeleteGroup, resolveDelete,
} from '../rules/chats.js';
import { mergeMessages, applyReaction } from '../rules/messages.js';
import { localAttachment, toBase64 } from '../rules/attach.js';
import { connectionSentence } from '../rules/connection.js';
import { noticeEnabled, updateNotice, updateNoticeKey, autoDownloadEnabled, messageNotice, serverUpdateNotice } from '../rules/notifications.js';
import { putNotice, dismissNotice, forgetRead, appUpdateNotice, noticeHoldMs } from '../rules/app-notices.js';
import { checkAnswer, capability, phoneUpdate, transferDetail } from '../rules/updates.js';
import { durationMs } from '../../kit/rules/press.js';
import './app-notices.js';
import { screenFor, pageAfterBack } from '../rules/screens.js';
import { SLOP, isEdgeStart, isHorizontal, progressFor, settlesOpen } from '../rules/drawer.js';
import { controlLayout } from '../rules/bar-layout.js';
import { resolveScheme, themeVars, themeFonts, textScaleVars, TYPE_SIZE_VARS } from '../rules/theme.js';
import { ICON_TOKENS, unreadTotal, iconColours, iconPalette, parseGlyph, renderIcon } from '../rules/icon.js';
import { ICON_MASTERS } from '../rules/app-icons-spec.js';
import { settingsAfterWrite, settingsAfterRefusal } from '../rules/settings.js';
import { iconToApply } from '../rules/app-icons.js';
import { sheetLeaveDeadline } from '../rules/sheet.js';
import { dismissable } from '../../kit/dismiss.js';
import { aimCarets } from '../../kit/popover.js';
import { pageZoomAttempt } from '../rules/zoom.js';
import './app-onboarding.js';
import './app-chat-list.js';
import './app-conversation.js';
import './app-settings.js';
import './app-about.js';
import './app-image-viewer.js';
import './app-slide-confirm.js';

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
    // showing. view says which page the sheet draws, if any (the conversation, settings or about). aboutFrom says what
    // About was opened from ('settings' when it was pushed over Settings, so its back returns there), and pageMotion
    // how the page on screen arrived inside the sheet ('push' or 'pop'; null when the sheet itself arrived).
    view: { state: true }, listOpen: { state: true }, aboutFrom: { state: true }, pageMotion: { state: true },
    // The Settings tab on show (issue 167), held here so a push to About and back returns to the tab it left.
    settingsTab: { state: true },
    // Follow theme's picture in Settings (issue 167): the app icon in the theme in force, drawn here as a PNG data URL.
    themePicture: { state: true },
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
    updateStatus: { state: true }, appNotices: { state: true },
    // host is what the shell says it is (product, version, platform), so core can draw a window bar where the
    // platform had a frame; maximized is the window's own state, which the shell reports.
    host: { state: true }, maximized: { state: true },
    // The chat list's filters live on the page, not on the server: they are a way of looking, not an arrangement.
    filters: { state: true }, filterOpen: { state: true }, sortOpen: { state: true }, searchOpen: { state: true },
    // The edit mode and its selection also live on the page: the list draws the checkboxes, the header selects all
    // and acts on the count, and the confirm gate names what a delete will remove before it removes anything.
    editing: { state: true }, checked: { state: true }, pendingDelete: { state: true },
    // Group asks for a name in a small prompt before the group is made; the name is optional.
    naming: { state: true },
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
    this.sheetDeadline = null;
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
    this.appNotices = [];
    this.noticeShownAt = null;
    this.noticeHold = null;
    this.pending = new Map();
    this.client = null;
    this.drag = null;
    this.filters = emptyFilters();
    this.filterOpen = false;
    this.sortOpen = false;
    this.searchOpen = false;
    this.editing = false;
    this.checked = [];
    this.pendingDelete = null;
    this.naming = false;
    this.viewing = null;
    this.reacting = null;
    this.messageNote = null;
    // Every menu and modal the page draws closes on a press outside it and on Escape, through the kit's one behaviour
    // (core/kit/dismiss.js): the filter and sort menus (each one's button keeps both, so it switches between them),
    // the group prompt, the delete confirm and the sheet. The sheet goes back the way its strip does (pageBack): About
    // pushed over Settings returns to Settings, and any other page runs the sheet's departure. A sheet already leaving
    // is not open.
    dismissable(this, { name: 'filter', open: () => this.filterOpen, close: () => { this.filterOpen = false; } });
    dismissable(this, { name: 'sort', open: () => this.sortOpen, close: () => { this.sortOpen = false; } });
    dismissable(this, { name: 'search', open: () => this.searchOpen, close: () => { this.searchOpen = false; } });
    dismissable(this, { name: 'group', open: () => this.naming, close: () => { this.naming = false; } });
    dismissable(this, { name: 'confirm', open: () => Boolean(this.pendingDelete), close: () => this.cancelDelete() });
    dismissable(this, { name: 'sheet', open: () => this.sheetShowing && !this.sheetLeaving, close: () => this.pageBack() });
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
    this.aboutFrom = null;
    this.pageMotion = null;
    this.settingsTab = null;
    // The app icon the shell last applied (issue 167), so a settings change that leaves the icon alone asks nothing.
    this.iconApplied = null;
    this.themePicture = null;
    this.themePictureKey = null;
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
    if (typeof window !== 'undefined') this.holdPage();
    this.boot();
  }

  // The page itself never scrolls or zooms (issue 180). A zoom asked for anywhere but the media viewer is refused; a
  // keyboard that shrinks the view leaves the focused field in view inside its own scroller; and anything that scrolls
  // the page as a whole (iOS reveals a focused field that way) is put back, so the header stays pinned and nothing
  // slides under the status bar.
  holdPage() {
    const refuse = (e) => {
      if (!pageZoomAttempt(e)) return;
      if (e.target && typeof e.target.closest === 'function' && e.target.closest('app-image-viewer')) return;
      e.preventDefault();
    };
    const pin = () => { if (window.scrollX || window.scrollY) window.scrollTo(0, 0); };
    // A keyboard arrives over a few frames, so the field is brought into sight as it starts and again once it has
    // settled, each time inside the views around it and never by scrolling the page.
    const revealNow = () => { revealField(document.activeElement); pin(); };
    const reveal = () => {
      requestAnimationFrame(revealNow);
      for (const ms of [200, 500]) setTimeout(revealNow, ms);
    };
    const viewport = window.visualViewport;
    this.pageHolds = [
      [window, 'wheel', refuse, { passive: false, capture: true }],
      [window, 'keydown', refuse, { capture: true }],
      [window, 'gesturestart', refuse, { passive: false, capture: true }],
      [window, 'gesturechange', refuse, { passive: false, capture: true }],
      [window, 'scroll', pin, { passive: true }],
      [window, 'resize', reveal, { passive: true }],
      [document, 'focusin', reveal, { passive: true }],
      ...(viewport ? [[viewport, 'resize', reveal, { passive: true }]] : []),
    ];
    for (const [target, type, fn, options] of this.pageHolds) target.addEventListener(type, fn, options);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    for (const [target, type, fn, options] of this.pageHolds || []) target.removeEventListener(type, fn, options);
    this.pageHolds = null;
    if (this.schemeQuery && this.onSchemeChange) this.schemeQuery.removeEventListener('change', this.onSchemeChange);
    if (this.offUpdate) { this.offUpdate(); this.offUpdate = null; }
    if (this.offWindow) { this.offWindow(); this.offWindow = null; }
    if (this.offOpen) { this.offOpen(); this.offOpen = null; }
    clearTimeout(this.noticeHold);
    this.noticeHold = null;
    clearTimeout(this.sheetDeadline);
    this.sheetDeadline = null;
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
    // A phone draws its status and navigation bars over the page, so the shell is told the scheme and the page's fill,
    // and the bars' icons stay readable on the colour behind them. A shell with no bars of its own answers false.
    if (typeof window !== 'undefined' && window.bridge && typeof window.bridge.call === 'function') {
      const background = getComputedStyle(root).getPropertyValue('--color-bg').trim();
      this.bridge('window.appearance', { scheme, background }).catch(() => {});
    }
    // Text size scales the type sizes the theme and the tokens resolve to, read back once the theme is in place, so a
    // theme's own type sizes are scaled too. At 100% nothing is written and the tokens draw what they always did.
    const style = getComputedStyle(root);
    const base = Object.fromEntries(TYPE_SIZE_VARS.map((name) => [name, style.getPropertyValue(name)]));
    const scaled = textScaleVars(this.settings['appearance.textScale'], base);
    for (const [name, value] of scaled) root.style.setProperty(name, value);
    this.themeApplied = [...themed, ...scaled];
    this.loadThemeFonts(this.settings['appearance.theme']);
    this.applyAppIcon();
    this.syncIcon();
    this.drawThemePicture();
  }

  // Follow theme's picture in Settings is the app icon as the theme in force colours it, drawn by the one renderer the
  // shells draw with (rules/icon.js) from the masters the icon pipeline mirrors for the page. Drawn once per change of
  // scheme or colours, after the theme is in place and off the render that applied it; until then, and where the page
  // has no canvas, Settings shows the default theme's icon (rules/app-icons.js).
  drawThemePicture() {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function' || !this.scheme) return;
    const style = getComputedStyle(document.documentElement);
    const colors = Object.fromEntries(ICON_TOKENS.map((k) => [k, style.getPropertyValue('--color-' + k).trim()]));
    const key = JSON.stringify([this.scheme, colors]);
    if (key === this.themePictureKey) return;
    this.themePictureKey = key;
    const scheme = this.scheme;
    setTimeout(() => {
      if (key !== this.themePictureKey) return;
      try {
        if (!AppRoot.iconMasters) AppRoot.iconMasters = { full: parseGlyph(ICON_MASTERS.full), small: parseGlyph(ICON_MASTERS.small) };
        const image = renderIcon({ masters: AppRoot.iconMasters, palette: iconPalette(iconColours(colors, colors), scheme), kind: 'app', size: 144 });
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext && canvas.getContext('2d');
        if (!context) return;
        context.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
        this.themePicture = canvas.toDataURL('image/png');
      } catch {
        this.themePicture = null;
      }
    }, 0);
  }

  // The app icon chosen in Settings (issue 167), applied by the shell where its platform can: the desktop's window and
  // Dock, the iPhone's alternate icon, Android's launcher alias. Only once the server's settings are read, so a stored
  // choice is never first undone by the default, and only when it changes, since iOS confirms every change with an
  // alert of its own. A shell that could not apply it answers so, and the next change asks again.
  async applyAppIcon() {
    if (!this.settingsRead) return;
    const next = iconToApply(this.iconApplied, this.settings);
    if (!next) return;
    this.iconApplied = next;
    try {
      const answer = await this.bridge('app.icon', { icon: next });
      if (!answer || answer.applied !== true) this.iconApplied = null;
    } catch {
      this.iconApplied = null;
    }
  }

  // The app icon follows the theme, the scheme and the unread count (issue 189). The shell draws it, so the page tells
  // it the colour tokens the icon reads as this page resolved them, the scheme it draws and the total unread, once per
  // change: a render that changes none of the three asks nothing.
  syncIcon() {
    if (typeof document === 'undefined' || typeof window === 'undefined' || !window.bridge || typeof window.bridge.call !== 'function' || !this.scheme) return;
    const style = getComputedStyle(document.documentElement);
    const colors = Object.fromEntries(ICON_TOKENS.map((k) => [k, style.getPropertyValue('--color-' + k).trim()]));
    const unread = unreadTotal(this.chats);
    const key = JSON.stringify([this.scheme, colors, unread]);
    if (key === this.iconSent) return;
    this.iconSent = key;
    this.bridge('icon.redraw', { scheme: this.scheme, colors, unread }).catch(() => {});
  }


  // A theme's type is fetched by the server when the theme is imported; the page reads each file once, with its token,
  // and adds it with the FontFace API, so the family the theme names draws as itself rather than as a fallback. A file
  // that cannot be read is tried again the next time the theme is applied.
  async loadThemeFonts(theme) {
    if (!this.client || typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) return;
    this.fontsLoaded ??= new Set();
    for (const f of themeFonts(theme)) {
      if (this.fontsLoaded.has(f.id)) continue;
      this.fontsLoaded.add(f.id);
      try {
        const face = new FontFace(f.family, await this.client.themeFont(f.id), { weight: f.weight, style: f.style });
        document.fonts.add(await face.load());
      } catch {
        this.fontsLoaded.delete(f.id);
      }
    }
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
      this.launchCheck();
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
  // change together. A message delivered live while the page is in flight is kept: the page was read before it
  // arrived, so it is merged into the page rather than replaced by it (issue 66).
  async open(chatId, { show = false } = {}) {
    const refresh = this.openChatId === chatId;
    this.selecting = refresh ? null : chatId;
    if (refresh && show) this.listOpen = false;
    const wasUnread = this.chats.some((c) => c.id === chatId && c.unread);
    this.chats = this.chats.map((c) => (c.id === chatId && c.unread ? { ...c, unread: 0 } : c));
    // Reading a conversation clears it on the Mac too, so the next client that asks sees the same count.
    if (wasUnread && this.client) this.client.markRead(chatId).catch(() => {});
    const arrived = [];
    const watch = (m) => { if (m.chatId === chatId) arrived.push(m); };
    if (!this.arrivals) this.arrivals = new Set();
    this.arrivals.add(watch);
    try {
      const { messages, hasMore } = await this.client.messages(chatId, { limit: 50 });
      if (refresh ? this.openChatId !== chatId : this.selecting !== chatId) return;
      if (!refresh) this.messageNote = null;
      this.openChatId = chatId;
      this.selecting = null;
      this.messages = mergeMessages(arrived, messages);
      this.hasMore = hasMore;
      this.problem = '';
      if (show) this.listOpen = false;
    } catch (e) {
      if (this.selecting === chatId) this.selecting = null;
      this.problem = this.describe(e);
    } finally {
      this.arrivals.delete(watch);
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
      if (this.arrivals) for (const watch of this.arrivals) watch(m);
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
    const { state, version, percent, detail, canInstall, transferred, total } = data || {};
    // How this build installs (TestFlight, a verified APK, or the desktop's own updater) is the platform's, so a state
    // the shell sends is drawn with the same action the page's own check would draw. A transfer the shell measured in
    // bytes is put into words here, so the words are the same on every platform.
    const via = data?.via || this.updateVia();
    const words = detail ?? (state === 'downloading' ? transferDetail({ transferred, total }) : null);
    this.updateStatus = state ? { state, version: version ?? null, percent: percent ?? null, detail: words ?? null, canInstall: Boolean(canInstall), ...(via ? { via } : {}) } : null;
    this.showUpdateNotice(appUpdateNotice(this.updateStatus));
    if (!this.settingsRead) { this.heldUpdate = data || null; return; }
    this.noticeUpdate(data);
  }

  // The update card follows the latest state, except that a transient card (a check in progress) stays up for the
  // floor the tokens hold (motion.min-visible) before a different state replaces it. Only the newest state is kept:
  // a later event cancels a pending one, so the card never replays a state that was already superseded.
  showUpdateNotice(notice) {
    clearTimeout(this.noticeHold);
    this.noticeHold = null;
    const floor = durationMs(getComputedStyle(this).getPropertyValue('--motion-min-visible'), 900);
    const wait = noticeHoldMs(this.appNotices, 'app-update', notice, this.noticeShownAt, Date.now(), floor);
    if (wait > 0) { this.noticeHold = setTimeout(() => this.showUpdateNotice(notice), wait); return; }
    const prior = this.appNotices.find((n) => n.id === 'app-update');
    this.appNotices = notice ? putNotice(this.appNotices, notice) : this.appNotices.filter((n) => n.id !== 'app-update');
    if (!notice) this.noticeShownAt = null;
    else if (prior?.revision !== notice.revision) this.noticeShownAt = Date.now();
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
      else this.messages = applyReaction(this.messages, { targetId: messageId, type: r.type, emoji: r.emoji ?? null, add: r.add, fromMe: true, sender: null });
      return r.status !== 'uncertain';
    } catch (e) {
      if (chatId === this.openChatId) this.messageNote = { id: messageId, text: e.code === 'sending_off' ? 'Sending is switched off on the server.' : this.describe(e) };
      return false;
    } finally {
      this.reacting = null;
    }
  }

  // Settings asked for while About is up goes back to Settings inside the same sheet, the way About's back does.
  openSettings() {
    this.settingsProblem = '';
    if (this.view === 'about' && !this.sheetLeaving) { this.showPage('settings', 'pop'); return; }
    // Settings arriving afresh opens on its first tab; only a return from About keeps the tab it left.
    if (!this.sheetShowing) this.settingsTab = null;
    this.openSheet('settings');
  }

  // About is a page of its own on every platform (issue 171). From Settings it is pushed inside the sheet that is
  // already up, so its back returns to Settings; asked for on its own (the tray, the app menu) the sheet arrives with
  // About as its page, and back closes it. Asking for it while it is up changes nothing.
  openAbout() {
    if (this.view === 'about' && !this.sheetLeaving) return;
    if (this.view === 'settings' && !this.sheetLeaving) { this.aboutFrom = 'settings'; this.showPage('about', 'push'); return; }
    this.aboutFrom = null;
    this.pageMotion = null;
    this.openSheet('about');
  }

  // A page moved inside the sheet that is up: no departure and no arrival of the sheet, only the page.
  showPage(view, motion) {
    if (view !== 'about') this.aboutFrom = null;
    this.pageMotion = motion;
    this.view = view;
  }

  // A page's back strip (and Escape): the page under it when there is one (rules/screens.js), else the sheet closes.
  pageBack() {
    const under = pageAfterBack(this.view, this.aboutFrom);
    if (under) this.showPage(under, 'pop');
    else this.closeView();
  }

  // About's Check for updates (issue 171): the shell runs the same check the tray's item runs (updates.check) and
  // answers the state it reached, which becomes the app notice exactly as an update.state event does; a later outcome
  // (a release found, nothing newer) arrives on that event as the tray's check's does. A card for the same answer
  // that was read and dismissed is forgotten first, so asking again shows the answer again. The press shows the check
  // until the shell answers, and fails when the shell refused it.
  async checkUpdates() {
    this.appNotices = forgetRead(this.appNotices, 'app-update');
    if (this.updateVia()) return this.phoneCheck({ asked: true });
    let answer;
    try { answer = await this.bridge('updates.check', {}); } catch { return false; }
    const state = checkAnswer(answer, String(this.host && this.host.platform || '').toLowerCase());
    if (state) this.onUpdate(state);
    return true;
  }

  // How this platform installs a newer build, or null where the shell runs its own updater (the desktop).
  updateVia() {
    return capability({ platform: String(this.host && this.host.platform || '').toLowerCase(), packaged: true }).via || null;
  }

  // A phone's check (issue 192): the shell reads the repository's public release feed (the page loads nothing from the
  // network) and the page decides, with the same rule on both phones (rules/updates.js phoneUpdate). A check someone
  // asked for shows that it is looking and answers every outcome; the one at launch speaks only when a newer build
  // exists, so a phone without a network is not greeted by a failure nobody asked about.
  async phoneCheck({ asked }) {
    const platform = String(this.host && this.host.platform || '').toLowerCase();
    const via = this.updateVia();
    if (!via) return false;
    if (asked) this.onUpdate({ state: 'checking', via });
    let feed;
    try {
      feed = await this.bridge('updates.releases', {});
    } catch (e) {
      if (asked) this.onUpdate({ state: 'error', detail: 'the release list could not be read: ' + this.describe(e), canInstall: false, via });
      return false;
    }
    const found = phoneUpdate({ platform, current: this.host && this.host.version, feed });
    // A failed check offers no download: there is nothing to try again but the check, which is the button on About.
    const state = found.state === 'error' ? { ...found, canInstall: false } : found;
    if (asked || state.state === 'available') this.onUpdate(state);
    return state.state !== 'error';
  }

  // The check at launch, on a platform whose page runs it (the phones); the desktop's updater checks on its own.
  launchCheck() {
    if (this.updateVia()) this.phoneCheck({ asked: false }).catch(() => {});
  }

  // About's Check for updates button follows the update state (rules/updates.js aboutUpdate): it checks, or it is the
  // step the notice offers (open TestFlight, download, install), so the page that was pressed shows the progress too.
  aboutPress(detail) {
    const command = detail && detail.command;
    return command ? this.updateAction(command) : this.checkUpdates();
  }

  // A link the page asked to open (About's source, licence and issue links) goes to the shell, which opens the
  // platform's browser rather than navigating the app.
  openExternal(url) {
    this.bridge('open.external', { url }).catch(() => {});
  }

  // The sheet runs one page at a time: asking for another while one is up runs the first down and only then brings
  // the next up. The motion and the dim are Chela's own conventions, so a reader who uses both apps sees one design
  // rather than two; this only sequences.
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

  // The departure ends on the sheet's own animationend, or at its deadline (the token duration plus a margin,
  // rules/sheet.js), whichever comes first: a window that draws no frames never sends the event.
  leaveSheet() {
    if (this.sheetLeaving) return;
    this.sheetLeaving = true;
    clearTimeout(this.sheetDeadline);
    const tokenMs = durationMs(getComputedStyle(this).getPropertyValue('--motion-sheet-out'), 400);
    this.sheetDeadline = setTimeout(() => this.finishSheetLeave(), sheetLeaveDeadline(tokenMs));
  }

  onSheetAnimationEnd = (e) => {
    if (!this.sheetLeaving || e.target !== e.currentTarget) return;
    this.finishSheetLeave();
  };

  // The departure has finished, so the surface changes now: the next page arrives from the bottom edge, or the
  // conversation does. Waiting for the event is what keeps a half-drawn page off the screen; the deadline only
  // stands in for an event that will never come. Whichever arrives second finds nothing left to do.
  finishSheetLeave() {
    clearTimeout(this.sheetDeadline);
    this.sheetDeadline = null;
    if (!this.sheetLeaving) return;
    this.sheetLeaving = false;
    const next = this.pendingSheet;
    this.pendingSheet = null;
    this.view = next || 'messages';
    this.pageMotion = null;
    if (this.view !== 'about') this.aboutFrom = null;
  }

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
    if (!sidebar || getComputedStyle(sidebar).position === 'static') return;   // the drawer exists only on the phone
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

  // The header is a search field with its mode, a filter menu, the sort menu and the gear that opens settings, and no
  // label text at all. Filtering is a way of looking, so its state and its controls live on the page; the list only
  // draws what it is handed.
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
    if (!chips.length) return nothing;
    return html`<div class="active-filters" aria-label="Active filters">${chips.map((c) => html`<span class="active-chip">${c.label}<button type="button" class="chip-clear" aria-label=${'Clear ' + c.label} @click=${press(() => this.clearFilter(c.key))}>×</button></span>`)}</div>`;
  }

  // The dropdown the filter icon opens: everything filterChats supports, which is unread, direct, group chats and the
  // person's own groups. A filter that is on reads as pressed, and pressing it again turns it off.
  filterMenu() {
    const f = this.filters || emptyFilters();
    const groups = this.chatGroups();
    const toggle = (key, value) => this.setFilters({ [key]: f[key] === value ? null : value });
    return html`<div class="filter-menu" role="group" aria-label="Filter conversations" data-dismiss="filter" data-popover data-popover-edge="top">
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

  // --- Search terms (issue 133). Typing filters live; Enter commits the text as a term in the chosen mode and clears the
  // field, and each later term refines the list. Every term keeps its own mode and can change it from its chip. ---

  commitSearch(input) {
    const f = this.filters || emptyFilters();
    const terms = addTerm(f.terms, input.value, f.mode);
    input.value = '';
    this.setFilters({ terms, text: '' });
  }

  onSearchKey(e) {
    const f = this.filters || emptyFilters();
    if (e.key === 'Enter') { e.preventDefault(); this.commitSearch(e.currentTarget); }
    else if (e.key === 'Backspace' && !e.currentTarget.value && f.terms.length) this.setFilters({ terms: removeTerm(f.terms, f.terms.length - 1) });
  }

  modeOptions(current) {
    return SEARCH_MODES.map((m) => html`<option value=${m} ?selected=${m === current}>${SEARCH_MODE_LABELS[m]}</option>`);
  }

  // The committed terms, one chip each: its mode, its text and its own remove control.
  searchTerms() {
    const terms = (this.filters || emptyFilters()).terms || [];
    if (!terms.length) return nothing;
    return html`<div class="search-terms" role="list" aria-label="Search terms">${terms.map((t, i) => html`<span class="search-term" role="listitem" data-mode=${t.mode}>
      <select class="term-mode" aria-label=${'Search ' + t.text + ' as'} @change=${(e) => this.setFilters({ terms: setTermMode(this.filters.terms, i, e.currentTarget.value) })}>${this.modeOptions(t.mode)}</select>
      <span class="term-text">${t.text}</span>
      <button type="button" class="chip-clear" aria-label=${'Remove ' + t.text} @click=${press(() => this.setFilters({ terms: removeTerm(this.filters.terms, i) }))}>×</button>
    </span>`)}</div>`;
  }

  // The sort choices the icon opens, the current one marked. Picking one writes it to the server through the page,
  // the same setting the list has always read.
  sortMenu() {
    const current = normalizeSort(this.settings['chats.sort']);
    return html`<div class="sort-menu" role="menu" aria-label="Sort conversations" data-dismiss="sort" data-popover data-popover-edge="top">
      ${SORT_ORDERS.map((o) => html`<button type="button" class="sort-choice" role="menuitemradio" aria-checked=${o === current ? 'true' : 'false'} @click=${press(() => this.chooseSort(o))}>
        <span class="sort-check" aria-hidden="true">${o === current ? html`<span class="icon" data-icon="check" aria-hidden="true"></span>` : nothing}</span>${SORT_LABELS[o]}
      </button>`)}
    </div>`;
  }

  chooseSort(sort) {
    this.sortOpen = false;
    return this.setSetting({ key: 'chats.sort', value: sort });
  }

  // The menu the search field's arrow opens (issues 173 and 217): our own menu, styled like the sort and filter ones,
  // listing the two ways a term reads and marking the one in force. No mode words sit on or beside the field itself.
  searchMenu() {
    const f = this.filters || emptyFilters();
    const notes = { contact: 'Names and people in a chat', text: 'Words inside messages' };
    return html`<div class="sort-menu search-menu" role="menu" aria-label="Search by" data-dismiss="search" data-popover data-popover-edge="top">
      ${SEARCH_MODES.map((m) => html`<button type="button" class="sort-choice" role="menuitemradio" aria-checked=${m === f.mode ? 'true' : 'false'} @click=${press(() => { this.searchOpen = false; this.setFilters({ mode: m }); })}>
        <span class="sort-check" aria-hidden="true">${m === f.mode ? html`<span class="icon" data-icon="check" aria-hidden="true"></span>` : nothing}</span><span class="search-choice">${SEARCH_MODE_LABELS[m]} search<span class="sort-choice-note">${notes[m] || ''}</span></span>
      </button>`)}
    </div>`;
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
    const visible = filterChats(this.visibleChats(), this.filters || emptyFilters(), { placement: this.chatPlacement(), texts: this.loadedTexts() });
    return sortChats(visible, { sort: this.settings['chats.sort'], locale: navigator.language }).map((c) => c.id);
  }

  // The message text the client holds beyond each chat's last message: the history loaded for the open chat. A Full
  // text term reads it, so a term finds what is on screen as well as the previews.
  loadedTexts() {
    if (!this.openChatId) return {};
    return { [this.openChatId]: (this.messages || []).map((m) => m.text || '').filter(Boolean) };
  }

  selectionCount() { return checkedCount(this.checked, this.selectableIds()); }

  toggleEditing() {
    this.editing = !this.editing;
    this.checked = [];
    this.filterOpen = false;
    this.sortOpen = false;
    this.naming = false;
  }

  exitEdit() {
    this.editing = false;
    this.checked = [];
    this.naming = false;
  }

  setChecked(id, checked) {
    this.checked = setAllChecked(this.checked, [id], checked === true);
  }

  toggleAllChecked() {
    const ids = this.selectableIds();
    this.checked = setAllChecked(this.checked, ids, !allChecked(this.checked, ids));
  }

  // Group asks for a name first. The prompt is the only step: an empty name is allowed, and the group takes the first
  // free "Group N" (rules/chats.js), so the group exists on the prompt's own press.
  openGroupPrompt() {
    if (!this.selectionCount()) return;
    this.naming = true;
    this.updateComplete.then(() => { const el = this.querySelector('.group-name-input'); if (el) el.focus(); });
  }

  groupSelection(name) {
    this.naming = false;
    if (!this.checked.length) return;
    const { groups, placement } = groupFromSelection(this.chatGroups(), this.chatPlacement(), this.checked, { id: newGroupId(), name });
    const work = this.setSettings({ 'chats.groups': groups, 'chats.placement': placement });
    this.exitEdit();
    return work;
  }

  onGroupNameKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); this.querySelector('.group-create')?.click(); }
  }

  groupPrompt() {
    const n = this.selectionCount();
    return html`<div class="sheet-scrim confirm-scrim">
      <section class="confirm-modal group-prompt" data-dismiss="group" role="dialog" aria-modal="true" aria-labelledby="group-prompt-title">
        <h2 id="group-prompt-title">Group ${n} conversation${n === 1 ? '' : 's'}</h2>
        <input class="group-name-input" type="text" placeholder="Name (optional)" aria-label="Group name, optional" @keydown=${this.onGroupNameKey}>
        <div class="confirm-actions">
          <button type="button" class="chip" @click=${press(() => { this.naming = false; })}>Cancel</button>
          <button type="button" class="button primary group-create" @click=${press(() => this.groupSelection(this.querySelector('.group-name-input').value))}>Create group</button>
        </div>
      </section>
    </div>`;
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
    if (!this.pendingDelete) return;
    this.updateComplete.then(() => { const el = this.querySelector('.confirm-modal .slide-thumb'); if (el) el.focus(); });
  }

  cancelDelete() {
    this.pendingDelete = null;
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

  // The row above the list (issue 137): a small Edit text control at the left. Pressed, it stays highlighted, every row
  // gains a checkbox, and the row offers select-all, the count, Group, Delete and Done for the selection.
  editRow() {
    const toggle = html`<button type="button" class="edit-toggle" aria-pressed=${this.editing ? 'true' : 'false'} @click=${press(() => this.toggleEditing())}>Edit</button>`;
    if (!this.editing) return html`<div class="list-tools">${toggle}</div>`;
    const ids = this.selectableIds();
    const count = checkedCount(this.checked, ids);
    const all = allChecked(this.checked, ids);
    return html`<div class="list-tools editing" role="group" aria-label="Edit conversations">
      ${toggle}
      <label class="edit-all"><input type="checkbox" class="select-all" aria-label="Select all" .checked=${all} .indeterminate=${count > 0 && !all} ?disabled=${ids.length === 0} @change=${() => this.toggleAllChecked()}></label>
      <span class="edit-count" role="status">${count} selected</span>
      <span class="edit-actions">
        <button type="button" class="text-button edit-group" ?disabled=${count === 0} @click=${press(() => this.openGroupPrompt())}>Group</button>
        <button type="button" class="text-button danger edit-delete" ?disabled=${count === 0} @click=${press(() => this.requestDeleteSelection())}>Delete</button>
        <button type="button" class="text-button edit-done" @click=${press(() => this.exitEdit())}>Done</button>
      </span>
    </div>`;
  }

  // The confirm gate drawn on the app's sheet backdrop: it names what it will remove, says what it will not touch, and
  // only carrying its slider to the end resolves it, because a delete is destructive. Escape, Cancel and a press on
  // the backdrop leave everything as it was.
  confirmModal() {
    const pending = this.pendingDelete;
    const isGroup = pending.kind === 'group';
    const n = isGroup ? 1 : pending.ids.length;
    const title = isGroup ? 'Delete the group "' + pending.name + '"?' : 'Delete ' + n + ' conversation' + (n === 1 ? '' : 's') + '?';
    const body = isGroup
      ? "The group leaves this client's list. Its conversations stay, and no message is deleted on the Mac."
      : "They leave this client's list only. No message is deleted on the Mac.";
    return html`<div class="sheet-scrim confirm-scrim">
      <section class="confirm-modal" data-dismiss="confirm" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 id="confirm-title">Are you sure?</h2>
        <p class="confirm-what">${title}</p>
        <p>${body}</p>
        <app-slide-confirm class="confirm-slide" .label=${'Slide to delete'} @confirm=${() => this.confirmDeleteSelection()}></app-slide-confirm>
        <div class="confirm-actions">
          <button type="button" class="chip" @click=${press(() => this.cancelDelete())}>Cancel</button>
        </div>
      </section>
    </div>`;
  }

  sidebarHead() {
    const f = this.filters || emptyFilters();
    return html`<header class="sidebar-head">
      <span class="search-box">
        <button type="button" class="search-mode-button" aria-label=${'Search by ' + SEARCH_MODE_LABELS[f.mode]} aria-haspopup="true" data-dismiss-keep="search" aria-expanded=${this.searchOpen ? 'true' : 'false'} @click=${press(() => { this.searchOpen = !this.searchOpen; this.filterOpen = false; this.sortOpen = false; })}><span class="icon" data-icon="chevron-down" aria-hidden="true"></span></button>
        <input class="chat-search" type="search" placeholder="Search" aria-label="Search conversations" .value=${f.text || ''} @input=${(e) => this.setFilters({ text: e.currentTarget.value })} @keydown=${this.onSearchKey}>
      </span>
      <button type="button" class="filter-button" aria-label="Filter conversations" aria-haspopup="true" data-dismiss-keep="filter sort" aria-expanded=${this.filterOpen ? 'true' : 'false'} @click=${press(() => { this.filterOpen = !this.filterOpen; this.sortOpen = false; this.searchOpen = false; })}><span class="icon" data-icon="list-filter" aria-hidden="true"></span></button>
      <button type="button" class="sort-button" aria-label="Sort conversations" aria-haspopup="true" data-dismiss-keep="filter sort" aria-expanded=${this.sortOpen ? 'true' : 'false'} @click=${press(() => { this.sortOpen = !this.sortOpen; this.filterOpen = false; this.searchOpen = false; })}><span class="icon" data-icon="arrow-up-down" aria-hidden="true"></span></button>
      <button type="button" class="gear-button" aria-label="Settings" @click=${press(() => this.openSettings())}><span class="icon" data-icon="settings" aria-hidden="true"></span></button>
      ${this.sortOpen ? this.sortMenu() : nothing}
      ${this.filterOpen ? this.filterMenu() : nothing}
      ${this.searchOpen ? this.searchMenu() : nothing}
    </header>`;
  }

  pane() {
    if (this.view !== 'messages') return 'conversation';
    return this.listOpen || !this.openChatId ? 'list' : 'conversation';
  }

  // Settings and About are pages of the one sheet, so they are drawn by sheetBody and never in the main pane. Each
  // carries how it arrived (data-motion), which the stylesheet turns into the screen push or pop.
  sheetBody() {
    if (this.view === 'about') {
      return html`<app-about data-motion=${this.pageMotion || 'none'} .info=${this.info} .host=${this.host} .backLabel=${this.aboutFrom === 'settings' ? 'Back to settings' : 'Back to app'}
        .release=${this.updateStatus} @check-updates=${(e) => respond(e, this.aboutPress(e.detail))} @open-external=${(e) => this.openExternal(e.detail.url)} @back=${() => this.pageBack()}></app-about>`;
    }
    return html`<app-settings data-motion=${this.pageMotion || 'none'} .values=${this.settings} .serverUrl=${this.serverUrl} .busy=${this.settingsBusy} .problem=${this.settingsProblem} .scheme=${this.scheme} .info=${this.info} .host=${this.host}
      @setting=${(e) => respond(e, this.setSetting(e.detail))} @settings=${(e) => respond(e, this.setSettings(e.detail))} @theme-import=${(e) => respond(e, this.importThemeUrl(e.detail))} @signout=${(e) => respond(e, this.signOut(''))} @about=${() => this.openAbout()} @back=${() => this.pageBack()}
      .themePicture=${this.themePicture} .tab=${this.settingsTab} @tab=${(e) => { this.settingsTab = e.detail; }}></app-settings>`;
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
    // A phone fetches the release the notice named, so the download says which one; the desktop's updater knows already.
    const args = command === 'updates.download' && this.updateStatus && this.updateStatus.version ? { version: this.updateStatus.version } : {};
    try { await this.bridge(command, args); return true; } catch { return false; /* the shell refused; the banner keeps the state it last drew */ }
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

  // The one class the stylesheet keys off: it says a surface is leaving, so the sheet and its dim leave together. A
  // render may also have changed the unread count the app icon carries.
  updated() {
    document.body.classList.toggle('surface--leaving', this.sheetLeaving === true);
    this.syncIcon();
    // Every open menu wears the shared caret, aimed at the control that opened it (issue 217).
    aimCarets(this);
  }

  render() {
    const platform = String(this.host && this.host.platform || '').toLowerCase();
    // No bar, no title and no icon: the app's surfaces run to the top edge of the window. macOS floats its traffic
    // lights over the top left, so the stylesheet pushes the content below down; every other platform draws its window
    // controls in the contact header instead (see mainView).
    return html`<div class="app-window" data-platform=${platform}>
      <div class="app-body">${this.body()}</div>
      <app-notices .notices=${this.appNotices} .runAction=${(command) => this.updateAction(command)} @notice-dismiss=${(e) => { this.appNotices = dismissNotice(this.appNotices, e.detail.id); }}></app-notices>
    </div>`;
  }

  body() {
    if (this.phase === 'boot' || this.phase === 'loading') return html`<div class="splash" aria-busy="true"><div class="spinner" role="img" aria-label="Loading"></div></div>`;
    if (this.phase === 'onboarding') return html`<app-onboarding .problem=${this.problem} @connect=${(e) => respond(e, this.onConnect(e.detail))}></app-onboarding>`;
    const chat = this.chats.find((c) => c.id === this.openChatId) || null;
    const sentence = connectionSentence(this.conn);
    return html`<div class="shell" data-pane=${this.pane()} @pointerdown=${this.onPointerDown} @view-image=${(e) => { this.viewing = e.detail && e.detail.src ? e.detail : null; }}>
      <aside class="sidebar" aria-label="Conversations">
        ${this.sidebarHead()}
        ${this.searchTerms()}
        ${sentence ? html`<div class="banner" role="status">${sentence}</div>` : nothing}
        ${this.problem ? html`<div class="banner problem" role="alert">${this.problem}</div>` : nothing}
        ${this.activeFilters()}
        ${this.editRow()}
        <app-chat-list .chats=${this.visibleChats()} .selected=${this.selecting || this.openChatId} .texts=${this.loadedTexts()}
          .sort=${normalizeSort(this.settings['chats.sort'])} .groups=${this.chatGroups()}
          .placement=${this.chatPlacement()} .filters=${this.filters}
          .editing=${this.editing} .checked=${this.checked}
          @select=${(e) => { this.view = 'messages'; this.open(e.detail, { show: true }); }}
          @check=${(e) => this.setChecked(e.detail.id, e.detail.checked)}
          @groupdelete=${(e) => this.requestGroupDelete(e.detail.id, e.detail.name)}
          @chatsettings=${(e) => respond(e, this.setSettings(e.detail.patch))}></app-chat-list>
      </aside>
      ${chat ? html`<button type="button" class="scrim" aria-label="Close the conversation list" @click=${press(() => this.closeDrawer())}></button>` : nothing}
      <main class="main">${this.mainView(chat)}</main>
      ${this.sheetShowing ? html`<div class="sheet-scrim"><section class="sheet" data-dismiss="sheet" role="dialog" aria-modal="true" aria-label=${this.view === 'about' ? 'About' : 'Settings'} @animationend=${this.onSheetAnimationEnd}>${this.sheetBody()}</section></div>` : nothing}
      ${this.pendingDelete ? this.confirmModal() : nothing}
      ${this.naming ? this.groupPrompt() : nothing}
      ${this.viewing ? html`<app-image-viewer .src=${this.viewing.src} .alt=${this.viewing.alt || ''} @close=${() => { this.viewing = null; }}></app-image-viewer>` : nothing}
    </div>`;
  }
}

customElements.define('app-root', AppRoot);
