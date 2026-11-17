// Keeps a scrolled view where it was across a re-render and a resize (issue 142): resizing the window, rotating a
// phone, opening the sidebar or a sheet, a new text size, new items above or below, a picture that loads. Every
// scrolled view in the app holds one of these; core/test/guards.test.js fails on a scroll container that does not.
//
// It is a Lit reactive controller. The view's place (rules/scroll.js) is what the person last scrolled to: it is read on
// a scroll, and only on a scroll that moved the view away from that place, so the browser clamping a view that grew
// shorter, or this controller putting it back, never moves the place itself. The view is put back after every render
// and whenever the view or anything in it changes size. A render never reads the place: by then a new text size or a
// new width may already have moved everything, and reading it there is how a place gets lost.
//
//   this.keep = keepScroll(this, { scroller: '.messages', follow: true });
//
// scroller is a selector inside the host (or the host's own tag, for a host that is itself the scroller). items picks
// the elements a place holds on to, and key names one (its data-id, data-chat or data-key, else its position). A view
// that follows its newest item passes follow, and starts at its end.
import { anchorFrom, scrollFor, revealDelta } from './rules/scroll.js';

const keyOf = (el, i) => el.dataset.id ?? el.dataset.chat ?? el.dataset.key ?? String(i);

// The person's own ways of moving a view, and how long after one a scroll is still theirs (a fling keeps scrolling).
const INPUTS = ['wheel', 'touchstart', 'touchmove', 'keydown', 'pointerdown'];
const PERSON_MS = 1500;

// The view's width. A scroll event that arrives while it differs from the width the view was last put back at is the
// browser's (a turn rewrapping every item, carrying or clamping the old scrollTop), never the person's. Only the width:
// a view that only grew or shrank in height (the composer growing under it) still takes a scroll the person or the page
// makes in that moment, such as going to the end as the composer empties.
const shapeOf = (el) => String(el.clientWidth);

export class KeepScroll {
  constructor(host, { scroller, items = ':scope > *', key = keyOf, follow = false } = {}) {
    this.host = host;
    this.selector = scroller;
    this.itemsSelector = items;
    this.key = key;
    this.follow = follow;
    this.anchor = follow ? { end: true } : null;
    this.el = null;
    this.onScroll = () => this.record();
    this.resized = null;
    this.added = null;
    this.observed = new Set();
    this.shape = null;
    // The scrollTop this controller last wrote, so the scroll event that write raises is never read as the person's.
    this.written = null;
    // The scrollTop this controller last heard or wrote, and the place it held then. A view that has moved since has a
    // scroll event still on its way, which restore() hears first (see there). A place set from outside (another
    // conversation's, a message brought into view) is not the one that position was heard with, so it is never moved by it.
    this.known = null;
    this.heardAnchor = null;
    // When the person last touched the view: a wheel, a touch, a key or a press on it (its scrollbar included). A view
    // that follows its newest item leaves its end only for the person, never for a layout that moved under it.
    this.touched = 0;
    this.onInput = () => { this.touched = Date.now(); };
    host.addController(this);
  }

  view() {
    const host = this.host;
    if (!this.selector) return null;
    if (typeof host.matches === 'function' && host.matches(this.selector)) return host;
    return host.querySelector(this.selector);
  }

  hostConnected() {
    if (typeof ResizeObserver === 'function') this.resized = new ResizeObserver(() => this.restore());
    if (typeof MutationObserver === 'function') this.added = new MutationObserver(() => this.observeItems());
  }

  hostDisconnected() {
    this.detach();
    if (this.resized) this.resized.disconnect();
    if (this.added) this.added.disconnect();
    this.resized = null;
    this.added = null;
  }

  // After a render: the view may be a new element, and its items may have moved.
  hostUpdated() {
    this.attach();
    this.restore();
  }

  // A different subject (another conversation): start again at the end, or the top.
  reset() {
    this.anchor = this.follow ? { end: true } : { top: 0 };
  }

  attach() {
    const el = this.view();
    if (el === this.el) return;
    this.detach();
    this.el = el;
    if (!el) return;
    el.addEventListener('scroll', this.onScroll, { passive: true });
    for (const type of INPUTS) el.addEventListener(type, this.onInput, { passive: true });
    // The browser's own scroll anchoring would move the view on a layout change by its own choice of anchor, before
    // this one is asked; with it off, the only mover is this controller (CSSOM, which the page's CSP allows).
    el.style.overflowAnchor = 'none';
    if (this.added) this.added.observe(el, { childList: true });
    this.observeItems();
  }

  detach() {
    this.known = null;
    if (!this.el) return;
    this.el.removeEventListener('scroll', this.onScroll);
    for (const type of INPUTS) this.el.removeEventListener(type, this.onInput);
    if (this.resized) this.resized.disconnect();
    this.observed.clear();
    if (this.added) this.added.disconnect();
    this.el = null;
  }

  // The view and each of its direct children: a child that grows (a picture loading, a longer preview, a new text
  // size) changes what sits above the anchor without the view itself changing size.
  observeItems() {
    if (!this.resized || !this.el) return;
    const current = new Set([this.el, ...this.el.children]);
    for (const node of this.observed) if (!current.has(node)) this.resized.unobserve(node);
    for (const node of current) if (!this.observed.has(node)) this.resized.observe(node);
    this.observed = current;
  }

  measure() {
    const el = this.el;
    const top = el.getBoundingClientRect().top;
    const items = [...el.querySelectorAll(this.itemsSelector)].map((item, i) => {
      const r = item.getBoundingClientRect();
      return { key: this.key(item, i), top: r.top - top, bottom: r.bottom - top };
    });
    return { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, items };
  }

