// Injected only by native test builds (issue 415). Two video tiles as a conversation draws them, in the shell's own web
// view: one whose server sends a poster, and one whose server has none (a server off the Mac, or a still that could
// not be made). Real components in the real shell, synthetic media only: the video is the two second test pattern
// (core/test/live-photo-fixture.mp4) the shell copies into test builds, and the poster is drawn here. No server, token
// or account.
//
// The defect was a tile the web view painted nothing in, so the verdict is the UI test's, read from the tile's own
// pixels; the page only says when both tiles are drawn and what each video element holds:
//   video:ready <json>   both tiles are on screen, with each one's label, box, poster and source
//   video:fail <why>     the fixture could not draw them
(async () => {
  const marker = document.createElement('output');
  marker.dataset.videoFixture = 'true';
  Object.assign(marker.style, { position: 'fixed', top: '0', left: '0', zIndex: '9999', fontSize: '1px' });
  const say = (text) => { marker.setAttribute('aria-label', text); marker.textContent = text; };
  say('video:boot');
  document.body.append(marker);
  await customElements.whenDefined('app-root');
  const root = document.querySelector('app-root');
  const until = async (test, what, ms = 20000) => {
    const deadline = performance.now() + ms;
    while (!test()) {
      if (performance.now() > deadline) throw new Error('timed out waiting for ' + what);
      await new Promise(requestAnimationFrame);
    }
  };
  await until(() => root.phase !== 'boot', 'the app to boot');
  if (root.phase !== 'onboarding') throw new Error('video tile fixture requires empty test storage');
  const scheme = window.fixtureScheme === 'dark' ? 'dark' : 'light';
  root.settings = { ...root.settings, 'appearance.skin': scheme };
  root.info = { product: (root.host && root.host.product) || 'App', serverVersion: '1.0.0', serverChannel: 'dev', apiVersion: 1, engine: { kind: 'fake', version: '1.0.0' } };
  root.chats = [];
  root.phase = 'ready';
  root.conn = 'open';
  await root.updateComplete;
  root.applyTheme();

  // The video, served by the shell's own scheme from the bundle and typed as the server types it.
  const r = await fetch(new URL('/live-photo-fixture.mp4', document.baseURI));
  if (!r.ok) throw new Error('the video fixture answered ' + r.status);
  const video = new Blob([await r.arrayBuffer()], { type: 'video/mp4' });
  // The poster: a still at the video's own three by four, in bands no empty tile could be mistaken for.
  const canvas = document.createElement('canvas');
  canvas.width = 120;
  canvas.height = 160;
  const g = canvas.getContext('2d');
  ['#2b6cb0', '#f6ad55', '#38a169', '#e53e3e'].forEach((colour, i) => { g.fillStyle = colour; g.fillRect(0, i * 40, 120, 40); });
  g.fillStyle = '#fefcbf';
  g.fillRect(40, 20, 40, 120);
  const poster = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  const client = (withPoster) => ({
    attachment: async (id, o = {}) => {
      if (o.part !== 'poster') return video;
      if (withPoster) return poster;
      throw Object.assign(new Error('HTTP 404'), { status: 404 });
    },
  });

  await customElements.whenDefined('app-attachment');
  const stage = document.createElement('div');
  Object.assign(stage.style, { position: 'fixed', top: '15%', left: '0', right: '0', zIndex: '9998', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '32px', padding: '16px', background: 'var(--color-bg)' });
  const tiles = [
    { id: 'vidposter00001', name: 'poster-clip.mp4', withPoster: true },
    { id: 'vidplain000001', name: 'plain-clip.mp4', withPoster: false },
  ].map((t) => {
    const el = document.createElement('app-attachment');
    el.client = client(t.withPoster);
    el.attachment = { id: t.id, name: t.name, mime: 'video/mp4', missing: false };
    stage.append(el);
    return el;
  });
  document.body.append(stage);
  await until(() => tiles.every((t) => t.querySelector('video')), 'both tiles to draw their video');
  // A poster the server sends lands beside the video; give it the same bound before saying what each tile holds.
  await until(() => tiles[0].querySelector('video').hasAttribute('poster'), 'the poster to land', 5000).catch(() => {});
  const report = tiles.map((t) => {
    const v = t.querySelector('video');
    const b = t.querySelector('.attachment-preview').getBoundingClientRect();
    return { label: t.querySelector('.attachment-preview').getAttribute('aria-label'), box: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)], poster: v.hasAttribute('poster'), fragment: /#t=/.test(v.getAttribute('src') || ''), readyState: v.readyState };
  });
  say('video:ready ' + JSON.stringify({ viewport: [innerWidth, innerHeight], tiles: report }));
})().catch((error) => {
  const text = 'video:fail fixture ' + error.message;
  const marker = document.querySelector('[data-video-fixture]') || document.createElement('output');
  marker.setAttribute('aria-label', text);
  marker.textContent = text;
  document.body.append(marker);
});
