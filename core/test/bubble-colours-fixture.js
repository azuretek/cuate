// Injected only by native test builds (issue 459). The real conversation, given synthetic messages from both sides,
// drawn in the default palette and in a synthetic imported theme, each in light and in dark: the other person's bubble
// must be the theme's accent bubble with that token's own text colour, ours the quiet tint, each with its text at 4.5:1,
// and the received bubble must stand out from the page more than ours. The page measures what it drew and reports a
// verdict the native test reads. Synthetic records only: no server, token or account.
//   bubbles:pass <detail>   every theme and scheme held; the default palette is left in light for the capture
//   bubbles:fail <why>      it did not
//   bubbles:dark <detail>   after the Show dark bubbles control is pressed: the default palette in dark, for the capture
(async () => {
  const until = async (test, what, ms = 20000) => {
    const deadline = performance.now() + ms;
    while (!test()) {
      if (performance.now() > deadline) throw new Error('timed out waiting for ' + what);
      await new Promise(requestAnimationFrame);
    }
  };
  const frames = async (n) => { for (let i = 0; i < n; i += 1) await new Promise(requestAnimationFrame); };
  const say = (text) => {
    const mark = document.querySelector('[data-bubbles-fixture]') || document.createElement('output');
    mark.setAttribute('data-bubbles-fixture', 'verdict');
    mark.setAttribute('aria-label', text);
    mark.textContent = text;
    Object.assign(mark.style, { position: 'fixed', bottom: '0', left: '0', zIndex: '9999', fontSize: '1px' });
    document.body.append(mark);
  };
  await customElements.whenDefined('app-conversation');
  await customElements.whenDefined('app-root');
  await until(() => window.bridge && typeof window.bridge.call === 'function', 'the bridge');
  await until(() => document.querySelector('app-root') && document.querySelector('app-root').settings, 'the page');
  const root = document.querySelector('app-root');
  const host = await window.bridge.call('app.info');
  const sam = '+15555550123';
  const at = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
  const chat = { id: 'fixture-bubbles-chat', name: 'Sam Example', isGroup: false, service: 'iMessage', participants: [sam], members: [{ handle: sam, name: 'Sam Example', photo: null }], unread: 0, lastMessageAt: at(1), lastMessage: null };
  const message = (id, minutes, text, mine, styles) => ({ id, chatId: chat.id, fromMe: mine, sender: mine ? null : sam, senderName: mine ? null : 'Sam Example', text, styles, sentAt: at(minutes), replyTo: null, read: null, attachments: [], link: null, payloads: 0, reactions: [] });
  const messages = [
    message('fixture-them-1', 9, 'Did the tickets come through?', false),
    message('fixture-me-1', 8, 'Yes, two seats on the aisle.', true),
    message('fixture-them-2', 7, 'Perfect, see you at seven.', false),
    message('fixture-me-2', 6, 'See you there!', true),
    // A mention on a received bubble (issue 453) reads on the accent that bubble now is.
    message('fixture-them-mention', 5, 'Sam, bring the umbrella', false, [{ start: 0, length: 3, mention: sam }]),
  ];
  const conv = document.createElement('app-conversation');
  Object.assign(conv, { chat, host, messages, sending: true, phone: true });
  Object.assign(conv.style, { position: 'fixed', inset: '0', zIndex: '9998', display: 'flex', flexDirection: 'column', background: 'var(--color-bg)' });
  document.body.append(conv);
  await until(() => conv.querySelectorAll('.bubble.them').length === 3 && conv.querySelectorAll('.bubble.me').length === 2 && Boolean(conv.querySelector('.bubble.them .mention')), 'the bubbles');

  // A colour as the page resolves it, read back through a canvas so any colour syntax the engine returns becomes sRGB.
  const cv = document.createElement('canvas');
  cv.width = 1;
  cv.height = 1;
  const g = cv.getContext('2d', { willReadFrequently: true });
  const rgb = (c) => { g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = c; g.fillRect(0, 0, 1, 1); return [...g.getImageData(0, 0, 1, 1).data].slice(0, 3); };
  const lum = (c) => { const [r, gg, b] = c.map((v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * gg + 0.0722 * b; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100; };
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 2);
  const probe = document.createElement('div');
  Object.assign(probe.style, { position: 'fixed', width: '0', height: '0', overflow: 'hidden' });
  document.body.append(probe);
  const token = (background, color) => { probe.style.background = background; probe.style.color = color; const s = getComputedStyle(probe); return { bg: rgb(s.backgroundColor), fg: rgb(s.color) }; };
  const drawn = (sel) => [...conv.querySelectorAll(sel)].map((b) => { const s = getComputedStyle(b); return { bg: rgb(s.backgroundColor), fg: rgb(s.color) }; });

  // A synthetic imported theme whose accent bubble is unlike the default's, so a bubble that kept the default palette
  // would be caught. Drawn through the page's own theme path, as a theme the server holds is.
  const THEME = {
    id: 'fixture-bubbles-theme',
    name: 'Fixture bubbles',
    color: {
      light: { bg: '#fbfaf7', fg: '#1c1917', 'chart-2': '#0f766e', 'bubble-me': '#1d4ed8', 'bubble-me-fg': '#ffffff' },
      dark: { bg: '#0c0a09', fg: '#f5f5f4', 'chart-2': '#5eead4', 'bubble-me': '#93c5fd', 'bubble-me-fg': '#0c0a09' },
    },
  };
  const apply = async (theme, scheme) => {
    root.settings = { ...root.settings, 'appearance.skin': scheme, 'appearance.theme': theme };
    root.applyTheme();
    await frames(3);
  };
  const problems = [];
  const seen = {};
  for (const [name, theme] of [['default', null], ['imported', THEME]]) {
    for (const scheme of ['light', 'dark']) {
      await apply(theme, scheme);
      const where = name + '-' + scheme;
      if (document.documentElement.dataset.scheme !== scheme) problems.push(where + ' drew the ' + document.documentElement.dataset.scheme + ' scheme');
      const accent = token('var(--color-bubble-me)', 'var(--color-bubble-me-fg)');
      const page = token('var(--color-bg)', 'var(--color-fg)').bg;
      const them = drawn('.bubble.them');
      const me = drawn('.bubble.me');
      if (!them.every((b) => near(b.bg, them[0].bg)) || !me.every((b) => near(b.bg, me[0].bg))) problems.push(where + ' draws one side in more than one colour');
      const received = them[0];
      const sent = me[0];
      if (!near(received.bg, accent.bg)) problems.push(where + ' the received bubble is ' + received.bg + ', not the accent bubble ' + accent.bg);
      if (!near(received.fg, accent.fg)) problems.push(where + ' the received text is ' + received.fg + ', not the accent bubble text ' + accent.fg);
      if (near(sent.bg, accent.bg)) problems.push(where + ' the sent bubble is still the accent bubble');
      const r = { received: ratio(received.fg, received.bg), sent: ratio(sent.fg, sent.bg), standsOut: ratio(received.bg, page), quiet: ratio(sent.bg, page) };
      if (r.received < 4.5) problems.push(where + ' received text is ' + r.received + ':1');
      if (r.sent < 4.5) problems.push(where + ' sent text is ' + r.sent + ':1');
      const mention = conv.querySelector('.bubble.them .mention');
      r.mention = ratio(rgb(getComputedStyle(mention).color), rgb(getComputedStyle(mention.closest('.bubble')).backgroundColor));
      if (r.mention < 4.5) problems.push(where + ' mention text is ' + r.mention + ':1 on the received bubble');
      if (!(r.standsOut > r.quiet)) problems.push(where + ' the received bubble (' + r.standsOut + ') does not stand out from the page more than ours (' + r.quiet + ')');
      seen[where] = r;
    }
  }
  probe.remove();
  await apply(null, 'light');
  const detail = Object.entries(seen).map(([k, v]) => k + '=' + v.received + '/' + v.sent + '/' + v.standsOut + '>' + v.quiet).join(' ');
  const ok = !problems.length;
  window.bubbleColoursProof = { ok, problems, seen, dark: false };
  // The capture in dark is taken after a press on this control, so each phone keeps one picture per scheme.
  const dark = document.createElement('button');
  dark.type = 'button';
  dark.textContent = 'Show dark bubbles';
  dark.setAttribute('data-bubbles-dark', '');
  Object.assign(dark.style, { position: 'fixed', top: '50%', right: '0', zIndex: '9999', minWidth: '44px', minHeight: '44px' });
  dark.addEventListener('click', async () => {
    await apply(null, 'dark');
    window.bubbleColoursProof = { ...window.bubbleColoursProof, dark: document.documentElement.dataset.scheme === 'dark' };
    say((ok ? 'bubbles:dark ' : 'bubbles:fail ') + (ok ? detail : problems.join('; ')));
  });
  document.body.append(dark);
  say(ok ? 'bubbles:pass ' + detail : 'bubbles:fail ' + problems.join('; '));
})().catch((error) => {
  const mark = document.createElement('output');
  mark.setAttribute('aria-label', 'bubbles:fail ' + error.message);
  mark.textContent = mark.getAttribute('aria-label');
  document.body.append(mark);
  window.bubbleColoursProof = { ok: false, error: error.message };
});
