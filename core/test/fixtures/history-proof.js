// Synthetic renderer-only acceptance harness. Never imported by a shipped module.
const { document, requestAnimationFrame, performance } = globalThis;
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
// A wait that runs out says what it measured, so a red run on a platform we cannot sit at names its cause.
async function until(check, label, measure) {
  const deadline = performance.now() + 20000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error('Timed out: ' + label + (measure ? ' ' + JSON.stringify(measure()) : ''));
    await frame();
  }
}
const mediaState = (el) => el ? {
  tag: el.tagName, connected: el.isConnected, readyState: el.readyState, networkState: el.networkState,
  error: el.error ? el.error.code + ' ' + el.error.message : null, paused: el.paused, currentTime: el.currentTime,
  videoWidth: el.videoWidth, naturalWidth: el.naturalWidth, complete: el.complete, scheme: String(el.currentSrc || el.src || '').split(':')[0],
} : null;
const root = () => document.querySelector('app-root');
const pane = () => root().querySelector('app-conversation');
const viewer = () => root().querySelector('app-image-viewer');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const settle = async () => { await root().updateComplete; if (pane()) await pane().updateComplete; await frame(); await frame(); };

globalThis.historyProof = {
  async history() {
    await until(() => root()?.phase === 'ready', 'application ready');
    await root().open('1', { show: true });
    await settle();
    const steps = [];
    let maxRows = 0;
    let maxObserved = 0;
    const deadline = performance.now() + 90000;
    while (root().hasMore) {
      assert(performance.now() < deadline, 'scrollback proof deadline');
      await until(() => !root().pendingHistory && !pane().olderPending, 'history request settled');
      const rows = [...pane().querySelectorAll('.messages > .bubble-row')];
      const target = rows[Math.min(25, rows.length - 1)];
      const scroll = pane().querySelector('.messages');
      pane().keep.onInput();
      scroll.scrollTop += target.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
      pane().keep.record();
      const anchor = { ...pane().keep.anchor };
      const moved = await root().loadOlder(pane().historyMeasurements());
      assert(moved, 'older page returned');
      await settle();
      const held = [...pane().querySelectorAll('.messages > .bubble-row')].find((row) => row.dataset.id === anchor.key);
      assert(held, 'anchor retained while adjacent page loads');
      const drift = held.getBoundingClientRect().top - scroll.getBoundingClientRect().top - anchor.offset;
      assert(Math.abs(drift) <= 1, 'scroll anchor drift: ' + drift);
      maxRows = Math.max(maxRows, root().messages.length);
      maxObserved = Math.max(maxObserved, pane().keep.observed.size);
      assert(root().messages.length <= 150, 'resident messages bounded');
      assert(pane().querySelectorAll('.messages > .bubble-row').length <= 150, 'rendered rows bounded');
      assert(pane().keep.observed.size <= scroll.children.length + 1, 'evicted observations released');
      steps.push({ first: root().messages[0].id, last: root().messages.at(-1).id, drift, rows: root().messages.length });
    }
    assert(root().messages[0].id === 'SYNTHETIC-1', 'reached oldest message without timestamp gaps');
    const click = await this.photoTarget();
    return { steps, maxRows, maxObserved, click };
  },
  // The photo the real pointer presses, placed the way the app places a message it brings into view
  // (revealMessage): through the scroll keeper's anchor, never a bare scrollIntoView, because the keeper
  // restores the person's recorded place after every render and would move a bare scroll back before its
  // scroll event is heard. The press point is read only once the photo has held still for several frames
  // and the point hit-tests to the photo itself, so the click never lands on stale coordinates.
  async photoTarget() {
    const scroll = pane().querySelector('.messages');
    const photo = () => [...pane().querySelectorAll('app-attachment img')].find((img) => img.closest('.bubble-row')?.dataset.id);
    await until(() => photo()?.naturalWidth > 0, 'synthetic photo decoded');
    const row = photo().closest('.bubble-row');
    const key = row.dataset.id;
    const place = () => {
      pane().keep.anchor = { key, offset: Math.round(scroll.clientHeight / 3) };
      pane().keep.restore();
    };
    const target = () => [...pane().querySelectorAll('.messages > .bubble-row')].find((r) => r.dataset.id === key)?.querySelector('app-attachment img');
    const centre = () => { const r = target()?.getBoundingClientRect(); return r ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null; };
    const view = () => scroll.getBoundingClientRect();
    const hits = (p) => { const hit = p && document.elementFromPoint(p.x, p.y); return Boolean(hit && target() && (hit === target() || target().closest('app-attachment').contains(hit))); };
    place();
    let last = null;
    let still = 0;
    const deadline = performance.now() + 20000;
    while (still < 8) {
      assert(performance.now() < deadline, 'photo never held still under the pointer');
      await settle();
      if (!target()) { place(); still = 0; last = null; continue; }
      const p = centre();
      const v = view();
      const inside = p && p.y > v.top + 1 && p.y < v.bottom - 1;
      if (!inside) place();
      still = inside && last && last.x === p.x && last.y === p.y && hits(p) ? still + 1 : 0;
      last = p;
    }
    return { ...last, key };
  },
  async media() {
    await until(() => viewer()?.items.length, 'viewer opened by real pointer');
    await until(() => !viewer().warming && !viewer().loadingMedia.size, 'neighbour prefetch');
    const current = viewer().items[viewer().index];
    const media = viewer().querySelector('.viewer-image');
    const live = () => viewer()?.querySelector('.viewer-image');
    await until(() => media.tagName === 'VIDEO' ? media.readyState >= 2 : media.naturalWidth > 0, 'media drawn', () => ({
      index: viewer().index, count: viewer().items.length, item: { id: current.id, kind: current.kind, messageId: current.messageId },
      rendered: viewer().querySelector('.viewer')?.dataset.kind ?? null, sameElement: media === live(), held: mediaState(media), live: mediaState(live()),
      cached: viewer().urls.has(current.id),
    }));
    const neighbours = viewer().neighbourItems();
    assert(neighbours.every((item) => viewer().urls.has(item.id)), 'two neighbours each side prefetched');
    assert(viewer().urls.size <= 6, 'blob cache is current and neighbours only');
    assert(viewer().mediaPages.pages.length <= 5, 'metadata page cache bounded');
    return { id: current.id, messageId: current.messageId, kind: current.kind, urls: viewer().urls.size, pages: viewer().mediaPages.pages.length, resident: root().messages.length };
  },
  async changed(id) { await until(() => viewer()?.items[viewer().index]?.id !== id, 'keyboard crosses media boundary'); return this.media(); },
};
