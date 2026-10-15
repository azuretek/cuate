import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { dismissable } from '../../kit/dismiss.js';
import { press } from '../../kit/press.js';
import { growFrom, play } from '../../kit/motion.js';
import { closeButtonHtml } from './close-button.js';
import { pressOutside } from '../../kit/rules/dismiss.js';
import { ZOOM_STEP, zoomFit, zoomMax, zoomBy, panBy, toggleZoom, pinch, wheelFactor, isClick, isDoubleTap, zoomKey, drawnY } from '../rules/zoom.js';
import { swipeStep } from '../rules/media.js';
import { DOC_ZOOM_MIN, DOC_ZOOM_MAX, DOC_ZOOM_STEP, docZoom, pageFit, pageCanvas } from '../rules/documents.js';
import { keepScroll } from '../../kit/scroll.js';
import { openPdf, pageSize, drawPage } from '../../kit/pdf.js';
import { openAttachment, saveAttachment } from './app-attachment.js';

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
//
// A document opens here too (issue 374): a PDF is drawn page by page by the bundled pdf.js (core/kit/pdf.js) into a
// view that scrolls through every page and zooms by pinch, by a ctrl or trackpad wheel, by the bar's controls and by
// the + and - keys; text, code and CSV are shown as text; and audio gets a player. Only the pages near the view are
// drawn, and a page scrolled far away gives its bitmap back, so a long PDF holds a few pages in memory, not all of
// them. The bar offers Open in, which hands the file to the device's own apps, and Save. Nothing leaves the device.
const needsJpeg = (item) => /heic|heif/i.test(String(item && item.mime || ''));
const DOC_KINDS = new Set(['pdf', 'text', 'audio']);
const isDocumentItem = (item) => Boolean(item && item.document && DOC_KINDS.has(item.kind));
// How long a zoom rests before the pages it changed are drawn again at their new size; until then the pages already
// drawn are scaled, so a pinch never waits on pdf.js.
const REDRAW_MS = 150;

class AppImageViewer extends KitElement {
  static properties = {
    src: {}, alt: {}, kind: {}, view: { state: true }, moving: { state: true },
    // A Live Photo shows its still, and its motion plays over it on the play control: the motion's URL, and whether it is
    // playing or could not be loaded.
    motion: { state: true }, playing: { state: true }, motionFailed: { state: true },
    // The conversation's media, in order, and the one on screen. The page hands them in; the viewer steps between them.
    items: { attribute: false }, index: { attribute: false }, client: { attribute: false },
    // The preview the viewer was opened from: it grows out of it and, closed on the same item, shrinks back into it.
    from: { attribute: false },
    // A document (issue 374): where it stands ('loading', 'ready' or 'failed'), its text, its page count and its zoom.
    docState: { state: true }, docText: { state: true }, docPages: { state: true }, docScale: { state: true },
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
    this.motion = '';
    this.playing = false;
    this.motionFailed = false;
    this.pointers = new Map();
    this.gesture = null;
    this.lastTap = null;
    this.opener = null;
    // The object URLs this viewer made for the items it loaded, kept so stepping back is instant and revoked on close.
    this.urls = new Map();
    this.onKey = (e) => this.key(e);
    // Safari's own pinch would zoom the whole page under the viewer; the pointer events already carry the pinch.
    this.onGesture = (e) => this.gestureZoom(e);
    this.docState = '';
    this.docText = '';
    this.docPages = 0;
    this.docScale = 1;
    this.pdf = null;
    this.docPointers = new Map();
    // A document's pages keep their place across a resize and a rotation, as every scrolled view does (issue 142).
    this.keepDoc = keepScroll(this, { scroller: '.viewer-doc', items: '.viewer-page' });
    dismissable(this, { name: 'viewer', outside: false, open: () => true, close: () => this.close() });
  }

