import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { dismissable } from '../../kit/dismiss.js';
import { press } from '../../kit/press.js';
import { closeButtonHtml } from './close-button.js';
import { pressOutside } from '../../kit/rules/dismiss.js';
import { ZOOM_STEP, zoomFit, zoomMax, zoomBy, panBy, toggleZoom, pinch, wheelFactor, isClick, isDoubleTap, zoomKey } from '../rules/zoom.js';
import { swipeStep } from '../rules/media.js';

// The image viewer: one picture or video, large, over the app. It draws on the settings sheet's own backdrop (the same
// .sheet-scrim, so the blur and the dim are one treatment, not a second), and it closes the three ways the sheet does:
// Escape, its close control, and a press that both starts and ends on the backdrop. It is registered with the kit's one
// dismiss behaviour (core/kit/dismiss.js) as a panel that owns the whole surface: the kit closes it on Escape, in its
// place among any other open panels, and leaves every press to the gestures below, which apply the kit's own rule for
// a press outside (core/kit/rules/dismiss.js) to the backdrop.
//
// It steps through the conversation's own media (issue 181): the page hands it the media items in conversation order
// and the one to start on, and the viewer moves to the previous or next item with the on-screen controls, the left and
// right arrow keys (at fit; a zoomed picture pans instead), and a finger's horizontal swipe, each staying put at the
// ends rather than wrapping. It loads a video item the same way it loads a picture, and draws it as a video element.
//
// A shared video link is one such item (issue 243): it names no attachment of ours but the link itself, and the viewer
// loads the media the server resolved and cached, so it plays here with the controls it already owns, and the client
// never opens the third party.
//
// Every number it draws comes from rules/zoom.js. This only measures the picture and the stage, turns pointer, wheel
// and key events into calls on those rules, and paints the view they answer:
// - a mouse: left click zooms in at the point clicked, right click zooms out there with no context menu, the wheel or
//   a trackpad pinch zooms about the pointer, and a drag pans once zoomed;
// - a finger: two fingers pinch, one drags once zoomed, a double tap toggles between fit and a closer look, and a
//   horizontal swipe steps to the next or previous item;
// - the keyboard: + and - zoom, 0 resets, the left and right arrows step through the media at fit and pan once zoomed,
//   the up and down arrows pan, Escape closes.
// The view is painted through custom properties set with setProperty, never a style attribute written as text, which
// the page's content security policy would refuse.
const needsJpeg = (item) => /heic|heif/i.test(String(item && item.mime || ''));

class AppImageViewer extends KitElement {
  static properties = {
    src: {}, alt: {}, kind: {}, view: { state: true }, moving: { state: true },
    // The conversation's media, in order, and the one on screen. The page hands them in; the viewer steps between them.
    items: { attribute: false }, index: { attribute: false }, client: { attribute: false },
  };

  constructor() {
    super();
    this.src = '';
    this.alt = '';
    this.kind = 'image';
    this.items = [];
    this.index = 0;
    this.client = null;
    this.view = zoomFit();
    this.moving = false;
    this.failed = false;
    this.pointers = new Map();
    this.gesture = null;
    this.lastTap = null;
    this.opener = null;
    // The object URLs this viewer made for the items it loaded, kept so stepping back is instant and revoked on close.
    this.urls = new Map();
    this.onKey = (e) => this.key(e);
    // Safari's own pinch would zoom the whole page under the viewer; the pointer events already carry the pinch.
    this.onGesture = (e) => e.preventDefault();
    dismissable(this, { name: 'viewer', outside: false, open: () => true, close: () => this.close() });
  }

