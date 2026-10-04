import { html } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { dismissable } from '../../kit/dismiss.js';
import { closeButtonHtml } from './close-button.js';
import { pressOutside } from '../../kit/rules/dismiss.js';
import { ZOOM_STEP, zoomFit, zoomMax, zoomBy, panBy, toggleZoom, pinch, wheelFactor, isClick, isDoubleTap, zoomKey } from '../rules/zoom.js';

// The image viewer: one picture, large, over the app. It draws on the settings sheet's own backdrop (the same
// .sheet-scrim, so the blur and the dim are one treatment, not a second), and it closes the three ways the sheet does:
// Escape, its close control, and a press that both starts and ends on the backdrop. It is registered with the kit's one
// dismiss behaviour (core/kit/dismiss.js) as a panel that owns the whole surface: the kit closes it on Escape, in its
// place among any other open panels, and leaves every press to the gestures below, which apply the kit's own rule for
// a press outside (core/kit/rules/dismiss.js) to the backdrop.
//
// Every number it draws comes from rules/zoom.js. This only measures the picture and the stage, turns pointer, wheel
// and key events into calls on those rules, and paints the view they answer:
// - a mouse: left click zooms in at the point clicked, right click zooms out there with no context menu, the wheel or
//   a trackpad pinch zooms about the pointer, and a drag pans once zoomed;
// - a finger: two fingers pinch, one drags once zoomed, a double tap toggles between fit and a closer look;
// - the keyboard: + and - zoom, 0 resets, the arrows pan, Escape closes.
// The view is painted through custom properties set with setProperty, never a style attribute written as text, which
// the page's content security policy would refuse.
class AppImageViewer extends KitElement {
  static properties = { src: {}, alt: {}, view: { state: true }, moving: { state: true } };

  constructor() {
    super();
    this.src = '';
    this.alt = '';
    this.view = zoomFit();
    this.moving = false;
    this.pointers = new Map();
    this.gesture = null;
    this.lastTap = null;
    this.opener = null;
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
    // Focus goes back to the preview that opened the viewer, so a keyboard reader is where they were.
    if (this.opener && this.opener.isConnected && typeof this.opener.focus === 'function') this.opener.focus();
  }

  firstUpdated() {
    this.querySelector('.close-button')?.focus();
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

  key(e) {
    if (e.key === 'Tab') {
      // The close control is the dialog's one stop; the page behind it is out of reach while the viewer is open.
      e.preventDefault();
      this.querySelector('.close-button')?.focus();
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
    // The page's own drag (the phone's drawer, from the left edge) must not start under the viewer.
    e.stopPropagation();
    if (e.target.closest && e.target.closest('.close-button')) return;
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
    const label = this.alt || 'Image';
    return html`<div class="sheet-scrim viewer" data-dismiss="viewer" role="dialog" aria-modal="true" aria-label=${label}
        data-scale=${String(this.view.scale)} data-zoomed=${this.view.scale > 1.001 ? 'true' : 'false'} data-gesture=${this.moving ? 'on' : 'off'}
        @pointerdown=${this.onDown} @pointermove=${this.onMove} @pointerup=${this.onUp} @pointercancel=${this.onCancel}
        @contextmenu=${this.onContext} @wheel=${this.onWheel}>
      <img class="viewer-image" src=${this.src} alt=${label} draggable="false" @load=${this.onLoad}>
      ${closeButtonHtml({ owner: 'viewer', label: 'Close', size: 'lg', onClose: () => this.close() })}
      <p class="viewer-zoom" aria-live="polite">${Math.round(this.view.scale * 100)}%</p>
    </div>`;
  }
}

customElements.define('app-image-viewer', AppImageViewer);
