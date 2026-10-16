// Synthetic renderer-only acceptance harness. Never imported by a shipped module.
const { document, requestAnimationFrame, performance, MediaRecorder } = globalThis;
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
async function until(check, label) {
  const deadline = performance.now() + 20000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error('Timed out: ' + label);
    await frame();
  }
}
const root = () => document.querySelector('app-root');
const pane = () => root().querySelector('app-conversation');
const viewer = () => root().querySelector('app-image-viewer');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const settle = async () => { await root().updateComplete; if (pane()) await pane().updateComplete; await frame(); await frame(); };

globalThis.historyProof = {
  async video() {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const context = canvas.getContext('2d');
    const stream = canvas.captureStream(10);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    const chunks = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
    recorder.start();
    const end = performance.now() + 350;
    while (performance.now() < end) { context.fillStyle = 'rgb(40,120,180)'; context.fillRect(0, 0, 64, 64); await frame(); }
    recorder.stop(); await stopped;
    for (const track of stream.getTracks()) track.stop();
    return Array.from(new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer()));
  },
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
    const attachment = pane().querySelector('app-attachment img');
    await until(() => attachment?.naturalWidth > 0, 'synthetic photo decoded');
    attachment.scrollIntoView({ block: 'center' });
    await settle();
    const rect = attachment.getBoundingClientRect();
    return { steps, maxRows, maxObserved, click: { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) } };
  },
  async media() {
    await until(() => viewer()?.items.length, 'viewer opened by real pointer');
    await until(() => !viewer().warming && !viewer().loadingMedia.size, 'neighbour prefetch');
    const current = viewer().items[viewer().index];
    const media = viewer().querySelector('.viewer-image');
    await until(() => media.tagName === 'VIDEO' ? media.readyState >= 2 : media.naturalWidth > 0, 'media drawn');
    const neighbours = viewer().neighbourItems();
    assert(neighbours.every((item) => viewer().urls.has(item.id)), 'two neighbours each side prefetched');
    assert(viewer().urls.size <= 6, 'blob cache is current and neighbours only');
    assert(viewer().mediaPages.pages.length <= 5, 'metadata page cache bounded');
    return { id: current.id, messageId: current.messageId, kind: current.kind, urls: viewer().urls.size, pages: viewer().mediaPages.pages.length, resident: root().messages.length };
  },
  async changed(id) { await until(() => viewer()?.items[viewer().index]?.id !== id, 'keyboard crosses media boundary'); return this.media(); },
};
