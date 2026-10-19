import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { createApiClient } from '../../kit/api.js';
import { press, respond } from '../../kit/press.js';
import { revealField } from '../../kit/scroll.js';
import {
  orderChats, applyMessageToChats, applyEditToChats, chatTitle, emptyFilters, SORT_ORDERS, SORT_LABELS, normalizeSort,
  SEARCH_MODES, SEARCH_MODE_LABELS, addTerm, removeTerm, setTermMode,
  sortChats, filterChats, setAllChecked, allChecked, checkedCount,
  hideChats, forgetChats, groupAddresses, upsertChat, parseMessagingLink, linkTarget,
  requestDelete, resolveDelete,
} from '../rules/chats.js';
import { mergeMessages, applyReaction, reactionUnsupported, applyEdit } from '../rules/messages.js';
import { mediaItems, mediaIndex } from '../rules/media.js';
import { initialWindow, shiftWindow, HISTORY_PAGE_SIZE, HISTORY_MAX_MESSAGES, HISTORY_CACHED_CHATS } from '../rules/history-window.js';
import { platformOf, foldReactions } from '../rules/platform.js';
import { localAttachment, toBase64 } from '../rules/attach.js';

// The text-fallback reactions a client on another service sends are folded onto the messages they quote, so they
// show as reactions rather than as new text (issue 184). The platform comes from the chat's own service; a list on a
// platform with no fallback is returned untouched.
const foldFor = (list, chats, chatId) => foldReactions(list, platformOf((chats || []).find((c) => c.id === chatId)));
import { connectionSentence } from '../rules/connection.js';
import { applyTyping, TYPING_TTL_MS } from '../rules/typing.js';
import { noticeEnabled, updateNotice, updateNoticeKey, autoDownloadEnabled, messageNotice, messageTarget, noticeTarget, serverUpdateNotice } from '../rules/notifications.js';
import { putNotice, dismissNotice, forgetRead, forgetNoticeState, appUpdateNotice, noticeHoldMs, quietNotices, noticeState, withNoticeState, noticeReadKey, sentNoticeRead, dropNoticeRead, noticeReadEcho, NOTICE_READ_KEY } from '../rules/app-notices.js';
import { checkAnswer, capability, phoneUpdate, transferDetail } from '../rules/updates.js';
import { durationMs } from '../../kit/rules/press.js';
import { withRuntime } from '../../kit/rules/build.js';
import './app-notices.js';
import { screenFor } from '../rules/screens.js';
import { SLOP, isEdgeStart, isHorizontal, progressFor, settlesOpenAt, velocityFor } from '../rules/drawer.js';
import { controlLayout } from '../rules/bar-layout.js';
import { windowControlsHtml } from './window-controls.js';
import { resolveScheme, themeVars, themeFonts, textScaleVars, textScaleInForce, TYPE_SIZE_VARS } from '../rules/theme.js';
import { ICON_TOKENS, unreadTotal } from '../rules/icon.js';
import { settingsAfterWrite, settingsAfterRefusal } from '../rules/settings.js';
import { favouriteCache, applyFavourites, queueFavourite, settleFavourite, adoptFavourites, FAVOURITES_MAX } from '../rules/emoji-favourites.js';
import { frequentEmoji } from '../rules/emoji.js';
import { readFavouriteCache, writeFavouriteCache, forgetFavouriteCache, readLegacyFavourites, forgetLegacyFavourites } from '../favourites.js';
import { CHATS_DEFAULT, CHATS_MIN, clampChatsWidth, chatsWidthFrom, dividerBounds, dividerKey, dragChatsWidth } from '../rules/divider.js';
import { iconToApply, themeMatch } from '../rules/app-icons.js';
import { sheetLeaveDeadline } from '../rules/sheet.js';
import { dismissable } from '../../kit/dismiss.js';
import { aimCarets } from '../../kit/popover.js';
import { pageZoomAttempt } from '../rules/zoom.js';
import './app-onboarding.js';
import './app-chat-list.js';
import './app-compose.js';
import './app-group-info.js';
import './app-conversation.js';
import { useMediaStore } from './app-attachment.js';
import { openMessageCache } from '../message-cache.js';
import { applyChangesToShown, olderFromHeld, CHANGE_PAGES_MAX } from '../rules/message-store.js';
import './app-settings.js';
import './app-about.js';
import './app-image-viewer.js';
import { notePlayed } from './app-audio.js';
import './app-slide-confirm.js';

const API_VERSION = 1;
// The server holds every setting; the page only draws what it holds. A read that fails leaves the schema defaults.
async function readSettingsFrom(client) {
  try {
    const { values } = await client.settings();
    return values || {};
  } catch {
    return {};
  }
}
// What the conversation pane says while nothing is open (issue 373): a fresh start opens nothing, so this is often
// the first thing seen beside the list.
const EMPTY_PANE = 'Choose a conversation to read it here.';
// A burst of arrivals in the conversation on screen is one read on the Mac (issue 323).
const READ_COALESCE_MS = 600;
const pageHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
// Ask the Mac to mark a conversation read, at most once per READ_COALESCE_MS for the same one, so a burst of arrivals
// is one read (issue 323). A page with no client that can mark a read (a test's stand-in) asks nothing.
function readOnMac(page, chatId) {
  if (!chatId || !page || typeof page.client?.markRead !== 'function') return;
  const id = String(chatId);
  if (!page.readTimers) page.readTimers = new Map();
  if (page.readTimers.has(id)) return;
  page.readTimers.set(id, setTimeout(() => {
    page.readTimers.delete(id);
    if (typeof page.client?.markRead === 'function') page.client.markRead(id).catch(() => {});
  }, READ_COALESCE_MS));
}
// How many earlier pages a pressed notice may load looking for its message (issue 331): fifty messages a page, so a
// notice for anything newer than a thousand messages back lands on it, and an older one opens its conversation.
const REVEAL_PAGES = 20;
// How long a pressed notice waits on the live stream for a message the server did not have yet (issue 414). Past it
// the conversation says the message is still loading, and it is still brought into view if it lands while that
// conversation stays open.
const NOTICE_ARRIVAL_MS = 15000;
const newKey = () => crypto.randomUUID().replaceAll('-', '');
const normalizeUrl = (u) => {
  const s = String(u || '').trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(s) ? s : 'https://' + s;
};

class AppRoot extends KitElement {
  static properties = {
    // The system's text size as this device's shell reports it (issue 369), null until it has answered or where it has none.
    systemText: { state: true },
    phase: { state: true }, chats: { state: true }, openChatId: { state: true }, messages: { state: true },
    historyWindow: { state: true },
    conn: { state: true }, problem: { state: true }, hasMore: { state: true }, sending: { state: true },
    // The message a pressed notice leads to, handed to the conversation to bring into view (issue 331).
    revealing: { state: true },
    // The live typing state of the open conversation (issue 230): { chatId, kind, at } for another of our signed-in
    // devices, or null. Held here so the page clears a stale one and never shows another conversation's.
    typing: { state: true },
    // The chat a press asked for while its page is on the way: the list marks it at once, and the pane keeps the
    // conversation it is drawing until the new one is ready, then swaps in one step (issue 142).
    selecting: { state: true },
    // The phone keeps one pane at a time: the list slides in over the conversation, and listOpen says which pane is
    // showing. view says which screen is on top (the conversation, settings or about). aboutFrom says what About was
    // opened over ('settings' when it is stacked above the Settings sheet, so its back returns there). Each sheet has
    // its OWN arrival and departure: sheetMotion and sheetLeaving (Settings), aboutMotion and aboutLeaving (About,
    // issue 253). About is a second sheet above Settings, not a page inside it.
    view: { state: true }, listOpen: { state: true }, aboutFrom: { state: true }, sheetMotion: { state: true }, aboutMotion: { state: true },
    // The Settings tab on show (issue 167), held here so a push to About and back returns to the tab it left.
    settingsTab: { state: true },
    // Follow theme's picture in Settings (issue 167): the app icon in the theme in force, drawn here as a PNG data URL.
    themePicture: { state: true },
    // Each sheet's leaving state has to be reactive: it drives that sheet's own [data-leaving], written on a render,
    // so a plain field would never repaint and the leave would never begin.
    sheetLeaving: { state: true }, aboutLeaving: { state: true }, pendingSheet: { state: true },
    settings: { state: true }, info: { state: true }, serverUrl: { state: true },
    // The person's emoji favourites, the same list on every device (issue 494). The cache is the copy this device
    // draws before the server answers and while offline; the list is what the row shows.
    favourites: { state: true },
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
    composing: { state: true }, groupInfo: { state: true },
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
    // The conversation each chat was last left showing, so switching back draws it at once from what we hold rather
    // than waiting on the server (issue 200). The conversation's own scroll place lives with the conversation.
    this.convos = new Map();
    // Which open(request) is current; a page that arrives after a newer open was asked for is dropped, so a slow one
    // never overwrites the conversation the person has since chosen.
    this.openSeq = 0;
    this.conn = 'connecting';
    this.problem = '';
    this.hasMore = false;
    this.selecting = null;
    this.sending = false;
    this.view = 'messages';
    this.listOpen = true;
    this.sheetLeaving = false;
    this.aboutLeaving = false;
    this.pendingSheet = null;
    this.sheetDeadline = null;
    this.aboutDeadline = null;
    this.afterAboutLeave = null;
    // A press on the backdrop is a second way back only when it both starts and ends there (rules/sheet.js).
    this.downOnBackdrop = false;
    this.settings = {};
    this.favourites = [];
    this.favouriteCache = favouriteCache(null);
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
    // The notice state that outlives a render (issue 191): the revisions marked read through the server, which hide a
    // card on every device until its operation changes phase. Closing a notice is the page's own dismissal instead.
    this.noticeRead = {};
    // This page's own writes of that map still awaiting the server's echo (rules/app-notices.js noticeReadEcho), so
    // the echo of an older write never undoes a newer one.
    this.noticeReadSent = [];
    this.pending = new Map();
    this.client = null;
    this.drag = null;
    // The divider drag in flight ({ pointerId, startX, baseWidth, shown, moved }), while the pointer is down on the
    // seam. baseWidth and startX are fixed for the whole drag, so every step reads the pointer's own travel.
    this.chatDrag = null;
    this.chatLost = null;
    this.filters = emptyFilters();
    this.filterOpen = false;
    this.sortOpen = false;
    this.searchOpen = false;
    this.editing = false;
    this.checked = [];
    this.pendingDelete = null;
    this.composing = null;
    this.groupInfo = null;
    this.viewing = null;
    this.reacting = null;
    this.messageNote = null;
    // Our own typing, told to the server while we compose: typingChat is the conversation we last said we were typing
    // in, typingSentAt throttles the refresh, and typingTimer clears the indicator we draw for another device (230).
    this.typing = null;
    this.typingChat = null;
    this.typingSentAt = 0;
    this.typingTimer = null;
    // Every menu and modal the page draws closes on a press outside it and on Escape, through the kit's one behaviour
    // (core/kit/dismiss.js): the filter and sort menus (each one's button keeps both, so it switches between them),
    // the group prompt, the delete confirm and the sheet. The sheet goes back the way its strip does (pageBack): About
    // pushed over Settings returns to Settings, and any other page runs the sheet's departure. A sheet already leaving
    // is not open.
    dismissable(this, { name: 'filter', open: () => this.filterOpen, close: () => { this.filterOpen = false; } });
    dismissable(this, { name: 'sort', open: () => this.sortOpen, close: () => { this.sortOpen = false; } });
    dismissable(this, { name: 'search', open: () => this.searchOpen, close: () => { this.searchOpen = false; } });
    dismissable(this, { name: 'confirm', open: () => Boolean(this.pendingDelete), close: () => this.cancelDelete() });
    dismissable(this, { name: 'sheet', open: () => this.settingsSheetShowing && !this.sheetLeaving, close: () => this.closeView() });
    dismissable(this, { name: 'about', open: () => this.aboutSheetShowing && !this.aboutLeaving, close: () => this.pageBack() });
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
    // How each sheet itself arrives when it opens: up from the bottom edge (issue 253). Set only on a fresh open, so
    // a sheet already up does not slide twice.
    this.sheetMotion = null;
    this.aboutMotion = null;
    this.settingsTab = null;
    // The app icon the shell last applied (issue 167), so a settings change that leaves the icon alone asks nothing.
    this.iconApplied = null;
    this.themePicture = null;
  }

