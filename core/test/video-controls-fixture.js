// Injected only by native test builds (issue 416). A video in the media viewer, drawn with the player's own controls,
// and the viewer's own controls around it: close, previous, next and the bar. The clip is synthetic (a test pattern with
// a silent sound track, so the player offers its mute control), portrait or landscape as the test asks, and the viewer is
// opened on the middle of three so both step controls are live. No server, token or account.
//
// The judgment is the native test's, never this page's: it finds every player control and every one of ours in the
// accessibility tree and asserts each is hittable and that no two overlap. This page only sets the scene and reports what
// it drew, on one marker the test reads:
//   vc:boot                 the script is running
//   vc:ready <json>         the viewer is open on the paused video, its controls showing, with the page's own boxes
//   vc:fail <why>           the scene could not be set
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
  const until = async (test, what, ms = 20000) => {
    const deadline = performance.now() + ms;
    while (!test()) {
      if (performance.now() > deadline) throw new Error('timed out waiting for ' + what);
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
  // Issue 443: a video's element carries a poster while its clip loads. The emulator's host renderer takes the whole
  // process down on an empty media surface, and the poster keeps that surface from ever being empty. Playback and the
  // player's own controls are untouched: the poster gives way to the first frame.
  const posterCanvas = document.createElement('canvas');
  posterCanvas.width = shape === 'landscape' ? 640 : 360;
  posterCanvas.height = shape === 'landscape' ? 360 : 640;
  const posterInk = posterCanvas.getContext('2d');
  posterInk.fillStyle = '#3a6'; posterInk.fillRect(0, 0, posterCanvas.width, posterCanvas.height);
  posterInk.fillStyle = '#fff'; posterInk.fillRect(20, 20, posterCanvas.width / 2, posterCanvas.height / 2);
  const poster = posterCanvas.toDataURL('image/png');
  let bytes;
  if (typeof window.fixtureVideoBase64 === 'string' && window.fixtureVideoBase64) {
    bytes = Uint8Array.from(atob(window.fixtureVideoBase64), (c) => c.charCodeAt(0));
  } else {
    const r = await fetch(new URL('/video-controls-' + shape + '.mp4', document.baseURI));
    if (!r.ok) throw new Error('the clip answered ' + r.status);
    bytes = new Uint8Array(await r.arrayBuffer());
  }
  const clip = new Blob([bytes], { type: 'video/mp4' });
  const client = { attachment: async () => clip };

  const { mediaItems } = await import(new URL('rules/media.js', document.baseURI).href);
  await customElements.whenDefined('app-image-viewer');
  const attachments = [1, 2, 3].map((n) => ({ id: 'v' + n, name: 'clip-' + n + '.mp4', mime: 'video/mp4', missing: false }));
  const items = mediaItems([{ id: 'm1', attachments }]).map((item) => ({ ...item, poster }));
  const el = document.createElement('app-image-viewer');
  el.items = items;
  el.index = 1;
  el.client = client;
  document.body.append(el);
  const video = () => el.querySelector('video.viewer-image');
  await until(() => video() && video().readyState >= 2 && video().videoWidth > 0, 'the clip to load');
  await until(() => !el.querySelector('.viewer').getAnimations({ subtree: true }).some((a) => a.playState === 'running'), 'the viewer to arrive');
  // Paused part way in, so the player keeps its controls on screen and the scrubber has somewhere to sit.
  const v = video();
  v.pause();
  if (Math.abs(v.currentTime - 1) > 0.05) {
    const seeked = new Promise((resolve) => v.addEventListener('seeked', resolve, { once: true }));
    v.currentTime = 1;
    await Promise.race([seeked, new Promise((resolve) => setTimeout(resolve, 3000))]);
  }
  await until(() => !el.querySelector('.viewer').getAnimations({ subtree: true }).some((a) => a.playState === 'running'), 'the viewer to settle');
  // Issue 443: the poster must not stand in for the clip. Draw the frame the player has after the seek and count the
  // pixels it painted, and report the player's own frame count, so a green test proves the clip decoded behind the poster.
  const proof = document.createElement('canvas');
  proof.width = 32;
  proof.height = 32;
  const proofInk = proof.getContext('2d');
  proofInk.drawImage(v, 0, 0, proof.width, proof.height);
  const proofPixels = proofInk.getImageData(0, 0, proof.width, proof.height).data;
  let decoded = 0;
  for (let i = 3; i < proofPixels.length; i += 4) if (proofPixels[i] !== 0) decoded += 1;
  const quality = typeof v.getVideoPlaybackQuality === 'function' ? v.getVideoPlaybackQuality() : null;
  const totalFrames = quality ? quality.totalFrames : 0;
  console.log('vc:frame decoded=' + decoded + ' total=' + totalFrames + ' rs=' + v.readyState + ' w=' + v.videoWidth + ' t=' + v.currentTime.toFixed(2));
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
  const report = { shape, viewport: { w: innerWidth, h: innerHeight }, video: box(v), paused: v.paused, t: Math.round(v.currentTime * 100) / 100, decoded, totalFrames };
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