  connectedCallback() {
    super.connectedCallback();
    this.opener = document.activeElement;
    document.addEventListener('keydown', this.onKey);
    document.addEventListener('gesturestart', this.onGesture);
    document.addEventListener('gesturechange', this.onGesture);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this.onKey);
    document.removeEventListener('gesturestart', this.onGesture);
    document.removeEventListener('gesturechange', this.onGesture);
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    // Focus goes back to the preview that opened the viewer, so a keyboard reader is where they were.
    if (this.opener && this.opener.isConnected && typeof this.opener.focus === 'function') this.opener.focus();
  }

  firstUpdated() {
    this.querySelector('.close-button')?.focus();
    // The item the page asked for: a single picture or video it handed over (a staged preview), or one of the media
    // items in the conversation, resolved by id.
    if (this.items.length) this.show(this.index);
  }

  updated() {
    const img = this.picture();
    if (!img) return;
    img.style.setProperty('--zoom-x', String(this.view.x));
    img.style.setProperty('--zoom-y', String(this.view.y));
    img.style.setProperty('--zoom-scale', String(this.view.scale));
  }

  close() {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  stage() {
    return this.querySelector('.viewer');
  }

  picture() {
    return this.querySelector('.viewer-image');
  }

  // What the rules need: the fitted picture (its layout size, which the transform does not change) and the stage.
  box() {
    const img = this.picture();
    const stage = this.stage();
    return { width: img ? img.offsetWidth : 0, height: img ? img.offsetHeight : 0, stageWidth: stage ? stage.clientWidth : 0, stageHeight: stage ? stage.clientHeight : 0 };
  }

  max() {
    const img = this.picture();
    return zoomMax(img && img.offsetWidth ? img.naturalWidth / img.offsetWidth : 1);
  }

  // A point on the screen, measured from the stage's centre, which is where the rules measure from.
  point(e) {
    const r = this.stage().getBoundingClientRect();
    return { x: e.clientX - (r.left + r.width / 2), y: e.clientY - (r.top + r.height / 2) };
  }

  zoom(factor, point) {
    this.view = zoomBy(this.view, factor, point, this.box(), this.max());
  }

  // Show the item at position i: its kind, its alt, and its bytes (the src the page handed over, a URL already made
  // for it, or a fresh load from the server). The zoom returns to fit, as it does when the viewer opens.
  async show(i) {
    const list = Array.isArray(this.items) ? this.items : [];
    this.view = zoomFit();
    this.failed = false;
    if (!list.length) return;
    const at = Math.max(0, Math.min(list.length - 1, Number(i) || 0));
    this.index = at;
    const item = list[at];
    this.kind = item.kind || 'image';
    this.alt = item.alt || item.name || '';
    this.src = item.src || this.urls.get(item.id) || '';
    await this.updateComplete;
    if (!this.src && (item.attachmentId || item.linkUrl) && this.client) this.load(item);
  }

  async load(item) {
    try {
      // A link item is a shared video the server resolves and caches (issue 243), so the viewer asks the server for it
      // and never the site; every other item is one of our own attachments.
      const blob = item.linkUrl
        ? await this.client.linkMedia(item.linkUrl)
        : await this.client.attachment(item.attachmentId, item.part ? { part: item.part } : { format: needsJpeg(item) ? 'jpeg' : undefined });
      const url = URL.createObjectURL(blob);
      this.urls.set(item.id, url);
      const current = this.items[this.index];
      if (current && current.id === item.id) {
        this.src = url;
        this.failed = false;
        await this.updateComplete;
      }
    } catch {
      const current = this.items[this.index];
      if (current && current.id === item.id) this.failed = true;
    }
  }

  // Move one item in the conversation's media, staying put at the ends. The page hears the move so its own idea of the
  // open item keeps up.
  go(dir) {
    const list = Array.isArray(this.items) ? this.items : [];
    if (list.length < 2) return;
    const to = dir === 'prev' ? this.index - 1 : this.index + 1;
    if (to < 0 || to >= list.length) return;
    this.show(to);
    this.dispatchEvent(new CustomEvent('navigate', { bubbles: true, composed: true, detail: { index: to } }));
  }

  key(e) {
    if (e.key === 'Tab') {
      // The close control is the dialog's one stop; the page behind it is out of reach while the viewer is open.
      e.preventDefault();
      this.querySelector('.close-button')?.focus();
      return;
    }
    // At fit, the left and right arrows step through the conversation's media; once zoomed they pan, as before.
    const steps = this.items.length > 1 && this.view.scale <= 1.001 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight');
    if (steps && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      this.go(e.key === 'ArrowRight' ? 'next' : 'prev');
      return;
    }
    const action = zoomKey(e.key);
    if (!action || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    if (action.kind === 'close') this.close();
    else if (action.kind === 'reset') this.view = zoomFit();
    else if (action.kind === 'zoom') this.zoom(action.factor, { x: 0, y: 0 });
    else if (action.kind === 'pan') this.view = panBy(this.view, action.dx, action.dy, this.box());
  }

  onDown = (e) => {
    // The page's own drag (the phone's drawer, from the left edge) must not start under the viewer. A press on the
    // close control, a step control or a video's own controls is theirs, not a pan's.
    e.stopPropagation();
    if (e.target.closest && (e.target.closest('.close-button') || e.target.closest('.viewer-nav') || e.target.closest('video'))) return;
    try { this.stage().setPointerCapture(e.pointerId); } catch { /* a synthetic pointer has nothing to capture */ }
    const p = this.point(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 2) {
      this.gesture = { kind: 'pinch', start: this.view, from: [...this.pointers.values()] };
      this.moving = true;
      return;
    }
    if (this.pointers.size > 2) return;
    this.gesture = {
      kind: 'press', start: this.view, down: p, moved: false, button: e.button, mouse: e.pointerType === 'mouse',
      onBackdrop: e.target === e.currentTarget, onImage: e.target === this.picture(),
    };
  };

  onMove = (e) => {
    if (!this.pointers.has(e.pointerId) || !this.gesture) return;
    const p = this.point(e);
    this.pointers.set(e.pointerId, p);
    const g = this.gesture;
    if (g.kind === 'pinch') {
      if (this.pointers.size >= 2) this.view = pinch(g.start, g.from, [...this.pointers.values()].slice(0, 2), this.box(), this.max());
      return;
    }
    if (!g.moved && !isClick(g.down, p)) g.moved = true;
    if (g.moved && g.start.scale > 1) {
      this.moving = true;
      this.view = panBy(g.start, p.x - g.down.x, p.y - g.down.y, this.box());
    }
  };

  onUp = (e) => {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.point(e);
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (!g) return;
    if (g.kind === 'pinch') {
      // One finger lifted: the other carries on as a pan from here, and is never read as a tap.
      const rest = [...this.pointers.values()];
      this.gesture = rest.length === 1 ? { kind: 'press', start: this.view, down: rest[0], moved: true, button: 0, mouse: false, onBackdrop: false, onImage: false } : null;
      if (!this.gesture) this.moving = false;
      return;
    }
    this.gesture = null;
    this.moving = false;
    // A finger's horizontal swipe, at fit, steps to the previous or next item (a zoomed picture pans instead).
    if (!g.mouse && this.items.length > 1 && g.start.scale <= 1.001) {
      const dir = swipeStep(p.x - g.down.x, p.y - g.down.y);
      if (dir) { this.go(dir); return; }
    }
    if (g.moved || !isClick(g.down, p)) return;
    const endsOnBackdrop = document.elementFromPoint(e.clientX, e.clientY) === this.stage();
    if (g.mouse) {
      if (g.button === 2) this.zoom(1 / ZOOM_STEP, p);
      else if (g.button === 0 && pressOutside(g.onBackdrop, endsOnBackdrop)) this.close();
      else if (g.button === 0 && g.onImage) this.zoom(ZOOM_STEP, p);
      return;
    }
    // A finger or a pen: a tap on the backdrop closes, two quick taps on the picture toggle the zoom.
    if (pressOutside(g.onBackdrop, endsOnBackdrop)) { this.close(); return; }
    const tap = { x: p.x, y: p.y, at: e.timeStamp };
    if (isDoubleTap(this.lastTap, tap)) {
      this.lastTap = null;
      this.view = toggleZoom(this.view, p, this.box(), this.max());
    } else {
      this.lastTap = tap;
    }
  };

  onCancel = (e) => {
    this.pointers.delete(e.pointerId);
    if (!this.pointers.size) {
      this.gesture = null;
      this.moving = false;
    }
  };

  // Right click zooms out (on pointerup above), so the context menu never opens over the picture or its backdrop.
  onContext = (e) => {
    e.preventDefault();
  };

  onWheel = (e) => {
    e.preventDefault();
    this.zoom(wheelFactor(e.deltaY, e.deltaMode, e.ctrlKey), this.point(e));
  };

  // The fitted size is known only once the picture has loaded; start from fit against it.
  onLoad = () => {
    this.view = zoomFit();
  };

  render() {
    const list = Array.isArray(this.items) ? this.items : [];
    const at = Math.max(0, Math.min(list.length ? list.length - 1 : 0, Number(this.index) || 0));
    const label = this.alt || (this.kind === 'video' ? 'Video' : 'Image');
    const hasNav = list.length > 1;
    const media = this.kind === 'video'
      ? html`<video class="viewer-image" src=${this.src} aria-label=${label} controls autoplay muted playsinline @loadeddata=${this.onLoad}></video>`
      : html`<img class="viewer-image" src=${this.src} alt=${label} draggable="false" @load=${this.onLoad}>`;
    return html`<div class="sheet-scrim viewer" data-dismiss="viewer" role="dialog" aria-modal="true" aria-label=${label}
        data-scale=${String(this.view.scale)} data-zoomed=${this.view.scale > 1.001 ? 'true' : 'false'} data-gesture=${this.moving ? 'on' : 'off'}
        data-index=${at} data-count=${list.length} data-kind=${this.kind}
        @pointerdown=${this.onDown} @pointermove=${this.onMove} @pointerup=${this.onUp} @pointercancel=${this.onCancel}
        @contextmenu=${this.onContext} @wheel=${this.onWheel}>
      ${media}
      ${hasNav ? html`<button type="button" class="viewer-nav viewer-prev" aria-label="Previous item" title="Previous item" ?disabled=${at <= 0} @click=${press(() => this.go('prev'))}><span class="icon" data-icon="chevron-left" aria-hidden="true"></span></button>` : nothing}
      ${hasNav ? html`<button type="button" class="viewer-nav viewer-next" aria-label="Next item" title="Next item" ?disabled=${at >= list.length - 1} @click=${press(() => this.go('next'))}><span class="icon" data-icon="chevron-right" aria-hidden="true"></span></button>` : nothing}
      ${closeButtonHtml({ owner: 'viewer', label: 'Close', size: 'lg', onClose: () => this.close() })}
      <p class="viewer-zoom" aria-live="polite">${Math.round(this.view.scale * 100)}%</p>
    </div>`;
  }
}

customElements.define('app-image-viewer', AppImageViewer);