  connectedCallback() {
    super.connectedCallback();
    this.opener = document.activeElement;
    // The item it opened on, which a close shrinks back into its preview only while it is still on screen.
    this.openedAt = this.index;
    document.addEventListener('keydown', this.onKey);
    document.addEventListener('gesturestart', this.onGesture);
    document.addEventListener('gesturechange', this.onGesture);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this.onKey);
    document.removeEventListener('gesturestart', this.onGesture);
    document.removeEventListener('gesturechange', this.onGesture);
    this.resized?.disconnect();
    this.closeDocument();
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    // Focus goes back to the preview that opened the viewer, so a keyboard reader is where they were.
    if (this.opener && this.opener.isConnected && typeof this.opener.focus === 'function') this.opener.focus();
  }

  firstUpdated() {
    this.querySelector('.close-button')?.focus();
    // The top lift depends on the stage's height, so a resize (a rotation, a window drag) redraws the picture's place.
    if (typeof ResizeObserver === 'function' && this.stage()) {
      this.resized = new ResizeObserver(() => this.updated());
      this.resized.observe(this.stage());
    }
    // The item the page asked for: a single picture or video it handed over (a staged preview), or one of the media
    // items in the conversation, resolved by id.
    if (this.items.length) this.show(this.index);
  }

  updated() {
    // A document's pages fit the stage, so a resize (a rotation, a window drag) lays them out again and redraws the
    // ones in view at their new size; their place down the document is kept by the page at the top.
    if (this.isDocument()) {
      if (this.pageSizes) { this.sizePages(); this.redrawPages(); }
      return;
    }
    const img = this.picture();
    if (!img) return;
    img.style.setProperty('--zoom-x', String(this.view.x));
    // The picture opens at the top of the stage (issue 315), lifted by the rules until a zoom makes it fill the stage.
    img.style.setProperty('--zoom-y', String(drawnY(this.view, this.box())));
    img.style.setProperty('--zoom-scale', String(this.view.scale));
  }

  // Closing on the item it opened on shrinks the picture back into its preview while the scrim fades (issue 316);
  // on another item, or with nowhere visible to go back to, the scrim fades with the picture in it.
  // With nothing to animate (reduced motion, or a page that cannot) it closes at once.
  close() {
    if (this.closing) return undefined;
    const done = () => { this.closing = false; this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true })); };
    const img = this.picture();
    const to = img ? this.returnRect() : null;
    const fade = play(this.stage(), [{ opacity: 1 }, { opacity: 0 }], { duration: 'screen', easing: 'sheet-ease', fill: 'forwards' });
    if (!fade) return done();
    this.closing = true;
    const back = to ? growFrom(img, to, { origin: this.layoutCentre(img), back: true, duration: 'screen', easing: 'sheet-ease' }) : fade.finished.catch(() => {});
    return back.then(done);
  }

  // Where the preview is now, if it is still on screen and this is the item it opened: a rectangle to grow from or
  // shrink back into, or null.
  returnRect() {
    const el = this.from;
    if (!el || !el.isConnected || this.index !== this.openedAt || typeof el.getBoundingClientRect !== 'function') return null;
    const r = el.getBoundingClientRect();
    const vh = typeof innerHeight === 'number' ? innerHeight : 0;
    return r.width > 0 && r.height > 0 && r.bottom > 0 && (!vh || r.top < vh) ? r : null;
  }

  // The picture's layout centre: its drawn centre less the pan and lift its transform wears.
  layoutCentre(img) {
    const r = img.getBoundingClientRect();
    const x = parseFloat(img.style.getPropertyValue('--zoom-x')) || 0;
    const y = parseFloat(img.style.getPropertyValue('--zoom-y')) || 0;
    return { x: r.left + r.width / 2 - x, y: r.top + r.height / 2 - y };
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
    const area = this.area();
    return { width: img ? img.offsetWidth : 0, height: img ? img.offsetHeight : 0, stageWidth: area.width, stageHeight: area.height, anchor: 'center' };
  }

  // The stage's content box on screen: the room inside its safe-area padding, where the picture is laid out and
  // where the rules' centre is, so a point and the top lift are measured from the same place the picture sits.
  area() {
    const stage = this.stage();
    if (!stage) return { left: 0, top: 0, width: 0, height: 0 };
    const r = stage.getBoundingClientRect();
    const cs = getComputedStyle(stage);
    const px = (v) => parseFloat(v) || 0;
    const left = r.left + px(cs.paddingLeft);
    const top = r.top + px(cs.paddingTop);
    return { left, top, width: Math.max(0, r.width - px(cs.paddingLeft) - px(cs.paddingRight)), height: Math.max(0, r.height - px(cs.paddingTop) - px(cs.paddingBottom)) };
  }

  max() {
    const img = this.picture();
    return zoomMax(img && img.offsetWidth ? img.naturalWidth / img.offsetWidth : 1);
  }

  // A point on the screen, measured from the centre of the stage's content box, which is where the rules measure from.
  point(e) {
    const r = this.area();
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
    this.motion = '';
    this.playing = false;
    this.motionFailed = false;
    if (!list.length) return;
    const at = Math.max(0, Math.min(list.length - 1, Number(i) || 0));
    this.index = at;
    const item = list[at];
    this.kind = item.kind || 'image';
    this.alt = item.alt || item.name || '';
    this.src = item.src || this.urls.get(item.id) || '';
    this.closeDocument();
    this.docState = this.isDocument(item) ? 'loading' : '';
    await this.updateComplete;
    if (this.isDocument(item)) {
      this.growDocument();
      if (this.client) this.loadDocument(item);
      return;
    }
    if (!this.src && (item.attachmentId || item.linkUrl) && this.client) this.load(item);
  }

  // Whether an item, or the one on screen, is a document rather than a picture or a video.
  isDocument(item = this.items[this.index]) {
    return isDocumentItem(item);
  }

  // A document grows out of the file it was opened from, as a picture grows out of its preview (issue 316).
  growDocument() {
    if (this.grown) return;
    this.grown = true;
    const el = this.querySelector('.viewer-doc, .viewer-note');
    const from = this.returnRect();
    if (el && from) growFrom(el, from, { origin: null });
  }

  // A document's bytes, read once: a PDF is opened by pdf.js and laid out page by page, text is decoded, and audio is
  // handed to the player. A document the viewer cannot read says so, and Open in still offers it to another app.
  async loadDocument(item) {
    const current = () => this.items[this.index] && this.items[this.index].id === item.id;
    try {
      const blob = await this.client.attachment(item.attachmentId);
      if (!current()) return;
      if (item.kind === 'text') {
        this.docText = await blob.text();
      } else if (item.kind === 'audio') {
        const url = URL.createObjectURL(blob);
        this.urls.set(item.id, url);
        this.src = url;
      } else {
        const doc = await openPdf(new Uint8Array(await blob.arrayBuffer()));
        if (!current()) { doc.destroy(); return; }
        this.pdf = doc;
        await this.layoutPages(doc);
      }
      if (current()) this.docState = 'ready';
    } catch {
      if (current()) this.docState = 'failed';
    }
  }

  // Every page gets its box at once, sized from its own page, so the scroll bar is the document's whole length from
  // the start; a page's bitmap is drawn only as it comes near the view.
  async layoutPages(doc) {
    const sizes = [];
    for (let n = 1; n <= doc.numPages; n += 1) sizes.push(await pageSize(doc, n));
    if (this.pdf !== doc) return;
    this.pageSizes = sizes;
    this.docPages = sizes.length;
    await this.updateComplete;
    const view = this.querySelector('.viewer-pages');
    if (!view) return;
    view.replaceChildren(...sizes.map((_, i) => {
      const box = document.createElement('div');
      box.className = 'viewer-page';
      box.dataset.key = String(i + 1);
      box.setAttribute('role', 'img');
      box.setAttribute('aria-label', 'Page ' + (i + 1) + ' of ' + sizes.length);
      return box;
    }));
    this.sizePages();
    this.watchPages(view);
  }

  // The room across the view, inside its padding, which a page fits at a zoom of 1.
  docRoom() {
    const view = this.querySelector('.viewer-pages');
    if (!view) return 0;
    const cs = getComputedStyle(view);
    return Math.max(0, view.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0));
  }

  // Lays every page box out at the zoom in force: one fit for the whole document, from its widest page, so pages of
  // one size line up and a zoom moves them all together.
  sizePages() {
    const view = this.querySelector('.viewer-pages');
    const sizes = this.pageSizes || [];
    if (!view || !sizes.length) return;
    const widest = Math.max(...sizes.map((s) => s.width));
    const scale = pageFit(widest, this.docRoom()) * this.docScale;
    const ratio = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    for (const box of view.querySelectorAll('.viewer-page')) {
      const s = sizes[Number(box.dataset.key) - 1];
      if (!s) continue;
      const size = pageCanvas(s.width, s.height, scale, ratio);
      box.size = size;
      box.style.setProperty('--page-w', size.cssWidth + 'px');
      box.style.setProperty('--page-h', size.cssHeight + 'px');
    }
  }

  // Draws the pages as they come within a screen of the view and lets a page's bitmap go once it is well away.
  watchPages(view) {
    this.pageWatch?.disconnect();
    if (typeof IntersectionObserver !== 'function') {
      for (const box of view.querySelectorAll('.viewer-page')) this.drawBox(box);
      return;
    }
    this.pageWatch = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) this.drawBox(e.target);
        else this.freeBox(e.target);
      }
    }, { root: view, rootMargin: '100% 0px' });
    for (const box of view.querySelectorAll('.viewer-page')) this.pageWatch.observe(box);
  }

  // A page is drawn into a fresh canvas that replaces the old one only once it is done, so a page being redrawn at a
  // new zoom keeps showing its last drawing, scaled, rather than going blank.
  drawBox(box) {
    const size = box.size;
    const doc = this.pdf;
    if (!size || !doc) return;
    const key = size.width + 'x' + size.height;
    if (box.drawn === key || box.drawing === key) return;
    box.draw?.cancel();
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const draw = drawPage(doc, Number(box.dataset.key), canvas);
    box.draw = draw;
    box.drawing = key;
    box.near = true;
    draw.done.then((ok) => {
      if (!ok || box.draw !== draw || !box.near) return;
      box.replaceChildren(canvas);
      box.drawn = key;
      box.dataset.drawn = 'true';
    }).catch(() => {
      if (box.draw === draw) box.dataset.drawn = 'failed';
    }).finally(() => {
      if (box.draw === draw) { box.draw = null; box.drawing = null; }
    });
  }

  freeBox(box) {
    box.near = false;
    box.draw?.cancel();
    box.draw = null;
    box.drawing = null;
    box.drawn = null;
    delete box.dataset.drawn;
    box.replaceChildren();
  }

  // The pages near the view, drawn again at the size the zoom gave them.
  redrawPages() {
    clearTimeout(this.redrawTimer);
    this.redrawTimer = setTimeout(() => {
      for (const box of this.querySelectorAll('.viewer-page')) if (box.near) this.drawBox(box);
    }, REDRAW_MS);
  }

  // Zooms a PDF by a factor, clamped to its bounds, keeping the middle of the view where it was across the width; the
  // scrolled place down the document is kept by the page at the top, as across any resize.
  zoomDoc(factor) {
    if (this.kind !== 'pdf' || !this.pageSizes) return;
    const before = this.docScale;
    const next = docZoom(before, factor);
    if (next === before) return;
    const view = this.querySelector('.viewer-pages');
    const mid = view ? view.scrollLeft + view.clientWidth / 2 : 0;
    this.docScale = next;
    this.sizePages();
    if (view) view.scrollLeft = Math.max(0, mid * (next / before) - view.clientWidth / 2);
    this.redrawPages();
  }

  // Safari's own pinch, which on an iPhone is the pinch: on a PDF it zooms the pages; anywhere else it is refused, so
  // the page under the viewer never zooms.
  gestureZoom(e) {
    e.preventDefault();
    if (this.kind !== 'pdf' || !this.isDocument()) return;
    if (e.type === 'gesturestart') { this.gestureFrom = this.docScale; return; }
    if (Number.isFinite(e.scale) && this.gestureFrom) this.zoomDoc(docZoom(this.gestureFrom, e.scale) / this.docScale);
  }

  closeDocument() {
    clearTimeout(this.redrawTimer);
    this.pageWatch?.disconnect();
    this.pageWatch = null;
    this.pageSizes = null;
    this.docText = '';
    this.docPages = 0;
    this.docScale = 1;
    if (this.pdf) {
      const doc = this.pdf;
      this.pdf = null;
      doc.destroy();
    }
  }

  // The file on screen, as the attachment it is, for Open in and Save.
  documentFile() {
    const item = this.items[this.index];
    return item ? { id: item.attachmentId, name: item.name || this.alt, mime: item.mime } : null;
  }

  openIn() {
    const file = this.documentFile();
    return file ? openAttachment(file, { client: this.client }) : false;
  }

  saveFile() {
    const file = this.documentFile();
    return file ? saveAttachment(file, { client: this.client }) : false;
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

  // A Live Photo's play control: the motion plays once over the still, muted and inline, and the still is back when it
  // ends or the control is pressed again. The motion is the attachment's live part, which the server serves as an MP4
  // every platform can play; it is fetched on the first press only, and kept for the viewer's life like any other item.
  async playMotion() {
    const item = this.items[this.index];
    if (!item || !item.live) return;
    if (this.playing) { this.playing = false; return; }
    const key = item.id + ':live';
    if (!this.urls.has(key)) {
      try {
        const blob = await this.client.attachment(item.attachmentId, { part: 'live' });
        this.urls.set(key, URL.createObjectURL(blob));
      } catch {
        if (this.items[this.index] === item) this.motionFailed = true;
        return;
      }
    }
    if (this.items[this.index] !== item) return;
    this.motion = this.urls.get(key);
    this.motionFailed = false;
    this.playing = true;
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
      // The close control is the dialog's one stop; the page behind it is out of reach while the viewer is open. A
      // document adds its own: the pages or text, its player, and the bar's controls, Open in and Save among them.
      e.preventDefault();
      if (this.isDocument()) {
        const stops = [...this.querySelectorAll('.viewer button:not(:disabled), .viewer-doc, .viewer audio')];
        const at = stops.indexOf(document.activeElement);
        stops[(at + (e.shiftKey ? -1 : 1) + stops.length) % stops.length]?.focus();
        return;
      }
      this.querySelector('.close-button')?.focus();
      return;
    }
    if (this.isDocument()) {
      this.documentKey(e);
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

  // A document's keys: Escape closes, + and - and 0 zoom a PDF, and the arrows scroll it. A key meant for the player
  // (an arrow seeking the recording) is the player's.
  documentKey(e) {
    const action = zoomKey(e.key);
    if (!action || e.metaKey || e.ctrlKey || e.altKey) return;
    if (action.kind !== 'close' && e.target && e.target.closest && e.target.closest('audio')) return;
    if (action.kind !== 'close' && action.kind !== 'pan' && this.kind !== 'pdf') return;
    e.preventDefault();
    e.stopPropagation();
    if (action.kind === 'close') this.close();
    else if (action.kind === 'reset') this.zoomDoc(1 / this.docScale);
    else if (action.kind === 'zoom') this.zoomDoc(action.factor > 1 ? DOC_ZOOM_STEP : 1 / DOC_ZOOM_STEP);
    else this.querySelector('.viewer-doc')?.scrollBy({ left: -action.dx, top: -action.dy });
  }

  // A document scrolls under the finger and the wheel natively; the viewer takes only two fingers, which pinch a PDF's
  // zoom, and a press that starts and ends on the backdrop, which closes it.
  documentDown(e) {
    if (e.target.closest && e.target.closest('button, audio, .viewer-bar')) return;
    if (e.pointerType === 'touch') {
      this.docPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.docPointers.size === 2) {
        const [a, b] = [...this.docPointers.values()];
        this.docPinch = { from: this.docScale, dist: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
      }
    }
    this.docPress = { onBackdrop: e.target === e.currentTarget, x: e.clientX, y: e.clientY };
  }

  documentMove(e) {
    if (!this.docPointers.has(e.pointerId)) return;
    this.docPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!this.docPinch || this.docPointers.size < 2) return;
    const [a, b] = [...this.docPointers.values()];
    this.zoomDoc(docZoom(this.docPinch.from, Math.hypot(a.x - b.x, a.y - b.y) / this.docPinch.dist) / this.docScale);
  }

  documentUp(e) {
    this.docPointers.delete(e.pointerId);
    if (this.docPointers.size < 2) this.docPinch = null;
    const p = this.docPress;
    this.docPress = null;
    if (!p || e.type !== 'pointerup' || !isClick({ x: p.x, y: p.y }, { x: e.clientX, y: e.clientY })) return;
    if (pressOutside(p.onBackdrop, document.elementFromPoint(e.clientX, e.clientY) === this.stage())) this.close();
  }

  onDown = (e) => {
    if (this.isDocument()) {
      e.stopPropagation();
      this.documentDown(e);
      return;
    }
    // The page's own drag (the phone's drawer, from the left edge) must not start under the viewer. A press on any of
    // the viewer's controls or a video's own controls is theirs, not a pan's: the stage captures the pointer for a pan,
    // and a captured pointer's click lands on the stage, so a control it captured never heard its own press (the Live
    // Photo play control did nothing, issue 325).
    e.stopPropagation();
    if (e.target.closest && e.target.closest('button, video, .viewer-bar')) return;
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
    if (this.isDocument()) { this.documentMove(e); return; }
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
    if (this.isDocument()) { this.documentUp(e); return; }
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
    if (this.isDocument()) { this.documentUp(e); return; }
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
    // A document scrolls under the wheel; a ctrl or trackpad pinch wheel zooms a PDF, and is never the page's zoom.
    if (this.isDocument()) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      if (this.kind === 'pdf') this.zoomDoc(wheelFactor(e.deltaY, e.deltaMode, e.ctrlKey));
      return;
    }
    e.preventDefault();
    this.zoom(wheelFactor(e.deltaY, e.deltaMode, e.ctrlKey), this.point(e));
  };

  // The fitted size is known only once the picture has loaded; start from fit against it.
  onLoad = async () => {
    this.view = zoomFit();
    // The first picture grows out of the preview it was opened from, once it is laid out at fit.
    if (this.grown) return;
    this.grown = true;
    await this.updateComplete;
    const img = this.picture();
    const from = this.returnRect();
    if (!img || !from) return;
    // The picture's first place (fit, lifted to the top) is drawn at once rather than through the zoom transition, so
    // the grow is measured against where the picture ends, not a frame of it sliding there.
    img.style.transition = 'none';
    this.updated();
    img.getBoundingClientRect();
    growFrom(img, from, { origin: this.layoutCentre(img) }).then(() => { img.style.transition = ''; });
  };

  // A document's surface: the pages, the text, or the player, and what the viewer says while it reads the file or when
  // it cannot show it.
  documentView(name) {
    if (this.docState === 'failed') {
      return html`<div class="viewer-note" data-doc=${this.kind}><span class="icon" data-icon="file-text" aria-hidden="true"></span><p class="viewer-note-name">${name}</p><p class="viewer-note-detail">This file could not be shown here. Open in shows it in another app.</p></div>`;
    }
    if (this.kind === 'pdf') {
      return html`<div class="viewer-doc viewer-pages" data-doc="pdf" tabindex="0" aria-label=${name} aria-busy=${this.docState === 'ready' ? 'false' : 'true'}></div>`;
    }
    if (this.kind === 'text') {
      return html`<div class="viewer-doc" data-doc="text" tabindex="0" aria-label=${name} aria-busy=${this.docState === 'ready' ? 'false' : 'true'}><pre class="viewer-text">${this.docText}</pre></div>`;
    }
    return html`<div class="viewer-note" data-doc="audio"><span class="icon" data-icon="play" aria-hidden="true"></span><p class="viewer-note-name">${name}</p>${this.src ? html`<audio class="viewer-audio" src=${this.src} controls preload="metadata" aria-label=${name}></audio>` : nothing}</div>`;
  }

  // A document's bar: a PDF's page count and zoom, then Open in and Save, each labelled, so a file the viewer shows can
  // still be opened in another app or kept.
  documentBar(name) {
    const pdf = this.kind === 'pdf' && this.docState === 'ready';
    const pages = pdf ? html`<span class="viewer-count">${this.docPages === 1 ? '1 page' : this.docPages + ' pages'}</span>` : nothing;
    const zoom = pdf ? html`<button type="button" class="viewer-control viewer-zoom-out" aria-label="Zoom out" title="Zoom out" ?disabled=${this.docScale <= DOC_ZOOM_MIN} @click=${press(() => this.zoomDoc(1 / DOC_ZOOM_STEP))}><span class="icon" data-icon="minus" aria-hidden="true"></span></button><span class="viewer-zoom" aria-live="polite">${Math.round(this.docScale * 100)}%</span><button type="button" class="viewer-control viewer-zoom-in" aria-label="Zoom in" title="Zoom in" ?disabled=${this.docScale >= DOC_ZOOM_MAX} @click=${press(() => this.zoomDoc(DOC_ZOOM_STEP))}><span class="icon" data-icon="plus" aria-hidden="true"></span></button>` : nothing;
    const openLabel = 'Open ' + name + ' in another app';
    return html`${pages}${zoom}<button type="button" class="viewer-control viewer-action viewer-open" aria-label=${openLabel} title=${openLabel} @click=${press(() => this.openIn())}><span class="icon" data-icon="external-link" aria-hidden="true"></span><span class="viewer-action-label">Open in</span></button><button type="button" class="viewer-control viewer-action viewer-save" aria-label=${'Save ' + name} title=${'Save ' + name} @click=${press(() => this.saveFile())}><span class="icon" data-icon="download" aria-hidden="true"></span><span class="viewer-action-label">Save</span></button>`;
  }

  render() {
    const list = Array.isArray(this.items) ? this.items : [];
    const at = Math.max(0, Math.min(list.length ? list.length - 1 : 0, Number(this.index) || 0));
    if (isDocumentItem(list[at])) {
      const name = list[at].name || this.alt || 'Document';
      return html`<div class="sheet-scrim viewer" data-dismiss="viewer" role="dialog" aria-modal="true" aria-label=${name}
          data-index=${at} data-count=${list.length} data-kind=${this.kind} data-doc-state=${this.docState} data-scale=${String(this.docScale)}
          @pointerdown=${this.onDown} @pointermove=${this.onMove} @pointerup=${this.onUp} @pointercancel=${this.onCancel}
          @contextmenu=${this.onContext} @wheel=${this.onWheel}>
        ${this.documentView(name)}
        ${closeButtonHtml({ owner: 'viewer', label: 'Close', size: 'lg', onClose: () => this.close() })}
        <div class="viewer-bar" role="toolbar" aria-label="Document controls">${this.documentBar(name)}</div>
      </div>`;
    }
    const label = this.alt || (this.kind === 'video' ? 'Video' : 'Image');
    const hasNav = list.length > 1;
    const live = Boolean(list[at] && list[at].live) && this.kind === 'image';
    const media = this.kind === 'video'
      ? html`<video class="viewer-image" src=${this.src} aria-label=${label} controls autoplay muted playsinline @loadeddata=${this.onLoad}></video>`
      : live && this.playing && this.motion
        ? html`<video class="viewer-image viewer-motion" src=${this.motion} aria-label=${label} autoplay muted playsinline @ended=${() => { this.playing = false; }}></video>`
        : html`<img class="viewer-image" src=${this.src} alt=${label} draggable="false" @load=${this.onLoad}>`;
    const playLabel = this.motionFailed ? 'The motion could not be loaded' : this.playing ? 'Show the photo' : 'Play the Live Photo';
    // The controls are one family (issue 325): the step controls either side, the close control in its corner, and one
    // bar centred at the foot holding the Live Photo's play control, where the item sits in the conversation's media
    // and the zoom. The play control is the bar's widest, labelled, so it is not missed.
    const play = live ? html`<button type="button" class="viewer-control viewer-play" aria-label=${playLabel} title=${playLabel} aria-pressed=${this.playing ? 'true' : 'false'} ?disabled=${this.motionFailed} @click=${press(() => this.playMotion())}><span class="icon" data-icon="play" aria-hidden="true"></span><span class="viewer-play-label">Live</span></button>` : nothing;
    const count = hasNav ? html`<span class="viewer-count">${at + 1} of ${list.length}</span>` : nothing;
    return html`<div class="sheet-scrim viewer" data-dismiss="viewer" role="dialog" aria-modal="true" aria-label=${label}
        data-scale=${String(this.view.scale)} data-zoomed=${this.view.scale > 1.001 ? 'true' : 'false'} data-gesture=${this.moving ? 'on' : 'off'}
        data-index=${at} data-count=${list.length} data-kind=${this.kind}
        @pointerdown=${this.onDown} @pointermove=${this.onMove} @pointerup=${this.onUp} @pointercancel=${this.onCancel}
        @contextmenu=${this.onContext} @wheel=${this.onWheel}>
      ${media}
      ${hasNav ? html`<button type="button" class="viewer-nav viewer-prev" aria-label="Previous item" title="Previous item" ?disabled=${at <= 0} @click=${press(() => this.go('prev'))}><span class="icon" data-icon="chevron-left" aria-hidden="true"></span></button>` : nothing}
      ${hasNav ? html`<button type="button" class="viewer-nav viewer-next" aria-label="Next item" title="Next item" ?disabled=${at >= list.length - 1} @click=${press(() => this.go('next'))}><span class="icon" data-icon="chevron-right" aria-hidden="true"></span></button>` : nothing}
      ${closeButtonHtml({ owner: 'viewer', label: 'Close', size: 'lg', onClose: () => this.close() })}
      <div class="viewer-bar" role="toolbar" aria-label="Media controls">${play}${count}<span class="viewer-zoom" aria-live="polite">${Math.round(this.view.scale * 100)}%</span></div>
    </div>`;
  }
}

customElements.define('app-image-viewer', AppImageViewer);
