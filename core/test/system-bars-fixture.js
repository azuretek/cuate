// Injected only by native test builds (issue 175). It fills the real app with a synthetic conversation in the scheme the
// test names, then reports what the page drew at its top and bottom edges, so the native test can hold the status bar
// and the home indicator or navigation bar in the capture to the surface beside them. The page is never told to pass:
// the fixture measures and the native test decides.
(async () => {
  await customElements.whenDefined('app-root');
  const root = document.querySelector('app-root');
  const deadline = performance.now() + 10000;
  while (root.phase === 'boot' && performance.now() < deadline) await new Promise(requestAnimationFrame);
  if (root.phase !== 'onboarding') throw new Error('system bars fixture requires empty test storage');
  const chat = { id: 'bars', title: 'System bars fixture', participants: ['fixture@example.invalid'], service: 'iMessage' };
  root.chats = [chat];
  root.openChatId = chat.id;
  root.messages = Array.from({ length: 40 }, (_, i) => ({
    id: 'bars-' + i, chatId: chat.id, text: 'Synthetic message ' + i + ' for the system bars.',
    sentAt: '2026-01-01T12:00:00.000Z', fromMe: i % 2 === 0, sender: 'Fixture', attachments: [], reactions: [], replyTo: null,
  }));
  root.phase = 'ready';
  root.conn = 'open';
  root.sending = true;
  root.listOpen = false;

  // The colour a point on the page is painted, read from the first element under it, outward, that paints a background.
  const painted = (x, y) => {
    for (let el = document.elementFromPoint(x, y); el; el = el.parentElement) {
      const bg = getComputedStyle(el).backgroundColor;
      const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(bg);
      if (m && (m[4] === undefined || Number(m[4]) > 0)) return [Number(m[1]), Number(m[2]), Number(m[3])];
    }
    return null;
  };
  // A length the stylesheet resolves, measured on a probe, since a custom property reads back unresolved.
  const measure = (value) => {
    const probe = document.createElement('div');
    Object.assign(probe.style, { position: 'fixed', visibility: 'hidden', height: value });
    document.body.append(probe);
    const h = probe.getBoundingClientRect().height;
    probe.remove();
    return h;
  };

  const marker = document.createElement('button');
  Object.assign(marker.style, { position: 'fixed', top: '45%', left: '30%', zIndex: '9999' });
  document.body.append(marker);

  let scheme = window.fixtureScheme === 'dark' ? 'dark' : 'light';
  const report = async () => {
    root.settings = { ...root.settings, 'appearance.skin': scheme };
    await root.updateComplete;
    root.applyTheme();
    const conversation = root.querySelector('app-conversation');
    await conversation.updateComplete;
    // Two frames, so the scheme and the shell's insets have reached the layout the capture will show.
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    const head = conversation.querySelector('.conv-head');
    const composer = conversation.querySelector('app-composer');
    if (!head || !composer) throw new Error('fixture must draw the conversation header and composer');
    const h = head.getBoundingClientRect();
    const c = composer.getBoundingClientRect();
    const headStyle = getComputedStyle(head);
    const composerStyle = getComputedStyle(composer);
    const proof = {
      scheme: document.documentElement.dataset.scheme,
      dpr: devicePixelRatio,
      width: innerWidth,
      height: innerHeight,
      envTop: measure('env(safe-area-inset-top, 0px)'),
      envBottom: measure('env(safe-area-inset-bottom, 0px)'),
      // Where the header's content starts below the top edge, and how far the composer's content ends above the bottom.
      headContentTop: h.top + parseFloat(headStyle.paddingTop),
      composerContentGap: innerHeight - (c.bottom - parseFloat(composerStyle.paddingBottom)),
      headTop: h.top,
      composerBottom: innerHeight - c.bottom,
      top: painted(innerWidth / 2, 1),
      bottom: painted(innerWidth / 2, innerHeight - 1),
    };
    window.systemBarsProof = proof;
    // The label carries the measurements for the iOS test, which reads the page only through accessibility:
    // bars:<scheme>:ready:<env top>:<env bottom>:<header content top>:<composer content gap>:<r>,<g>,<b> in CSS pixels.
    const round = (n) => Math.round(n * 100) / 100;
    const label = ['bars', proof.scheme, 'ready', round(proof.envTop), round(proof.envBottom), round(proof.headContentTop), round(proof.composerContentGap), (proof.top || [0, 0, 0]).join(',')].join(':');
    marker.textContent = label;
    marker.setAttribute('aria-label', label);
    return proof;
  };
  // A runtime change of scheme, the way a skin chosen in settings arrives: the native test calls it on Android, and
  // presses the marker on iOS.
  window.systemBarsSwitch = (next) => { scheme = next === 'dark' ? 'dark' : 'light'; return report(); };
  marker.addEventListener('click', () => { window.systemBarsSwitch(scheme === 'dark' ? 'light' : 'dark'); });

  // The keyboard (issue 180). The native test taps a real field, the composer's or one in Settings, so the platform
  // raises its own keyboard; the page reports whether anything slid: the page's scroll, the visual viewport's offset,
  // where the surface at the top now sits, and where the focused field is against the visible height.
  let kind = 'conversation';
  let settingsReady = false;
  const field = () => (kind === 'settings' ? document.querySelector('[data-bars-field]') : document.querySelector('app-composer textarea'));
  window.systemBarsField = () => {
    if (kind === 'settings' && !settingsReady) return null;
    const f = field();
    if (!f) return null;
    const r = f.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 20) };
  };
  window.systemBarsOpenSettings = async () => {
    kind = 'settings';
    root.openSettings();
    await root.updateComplete;
    await new Promise(requestAnimationFrame);
    const fields = [...document.querySelectorAll('app-settings input[type=url], app-settings input[type=text], app-settings input[type=number], app-settings textarea')];
    // The last text field, low in the sheet, so a keyboard covers where it sits until the sheet scrolls it into sight.
    const f = fields[fields.length - 1];
    if (!f) throw new Error('settings must offer a text field');
    // The sheet slides up as it opens; the field is only where it will stay once that has finished.
    const sheet = document.querySelector('.sheet-scrim > .sheet');
    const settle = (sheet ? sheet.getAnimations({ subtree: true }) : []).map((a) => a.finished.catch(() => {}));
    await Promise.race([Promise.all(settle), new Promise((resolve) => setTimeout(resolve, 3000))]);
    f.scrollIntoView({ block: 'end' });
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    f.dataset.barsField = '';
    f.setAttribute('aria-label', 'bars-field');
    settingsReady = true;
    keys();
    return window.systemBarsField();
  };
  const keysMarker = document.createElement('button');
  Object.assign(keysMarker.style, { position: 'fixed', top: '40%', left: '5%', zIndex: '9999' });
  keysMarker.addEventListener('click', () => { window.systemBarsOpenSettings(); });
  document.body.append(keysMarker);
  const keys = () => {
    const f = field();
    const r = f ? f.getBoundingClientRect() : { top: -1, bottom: -1 };
    const surface = kind === 'settings' ? document.querySelector('.sheet-scrim > .sheet') : document.querySelector('.conv-head');
    const s = surface ? surface.getBoundingClientRect() : { top: -1 };
    const vv = window.visualViewport || { offsetTop: 0, height: innerHeight, scale: 1 };
    const proof = {
      kind,
      focused: Boolean(f) && document.activeElement === f,
      scrollY: window.scrollY,
      doc: document.scrollingElement.scrollTop,
      viewportTop: vv.offsetTop,
      viewportHeight: vv.height,
      scale: vv.scale,
      envTop: measure('var(--inset-top)'),
      surfaceTop: s.top,
      fieldTop: r.top,
      fieldBottom: r.bottom,
    };
    window.systemBarsKeys = proof;
    const round = (n) => Math.round(n * 100) / 100;
    // keys:<kind>:<focused>:<scrollY>:<viewport top>:<viewport height>:<scale>:<inset top>:<surface top>:<field top>:<field bottom>
    const label = ['keys', kind, proof.focused ? 1 : 0, round(proof.scrollY + proof.doc), round(proof.viewportTop), round(proof.viewportHeight), round(proof.scale), round(proof.envTop), round(proof.surfaceTop), round(proof.fieldTop), round(proof.fieldBottom)].join(':');
    if (keysMarker.textContent !== label) { keysMarker.textContent = label; keysMarker.setAttribute('aria-label', label); }
    return proof;
  };
  window.systemBarsKeysProof = keys;
  // A strip of a fixed fill along the bottom of the visible page, drawn only for the keyboard checks: a capture shows
  // it just above the keyboard once the screen draws the view the keyboard shrank, and nowhere while it still shows
  // the frame from before, so a native test can tell a stale capture from a real one by its pixels.
  window.systemBarsEdge = () => {
    if (document.querySelector('[data-bars-edge]')) return true;
    const edge = document.createElement('div');
    edge.dataset.barsEdge = '';
    Object.assign(edge.style, { position: 'fixed', left: '0', right: '0', bottom: '0', height: '4px', background: '#1b7f3b', zIndex: '9999', pointerEvents: 'none' });
    document.body.append(edge);
    return true;
  };
  const tick = () => { keys(); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  await report();
})().catch((error) => {
  window.systemBarsProof = { error: error.message };
  document.body.textContent = 'system bars fixture failed: ' + error.message;
});
