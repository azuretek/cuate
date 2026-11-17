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
// After a frame has been painted: a task queued from a frame callback runs once that frame's rendering is done, its resize
// handling included, so what it reads is what the reader was shown rather than a layout caught before the keep put it
// back. Ordered by frames, never by a clock.
const painted = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
// A reading taken on painted frames until two in a row agree, so a picture landing in one frame (put back in the next)
// is not mistaken for where the page settled. Bounded by the same deadline as every other wait here.
async function steady(read, label) {
  const deadline = performance.now() + 20000;
  await painted();
  let last = read();
  for (;;) {
    if (performance.now() > deadline) throw new Error('Timed out: ' + label + ' ' + JSON.stringify(last));
    await painted();
    const now = read();
    if (now !== null && last !== null && Math.abs(now - last) < 0.5) return now;
    last = now;
  }
}

globalThis.historyProof = {
  // The reader's walk (core/test/history-scroll-fixture.js, the same script the phones run): up past several evicted
  // pages and back down to the newest message, every page landing only once the reader has read another screen, and
  // every step asserting the messages coming into view were already loaded and nothing on screen moved.
  async walk() {
    await until(() => root()?.phase === 'ready', 'application ready');
    // A live message is made to arrive by the real server's synthetic engine (issue 537): the proof's main process hears
    // this line and has the engine deliver it, as imsg's live stream does.
    const arrive = (k, text) => { console.log('history:arrive ' + JSON.stringify(text)); };
    return globalThis.historyWalk({ root: root(), chatId: '1', upTo: 400, arrive });
  },
  async history() {
    await until(() => root()?.phase === 'ready', 'application ready');
    // The walk left the pages it read in the device's store, which would answer this loop's pages with no server read.
    // The store starts again, so every page below is read from the server as on a fresh launch, which the race needs.
    if (root().cache) await root().cache.reset(root().cache.cursor);
    await root().open('1', { show: true });
    await settle();
    const steps = [];
    // A refresh of the conversation on screen spans a page boundary (issue 504), in the order the Windows packaged leg
    // met it when its window was shown again: the refresh begins while one page is asked for, and answers while the
    // next is in flight, before that page lands. The answers are ordered by what the page reports it asked for, never
    // by a wait, so every platform proves the same interleaving. The store is taken as not current, as a catch-up that
    // has not finished leaves it, so the refresh reads the newest page rather than answering from the store.
    const RACE_FROM = 2;
    const client = root().client;
    const ask = client.messages.bind(client);
    const race = { order: [] };
    race.nextAsked = new Promise((resolve) => { race.ask = resolve; });
    client.messages = async (chatId, options = {}) => {
      const answer = ask(chatId, options);
      if (!race.refresh || race.done) return answer;
      if (!options.beforeCursor && !options.afterCursor) {
        race.order.push('refresh asked');
        await race.nextAsked;
        const page = await answer;
        race.order.push('refresh answered');
        return page;
      }
      if (steps.length !== RACE_FROM + 1) return answer;
      race.order.push('page asked');
      race.ask();
      const page = await answer;
      await race.refresh;
      race.order.push('page answered');
      return page;
    };
    let maxRows = 0;
    let maxObserved = 0;
    const deadline = performance.now() + 90000;
    while (root().hasMore) {
      assert(performance.now() < deadline, 'scrollback proof deadline');
      await until(() => !root().pendingHistory && !pane().olderPending, 'history request settled');
      const rows = [...pane().querySelectorAll('.messages > .bubble-row')];
      const target = rows[Math.min(25, rows.length - 1)];
      const scroll = pane().querySelector('.messages');
      // Placed through the keep, as the app places a message, so the conversation reads it as its own placing rather
      // than the reader scrolling, and this loop alone asks for each page.
      pane().keep.anchor = { key: target.dataset.id, offset: 0 };
      pane().keep.restore();
      const anchor = { ...pane().keep.anchor };
      // Failure-only diagnostics distinguish a stale keeper anchor from an extra page or an undrawn model.
      const position = () => {
        const drawn = [...pane().querySelectorAll('.messages > .bubble-row')];
        return { anchor: { ...pane().keep.anchor }, first: drawn[0]?.dataset.id, last: drawn.at(-1)?.dataset.id, target: target.dataset.id, targetConnected: target.isConnected, scrollTop: scroll.scrollTop, written: pane().keep.written, width: scroll.clientWidth, height: scroll.clientHeight, beforeCount: root().historyWindow?.beforeCount, afterCount: root().historyWindow?.afterCount };
      };
      const positioned = position();
      // What the page held when the proof asked, so a refused page names why rather than only that it was refused.
      const asked = { first: root().messages[0]?.id, rows: root().messages.length, seq: root().openSeq, pending: Boolean(root().pendingHistory), olderPending: Boolean(pane().olderPending), hasOlder: root().historyWindow?.hasOlder, chat: root().openChatId };
      if (steps.length === RACE_FROM) {
        race.upToDate = root().upToDate;
        root().upToDate = false;
        race.refresh = root().open(root().openChatId);
      }
      const moved = await root().loadOlder(pane().historyMeasurements());
      if (steps.length === RACE_FROM + 1) {
        race.done = true;
        root().upToDate = race.upToDate;
        assert(race.order.join(',') === 'refresh asked,page asked,refresh answered,page answered', 'refresh answered while the page was in flight ' + JSON.stringify(race.order));
      }
      const after = () => ({ first: root().messages[0]?.id, rows: root().messages.length, seq: root().openSeq, pending: Boolean(root().pendingHistory), olderPending: Boolean(pane().olderPending), hasOlder: root().historyWindow?.hasOlder, chat: root().openChatId, problem: root().problem || '' });
      assert(moved, 'older page returned ' + JSON.stringify({ asked, after: after() }));
      const returned = { model: after(), view: position() };
      await settle();
      const held = [...pane().querySelectorAll('.messages > .bubble-row')].find((row) => row.dataset.id === anchor.key);
      assert(held, 'anchor retained while adjacent page loads ' + JSON.stringify({ anchor, asked, positioned, returned, after: after(), view: position(), steps }));
      const drift = (await steady(() => (held.isConnected ? held.getBoundingClientRect().top - scroll.getBoundingClientRect().top : null), 'the anchor to settle')) - anchor.offset;
      assert(Math.abs(drift) <= 1, 'scroll anchor drift: ' + drift + ' ' + JSON.stringify({ anchor, positioned, returned, view: position(), steps: steps.slice(-2) }));
      maxRows = Math.max(maxRows, root().messages.length);
      maxObserved = Math.max(maxObserved, pane().keep.observed.size);
      assert(root().messages.length <= 150, 'resident messages bounded');
      assert(pane().querySelectorAll('.messages > .bubble-row').length <= 150, 'rendered rows bounded');
      assert(pane().keep.observed.size <= scroll.children.length + 1, 'evicted observations released');
      steps.push({ first: root().messages[0].id, last: root().messages.at(-1).id, drift, rows: root().messages.length });
    }
    assert(root().messages[0].id === 'SYNTHETIC-1', 'reached oldest message without timestamp gaps');
    const click = await this.photoTarget();
    return { steps, maxRows, maxObserved, click, race: race.order };
  },
  // The photo the real pointer presses, placed the way the app places a message it brings into view
  // (revealMessage): through the scroll keeper's anchor, never a bare scrollIntoView, because the keeper
  // restores the person's recorded place after every render and would move a bare scroll back before its
  // scroll event is heard. The press point is read only once the photo has held still for several frames
  // and the point hit-tests to the photo itself, so the click never lands on stale coordinates.
  // A picture is fetched only once its row is on screen or within a screen of it (issue 425), so the photo's row is
  // brought into view first and its picture waited for there, rather than found among rows already fetched.
  async photoTarget() {
    const scroll = pane().querySelector('.messages');
    const isPhoto = (el) => /^image\//.test(String(el.attachment?.mime || ''));
    const photoRow = () => [...pane().querySelectorAll('.messages > .bubble-row')].find((r) => r.dataset.id && [...r.querySelectorAll('app-attachment')].some(isPhoto));
    await until(() => photoRow(), 'a synthetic photo row resident');
    const key = photoRow().dataset.id;
    const place = () => {
      pane().keep.anchor = { key, offset: Math.round(scroll.clientHeight / 3) };
      pane().keep.restore();
    };
    const target = () => [...pane().querySelectorAll('.messages > .bubble-row')].find((r) => r.dataset.id === key)?.querySelector('app-attachment img');
    place();
    await until(() => target()?.naturalWidth > 0, 'synthetic photo decoded', () => ({ key, rendered: Boolean(target()), held: mediaState(target()) }));
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
