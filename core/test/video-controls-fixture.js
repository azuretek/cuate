// Injected only by native test builds (issue 416). A video in the media viewer, drawn with the player's own controls,
// and the viewer's own controls around it: close, previous, next and the bar. The clip is synthetic (a test pattern with
// a silent sound track, so the player offers its mute control), portrait or landscape as the test asks, and the viewer is
// opened on the middle of three so both step controls are live. No server, token or account.
//
// The judgment is the native test's, never this page's: it finds every player control and every one of ours in the
// accessibility tree and asserts each is hittable and that no two overlap. This page only sets the scene and reports what
// it drew, on one marker the test reads:
//   vc:boot                 the script is running
//   vc:empty <json>         the viewer is open on the video and its clip is held back, so the page and the accessibility
//                           tree are built while the video has nothing to play
//   vc:ready <json>         the viewer is open on the paused video, its controls showing, with the page's own boxes
//   vc:fail <why>           the scene could not be set
// The clip is held until the test lets it go (issue 446), so every run takes the real order: the video drawn empty
// first, with the accessibility tree read over it, then its clip. Android calls window.videoControlsRelease(); iOS
// presses the vc:release button, which is on the page only while the clip is held.
// The clip comes from the shell's own scheme (iOS copies it into test builds) or, where the shell cannot serve a test
// file (Android keeps fixtures in the test package), as base64 the test hands over first in window.fixtureVideoBase64.
(async () => {
  const marker = document.createElement('output');
  marker.dataset.videoControlsFixture = 'true';
  Object.assign(marker.style, { position: 'fixed', top: '0', left: '0', zIndex: '9999', fontSize: '1px', pointerEvents: 'none' });
  const say = (text) => { marker.setAttribute('aria-label', text); marker.textContent = text; window.videoControlsState = text; };
  say('vc:boot');
  document.body.append(marker);
  await customElements.whenDefined('app-root');
  const root = document.querySelector('app-root');
  const until = async (test, what, ms = 20000, onTick) => {
    const deadline = performance.now() + ms;
    while (!test()) {
      if (performance.now() > deadline) throw new Error('timed out waiting for ' + what);
      if (onTick) onTick();
      await new Promise(requestAnimationFrame);
    }
  };
  await until(() => root.phase !== 'boot', 'the app to boot');
  if (root.phase !== 'onboarding') throw new Error('the video controls fixture requires empty test storage');
  const scheme = window.fixtureScheme === 'dark' ? 'dark' : 'light';
  root.settings = { ...root.settings, 'appearance.skin': scheme };
  root.info = { product: (root.host && root.host.product) || 'App', serverVersion: '1.0.0', serverChannel: 'dev', apiVersion: 1, engine: { kind: 'fake', version: '1.0.0' } };
  root.chats = [];
  root.phase = 'ready';
  root.conn = 'open';
  await root.updateComplete;
  root.applyTheme();

  const shape = window.fixtureVideo === 'landscape' ? 'landscape' : 'portrait';
  let bytes;
  if (typeof window.fixtureVideoBase64 === 'string' && window.fixtureVideoBase64) {
    bytes = Uint8Array.from(atob(window.fixtureVideoBase64), (c) => c.charCodeAt(0));
  } else {
    const r = await fetch(new URL('/video-controls-' + shape + '.mp4', document.baseURI));
    if (!r.ok) throw new Error('the clip answered ' + r.status);
    bytes = new Uint8Array(await r.arrayBuffer());
  }
  const clip = new Blob([bytes], { type: 'video/mp4' });
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const client = { attachment: async () => { await held; return clip; } };
  const releaseButton = document.createElement('button');
  releaseButton.type = 'button';
  releaseButton.setAttribute('aria-label', 'vc:release');
  releaseButton.textContent = 'vc:release';
  Object.assign(releaseButton.style, { position: 'fixed', top: '45%', left: '30%', zIndex: '9999' });
  window.videoControlsRelease = () => { releaseButton.remove(); release(); return true; };
  releaseButton.addEventListener('click', () => { window.videoControlsRelease(); });

  const { mediaItems } = await import(new URL('rules/media.js', document.baseURI).href);
  await customElements.whenDefined('app-image-viewer');
  const attachments = [1, 2, 3].map((n) => ({ id: 'v' + n, name: 'clip-' + n + '.mp4', mime: 'video/mp4', missing: false }));
  const items = mediaItems([{ id: 'm1', attachments }]);
  const el = document.createElement('app-image-viewer');
  el.items = items;
  el.index = 1;
  el.client = client;
  document.body.append(el);
  const video = () => el.querySelector('video.viewer-image');
  await until(() => el.querySelector('.viewer') && !el.querySelector('.viewer').getAnimations({ subtree: true }).some((a) => a.playState === 'running'), 'the empty viewer to arrive');
  document.body.append(releaseButton);
  say('vc:empty ' + JSON.stringify({ shape, video: Boolean(video()), pending: Boolean(el.querySelector('.viewer-pending')) }));
  await until(() => !releaseButton.isConnected, 'the test to let the clip go', 120000);
  say('vc:loading');
  await until(() => video() && video().readyState >= 2 && video().videoWidth > 0, 'the clip to load');
  await until(() => !el.querySelector('.viewer').getAnimations({ subtree: true }).some((a) => a.playState === 'running'), 'the viewer to arrive');
  // Paused part way in, so the player keeps its controls on screen and the scrubber has somewhere to sit. WebKit can
  // drop a seek set on an element that has only just loaded, or hold one while the element is paused, so the wait is on
  // the state it needs, re-issues the seek and lets a held one finish by playing; a wait that runs out says what the
  // element was actually doing, never just that a second passed (issue 446).
  const v = video();
  const mediaState = () => JSON.stringify({
    paused: v.paused, seeking: v.seeking, t: Math.round(v.currentTime * 1000) / 1000,
    ready: v.readyState, duration: v.duration,
    buffered: v.buffered.length ? [v.buffered.start(0), v.buffered.end(0)] : [],
  });
  const atOneSecond = () => !v.seeking && Math.abs(v.currentTime - 1) <= 0.05;
  v.pause();
  try {
    await until(atOneSecond, 'the video to settle at one second', 60000, () => {
      if (v.seeking) {
        if (v.paused) v.play().catch(() => {});
      } else {
        try { v.currentTime = 1; } catch { /* an element without metadata refuses the seek; the next frame tries again */ }
      }
    });
  } catch (error) {
    throw new Error(error.message + ' (the video was ' + mediaState() + ')', { cause: error });
  }
  v.pause();
  if (!atOneSecond()) throw new Error('the video did not settle at one second (the video was ' + mediaState() + ')');
  await until(() => !el.querySelector('.viewer').getAnimations({ subtree: true }).some((a) => a.playState === 'running'), 'the viewer to settle');
  const box = (node) => {
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const ours = {
    close: el.querySelector('.close-button'),
    prev: el.querySelector('.viewer-prev'),
    next: el.querySelector('.viewer-next'),
    bar: el.querySelector('.viewer-bar'),
  };
  const report = { shape, viewport: { w: innerWidth, h: innerHeight }, video: box(v), paused: v.paused, t: Math.round(v.currentTime * 100) / 100 };
  for (const [name, node] of Object.entries(ours)) report[name] = box(node);
  say('vc:ready ' + JSON.stringify(report));
})().catch((error) => {
  const text = 'vc:fail ' + String((error && error.message) || error);
  const marker = document.querySelector('[data-video-controls-fixture]') || document.createElement('output');
  marker.setAttribute('aria-label', text);
  marker.textContent = text;
  window.videoControlsState = text;
  if (!marker.isConnected) document.body.append(marker);
});
