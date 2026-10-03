// Keeps a scrolled view where it was across a re-render and a resize (issue 142): resizing the window, rotating a
// phone, opening the sidebar or a sheet, a new text size, new items above or below, a picture that loads. Every
// scrolled view in the app holds one of these; core/test/guards.test.js fails on a scroll container that does not.
//
// It is a Lit reactive controller. It reads the view's place (rules/scroll.js) before every render and on every
// scroll, and puts the view back after every render and whenever the view or anything in it changes size.
//
//   this.keep = keepScroll(this, { scroller: '.messages', follow: true });
//
// scroller is a selector inside the host (or the host's own tag, for a host that is itself the scroller). items picks
// the elements a place holds on to, and key names one (its data-id, data-chat or data-key, else its position). A view
// that follows its newest item passes follow, and starts at its end.
import { anchorFrom, scrollFor } from './rules/scroll.js';

const keyOf = (el, i) => el.dataset.id ?? el.dataset.chat ?? el.dataset.key ?? String(i);

export class KeepScroll {
  constructor(host, { scroller, items = ':scope > *', key = keyOf, follow = false } = {}) {
    this.host = host;
    this.selector = scroller;
    this.itemsSelector = items;
    this.key = key;
    this.follow = follow;
    this.anchor = follow ? { end: true } : null;
    this.el = null;
    // Set by reset(): the next render starts at the new place rather than recording the old view's.
    this.pinned = false;
    this.onScroll = () => this.record();
    this.resized = null;
    this.added = null;
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

  // Before a render: where the view is now, while the old layout still stands.
  hostUpdate() {
    if (!this.pinned && this.el && this.el.isConnected) this.record();
  }

  // After a render: the view may be a new element, and its items may have moved.
  hostUpdated() {
    this.attach();
    this.restore();
    this.pinned = false;
  }

  // A different subject (another conversation): start again at the end, or the top.
  reset() {
    this.anchor = this.follow ? { end: true } : { top: 0 };
    this.pinned = true;
  }

  attach() {
    const el = this.view();
    if (el === this.el) return;
    this.detach();
    this.el = el;
    if (!el) return;
    el.addEventListener('scroll', this.onScroll, { passive: true });
    if (this.added) this.added.observe(el, { childList: true });
    this.observeItems();
  }

  detach() {
    if (!this.el) return;
    this.el.removeEventListener('scroll', this.onScroll);
    if (this.resized) this.resized.disconnect();
    if (this.added) this.added.disconnect();
    this.el = null;
  }

  // The view and each of its direct children: a child that grows (a picture loading, a longer preview, a new text
  // size) changes what sits above the anchor without the view itself changing size.
  observeItems() {
    if (!this.resized || !this.el) return;
    this.resized.observe(this.el);
    for (const child of this.el.children) this.resized.observe(child);
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

  record() {
    if (!this.el) return;
    this.anchor = anchorFrom({ ...this.measure(), follow: this.follow });
  }

  restore() {
    if (!this.el || !this.el.isConnected || !this.anchor) return;
    const next = scrollFor(this.anchor, this.measure());
    if (Math.abs(next - this.el.scrollTop) >= 1) this.el.scrollTop = next;
  }
}

export function keepScroll(host, options) {
  return new KeepScroll(host, options);
}