  // A scroll that left the view where its place says it should be (this controller's own restore, or the browser
  // clamping a view that cannot reach it) keeps the place; any other is the person scrolling, and becomes the place.
  // A scroll that arrives after the view changed width, before this controller has put the view back for that change,
  // is the layout moving under the view (a phone turning, a rewrap; issue 211): the place stays, and the resize that
  // follows puts the view back. Read as the person's, it re-anchors a conversation to whatever item the half-turned
  // layout has at its top, so a turn can end many messages away from where it started.
  //
  // A scroll that leaves the view exactly where this controller last put it is this controller's own, whatever has
  // changed since: the browser delivers the scroll event a moment after restore() moves the view, and a picture that
  // landed in that moment has already grown the conversation, so read then, the view no longer sits on its place and
  // the scroll was taken for the person's. That is how a conversation at its newest message came to rest a screen or
  // more above it: the end was traded for whatever message happened to be at the top. The person scrolling always
  // moves the view off the value written here.
  //
  // The person's scroll moves the place by exactly how far the view scrolled since it was last heard. Anything else that
  // changed in that moment is layout: a picture above the place that grew as it loaded, in the frame between the scroll
  // and its event, would otherwise be read as part of the scroll, and what the person sees would jump by its height. So
  // the place is moved by the scroll alone, the view is put where that place says, and only then is the place said
  // again from the item now at the top.
  record() {
    if (!this.el) return;
    const previous = this.anchor === this.heardAnchor ? this.known : null;
    this.known = this.el.scrollTop;
    this.heardAnchor = this.anchor;
    if (this.shape !== null && shapeOf(this.el) !== this.shape) return;
    if (this.written !== null && Math.abs(this.el.scrollTop - this.written) < 1) return;
    // A view at its end stays there until the person moves it. The browser clamps a view whose content shrank (a row
    // handed a picture still on its way), and by the time that scroll is heard a picture may already have grown the
    // conversation again, so the view reads as a screen above its end with nobody having scrolled. Without the person's
    // own input just before, that is layout: the end is kept and the view is put back on it.
    if (this.anchor && this.anchor.end && Date.now() - this.touched > PERSON_MS) {
      this.restore();
      return;
    }
    this.written = null;
    const now = this.measure();
    if (this.anchor && Math.abs(scrollFor(this.anchor, now) - now.scrollTop) < 1) return;
    const anchor = this.anchor;
    if (anchor && anchor.key != null && previous !== null && now.items.some((it) => String(it.key) === anchor.key)) {
      const next = scrollFor({ key: anchor.key, offset: anchor.offset - (now.scrollTop - previous) }, now);
      if (Math.abs(next - now.scrollTop) >= 1) {
        this.el.scrollTop = next;
        this.written = this.el.scrollTop;
        this.known = this.written;
      }
      this.anchor = anchorFrom({ ...this.measure(), follow: this.follow });
      this.heardAnchor = this.anchor;
      return;
    }
    this.anchor = anchorFrom({ ...now, follow: this.follow });
    this.heardAnchor = this.anchor;
  }

  // A view the person moved since this controller last heard it has a scroll event still on its way: the browser delivers
  // it at the next frame, and a resize (a picture growing as it loads) can be handled before it. Putting the view back
  // to the place it had then would undo the person's scroll, so their move is heard first, as that event would have
  // been. Only the person's: a move with no input of theirs just before, or one that left the view clamped at its end
  // because what it holds grew shorter, is layout, and the place stays.
  restore() {
    if (!this.el || !this.el.isConnected || !this.anchor) return;
    const el = this.el;
    const moved = this.known !== null && this.anchor === this.heardAnchor && Math.abs(el.scrollTop - this.known) >= 1;
    if (moved && Date.now() - this.touched <= PERSON_MS && el.scrollTop < el.scrollHeight - el.clientHeight - 1) this.record();
    if (!this.anchor) return;
    const next = scrollFor(this.anchor, this.measure());
    if (Math.abs(next - this.el.scrollTop) >= 1) {
      this.el.scrollTop = next;
      // Where the view actually landed, which a view too short to reach the place clamps.
      this.written = this.el.scrollTop;
    }
    this.known = this.el.scrollTop;
    this.heardAnchor = this.anchor;
    this.shape = shapeOf(this.el);
    this.reveal();
  }

  // A field being typed in is the person's place above any anchor (issue 180): when the view shrinks under it, an
  // on-screen keyboard opening, the view brings the field into sight, and that scroll becomes the place it keeps.
  reveal() {
    const field = typeof document === 'undefined' ? null : document.activeElement;
    if (!field || field === this.el || !this.el.contains(field)) return;
    revealField(field);
  }
}

// Brings a focused field into sight inside every view that scrolls around it (issue 180), measured against what is
// actually visible: each view's own box, cut at the bottom of the visual viewport, which an on-screen keyboard can
// shrink before the layout does or without it. Each view scrolls the least that shows the field.
export function revealField(field) {
  if (!field || typeof field.matches !== 'function' || !field.matches('input, textarea, [contenteditable]')) return;
  const viewport = typeof window === 'undefined' ? null : window.visualViewport;
  const visibleBottom = viewport ? viewport.offsetTop + viewport.height : Infinity;
  for (let el = field.parentElement; el; el = el.parentElement) {
    if (el.scrollHeight <= el.clientHeight + 1) continue;
    const overflow = getComputedStyle(el).overflowY;
    if (overflow !== 'auto' && overflow !== 'scroll') continue;
    const box = el.getBoundingClientRect();
    const delta = revealDelta({ top: box.top, bottom: Math.min(box.bottom, visibleBottom) }, field.getBoundingClientRect());
    if (delta) el.scrollTop += delta;
  }
}

export function keepScroll(host, options) {
  return new KeepScroll(host, options);
}