  connectedCallback() {
    super.connectedCallback();
    if (typeof window !== 'undefined' && window.matchMedia) {
      this.schemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
      this.onSchemeChange = () => this.applyTheme();
      this.schemeQuery.addEventListener('change', this.onSchemeChange);
    }
    // Coming back to the window reads the conversation on screen, which may have taken messages while it was hidden
    // (issue 323).
    if (typeof document !== 'undefined') {
      this.onVisible = () => this.onShown();
      document.addEventListener('visibilitychange', this.onVisible);
    }
    // The shell names its platform and product before the page boots, so the bar is drawn with the first paint and
    // only where a window exists. A phone answers call but installs no event stream, so the bar is desktop only.
    if (typeof window !== 'undefined' && window.bridge && typeof window.bridge.call === 'function') {
      // The shell's report with the page's own running environment folded in: the runtime rows (Electron, Chromium, Node)
      // and a commit the shell did not stamp are read from the process the page actually runs in, so a phone's web view
      // reports what it has rather than Unknown (PR 257).
      this.bridge('app.info').then((info) => { this.host = withRuntime(info || {}, globalThis); }, () => { this.host = withRuntime({}, globalThis); });
    }
    if (typeof window !== 'undefined' && window.bridge && typeof window.bridge.on === 'function') {
      this.offUpdate = window.bridge.on('update.state', (data) => this.onUpdate(data || {}));
      // The window's maximized state comes from the shell, so the platform's own double-click and the control's own
      // toggle redraw the same glyph.
      this.offWindow = window.bridge.on('window.state', (data) => { this.maximized = Boolean(data && data.maximized); });
      this.offOpen = window.bridge.on('app.open', (data) => this.openScreen(data && data.screen));
      this.offLink = window.bridge.on('app.link', () => this.takeLink());
      // A notice was pressed (issue 331): the shell holds which one, and the page takes it.
      this.offNotice = window.bridge.on('notify.opened', () => this.takeNotice());
      // The system's text size (issue 369): asked for once, then told as an event whenever the person changes it, so
      // the page follows at once with nothing polled.
      this.offTextSize = window.bridge.on('display.textScale', (data) => this.onSystemText(data && data.percent));
      this.bridge('display.textScale', {}).then((percent) => this.onSystemText(percent), () => {});
    }
    if (typeof window !== 'undefined') this.holdPage();
    // A messaging link may arrive while the app is away, and a phone has no event to say so: it is asked for whenever
    // the page is shown (issue 333).
    if (typeof document !== 'undefined') {
      this.onShownForLink = () => { if (document.visibilityState !== 'hidden') this.takeLink(); };
      document.addEventListener('visibilitychange', this.onShownForLink);
    }
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
      // The chats list may only reach where the conversation keeps its own minimum, so the divider is put back inside
      // its bounds when the window changes (issue 215); the views' own place across that is kept by the kit (142).
      [window, 'resize', () => this.applyChatsWidth(), { passive: true }],
      [document, 'focusin', reveal, { passive: true }],
      ...(viewport ? [[viewport, 'resize', reveal, { passive: true }]] : []),
    ];
    for (const [target, type, fn, options] of this.pageHolds) target.addEventListener(type, fn, options);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (typeof this.offTextSize === 'function') this.offTextSize();
    if (this.onVisible) document.removeEventListener('visibilitychange', this.onVisible);
    for (const t of this.readTimers?.values() || []) clearTimeout(t);
    if (this.onShownForLink) document.removeEventListener('visibilitychange', this.onShownForLink);
    if (typeof this.offLink === 'function') this.offLink();
    for (const [target, type, fn, options] of this.pageHolds || []) target.removeEventListener(type, fn, options);
    this.pageHolds = null;
    this.endDividerDrag();
    if (this.schemeQuery && this.onSchemeChange) this.schemeQuery.removeEventListener('change', this.onSchemeChange);
    if (this.offUpdate) { this.offUpdate(); this.offUpdate = null; }
    if (this.offWindow) { this.offWindow(); this.offWindow = null; }
    if (this.offOpen) { this.offOpen(); this.offOpen = null; }
    if (this.offNotice) { this.offNotice(); this.offNotice = null; }
    clearTimeout(this.noticeHold);
    this.noticeHold = null;
    clearTimeout(this.sheetDeadline);
    this.sheetDeadline = null;
    clearTimeout(this.typingTimer);
    this.typingTimer = null;
  }

  // The server holds the theme and the skin; the page writes them onto the root as custom properties, so a theme
  // chosen on any device is what this page draws, and light and dark both come from it. No client carries its own copy.
  // A new system text size redraws the type only when it changes what is in force.
  onSystemText(percent) {
    const next = Number.isFinite(Number(percent)) && percent !== null ? Number(percent) : null;
    if (next === this.systemText) return;
    this.systemText = next;
    this.applyTheme();
  }

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
    const scaled = textScaleVars(textScaleInForce(this.settings, this.systemText), base);
    for (const [name, value] of scaled) root.style.setProperty(name, value);
    this.themeApplied = [...themed, ...scaled];
    this.loadThemeFonts(this.settings['appearance.theme']);
    this.applyAppIcon();
    this.syncIcon();
    this.drawThemePicture();
  }

  // The theme's accent as the page resolves it, which Follow theme matches an offered icon against (issue 337).
  themeAccent() {
    if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return null;
    return getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || null;
  }

  // Follow theme's picture in Settings and About is the offered icon it picks for the theme in force (issue 337), the
  // same generated picture that icon's own tile shows.
  drawThemePicture() {
    const accent = this.themeAccent();
    this.themePicture = accent ? 'assets/app-icons/' + themeMatch(accent) + '.png' : null;
  }

  // The app icon chosen in Settings (issue 167), applied by the shell where its platform can: the desktop's window and
  // Dock, the iPhone's alternate icon, Android's launcher alias. Only once the server's settings are read, so a stored
  // choice is never first undone by the default, and only when it changes, since iOS confirms every change with an
  // alert of its own. A shell that could not apply it answers so, and the next change asks again.
  async applyAppIcon() {
    if (!this.settingsRead) return;
    const next = iconToApply(this.iconApplied, this.settings, this.themeAccent());
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
    if ((!this.client && !this.cache) || typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) return;
    this.fontsLoaded ??= new Set();
    for (const f of themeFonts(theme)) {
      if (this.fontsLoaded.has(f.id)) continue;
      this.fontsLoaded.add(f.id);
      try {
        const face = new FontFace(f.family, await this.themeFontBytes(f.id), { weight: f.weight, style: f.style });
        document.fonts.add(await face.load());
      } catch {
        this.fontsLoaded.delete(f.id);
      }
    }
  }
  // A theme's font file from the device's store when it holds it (issue 441), so a launch draws the theme's type before the
  // server answers; else read from the server and offered to the store.
  async themeFontBytes(id) {
    const cache = this.cache;
    const kept = cache ? await cache.media({ id }, { kind: 'font' }).catch(() => null) : null;
    if (kept) return kept.arrayBuffer();
    if (!this.client) throw Object.assign(new Error('No server yet.'), { code: 'no_client' });
    const bytes = await this.client.themeFont(id);
    if (cache) cache.keepMedia({ id }, new Blob([bytes]), { kind: 'font' }).catch(() => {});
    return bytes;
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
    // The store on the device (issue 441) paints the conversation list it holds at once, before any server read
    // answers, and opening a conversation it holds draws that at once too. One opened for another server starts empty.
    let ready;
    this.storeReady = new Promise((resolve) => { ready = resolve; });
    await this.openStore(url);
    try {
      // The three reads a first paint needs are asked for together (issue 427), so the list costs one round trip rather
      // than three in a row. None depends on another's answer: the version is checked before anything answered is
      // used, and the settings are in hand before the event stream opens, so no notice, a message's or an update's, is
      // decided against defaults the server has already overridden. A settings read that fails leaves the defaults.
      // The info is awaited first, so a server on another version is refused with that sentence even when its
      // conversation read, which it may not answer in this version's shape, fails before the info lands.
      const infoRead = client.info();
      const chatsRead = client.chats();
      chatsRead.catch(() => {});
      const settingsRead = readSettingsFrom(client);
      const info = await infoRead;
      if (info.apiVersion !== API_VERSION) throw new Error(connectionSentence('version-mismatch'));
      // What changed since the store's cursor is asked beside the list and the settings, so a conversation held and
      // current is never read again on open.
      const [{ chats }, values] = await Promise.all([chatsRead, settingsRead, this.catchUp(client)]);
      this.client = client;
      this.info = info;
      this.serverUrl = url;
      this.sending = Boolean(info.sending);
      this.settings = values;
      this.settingsRead = true;
      // The cache paints the favorites row before the server answers; the server's list replaces it once the stream is
      // open, and a change queued while offline is sent then (issue 494).
      await this.loadCachedFavourites();
      // A notice's read state is a server setting, so it survives a reload and is read back on every device.
      this.noticeRead = noticeState(this.settings[NOTICE_READ_KEY]);
      this.applyNoticeQuiet();
      this.applyUpdateSetting();
      this.applyTheme();
      this.chats = orderChats(chats);
      this.phase = 'ready';
      ready();
      client.connect();
      this.takeLink();
      this.syncFavourites().catch(() => {});
      // Signed in, so notifications are asked for now, on every platform, rather than on the first message (issue
      // 327). The system asks only once; after that the shell answers where it stands.
      this.bridge('notify.permission', { request: true }).then((state) => { this.notifyPermission = state; this.registerPush(); }).catch(() => {});
      this.releaseHeldUpdate();
      this.launchCheck();
      this.noticeServerUpdate(info.serverUpdate);
      this.releaseHeldScreen();
      // A fresh start opens no conversation (issue 373): opening one reads it, here and on the Mac, so the list and its
      // unread counts are what is seen first. Only a press or a link that launched the app opens one. A start over a
      // conversation already on screen (signing in again without leaving it) refreshes that one in place.
      if (this.openChatId) await this.open(this.openChatId);
      this.dataset.state = 'ready';
      // A notice pressed while the app was closed launched it (issue 331): the shell held the press, so it is taken now
      // the conversations are here.
      this.takeNotice();
    } catch (e) {
      client.close();
      ready();
      this.phase = 'onboarding';
      this.problem = this.describe(e);
    }
  }

  // The device's store for this server (issue 441), or none where the web view has no IndexedDB or refuses it.
  async openStore(url) {
    if (this.cache && this.cacheUrl === url) return this.cache;
    if (this.cache) this.cache.close();
    this.cache = null;
    this.cacheUrl = url;
    this.upToDate = false;
    try {
      this.cache = await openMessageCache(url);
    } catch {
      this.cache = null;
    }
    useMediaStore(this.cache);
    // The settings it holds draw the theme, scheme and text size at once too, so the held list is never drawn in the
    // defaults first; the server's answer replaces them a moment later.
    if (this.cache && this.cache.settings && !this.settingsRead) {
      this.settings = { ...this.cache.settings };
      this.applyTheme();
    }
    if (this.cache && this.cache.chats.length && !this.chats.length) {
      this.chats = orderChats(this.cache.chats);
      this.phase = 'ready';
    }
    return this.cache;
  }

  // Asks the server only for what changed since the store's cursor (issue 441), page after page, and applies it to the
  // store, the conversation on screen and those held in memory. A cursor the server cannot honour empties the store and
  // starts it again from the head. Too much to follow, or a server with no such route, leaves every conversation to be
  // read again when it is opened. One catch-up runs at a time; a second ask shares it.
  catchUp(client = this.client) {
    const cache = this.cache;
    if (!cache || !client || typeof client.changes !== 'function') return Promise.resolve(false);
    if (this.catching) return this.catching;
    const run = (async () => {
      try {
        let since = cache.cursor;
        for (let page = 0; page < CHANGE_PAGES_MAX; page += 1) {
          const list = await client.changes({ since });
          if (this.cache !== cache) return false;
          if (list.reset) {
            if (since !== null) this.convos = new Map();
            await cache.reset(list.cursor);
          } else {
            await cache.apply(list);
            this.showChanges(list);
          }
          since = list.cursor;
          if (!list.more) { this.upToDate = true; return true; }
        }
        await cache.stale();
        this.upToDate = false;
        return false;
      } catch {
        this.upToDate = false;
        return false;
      } finally {
        if (this.catching === run) this.catching = null;
      }
    })();
    this.catching = run;
    return run;
  }

  // A conversation held in memory and not on screen still draws at once when it is opened again, and is then drawn
  // again from the store, which holds what changed in it since (issue 441).
  markStale(chatId) {
    const id = String(chatId);
    if (id === String(this.openChatId)) return;
    const held = this.convos?.get(id);
    if (held && !held.stale) this.convos.set(id, { ...held, stale: true });
  }

  // Changes made while the page was away, drawn on the conversation on screen and on those held in memory.
  showChanges(list) {
    for (const [id, held] of this.convos || []) {
      const { messages, arrived } = applyChangesToShown(held.messages, list, id);
      if (arrived.length || messages !== held.messages) this.markStale(id);
    }
    if (!this.openChatId) return;
    const { messages, arrived } = applyChangesToShown(this.messages, list, this.openChatId);
    if (messages !== this.messages) {
      if (this.historyWindow) this.applyWindow({ ...this.historyWindow, messages });
      else this.messages = messages;
    }
    for (const m of arrived) this.receiveHistoryMessage(m);
  }

  // The emoji favourites (issue 494): the server's list is the value, and this device keeps a cache so the row is
  // there before the first round trip and while offline. A change is queued in the cache first and sent second, so
  // one made while offline is never lost, and a queued change stays until the server has answered it.
  async loadCachedFavourites() {
    const cache = await readFavouriteCache();
    this.favouriteCache = cache;
    this.favourites = applyFavourites(cache.list, cache.pending);
  }

  async syncFavourites() {
    if (!this.client) return;
    let server;
    try {
      const answer = await this.client.favourites();
      server = Array.isArray(answer.favourites) ? answer.favourites : null;
    } catch {
      return;
    }
    if (!server) return;
    this.favouriteCache = adoptFavourites(this.favouriteCache, server);
    this.favourites = this.favouriteCache.list;
    await writeFavouriteCache(this.favouriteCache);
    // A list this device kept before the server held it becomes its first change, so nobody loses their row. A
    // server that already has a list wins, and the old key goes either way: it is read once.
    if (!server.length && !this.favouriteCache.list.length) await this.migrateFavourites();
    else await forgetLegacyFavourites();
    await this.flushFavourites();
  }

  async migrateFavourites() {
    const legacy = await readLegacyFavourites();
    if (!legacy.length) return;
    // The old list was a use list, newest last: most used first is the row, and the server draws it in the order the
    // adds arrive, so the top emoji is added last.
    const ordered = frequentEmoji(legacy, { limit: FAVOURITES_MAX });
    if (ordered.length) this.queueFavouriteChange({ add: ordered.slice().reverse() });
    await forgetLegacyFavourites();
  }

  // Sends the queued changes in the order they were made. A change that cannot be sent stays queued for the next
  // connection rather than being dropped.
  async flushFavourites() {
    while (this.client && this.favouriteCache.pending.length) {
      const op = this.favouriteCache.pending[0];
      let list;
      try {
        const answer = await this.client.favouritesWrite({ op: op.id, add: op.add, remove: op.remove });
        list = Array.isArray(answer.favourites) ? answer.favourites : null;
      } catch {
        return;
      }
      if (!list) return;
      this.favouriteCache = settleFavourite(this.favouriteCache, op.id, list);
      this.favourites = this.favouriteCache.list;
      await writeFavouriteCache(this.favouriteCache);
    }
  }

  queueFavouriteChange(change) {
    const id = newKey();
    this.favouriteCache = queueFavourite(this.favouriteCache, change, id);
    this.favourites = this.favouriteCache.list;
    writeFavouriteCache(this.favouriteCache).catch(() => {});
    return id;
  }

  // A pick or a removal is shown at once and sent behind it. The press it came from is a button's own, so the
  // handler answers whether the change was taken rather than making the button wait.
  async favouriteEmoji(char) {
    this.queueFavouriteChange({ add: [char] });
    await this.flushFavourites();
    return true;
  }

  async forgetEmoji(char) {
    this.queueFavouriteChange({ remove: [char] });
    await this.flushFavourites();
    return true;
  }

  // Another device's change arrives here as the server's whole list; this device's own queued changes still sit on top
  // of it, so one made offline is drawn until it lands.
  adoptFavouriteList(list) {
    this.favouriteCache = adoptFavourites(this.favouriteCache, list);
    this.favourites = this.favouriteCache.list;
    writeFavouriteCache(this.favouriteCache).catch(() => {});
  }

  // The settings as the server holds them now (readSettingsFrom above).
  readSettings() {
    return readSettingsFrom(this.client);
  }

  onConnState(s) {
    this.conn = s;
    if (s === 'unauthorized') this.signOut("The server no longer accepts this device's token. Connect again with a new one.");
    if (s === 'open' && this.client) {
      this.client.info().then((info) => { this.info = info; this.sending = Boolean(info.sending); this.noticeServerUpdate(info.serverUpdate); }, () => {});
      // The connection returning is when a change made offline goes out, and when the other devices' list arrives.
      this.syncFavourites().catch(() => {});
    }
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
    // A different server is a different person's list, so nothing this device cached for the old one is carried over.
    if (this.serverUrl && this.serverUrl !== base) await this.resetFavourites();
    await this.bridge('storage.set', { key: 'server.url', value: base });
    await this.bridge('storage.set', { key: 'server.token', value: token });
    await this.start(base, token);
    return this.phase === 'ready';
  }

  // A phone allowed to show notifications registers for them with the app closed (issue 347): the shell answers its
  // push token and key, or null where push cannot work, and the server keeps one registration per signed-in device.
  async registerPush() {
    const client = this.client;
    if (!client || this.notifyPermission !== 'granted') return false;
    try {
      const reg = await this.bridge('push.token', {});
      if (!reg || this.client !== client) return false;
      await client.pushRegister(reg);
      return true;
    } catch {
      return false;
    }
  }

  // The list this device cached belongs to the server it came from.
  async resetFavourites() {
    await forgetFavouriteCache();
    this.favourites = [];
    this.favouriteCache = favouriteCache(null);
  }

  async signOut(reason) {
    // Signing out stops this phone's notifications too; the server also forgets them when the token is revoked.
    if (this.client) this.client.pushUnregister().catch(() => {});
    if (this.client) this.client.close();
    this.client = null;
    // Everything the device holds for this server goes with the token (issue 441).
    const cache = this.cache;
    this.cache = null;
    this.cacheUrl = null;
    this.upToDate = false;
    useMediaStore(null);
    if (cache) await cache.clear().catch(() => {});
    await this.bridge('storage.delete', { key: 'server.token' });
    await this.resetFavourites();
    this.chats = [];
    this.messages = [];
    this.convos = new Map();
    this.openChatId = null;
    this.selecting = null;
    this.settings = {};
    this.settingsRead = false;
    this.appNotices = [];
    this.noticeRead = {};
    this.noticeReadSent = [];
    this.typingChat = null;
    this.resetTyping();
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
  async open(chatId, { show = false, newest = false } = {}) {
    // A pressed notice waits for its message only while its own conversation is open (issue 414).
    if (this.noticeWait && this.noticeWait.chatId !== chatId) this.stopNoticeWait();
    // Leaving a conversation stops its typing, and the indicator belongs to the conversation on screen, so a change
    // clears it rather than carrying one conversation's typing into another (issue 230).
    if (this.typingChat && this.typingChat !== chatId) this.clearTyping();
    this.resetTyping();
    const refresh = this.openChatId === chatId;
    const seq = (this.openSeq = (this.openSeq || 0) + 1);
    // The conversation we already hold draws at once, before the server answers, so switching back never leaves the
    // pane on the last conversation while a page is fetched and never blanks it (issue 200). A chat never opened has
    // nothing to draw yet, so the list marks it and the pane keeps the conversation it has until the page arrives.
    // One the device's store holds draws the same way, on a launch as on a switch (issue 441).
    const convos = this.convos || (this.convos = new Map());
    let cached = convos.get(String(chatId));
    if (!cached && this.cache) {
      cached = await this.storedWindow(chatId);
      if (this.openSeq !== seq) return;
    }
    if (cached) {
      this.openChatId = chatId;
      this.selecting = null;
      this.messages = foldFor(cached.messages, this.chats, chatId);
      this.historyWindow = cached.historyWindow;
      this.hasMore = cached.hasMore;
      this.problem = '';
      if (show) this.listOpen = false;
    } else {
      this.selecting = refresh ? null : chatId;
      if (refresh && show) this.listOpen = false;
    }
    this.chats = this.chats.map((c) => (c.id === chatId && c.unread ? { ...c, unread: 0 } : c));
    // Reading a conversation clears it on the Mac too, so the phone and the next client see the same count. It is asked
    // every time a conversation opens, not only when this page counted it unread: a count this page had not caught up
    // with (a message that arrived while it was away) still has to be read on the Mac (issue 323).
    readOnMac(this, chatId);
    if (this.cache) {
      // What is current is known once the launch's catch-up has answered; a conversation held and current is not read
      // again, since the server has said nothing in it changed that the store does not already hold (issue 441).
      await this.storeReady;
      if (this.openSeq !== seq || !this.client) return;
      readOnMac(this, chatId);
      if (cached && this.upToDate && this.cache?.heldNow(chatId)?.current) {
        // A conversation held in memory that the live stream or a catch-up has since changed is drawn again from the
        // store, which took those changes.
        const fresh = cached.stale ? await this.storedWindow(chatId) : null;
        if (this.openSeq !== seq) return;
        if (fresh) {
          this.messages = fresh.messages;
          this.historyWindow = fresh.historyWindow;
          this.hasMore = fresh.hasMore;
        }
        if (!refresh) this.messageNote = null;
        this.openChatId = chatId;
        this.selecting = null;
        this.problem = '';
        if (show) this.listOpen = false;
        return;
      }
    }
    const arrived = [];
    const watch = (m) => { if (m.chatId === chatId) arrived.push(m); };
    if (!this.arrivals) this.arrivals = new Set();
    this.arrivals.add(watch);
    try {
      const { messages, hasMore, totalCount } = await this.client.messages(chatId, { limit: HISTORY_PAGE_SIZE, includeTotal: true });
      // The newest page, read after the store's cursor was taken, is the conversation as it is now.
      this.cache?.keep(chatId, { messages, hasOlder: hasMore, totalCount, current: Boolean(this.cache.cursor) });
      if (this.openSeq !== seq) return;
      if (!refresh) this.messageNote = null;
      this.openChatId = chatId;
      this.selecting = null;
      // A page merged over the conversation we held keeps any older messages already loaded, and keeps a message that
      // arrived live while the page was in flight (issue 66).
      const pane = this.querySelector('app-conversation');
      // A window held scrolled back keeps its place, unless the newest messages are what was asked for: a pressed notice
      // looks for its message among them (issue 414).
      // What the store drew may be an older stretch than the page, so the page is laid out on its own.
      if (cached?.fromStore) cached = null;
      if (cached?.historyWindow?.afterCount && !newest) {
        const fresh = new Map(messages.map((m) => [m.id, m]));
        this.applyWindow({ ...cached.historyWindow, messages: cached.messages.map((m) => fresh.get(m.id) || m) });
      } else if (cached?.historyWindow && !cached.historyWindow.afterCount) {
        this.applyWindow(shiftWindow(cached.historyWindow, foldFor(mergeMessages(arrived, messages), this.chats, chatId), { direction: 'newer', hasMore: false, heights: pane?.historyMeasurements().heights }));
      } else {
        this.applyWindow(initialWindow(foldFor(mergeMessages(arrived, messages), this.chats, chatId), { totalCount, hasMore, estimate: pane?.historyMeasurements().estimate || 1 }));
      }
      this.problem = '';
      if (show) this.listOpen = false;
    } catch (e) {
      if (this.openSeq === seq) {
        if (this.selecting === chatId) this.selecting = null;
        if (!cached) this.problem = this.describe(e);
      }
    } finally {
      this.arrivals.delete(watch);
    }
  }

// The notice the person pressed, taken from the shell (issue 331). Taking it clears it, so a press is answered once
  // however many times the page asks; before the app is ready the shell keeps holding it for the boot to take.
  async takeNotice() {
    if (this.phase !== 'ready') return false;
    let target;
    try {
      target = noticeTarget(await this.bridge('notify.take', {}));
    } catch {
      return false;
    }
    if (!target) return false;
    return this.openMessage(target);
  }

  // Opens a conversation at one message (issue 331): any sheet or viewer over it goes, the conversation opens at its
  // newest messages, earlier pages load until the message is among them, and the conversation is told to bring it into
  // view and mark it. A notice can be pressed before the server has its message (issue 414), so the live stream is
  // watched from before the first page is asked for: a message that lands there within NOTICE_ARRIVAL_MS is revealed,
  // and past that the conversation says it is still loading and reveals it if it lands while that conversation is open.
  // A message that cannot be found still leaves its conversation open, which is the nearest true answer.
  async openMessage({ chatId, messageId }) {
    if (!this.chats.some((c) => c.id === chatId)) await this.reload();
    if (!this.chats.some((c) => c.id === chatId)) return false;
    this.viewing = null;
    // A sheet over the conversation leaves with its own departure, which lands on the conversation. Setting the view here
    // as well would drop the sheet at once and leave its departure pending, and that departure would later take down a
    // Settings sheet opened in the meantime.
    if (this.sheetShowing) this.closeView();
    else this.view = 'messages';
    this.revealing = null;
    this.stopNoticeWait();
    const wait = messageId ? this.watchNotice(chatId, messageId) : null;
    await this.open(chatId, { show: true, newest: true });
    if (this.openChatId !== chatId || !messageId) { if (wait) this.stopNoticeWait(wait); return false; }
    const here = () => this.messages.some((m) => m.id === messageId);
    for (let page = 0; page < REVEAL_PAGES && !here() && !wait.arrived && this.hasMore; page += 1) {
      if (!(await this.loadOlder()) || this.openChatId !== chatId) break;
    }
    if (this.noticeWait !== wait || this.openChatId !== chatId) return false;
    if (!here() && !wait.arrived) {
      let timer;
      const bound = new Promise((resolve) => { timer = setTimeout(() => resolve(false), this.noticeWaitMs ?? NOTICE_ARRIVAL_MS); });
      const came = await Promise.race([wait.landed, bound]);
      clearTimeout(timer);
      if (this.noticeWait !== wait || this.openChatId !== chatId) return false;
      if (!came) {
        // Still on its way: the conversation says so, and the watch stays until it lands or the conversation changes.
        this.revealing = { id: messageId, seq: (this.revealing?.seq || 0) + 1, pending: true };
        wait.landed.then(() => { if (this.noticeWait === wait && this.openChatId === chatId) this.revealNotice(wait); });
        return false;
      }
    }
    return this.revealNotice(wait);
  }

  // The pressed notice's message, brought into view once it is here (issue 414). One that came over the live stream
  // while the window on screen was not the newest is read in with the newest messages first.
  async revealNotice(wait) {
    const { chatId, messageId } = wait;
    this.stopNoticeWait(wait);
    const here = () => this.messages.some((m) => m.id === messageId);
    if (!here() && wait.arrived) await this.open(chatId, { newest: true });
    if (this.openChatId !== chatId || !here()) return false;
    this.revealing = { id: messageId, seq: (this.revealing?.seq || 0) + 1 };
    return true;
  }

  // Watches for a pressed notice's message (issue 414): on the live stream, and in any window put on screen, so a
  // page read on coming back to the foreground finds it as well. Only the latest press is watched.
  watchNotice(chatId, messageId) {
    let land;
    const wait = { chatId, messageId, arrived: false, landed: new Promise((resolve) => { land = resolve; }) };
    wait.seen = (m) => {
      if (!m || m.chatId !== chatId || m.id !== messageId) return;
      wait.arrived = true;
      land(true);
    };
    if (!this.arrivals) this.arrivals = new Set();
    this.arrivals.add(wait.seen);
    this.noticeWait = wait;
    return wait;
  }

  stopNoticeWait(wait = this.noticeWait) {
    if (!wait) return;
    this.arrivals?.delete(wait.seen);
    if (this.noticeWait !== wait) return;
    this.noticeWait = null;
    if (this.revealing?.pending) this.revealing = null;
  }

  // Coming back to the window (issue 323) reads the conversation on screen as read, here and on the Mac, and reads its
  // newest messages (issue 414): a phone's live stream sleeps with the app, so what landed while it was away, a pressed
  // notice's message included, is read rather than waited for.
  // Opening it again does all three, in place, keeping a window held scrolled back where it is.
  async onShown() {
    if (pageHidden() || !this.openChatId) return;
    await this.catchUp();
    await this.open(this.openChatId);
  }

  // What is drawn is kept on the device (issue 441): the conversation on screen, merged into what the store holds, and
  // the conversation list. The store writes only what changed, a moment after the renders settle.
  keepShown() {
    if (!this.cache || !this.client || this.phase !== 'ready') return;
    if (this.openChatId) this.cache.keep(this.openChatId, { messages: this.messages });
    if (this.chats !== this.keptChats) { this.keptChats = this.chats; this.cache.saveChats(this.chats); }
    if (this.settingsRead && this.settings !== this.keptSettings) { this.keptSettings = this.settings; this.cache.saveSettings(this.settings); }
  }

  // A conversation the device's store holds, laid out as a window at its newest messages (issue 441), or null.
  async storedWindow(chatId) {
    let held;
    try { held = await this.cache.convo(chatId); } catch { return null; }
    if (!held || !held.messages.length) return null;
    const messages = foldFor(held.messages, this.chats, chatId);
    const pane = this.querySelector('app-conversation');
    const hasMore = held.messages.length > HISTORY_MAX_MESSAGES || held.hasOlder;
    const state = initialWindow(messages, { totalCount: Math.max(held.totalCount || 0, messages.length), hasMore, estimate: pane?.historyMeasurements().estimate || 1 });
    return { messages: state.messages, hasMore: state.hasOlder, historyWindow: state, fromStore: true };
  }

  // The Load earlier press shows itself working and drops a second press (core/kit/press.js), so no flag is kept here.
  applyWindow(state) {
    this.historyWindow = state;
    this.messages = state.messages;
    this.hasMore = state.hasOlder;
    const wait = this.noticeWait;
    if (wait && !wait.arrived && wait.chatId === this.openChatId) for (const m of state.messages) wait.seen(m);
  }

  measureHistory({ estimate }) {
    const state = this.historyWindow;
    if (state && state.estimate <= 1 && estimate > 1) this.historyWindow = { ...state, estimate, beforeHeight: state.beforeCount * estimate, afterHeight: state.afterCount * estimate };
  }

  loadOlder(detail) { return this.loadHistory('older', detail); }

  async loadHistory(direction, detail = {}) {
    if (this.pendingHistory || !this.messages.length) return false;
    const state = this.historyWindow || initialWindow(this.messages, { hasMore: this.hasMore });
    if (!(direction === 'older' ? state.hasOlder : state.hasNewer)) return false;
    const chatId = this.openChatId;
    const edge = direction === 'older' ? this.messages[0] : this.messages.at(-1);
    // Older messages the device's store holds are drawn from it, with no server read (issue 441).
    const held = direction === 'older' ? olderFromHeld(this.cache?.heldNow(chatId), edge.id, HISTORY_PAGE_SIZE) : null;
    if (held && held.messages.length) {
      this.applyWindow(shiftWindow({ ...state, messages: this.messages }, foldFor(held.messages, this.chats, chatId), { direction, hasMore: held.hasMore, heights: detail?.heights }));
      return true;
    }
    if (!edge.historyCursor) { this.problem = 'Update the message engine to browse the whole conversation.'; return false; }
    this.pendingHistory = true;
    try {
      const { messages, hasMore } = await this.client.messages(chatId, { limit: HISTORY_PAGE_SIZE, [direction === 'older' ? 'beforeCursor' : 'afterCursor']: edge.historyCursor });
      this.cache?.keep(chatId, direction === 'older' ? { messages, hasOlder: hasMore } : { messages }, { adjacent: true });
      // The page belongs to the conversation, not to the open that asked for it (issue 484): a window shown
      // again, or a refresh of the same conversation, re-opens it without leaving it, and that must not throw
      // away a page the person is waiting for. Only leaving the conversation invalidates the answer.
      if (this.openChatId !== chatId) return false;
      const next = shiftWindow({ ...state, messages: this.messages }, foldFor(messages, this.chats, chatId), { direction, hasMore, heights: detail?.heights });
      this.applyWindow(next);
      return true;
    } catch (e) { this.problem = this.describe(e); return false; }
    finally { this.pendingHistory = false; }
  }

  receiveHistoryMessage(message) {
    const state = this.historyWindow;
    const pane = this.querySelector('app-conversation');
    if (state && !this.messages.some((m) => m.id === message.id) && (state.afterCount || (this.messages.length >= HISTORY_MAX_MESSAGES && !pane?.keep.anchor?.end))) {
      this.historyWindow = { ...state, afterCount: state.afterCount + 1, afterHeight: state.afterHeight + state.estimate, hasNewer: true };
      return;
    }
    if (state) this.applyWindow(shiftWindow({ ...state, messages: this.messages }, [message], { direction: 'newer', hasMore: false, heights: pane?.historyMeasurements().heights }));
    else this.messages = foldFor(mergeMessages(this.messages, [message]), this.chats, message.chatId);
  }

  async reload() {
    if (!this.client) return;
    try {
      const [{ chats }] = await Promise.all([this.client.chats(), this.catchUp()]);
      this.chats = orderChats(chats);
      if (this.openChatId) await this.open(this.openChatId);
    } catch (e) {
      this.problem = this.describe(e);
    }
  }

  onEvent({ name, data }) {
    if (name === 'resync') { this.reload(); return; }
    // What the live stream says keeps the device's store current while the page runs (issue 441); a conversation held
    // in memory and not on screen is drawn from the store the next time it opens.
    if (this.cache && (name === 'message.new' || name === 'message.edited' || name === 'reaction')) {
      const one = name === 'reaction' ? { reactions: [data] } : { messages: [data.message] };
      this.cache.live(one).catch(() => {});
      const id = String(name === 'reaction' ? data.chatId : data.message.chatId);
      this.markStale(id);
    }
    if (name === 'message.new') {
      const m = data.message;
      if (this.arrivals) for (const watch of this.arrivals) watch(m);
      this.reconcile(m);
      // A message that arrives in the conversation on screen is read there and then, on the Mac too (issue 323); one
      // that arrives while the window is hidden is not, and counts as unread until the window is seen again.
      const seen = this.openChatId && !pageHidden() ? this.openChatId : null;
      const r = applyMessageToChats(this.chats, m, { openChatId: seen });
      if (!m.fromMe && m.chatId === seen) readOnMac(this, m.chatId);
      if (r.known) this.chats = r.chats;
      else this.reload();
      if (m.chatId === this.openChatId) this.receiveHistoryMessage(m);
      if (!m.fromMe && (document.hidden || m.chatId !== this.openChatId) && noticeEnabled(this.settings, 'newMessage')) {
        const chat = this.chats.find((c) => c.id === m.chatId);
        const title = chat ? chatTitle(chat) : m.senderName || m.sender || 'New message';
        this.bridge('notify', { ...messageNotice(title, m), ...messageTarget(m) }).catch(() => {});
      }
    } else if (name === 'reaction') {
      if (data.chatId === this.openChatId) this.messages = applyReaction(this.messages, data);
    } else if (name === 'message.edited') {
      // A message edited on any device, this one included, replaces its words in the open conversation and in the
      // chat's preview, marked Edited (issue 391); a reload reads the same from the server.
      const m = data.message;
      if (m.chatId === this.openChatId) this.messages = applyEdit(this.messages, m);
      this.chats = applyEditToChats(this.chats, m);
    } else if (name === 'chat.changed') {
      // A conversation started, a group renamed or its people changed, on any device (issue 326).
      this.chats = upsertChat(this.chats, data);
    } else if (name === 'attachment.played') {
      // A recording played on another of the person's devices (issue 440) takes its mark off here at once.
      notePlayed(String(data.attachmentId)).catch(() => {});
    } else if (name === 'chat.read') {
      // A chat read on any device clears here too, so the count is the server's and not this page's own idea.
      const id = String(data.chatId);
      const unread = Number.isFinite(data.unread) ? data.unread : 0;
      this.chats = this.chats.map((c) => (c.id === id ? { ...c, unread } : c));
    } else if (name === 'typing') {
      // One of this account's other signed-in devices is typing in a conversation (issue 230). The server never sends
      // this back to the device that sent it, so any we hear is another device, never our own draft.
      this.receiveTyping(data);
    } else if (name === 'server.state') {
      this.sending = Boolean(data.sending);
    } else if (name === 'server.update') {
      this.noticeServerUpdate(data);
    } else if (name === 'emoji.changed') {
      // A favourite added or removed on another device is the server's whole list, drawn here with this device's own
      // queued changes still on top of it.
      if (Array.isArray(data.favourites)) this.adoptFavouriteList(data.favourites);
    } else if (name === 'settings.changed') {
      // A change made on any device arrives here and the page redraws from it, so it never holds its own copy.
      this.settings = { ...this.settings, ...(data.values || {}) };
      // Marking a notice read on another device arrives here with the rest of the settings, so this page clears it too.
      // Only an event that carries the read map changes it, and the echo of this page's own older write is not news.
      const values = data.values || {};
      if (Object.hasOwn(values, NOTICE_READ_KEY)) {
        const echo = noticeReadEcho(this.noticeReadSent, values[NOTICE_READ_KEY]);
        this.noticeReadSent = echo.sent;
        if (!echo.stale) this.noticeRead = noticeState(values[NOTICE_READ_KEY]);
      }
      this.applyNoticeQuiet();
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
    this.applyNoticeQuiet();
    if (!notice) this.noticeShownAt = null;
    else if (prior?.revision !== notice.revision) this.noticeShownAt = Date.now();
  }

  // A notice whose revision was read on the server is hidden, on every device (issue 191). The card is left in the
  // stack with read set, so its revision can be read back.
  applyNoticeQuiet() {
    this.appNotices = quietNotices(this.appNotices, this.noticeRead);
  }

  noticeRevision(id) {
    return this.appNotices.find((n) => n.id === id)?.revision ?? null;
  }

  // The card's one control, its X (issue 342): closing a notice marks it read on every device. The revision is written
  // to the server as a setting, so the card clears here at once and the server tells every other client through
  // settings.changed, and it is read back at start, so it stays cleared after a reload. The write is optimistic: a refused
  // or offline write still clears this page for the run.
  onNoticeRead(e) {
    const { id, revision } = e.detail || {};
    if (!id) return;
    const value = revision ?? this.noticeRevision(id);
    this.appNotices = dismissNotice(this.appNotices, id);
    this.noticeRead = withNoticeState(this.noticeRead, id, value);
    this.applyNoticeQuiet();
    this.writeNoticeRead();
  }

  // The read map goes to the server, remembered until its echo comes back. The write is optimistic: a refused or
  // offline write still holds this page for the run, and is no longer awaited.
  writeNoticeRead() {
    if (!this.client) return;
    const key = noticeReadKey(this.noticeRead);
    this.noticeReadSent = sentNoticeRead(this.noticeReadSent, this.noticeRead);
    this.client.settingsWrite({ [NOTICE_READ_KEY]: this.noticeRead }).catch(() => { this.noticeReadSent = dropNoticeRead(this.noticeReadSent, key); });
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
    // Sending ends our typing for the conversation, whatever the draft field then shows (issue 230).
    this.clearTyping();
    const clientKey = newKey();
    const localId = 'local:' + clientKey;
    this.pending.set(clientKey, { localId, chatId, text, messageId: null });
    const local = { id: localId, chatId, fromMe: true, sender: null, senderName: null, text, sentAt: new Date().toISOString(), replyTo: replyTo || null, read: null, attachments: file ? [localAttachment(file)] : [], reactions: [], state: 'sending' };
    this.messages = foldFor(mergeMessages(this.messages, [local]), this.chats, chatId);
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
    // The message being reacted to is carried along so the server can compose the platform's own text fallback
    // where the conversation is not on the message service (issue 184); it is used for that and never stored.
    const target = (this.messages || []).find((x) => x.id === messageId);
    try {
      const r = await this.client.react(chatId, messageId, { emoji, remove, text: target ? target.text : '' });
      if (chatId !== this.openChatId) return;
      if (r.status === 'uncertain') this.messageNote = { id: messageId, text: 'The reaction may not have sent.' };
      else this.messages = applyReaction(this.messages, { targetId: messageId, type: r.type, emoji: r.emoji ?? null, add: r.add, fromMe: true, sender: null });
      return r.status !== 'uncertain';
    } catch (e) {
      if (chatId === this.openChatId) this.refuseReaction(messageId, e);
      return false;
    } finally {
      this.reacting = null;
    }
  }

  // Edit one of our own messages (issue 391). The new words show at once on success, and the event stream's copy lands on
  // the same message; a refusal or an uncertain outcome is said under the message, and the words stay as they were.
  async edit({ messageId, text }) {
    const chatId = this.openChatId;
    if (!chatId || !this.client) return false;
    this.messageNote = null;
    try {
      const r = await this.client.edit(chatId, messageId, text);
      if (chatId !== this.openChatId) return r.status !== 'uncertain';
      if (r.status === 'uncertain') {
        this.messageNote = { id: messageId, text: 'The edit may not have been made.' };
        return false;
      }
      const target = (this.messages || []).find((x) => x.id === messageId);
      if (target) {
        const edited = { ...target, text: r.text };
        this.messages = applyEdit(this.messages, edited);
        this.chats = applyEditToChats(this.chats, edited);
      }
      return true;
    } catch (e) {
      if (chatId === this.openChatId) this.messageNote = { id: messageId, text: e.code === 'sending_off' ? 'Sending is switched off on the server.' : this.describe(e) };
      return false;
    }
  }

  // A reaction the engine cannot send is said in place, in the app's own notice style: the honest limit under the
  // message, and a dismissible app notice naming the engine that answered. Never a raw error, never a log line, and
  // never a silent downgrade to a classic tapback; the emoji panel stays usable and the draft is untouched, so the
  // same attempt succeeds after an engine upgrade without restarting the app (issue 241).
  refuseReaction(messageId, e) {
    if (e.code === 'reaction_unsupported') {
      const { message, detail } = reactionUnsupported(this.info?.engine);
      this.messageNote = { id: messageId, text: message };
      this.appNotices = putNotice(this.appNotices, { id: 'reaction:' + messageId, revision: messageId + ':' + message, message, detail, tone: 'warn' });
      return;
    }
    this.messageNote = { id: messageId, text: e.code === 'sending_off' ? 'Sending is switched off on the server.' : this.describe(e) };
  }

  // --- Our own typing, relayed between this account's devices (issue 230) ---
  // While we compose the page tells the server, which relays it to this account's other signed-in devices, and to no
  // one else. It is never a message and never enters history. A throttle keeps one report per couple of seconds while
  // the draft stays non-empty; the server's own expiry covers the gaps between them.
  onDraft({ empty }) {
    this.relayTyping(!empty);
  }

  relayTyping(typing) {
    const chatId = this.openChatId;
    if (!chatId || !this.client) return;
    if (!typing) {
      if (this.typingChat === chatId) this.clearTyping();
      return;
    }
    const now = Date.now();
    if (this.typingChat !== chatId || now - this.typingSentAt > 2000) {
      this.typingChat = chatId;
      this.typingSentAt = now;
      this.client.typing(chatId, true).catch(() => {});
    }
  }

  // Stop, for the conversation we were typing in. It only ever sends a stop for a conversation we actually said we
  // were typing in, so a draft in one conversation never stops another's.
  clearTyping() {
    const chatId = this.typingChat;
    this.typingChat = null;
    if (chatId && this.client) this.client.typing(chatId, false).catch(() => {});
  }

  // What another device's typing means for the conversation on screen. Events for another conversation are ignored,
  // and a stale one clears itself even if no stop ever arrives, so a dropped connection cannot leave it up.
  receiveTyping(data) {
    const chatId = this.openChatId;
    if (!data || !chatId) return;
    if (!data.typing) {
      if (String(data.chatId) === String(chatId)) this.resetTyping();
      return;
    }
    const next = applyTyping(this.typing, data, { chatId, now: Date.now() });
    if (!next) return;
    this.typing = next;
    clearTimeout(this.typingTimer);
    this.typingTimer = setTimeout(() => { this.resetTyping(); }, TYPING_TTL_MS);
  }

  resetTyping() {
    clearTimeout(this.typingTimer);
    this.typingTimer = null;
    this.typing = null;
  }

  // Settings asked for while About is up: the About sheet comes down and the Settings sheet it is stacked over stands
  // (raised first if About had been opened on its own).
  openSettings() {
    this.settingsProblem = '';
    if (this.view === 'about') { this.pageBack(); return; }
    // Settings arriving afresh opens on its first tab; only a return from About keeps the tab it left.
    if (!this.settingsSheetShowing) this.settingsTab = null;
    this.openSheet('settings');
  }

  // About is its own sheet on every platform (issues 171, 253): a new overlay stacked ABOVE the Settings sheet, which
  // steps aside underneath it. It has its own rise and its own way back, so it replaces Settings by taking the screen
  // while Settings stays behind. Opened from Settings its back returns there; opened on its own (the tray, the app
  // menu) it is the only sheet and its back closes it. Asking for it while it is up changes nothing.
  openAbout() {
    if (this.aboutSheetShowing && !this.aboutLeaving) return;
    this.aboutMotion = 'up';
    if (this.view === 'settings' && !this.sheetLeaving) { this.aboutFrom = 'settings'; this.view = 'about'; return; }
    this.aboutFrom = null;
    this.view = 'about';
  }

  // A sheet's own way back. The About sheet comes down over whatever it was stacked over: 'settings' keeps the
  // Settings sheet standing, 'messages' leaves nothing behind. The Settings sheet closes the surface.
  pageBack() {
    if (this.view === 'about') { this.leaveAbout(this.aboutFrom === 'settings' ? 'settings' : 'messages'); return; }
    this.closeView();
  }

  // About's Check for updates (issue 171): the shell runs the same check the tray's item runs (updates.check) and
  // answers the state it reached, which becomes the app notice exactly as an update.state event does; a later outcome
  // (a release found, nothing newer) arrives on that event as the tray's check's does. A card for the same answer
  // that was read and dismissed is forgotten first, so asking again shows the answer again. The press shows the check
  // until the shell answers, and fails when the shell refused it.
  async checkUpdates() {
    this.appNotices = forgetRead(this.appNotices, 'app-update');
    // A re-ask forgets the read revision on the server too, so the same answer shows again even though the reader
    // marked it read before (issue 191); without this the persistent state hides the answer a person just asked for.
    if (Object.hasOwn(this.noticeRead, 'app-update')) {
      this.noticeRead = forgetNoticeState(this.noticeRead, 'app-update');
      this.writeNoticeRead();
    }
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

  // The Settings sheet rises from the bottom edge when it opens (issue 253). Asking for it while it is already up
  // changes nothing; asked for while it is leaving, it arrives once the departure has finished.
  openSheet(next) {
    if (!this.settingsSheetShowing) { this.view = next; this.sheetMotion = 'up'; }
    else if (this.view !== next) { this.pendingSheet = next; this.leaveSheet(); }
  }

  // Closing the surface takes every sheet down: the About sheet with its own departure, and the Settings sheet under
  // it when it was stacked there.
  closeView() {
    this.pendingSheet = null;
    if (this.view === 'about') {
      if (this.aboutFrom === 'settings') this.leaveSheet();
      this.leaveAbout('messages');
      return;
    }
    this.leaveSheet();
  }

  // A screen the shell asked for (the tray's Settings, About and Check for updates). The shell has already raised the
  // window; rules/screens.js says what the page shows, and the sheets open through the same path the gear does.
  // The messaging link the platform handed the shell (issue 333): the conversation already held with those people
  // opens, or the compose sheet starts one with them. Before the app is ready the link waits in the shell.
  async takeLink() {
    if (this.phase !== 'ready' || typeof window === 'undefined' || !window.bridge || typeof window.bridge.call !== 'function') return;
    let url;
    try { url = await this.bridge('link.take'); } catch { return; }
    const target = linkTarget(this.chats, parseMessagingLink(url));
    if (!target) return;
    if (target.open) { this.view = 'messages'; this.open(target.open, { show: true }); } else this.composing = { mode: target.compose.length > 1 ? 'group' : 'new', preset: target.compose };
  }

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

  // A departure ends on that sheet's own animationend, or at its deadline (the token duration plus a margin,
  // rules/sheet.js), whichever comes first: a window that draws no frames never sends the event. Each sheet has its
  // own, so the About sheet coming down never takes the Settings sheet under it with it.
  leaveSheet() {
    if (this.sheetLeaving) return;
    this.sheetLeaving = true;
    clearTimeout(this.sheetDeadline);
    const tokenMs = durationMs(getComputedStyle(this).getPropertyValue('--motion-sheet-out'), 400);
    this.sheetDeadline = setTimeout(() => this.finishSheetLeave(), sheetLeaveDeadline(tokenMs));
  }

  leaveAbout(next) {
    if (this.aboutLeaving) return;
    this.afterAboutLeave = next;
    this.aboutLeaving = true;
    clearTimeout(this.aboutDeadline);
    const tokenMs = durationMs(getComputedStyle(this).getPropertyValue('--motion-sheet-out'), 400);
    this.aboutDeadline = setTimeout(() => this.finishAboutLeave(), sheetLeaveDeadline(tokenMs));
  }

  onSheetAnimationEnd = (e) => {
    if (!this.sheetLeaving || e.target !== e.currentTarget) return;
    this.finishSheetLeave();
  };

  onAboutAnimationEnd = (e) => {
    if (!this.aboutLeaving || e.target !== e.currentTarget) return;
    this.finishAboutLeave();
  };

  // The Settings sheet's departure has finished, so the surface changes now: the next sheet arrives from the bottom
  // edge, or the conversation does. Waiting for the event keeps a half-drawn page off the screen; the deadline only
  // stands in for an event that will never come. Whichever arrives second finds nothing left to do.
  finishSheetLeave() {
    clearTimeout(this.sheetDeadline);
    this.sheetDeadline = null;
    if (!this.sheetLeaving) return;
    this.sheetLeaving = false;
    const next = this.pendingSheet;
    this.pendingSheet = null;
    this.sheetMotion = null;
    if (next) { this.view = next; return; }
    if (!this.aboutLeaving) { this.view = 'messages'; this.aboutFrom = null; }
  }

  // The About sheet's departure has finished: the Settings sheet it was stacked over stands (raised first if About
  // had been opened on its own), or the conversation shows.
  finishAboutLeave() {
    clearTimeout(this.aboutDeadline);
    this.aboutDeadline = null;
    if (!this.aboutLeaving) return;
    this.aboutLeaving = false;
    const under = this.aboutFrom === 'settings';
    const next = this.afterAboutLeave || (under ? 'settings' : 'messages');
    this.afterAboutLeave = null;
    this.aboutFrom = null;
    this.aboutMotion = null;
    if (next === 'settings') {
      if (!under) { this.settingsTab = null; this.sheetMotion = 'up'; }
      this.view = 'settings';
    } else if (!this.sheetLeaving) {
      this.view = 'messages';
    }
  }

  // The sheets on screen: the Settings sheet stays up while the About sheet is stacked above it, so About replaces
  // Settings by taking the screen while Settings steps aside underneath.
  get settingsSheetShowing() {
    return this.view === 'settings' || (this.view === 'about' && this.aboutFrom === 'settings');
  }

  get aboutSheetShowing() {
    return this.view === 'about';
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
    // Take the pointer for the whole drag: the browser may not claim it back for a scroll or a system gesture mid-way,
    // and a move off the panel is still delivered. Without it a touch drag is cancelled and the panel snaps, the flash
    // the finger sees. Inline the base and the finger's origin, fixed for the drag, so every step is its own travel.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer has nothing to capture */ }
    this.drag = { shell: e.currentTarget, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, open, startProgress: open ? 1 : 0, active: false, width: 0, progress: open ? 1 : 0, samples: [] };
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
    // One number, written straight onto the shell: the panel and the scrim both read --drawer-progress, so nothing is
    // redrawn per frame and the two can never disagree about where the finger is.
    d.progress = progressFor({ open: d.open, startX: d.startX, x: e.clientX, width: d.width });
    d.samples.push({ x: e.clientX, time: e.timeStamp });
    if (d.samples.length > 6) d.samples.shift();
    d.shell.style.setProperty('--drawer-progress', String(d.progress));
  };

  onPointerUp = (e) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    if (d.active) {
      // The finger's own movement decides: a flick settles in the direction it moved, short of that it settles by where
      // the finger left the panel, held between the two ends.
      const travel = Math.abs(d.progress - d.startProgress);
      this.settleDrawer(d, settlesOpenAt({ progress: d.progress, travel, velocity: velocityFor(d.samples), width: d.width }));
    }
    this.endDrag();
  };

  onPointerCancel = (e) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    // A cancelled drag (the browser took the pointer) returns to where it started rather than deciding.
    if (d.active) this.settleDrawer(d, d.open);
    this.endDrag();
  };

  // The finger is up: hand the panel's position back to the stylesheet, which animates it from where the finger left
  // it to where it settled. Clearing the drag flag and the inline position together lets the transition run.
  settleDrawer(d, open) {
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
    if (!chips.length) return nothing;
    return html`<div class="active-filters" aria-label="Active filters">${chips.map((c) => html`<span class="active-chip">${c.label}<button type="button" class="chip-clear" aria-label=${'Clear ' + c.label} @click=${press(() => this.clearFilter(c.key))}>×</button></span>`)}</div>`;
  }

  // The dropdown the filter icon opens: everything filterChats supports, which is unread, direct and group chats. A filter that is on reads as pressed, and pressing it again turns it off.
  filterMenu() {
    const f = this.filters || emptyFilters();
    const toggle = (key, value) => this.setFilters({ [key]: f[key] === value ? null : value });
    return html`<div class="filter-menu" role="group" aria-label="Filter conversations" data-dismiss="filter" data-popover data-popover-edge="top">
      <div class="filter-menu-row">
        <button type="button" class="chip" aria-pressed=${f.unread ? 'true' : 'false'} @click=${press(() => this.setFilters({ unread: !f.unread }))}>Unread</button>
        <button type="button" class="chip" aria-pressed=${f.kind === 'direct' ? 'true' : 'false'} @click=${press(() => toggle('kind', 'direct'))}>Direct</button>
        <button type="button" class="chip" aria-pressed=${f.kind === 'group' ? 'true' : 'false'} @click=${press(() => toggle('kind', 'group'))}>Group chats</button>
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
    const visible = filterChats(this.visibleChats(), this.filters || emptyFilters(), { texts: this.loadedTexts() });
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

  // A new conversation, or a group made from the selection in Edit (issue 326): both open the compose sheet, the group
  // starting from the people of every chosen conversation. The Mac creates it, and the page opens it.
  openCompose(mode = 'new') {
    const preset = mode === 'group' ? groupAddresses(this.chats, this.checked) : [];
    this.filterOpen = false;
    this.sortOpen = false;
    this.composing = { mode, preset };
  }

  composed(chat) {
    this.composing = null;
    if (!chat) return;
    this.chats = upsertChat(this.chats, chat);
    if (this.editing) this.exitEdit();
    this.view = 'messages';
    this.open(chat.id, { show: true });
  }

  // A group's own details, opened from its conversation's header (issue 326).
  openGroupInfo() {
    const chat = this.chats.find((c) => c.id === this.openChatId);
    if (chat && chat.isGroup) this.groupInfo = { chatId: chat.id };
  }

  groupChanged(chat) {
    if (chat) this.chats = upsertChat(this.chats, chat);
  }

  // The first press opens the gate; only the modal's own press, a second one, resolves it. The modal is drawn only
  // while a delete is pending, so a delete cannot complete without that press.
  requestDeleteSelection() {
    this.pendingDelete = requestDelete(this.checked);
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
    const work = this.setSettings({ 'chats.hidden': hideChats(this.chatHidden(), pending.ids), 'chats.order': forgetChats(this.chatOrder(), pending.ids) });
    this.exitEdit();
    return work;
  }

  // The row above the list (issue 137): a small Edit text control at the left. Pressed, it stays highlighted, every row
  // gains a checkbox, and the row offers select-all, the count, Group, Delete and Done for the selection. The new
  // conversation control sits at the row's right end (issue 326).
  editRow() {
    const toggle = html`<button type="button" class="edit-toggle" aria-pressed=${this.editing ? 'true' : 'false'} @click=${press(() => this.toggleEditing())}>Edit</button>`;
    if (!this.editing) return html`<div class="list-tools">${toggle}<button type="button" class="new-chat" aria-label="New conversation" title="New conversation" @click=${press(() => this.openCompose('new'))}><span class="icon" data-icon="pencil" aria-hidden="true"></span></button></div>`;
    const ids = this.selectableIds();
    const count = checkedCount(this.checked, ids);
    const all = allChecked(this.checked, ids);
    return html`<div class="list-tools editing" role="group" aria-label="Edit conversations">
      ${toggle}
      <label class="edit-all"><input type="checkbox" class="select-all" aria-label="Select all" .checked=${all} .indeterminate=${count > 0 && !all} ?disabled=${ids.length === 0} @change=${() => this.toggleAllChecked()}></label>
      <span class="edit-count" role="status">${count} selected</span>
      <span class="edit-actions">
        <button type="button" class="text-button edit-group" ?disabled=${count === 0} @click=${press(() => this.openCompose('group'))}>Group</button>
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
    const n = pending.ids.length;
    const title = 'Delete ' + n + ' conversation' + (n === 1 ? '' : 's') + '?';
    const body = "They leave this client's list only. No message is deleted on the Mac.";
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

  // Settings and About are the app's two sheets, drawn here and never in the main pane: the Settings sheet under,
  // the About sheet stacked above it (issues 171, 253).
  settingsBody() {
    return html`<app-settings .values=${this.settings} .systemText=${this.systemText} .serverUrl=${this.serverUrl} .busy=${this.settingsBusy} .problem=${this.settingsProblem} .scheme=${this.scheme} .info=${this.info} .host=${this.host}
      @setting=${(e) => respond(e, this.setSetting(e.detail))} @settings=${(e) => respond(e, this.setSettings(e.detail))} @theme-import=${(e) => respond(e, this.importThemeUrl(e.detail))} @signout=${(e) => respond(e, this.signOut(''))} @about=${() => this.openAbout()} @back=${() => this.pageBack()} @close=${() => this.closeView()}
      .themePicture=${this.themePicture} .tab=${this.settingsTab} @tab=${(e) => { this.settingsTab = e.detail; }}></app-settings>`;
  }

  // The About sheet's own body (issue 253).
  aboutBody() {
    return html`<app-about .info=${this.info} .host=${this.host} .backLabel=${this.aboutFrom === 'settings' ? 'Back to settings' : ''}
      .values=${this.settings} .themePicture=${this.themePicture} .release=${this.updateStatus} @check-updates=${(e) => respond(e, this.aboutPress(e.detail))} @open-external=${(e) => this.openExternal(e.detail.url)} @back=${() => this.pageBack()} @close=${() => this.closeView()}></app-about>`;
  }

  mainView(chat) {
    return chat
      ? html`<app-conversation .chat=${chat} .host=${this.host} .reveal=${this.revealing} .messages=${this.messages} .historyWindow=${this.historyWindow} .hasMore=${this.hasMore} .sending=${this.sending} .uploadMaxBytes=${this.info?.uploadMaxBytes} .client=${this.client} .windowControls=${this.windowControls()} .maximized=${this.maximized} .phone=${this.isPhone()} .reacting=${this.reacting} .canEdit=${Boolean(this.info?.engine?.edit)} .note=${this.messageNote} .typing=${this.typing} .favourites=${this.favourites} @open-external=${(e) => this.openExternal(e.detail.url)} @favourite=${(e) => this.favouriteEmoji(e.detail)} @forget-favourite=${(e) => this.forgetEmoji(e.detail)} @react=${(e) => respond(e, this.react(e.detail))} @edit=${(e) => respond(e, this.edit(e.detail))} @groupinfo=${() => this.openGroupInfo()} @send=${(e) => respond(e, this.send(e.detail))} @draft=${(e) => this.onDraft(e.detail)} @older=${(e) => respond(e, this.loadOlder(e.detail))} @newer=${(e) => respond(e, this.loadHistory('newer', e.detail))} @history-measured=${(e) => this.measureHistory(e.detail)} @window-action=${(e) => this.windowAction(e.detail)} @back=${() => { this.listOpen = true; }}></app-conversation>`
      : html`<header class="conv-head conv-head--empty">${this.emptyControls()}</header><div class="empty">${EMPTY_PANE}</div>`;
  }

  // The shell's product and platform; the app draws window chrome only where the platform has a window.
  isDesktop() {
    return ['darwin', 'win32', 'linux'].includes(String(this.host && this.host.platform || '').toLowerCase());
  }

  // The shell's platform again, for the one control a phone does not need: its own keyboard carries emoji, so the
  // composer draws the emoji tool only where a window has a physical keyboard.
  isPhone() {
    return ['ios', 'android'].includes(String(this.host && this.host.platform || '').toLowerCase());
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

  // The pane with no conversation keeps the window's own top strip (issue 373): it drags the window as the contact
  // header does, and on Windows and Linux it carries the same controls, since nothing is open to draw them.
  emptyControls() {
    const layout = this.windowControls();
    return layout && layout.drawn ? windowControlsHtml({ order: layout.order, maximized: this.maximized, onAction: (name) => this.windowAction(name) }) : nothing;
  }

  // The one class the stylesheet keys off: it says a surface is leaving, so the sheet and its dim leave together. A
  // render may also have changed the unread count the app icon carries.
  updated() {
    document.body.classList.toggle('surface--leaving', this.sheetLeaving === true || this.aboutLeaving === true);
    this.syncIcon();
    // The conversation on screen is what a switch back to it draws (issue 200), kept after every render. Its pair of
    // fields is always written together, so the cache never holds one conversation's messages under another's id.
    if (this.messages.length > HISTORY_MAX_MESSAGES && this.historyWindow) this.applyWindow(shiftWindow({ ...this.historyWindow, messages: [] }, this.messages, { direction: 'newer' }));
    if (this.openChatId && this.client) {
      const convos = this.convos = this.convos || new Map();
      convos.delete(String(this.openChatId));
      convos.set(String(this.openChatId), { messages: this.messages, hasMore: this.hasMore, historyWindow: this.historyWindow ? { ...this.historyWindow, messages: this.messages } : null });
      while (convos.size > HISTORY_CACHED_CHATS) convos.delete(convos.keys().next().value);
    }
    this.keepShown();
    // Every open menu wears the shared caret, aimed at the control that opened it (issue 217).
    aimCarets(this);
    // The divider's seam follows the width the settings hold, and the separator reports the width a screen reader should
    // (issue 215). A render is the only moment the shell's column is rebuilt, so it is put back here.
    this.applyChatsWidth();
  }

  // The chats list's width in the window as it is now: the size-sidebar token before anyone chooses one, and the choice
  // held on the server afterwards, always held between the two pane minimums so neither can be dragged to nothing.
  dividerViewport() {
    return typeof window === 'undefined' ? CHATS_MIN + CHATS_DEFAULT : window.innerWidth;
  }

  chatsChosen() {
    return chatsWidthFrom(this.settings ? this.settings['chats.width'] : null, this.dividerViewport());
  }

  chatsShown() {
    const chosen = this.chatsChosen();
    return clampChatsWidth(chosen === null ? CHATS_DEFAULT : chosen, this.dividerViewport());
  }

  // Writes the width onto the shell's column and the separator's value. With no choice stored, and the window wide
  // enough for the token default, nothing is written and the size-sidebar token draws it; a window too narrow to hold
  // the default writes the clamped width instead, so the conversation still keeps its minimum.
  applyChatsWidth() {
    const shell = this.querySelector && this.querySelector('.shell');
    if (!shell) return;
    const chosen = this.chatsChosen();
    const shown = clampChatsWidth(chosen === null ? CHATS_DEFAULT : chosen, this.dividerViewport());
    if (chosen === null && shown === CHATS_DEFAULT) shell.style.removeProperty('--chats-width');
    else shell.style.setProperty('--chats-width', shown + 'px');
    const divider = this.querySelector('.conv-divider');
    if (divider) {
      const bounds = dividerBounds(this.dividerViewport());
      divider.setAttribute('aria-valuemin', String(bounds.min));
      divider.setAttribute('aria-valuemax', String(bounds.max));
      divider.setAttribute('aria-valuenow', String(shown));
    }
  }

  // A drag in flight, written straight onto the seam so the whole page is not redrawn under the pointer; the choice is
  // only sent to the server once, when the pointer lifts.
  showChatsWidth(width) {
    const shell = this.querySelector('.shell');
    if (shell) shell.style.setProperty('--chats-width', width + 'px');
    const divider = this.querySelector('.conv-divider');
    if (divider) divider.setAttribute('aria-valuenow', String(width));
  }

  onDividerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    // Take the pointer for the whole drag: a fast move that leaves the handle's own 12px box, or runs off the window,
    // still delivers until the pointer lifts. The width the drag starts at and the pointer's origin are held FIXED for
    // the drag, so every step is the pointer's own travel and nothing compounds.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer has nothing to capture */ }
    const baseWidth = this.chatsShown();
    this.chatDrag = { pointerId: e.pointerId, startX: e.clientX, baseWidth, shown: baseWidth, moved: false };
    this.chatMove = (ev) => this.onDividerMove(ev);
    this.chatUp = (ev) => this.onDividerUp(ev);
    this.chatLost = () => this.onDividerLost();
    window.addEventListener('pointermove', this.chatMove);
    window.addEventListener('pointerup', this.chatUp);
    window.addEventListener('pointercancel', this.chatUp);
    const divider = e.currentTarget;
    divider.dataset.capture = String(e.pointerId);
    divider.addEventListener('lostpointercapture', this.chatLost);
    // Nothing animates the seam while the pointer is down: it is exactly where the pointer put it, never easing toward
    // it. The flag also names the drag for the check that reads it.
    const shell = this.querySelector('.shell');
    if (shell) shell.dataset.drag = 'divider';
    // The press belongs to the seam, not to the phone drawer's own edge drag the shell watches.
    e.stopPropagation();
  }

  onDividerMove(e) {
    const d = this.chatDrag;
    if (!d || e.pointerId !== d.pointerId) return;
    // One to one from where the pointer went down: the width is the base plus the pointer's own travel, so each step
    // matches the pointer and never compounds. The bounds clamp only what is drawn; the base and the origin stay fixed,
    // so a drag past a minimum and back resumes one to one.
    const width = dragChatsWidth({ baseWidth: d.baseWidth, startX: d.startX, x: e.clientX, viewport: this.dividerViewport() });
    d.shown = width;
    d.moved = true;
    this.showChatsWidth(width);
    e.preventDefault();
  }

  onDividerUp(e) {
    const d = this.chatDrag;
    if (!d || (e.pointerId !== undefined && e.pointerId !== d.pointerId)) return;
    this.endDividerDrag();
    // A press that never moved is only a focus, not a width: nothing is written. A drag writes the width it drew once,
    // on release.
    if (d.moved) this.setSettings({ 'chats.width': d.shown });
    e.preventDefault();
  }

  // The pointer was taken from the seam (the element left the document, or the browser dropped the capture): settle the
  // same width a lift would, so a drag never strands the listeners.
  onDividerLost() {
    const d = this.chatDrag;
    if (!d) return;
    this.endDividerDrag();
    if (d.moved) this.setSettings({ 'chats.width': d.shown });
  }

  endDividerDrag() {
    this.chatDrag = null;
    if (typeof window === 'undefined') return;
    if (this.chatMove) { window.removeEventListener('pointermove', this.chatMove); this.chatMove = null; }
    if (this.chatUp) {
      window.removeEventListener('pointerup', this.chatUp);
      window.removeEventListener('pointercancel', this.chatUp);
      this.chatUp = null;
    }
    const divider = this.querySelector('.conv-divider');
    if (divider) {
      if (this.chatLost) divider.removeEventListener('lostpointercapture', this.chatLost);
      delete divider.dataset.capture;
    }
    this.chatLost = null;
    const shell = this.querySelector('.shell');
    if (shell && shell.dataset.drag === 'divider') delete shell.dataset.drag;
  }

  // A double click clears the choice, so the divider returns to the token default as a fresh app would draw it.
  onDividerDblClick(e) {
    e.preventDefault();
    this.setSettings({ 'chats.width': null });
  }

  // The two arrows step the divider and Home or Enter resets it (issue 215), each held between the pane minimums.
  onDividerKey(e) {
    const out = dividerKey(e.key, this.chatsShown(), this.dividerViewport());
    if (!out) return;
    e.preventDefault();
    this.setSettings({ 'chats.width': out.reset ? null : out.width });
  }

  // The media viewer: the picture or video a preview opened, and the conversation's other media, so the viewer steps
  // through them in conversation order (issue 181). A preview of an attachment names the attachment; the page finds it
  // among the conversation's media and hands the viewer the whole list and where to start. A staged preview in the
  // composer has no conversation behind it, so it is a single item with nothing to step to.
  openViewer(detail) {
    const d = detail || {};
    // The preview it was opened from, which the viewer grows out of and shrinks back into (issue 316).
    this.viewerFrom = d.from || null;
    // A shared video link (issue 243) is a single item the viewer loads from the server, not one of the conversation's
    // attachments, so it is handed over on its own rather than looked up among the conversation's media.
    if (d.linkUrl) {
      const item = { id: String(d.linkUrl), linkUrl: String(d.linkUrl), kind: 'video', alt: d.alt || '' };
      this.viewing = { src: d.src || '', alt: d.alt || '', kind: 'video', items: [item], index: 0 };
      return;
    }
    // A document the viewer shows (issue 374: a PDF, text, or audio) is a single item the viewer loads itself, with Open
    // in and Save beside it; it is not one of the conversation's media, so there is nothing to step to.
    if (d.document && d.attachmentId) {
      const item = { id: String(d.attachmentId), attachmentId: String(d.attachmentId), kind: String(d.kind || ''), name: String(d.name || ''), mime: String(d.mime || ''), alt: d.alt || d.name || '', document: true };
      this.viewing = { src: '', alt: item.alt, kind: item.kind, items: [item], index: 0 };
      return;
    }
    if (!d.src) { this.viewing = null; return; }
    const items = mediaItems(this.messages || []);
    const at = d.attachmentId ? mediaIndex(items, d.attachmentId, { messageId: d.from?.closest?.('.bubble-row')?.dataset?.id }) : -1;
    if (at < 0) {
      this.viewing = { src: d.src, alt: d.alt || '', kind: d.kind || 'image', items: [], index: 0 };
      return;
    }
    // The starting item is already loaded (its preview handed the src over), so the viewer shows it at once. A Live
    // Photo's preview is its still, not the motion the viewer plays, so that one is loaded rather than handed over.
    const handed = items[at].part ? {} : { src: d.src };
    items[at] = { ...items[at], ...handed, alt: d.alt || items[at].alt };
    this.viewing = { src: handed.src || '', alt: d.alt || '', kind: items[at].kind || d.kind || 'image', items, index: at, history: { chatId: this.openChatId, beforeCursor: this.messages[0]?.historyCursor, afterCursor: this.messages.at(-1)?.historyCursor } };
  }

  // The viewer stepped to another item: the page keeps its own idea of the open item, so a re-render does not undo it.
  viewerNavigate(e) {
    if (!this.viewing) return;
    const index = e && e.detail && Number.isFinite(e.detail.index) ? e.detail.index : this.viewing.index;
    this.viewing = { ...this.viewing, index, ...(e.detail.items ? { items: e.detail.items } : {}) };
  }

  render() {
    const platform = String(this.host && this.host.platform || '').toLowerCase();
    // No bar, no title and no icon: the app's surfaces run to the top edge of the window. macOS floats its traffic
    // lights over the top left, so the stylesheet pushes the content below down; every other platform draws its window
    // controls in the contact header instead (see mainView).
    return html`<div class="app-window" data-platform=${platform}>
      <div class="app-body">${this.body()}</div>
      <app-notices data-dismiss-keep="sheet about" .notices=${this.appNotices} .runAction=${(command) => this.updateAction(command)} @notice-read=${(e) => this.onNoticeRead(e)}></app-notices>
    </div>`;
  }

  body() {
    if (this.phase === 'boot' || this.phase === 'loading') return html`<div class="splash" aria-busy="true"><div class="spinner" role="img" aria-label="Loading"></div></div>`;
    if (this.phase === 'onboarding') return html`<app-onboarding .problem=${this.problem} @connect=${(e) => respond(e, this.onConnect(e.detail))}></app-onboarding>`;
    const chat = this.chats.find((c) => c.id === this.openChatId) || null;
    const sentence = connectionSentence(this.conn);
    return html`<div class="shell" data-pane=${this.pane()} @pointerdown=${this.onPointerDown} @view-image=${(e) => this.openViewer(e.detail)}>
      <div class="drawer-edge" aria-hidden="true"></div>
      <aside class="sidebar" aria-label="Conversations">
        ${this.sidebarHead()}
        ${this.searchTerms()}
        ${sentence ? html`<div class="banner" role="status">${sentence}</div>` : nothing}
        ${this.problem ? html`<div class="banner problem" role="alert">${this.problem}</div>` : nothing}
        ${this.activeFilters()}
        ${this.editRow()}
        <app-chat-list .client=${this.client} .chats=${this.visibleChats()} .selected=${this.selecting || this.openChatId} .texts=${this.loadedTexts()}
          .sort=${normalizeSort(this.settings['chats.sort'])} .filters=${this.filters}
          .editing=${this.editing} .checked=${this.checked}
          @select=${(e) => { this.view = 'messages'; this.open(e.detail, { show: true }); }}
          @check=${(e) => this.setChecked(e.detail.id, e.detail.checked)}
></app-chat-list>
      </aside>
      ${chat ? html`<button type="button" class="scrim" aria-label="Close the conversation list" @click=${press(() => this.closeDrawer())}></button>` : nothing}
      <div class="conv-divider" role="separator" aria-orientation="vertical" aria-label="Resize the conversation list" tabindex="0" @pointerdown=${(e) => this.onDividerDown(e)} @dblclick=${(e) => this.onDividerDblClick(e)} @keydown=${(e) => this.onDividerKey(e)}></div>
      <main class="main">${this.mainView(chat)}</main>
      ${this.settingsSheetShowing ? html`<div class="sheet-scrim" data-sheet="settings" ?data-leaving=${this.sheetLeaving} ?data-under=${this.aboutSheetShowing && this.aboutFrom === 'settings' && !this.aboutLeaving} ?data-returning=${this.aboutLeaving && this.aboutFrom === 'settings'}><section class="sheet" data-view="settings" data-arrive=${this.sheetMotion || 'none'} data-dismiss="sheet" role="dialog" aria-modal="true" aria-label="Settings" @animationend=${this.onSheetAnimationEnd}>${this.settingsBody()}</section></div>` : nothing}
      ${this.aboutSheetShowing ? html`<div class="sheet-scrim about-sheet-scrim" data-sheet="about" ?data-leaving=${this.aboutLeaving}><section class="sheet" data-view="about" data-arrive=${this.aboutMotion || 'none'} data-dismiss="about" role="dialog" aria-modal="true" aria-label="About" @animationend=${this.onAboutAnimationEnd}>${this.aboutBody()}</section></div>` : nothing}
      ${this.pendingDelete ? this.confirmModal() : nothing}
      ${this.composing ? html`<app-compose .chats=${this.chats} .client=${this.client} .mode=${this.composing.mode} .preset=${this.composing.preset} @created=${(e) => respond(e, this.composed(e.detail))} @close=${() => { this.composing = null; }}></app-compose>` : nothing}
      ${this.groupInfo && this.chats.find((c) => c.id === this.groupInfo.chatId) ? html`<app-group-info .chat=${this.chats.find((c) => c.id === this.groupInfo.chatId)} .client=${this.client} @changed=${(e) => this.groupChanged(e.detail)} @close=${() => { this.groupInfo = null; }}></app-group-info>` : nothing}
      ${this.viewing ? html`<app-image-viewer .src=${(this.viewing.items && this.viewing.items.length) ? '' : (this.viewing.src || '')} .alt=${this.viewing.alt || ''} .kind=${this.viewing.kind || 'image'} .items=${this.viewing.items || []} .index=${this.viewing.index || 0} .history=${this.viewing.history || null} .client=${this.client} .from=${this.viewerFrom} @navigate=${(e) => this.viewerNavigate(e)} @close=${() => { this.viewing = null; }}></app-image-viewer>` : nothing}
    </div>`;
  }
}

customElements.define('app-root', AppRoot);
