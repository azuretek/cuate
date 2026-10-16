// Injected only by native test builds (issue 386). A Live Photo in the media viewer: it opens on its still, and a real
// press on its LIVE control plays the motion over the still and brings the still back when the motion ends. Real
// components in the real shell, synthetic media only: the still is drawn here, and the motion is a two second test
// pattern (core/test/live-photo-fixture.mp4) the shell copies into test builds beside this script. No server, token
// or account.
//
// The press is the UI test's, never a scripted click, because the defect lives in what the web view allows after a
// person's press: the motion was left to autoplay, which WebKit refuses outside a gesture by default, so on iPhone the
// press drew an empty box. The page reports what it saw on one marker the UI test reads:
//   live:ready              the still is on screen and the LIVE control is offered
//   live:pressed            the press reached the page as a click
//   live:pass <detail>      the motion played (its time advanced) in the still's box, and the still came back
//   live:fail <why> <state> anything else, with what the motion element reported
(async () => {
  const markerAt = Date.now();
  const marker = document.createElement('output');
  marker.dataset.liveFixture = 'true';
  Object.assign(marker.style, { position: 'fixed', top: '0', left: '0', zIndex: '9999', fontSize: '1px' });
  marker.setAttribute('aria-label', 'live:boot at=' + markerAt);
  marker.textContent = 'live:boot at=' + markerAt;
  document.body.append(marker);
  const { observeLiveMotion, createLiveTrace, traceCall, recordMediaEvent, livePhase, recordMounts } = await import(new URL('/live-photo-observation.js', document.baseURI));
  const trace = createLiveTrace();
  trace.entries.push({ event: 'marker-published', at: markerAt });
  const traceOutput = document.createElement('output');
  Object.assign(traceOutput.style, { position: 'fixed', top: '0', left: '0', fontSize: '1px' });
  document.body.append(traceOutput);
  let flushed = -1;
  const flushTrace = () => {
    if (flushed === trace.entries.length) return;
    flushed = trace.entries.length;
    const snapshot = 'live-trace:' + JSON.stringify(trace.entries);
    traceOutput.setAttribute('aria-label', snapshot); traceOutput.textContent = snapshot;
  };
  const say = (text) => {
    trace.note(text.split(' ')[0]);
    marker.setAttribute('aria-label', text); marker.textContent = text;
    flushTrace();
  };
  flushTrace();
  await customElements.whenDefined('app-root');
  const root = document.querySelector('app-root');
  const until = async (test, what, ms = 10000) => {
    const deadline = performance.now() + ms;
    while (!test()) {
      flushTrace();
      if (performance.now() > deadline) throw new Error('timed out waiting for ' + what);
      await new Promise(requestAnimationFrame);
    }
  };
  // What the page's own policy refused, recorded as it happens: a media load the Content-Security-Policy does not
  // allow fails as an unsupported source rather than as itself, so the recorded violation is the only thing that names
  // the cause (issue 386).
  const refusals = [];
  document.addEventListener('securitypolicyviolation', (e) => refusals.push(e.violatedDirective + ' ' + e.blockedURI));
  await until(() => root.phase !== 'boot', 'the app to boot');
  if (root.phase !== 'onboarding') throw new Error('live photo fixture requires empty test storage');
  const scheme = window.fixtureScheme === 'dark' ? 'dark' : 'light';
  root.settings = { ...root.settings, 'appearance.skin': scheme };
  root.info = { product: (root.host && root.host.product) || 'App', serverVersion: '1.0.0', serverChannel: 'dev', apiVersion: 1, engine: { kind: 'fake', version: '1.0.0' } };
  root.chats = [];
  root.phase = 'ready';
  root.conn = 'open';
  await root.updateComplete;
  root.applyTheme();

  // The still: a picture drawn here, three by four like a phone's photo.
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 800;
  const g = canvas.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 800);
  sky.addColorStop(0, '#2b6cb0');
  sky.addColorStop(1, '#f6ad55');
  g.fillStyle = sky;
  g.fillRect(0, 0, 600, 800);
  g.fillStyle = '#fefcbf';
  g.beginPath();
  g.arc(300, 520, 120, 0, Math.PI * 2);
  g.fill();
  const still = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  // The motion, served by the shell's own scheme from the bundle and typed as the server types it. What went wrong is
  // kept, because a failure the page cannot explain reads as a viewer bug whatever it was (issue 386).
  let fetchFailure = null;
  const motion = async () => {
    trace.note('fetch-start');
    try {
      const r = await fetch(new URL('/live-photo-fixture.mp4', document.baseURI));
      if (!r.ok) throw new Error('the motion fixture answered ' + r.status);
      const bytes = await r.arrayBuffer();
      trace.note('fetch-complete');
      return new Blob([bytes], { type: 'video/mp4' });
    } catch (error) {
      trace.note('fetch-failed');
      fetchFailure = String((error && error.message) || error);
      throw error;
    }
  };
  const client = { attachment: async (id, o = {}) => (o.part === 'live' ? motion() : still) };

  const { mediaItems } = await import(new URL('rules/media.js', document.baseURI).href);
  await customElements.whenDefined('app-image-viewer');
  const items = mediaItems([{ id: 'm1', attachments: [{ id: 'a1', name: 'IMG_0001.HEIC', mime: 'image/png', missing: false, live: true }] }]);
  const el = document.createElement('app-image-viewer');
  el.items = items;
  el.index = 0;
  el.client = client;
  document.body.append(el);
  traceCall(el, 'playMotion', trace, 'press-admitted');
  traceCall(HTMLMediaElement.prototype, 'play', trace, 'play-called', (node) => node.matches('video.viewer-motion'));
  const img = () => el.querySelector('img.viewer-image');
  const video = () => el.querySelector('video.viewer-motion');
  const control = () => el.querySelector('.viewer-play');
  await until(() => img() && img().complete && img().naturalWidth > 0, 'the still');
  await until(() => !el.querySelector('.viewer').getAnimations().some((a) => a.playState === 'running'), 'the viewer to arrive');
  const box = (node) => { const r = node.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
  const stillBox = box(img());
  const observation = observeLiveMotion(stillBox);
  // Event callbacks record only names and timestamps. Media state and geometry are read by the sampling loop.
  for (const type of ['loadeddata', 'playing', 'timeupdate', 'ended', 'error']) {
    el.addEventListener(type, (event) => {
      if (event.target.matches?.('video.viewer-motion')) recordMediaEvent(trace, event);
    }, true);
  }
  const state = () => {
    const v = video();
    const c = control();
    return JSON.stringify({
      video: v ? { ready: v.readyState, t: Math.round(v.currentTime * 100) / 100, paused: v.paused, error: v.error ? v.error.code : null, box: box(v) } : null,
      observedMotion: observation.last, phase: livePhase(trace), timeline: trace.entries,
      still: img() ? box(img()) : null,
      control: c ? c.getAttribute('aria-label') : null,
    });
  };
  const mounts = new MutationObserver((records) => recordMounts(trace, records));
  mounts.observe(el, { childList: true, subtree: true });

  // Why a motion could not play, asked of the shell rather than inferred: the fixture fetches the motion and plays it on
  // an element of its own, so a fetch the shell refused and a shell that will not load a blob read apart, and the reason
  // is the media's own (issue 386).
  const policy = () => (refusals.length ? 'refused by the policy: ' + refusals.join(', ') : 'nothing refused by the policy');
  const why = async () => {
    if (fetchFailure) return 'the page could not fetch the motion: ' + fetchFailure;
    const probe = document.createElement('video');
    probe.muted = true;
    probe.playsInline = true;
    try {
      probe.src = URL.createObjectURL(await motion());
      await probe.play();
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return 'the page could not play the same motion on its own element: ' + String((error && error.name) || '') + ' ' + String((error && error.message) || error) + '; ' + policy();
    }
    const until = performance.now() + 3000;
    while (performance.now() < until && probe.readyState < 2 && !probe.error) await new Promise(requestAnimationFrame);
    return 'the page played the same motion on its own element: readyState ' + probe.readyState + ' error ' + (probe.error ? probe.error.code : 'none') + '; ' + policy();
  };

  // A captured click is not proof the kit admitted it. The app handler wrapper above records that separately.
  el.addEventListener('click', (e) => {
    if (e.target.closest?.('.viewer-play')) trace.note('click-captured');
  }, true);
  // Where the LIVE control is on the page, for a test that cannot find it in the accessibility tree to press it there.
  const at = document.createElement('output');
  Object.assign(at.style, { position: 'fixed', top: '0', right: '0', zIndex: '9999', fontSize: '1px' });
  const r = control().getBoundingClientRect();
  const where = 'where:live ' + Math.round(r.left + r.width / 2) + ' ' + Math.round(r.top + r.height / 2) + ' ' + innerWidth + ' ' + innerHeight;
  at.setAttribute('aria-label', where);
  at.textContent = where;
  document.body.append(at);
  say('live:ready');
  await until(() => trace.has('press-admitted'), 'the app to admit the LIVE press', 120000);
  say('live:pressed');

  // The motion takes the still's box from the moment it is drawn, and its time advances. Every frame until it plays is
  // measured, so a moment drawn at another size, the empty box, is caught rather than missed between two looks.

  const deadline = performance.now() + 15000;
  while (performance.now() < deadline) {
    const v = video();
    if (v) {
      observation.sample(v, box);
    } else if (control() && control().getAttribute('aria-label') === 'The motion could not be loaded') {
      say('live:fail the viewer reported the motion could not be loaded ' + state() + ' ' + await why());
      return;
    }
    flushTrace();
    if (observation.passed) break;
    await new Promise(requestAnimationFrame);
  }
  observation.sample(video(), box);
  if (!observation.passed) { say('live:fail the motion never played ' + state()); return; }
  const wrongBox = observation.wrongBox;
  if (wrongBox) { say('live:fail the motion was drawn at ' + wrongBox.w + 'x' + wrongBox.h + ', not the still\'s ' + stillBox.w + 'x' + stillBox.h + ' ' + state()); return; }
  const played = Math.round(observation.played * 100) / 100;
  // The still is back when the motion ends.
  try {
    await until(() => !video() && img(), 'the still to come back', 10000);
  } catch {
    say('live:fail the still did not come back after the motion ' + state());
    return;
  }
  say('live:pass played to ' + played + 's in the still\'s ' + stillBox.w + 'x' + stillBox.h + ' box, and the still came back');
})().catch((error) => {
  const text = 'live:fail fixture ' + error.message;
  const marker = document.querySelector('[data-live-fixture]') || document.createElement('output');
  marker.setAttribute('aria-label', text);
  marker.textContent = text;
  document.body.append(marker);
});
