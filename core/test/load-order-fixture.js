// Injected only by native test builds (issue 425). The real page signs in to a stand-in server held in this script,
// over an emulated slow link, opens a conversation of synthetic photos at its newest message, and measures what a
// person waits for: the first chat row, the first message and the first picture on screen, and every picture on
// screen. It also records every picture the page asked for and when, so the UI test can say whether anything off
// screen was asked for before what is on screen had arrived. Synthetic records and pictures drawn here only: no
// server, token or account.
//
// The link is the same for every run, so a before and an after differ only by the page: one round trip of
// LINK.rttMs before a response's first byte, LINK.connections requests at once to the one server (more wait their
// turn, as a web view's own connection pool makes them), and LINK.bytesPerMs shared evenly by every response still
// arriving. Each response's size is the size its real counterpart would have, set out below.
//   order:ready <json>   the measurement, once every picture on screen is drawn and the page has settled
//   order:fail <why>     the fixture could not measure
(async () => {
  const LINK = { rttMs: 150, connections: 6, bytesPerMs: 1500 };
  const SIZE = { json: 2000, chats: 12000, messages: 24000, photo: 150000, avatar: 25000 };
  const CHAT = 'fixture-album';
  const PHOTOS = 48;
  const GROUPS = 29;
  const SETTLE_MS = 1500;
  const t0 = performance.now();
  const at = () => Math.round(performance.now() - t0);
  const mark = document.createElement('output');
  mark.dataset.orderFixture = 'true';
  Object.assign(mark.style, { position: 'fixed', bottom: '0', left: '0', zIndex: '9999', fontSize: '1px' });
  const say = (text) => { mark.setAttribute('aria-label', text); mark.textContent = text; };
  document.body.append(mark);
  say('order:boot');
  const until = async (check, what, ms) => {
    const deadline = performance.now() + ms;
    while (!check()) {
      if (performance.now() > deadline) throw new Error('timed out waiting for ' + what);
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
  };

  // The pictures, drawn before the clock that matters starts: each photo its own colour at three by four, each group
  // photo a square, so a picture on screen is plainly a picture.
  const draw = (w, h, hue, label) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = 'hsl(' + hue + ' 60% 55%)';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'hsl(' + ((hue + 180) % 360) + ' 70% 35%)';
    g.fillRect(w * 0.2, h * 0.2, w * 0.6, h * 0.3);
    g.fillStyle = '#ffffff';
    g.font = Math.round(w / 6) + 'px sans-serif';
    g.fillText(label, w * 0.1, h * 0.85);
    return new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.8));
  };
  const pad = (n) => String(n).padStart(2, '0');
  const pictures = new Map();
  for (let i = 0; i < PHOTOS; i += 1) pictures.set('photo-' + pad(i), await draw(240, 320, (i * 37) % 360, pad(i)));
  for (let i = 0; i < GROUPS; i += 1) pictures.set('avatar-' + pad(i), await draw(96, 96, (i * 53) % 360, 'G'));

  // The records, in the API's own shapes.
  const sent = (i) => '2026-01-01T' + pad(Math.floor(i / 60)) + ':' + pad(i % 60) + ':00.000Z';
  const messages = Array.from({ length: PHOTOS }, (_, i) => ({ id: 'm-' + pad(i), chatId: CHAT, fromMe: i % 3 === 0, sender: '+15555550150', senderName: 'Fixture Album', text: 'Fixture photo ' + pad(i), sentAt: sent(i), replyTo: null, read: null, attachments: [{ id: 'photo-' + pad(i), name: 'photo-' + pad(i) + '.jpg', mime: 'image/jpeg', missing: false }], link: null, payloads: 0, reactions: [], historyCursor: 'cursor-' + pad(i) }));
  const album = { id: CHAT, name: 'Fixture Album', isGroup: false, service: 'iMessage', participants: ['+15555550150'], unread: 0, lastMessageAt: sent(PHOTOS), lastMessage: { text: 'Fixture photo ' + pad(PHOTOS - 1) }, members: [{ handle: '+15555550150', name: 'Fixture Album' }] };
  const groups = Array.from({ length: GROUPS }, (_, i) => ({ id: 'fixture-group-' + pad(i), name: 'Fixture Group ' + pad(i), isGroup: true, service: 'iMessage', participants: ['+155555501' + pad(60 + i), '+155555501' + pad(i)], unread: 0, lastMessageAt: sent(i), lastMessage: { text: 'Fixture group text ' + pad(i) }, photo: { id: 'avatar-' + pad(i), name: 'group.jpg', mime: 'image/jpeg', missing: false }, members: [] }));

  // The emulated link.
  const requests = [];
  const waiting = [];
  const arriving = new Set();
  let open = 0;
  let ticking = false;
  const tick = (last) => {
    const now = performance.now();
    const share = arriving.size ? ((now - last) * LINK.bytesPerMs) / arriving.size : 0;
    for (const r of [...arriving]) {
      r.left -= share;
      if (r.left <= 0) finish(r);
    }
    if (arriving.size) setTimeout(() => tick(now), 8);
    else ticking = false;
  };
  const finish = (r) => {
    arriving.delete(r);
    open -= 1;
    r.log.end = at();
    r.resolve(r.answer);
    next();
  };
  const next = () => {
    while (open < LINK.connections && waiting.length) {
      const r = waiting.shift();
      open += 1;
      r.log.start = at();
      r.timer = setTimeout(() => {
        r.timer = null;
        arriving.add(r);
        if (!ticking) {
          ticking = true;
          setTimeout(() => tick(performance.now()), 8);
        }
      }, LINK.rttMs);
    }
  };
  const send = (log, size, answer, signal) => new Promise((resolve, reject) => {
    const r = { log, left: size, answer, resolve };
    requests.push(log);
    log.asked = at();
    const abort = () => {
      if (log.end != null) return;
      log.aborted = at();
      log.end = log.aborted;
      const queued = waiting.indexOf(r);
      if (queued >= 0) waiting.splice(queued, 1);
      else {
        if (r.timer) clearTimeout(r.timer);
        arriving.delete(r);
        open -= 1;
        next();
      }
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    };
    if (signal) signal.addEventListener('abort', abort, { once: true });
    waiting.push(r);
    next();
  });
  const json = (body) => ({ ok: true, status: 200, json: async () => body, blob: async () => new Blob([JSON.stringify(body)]) });
  const bytes = (blob) => ({ ok: true, status: 200, json: async () => null, blob: async () => blob });
  const missing = { ok: false, status: 404, json: async () => ({ error: { code: 'not_found', message: 'No such file.' } }), blob: async () => new Blob([]) };
  window.fetch = async (url, { method = 'GET', signal } = {}) => {
    const u = new URL(url);
    const path = u.pathname;
    const attachment = path.match(/^\/api\/v1\/attachments\/([^/]+)$/);
    if (attachment) {
      const id = decodeURIComponent(attachment[1]);
      const kind = id.startsWith('avatar-') ? 'avatar' : 'photo';
      const blob = pictures.get(id);
      // Judged when it is asked for, since a picture that lands changes the layout under every other one: whether the
      // element asking is on screen, and whether something on screen is still waiting for its picture.
      const tag = kind === 'avatar' ? 'app-avatar' : 'app-attachment';
      const own = [...document.querySelectorAll(tag)].filter((el) => (kind === 'avatar' ? el.photo : el.attachment)?.id === id);
      const waitingOn = [...document.querySelectorAll('app-attachment')].filter((el) => !el.src && el.attachment?.id !== id && shown(el)).map((el) => el.attachment.id);
      return send({ kind, id, part: u.searchParams.get('part') || '', shown: own.some(shown), screenWaiting: waitingOn.length > 0, waitingOn }, blob ? SIZE[kind] : SIZE.json, blob ? bytes(blob) : missing, signal);
    }
    const log = { kind: 'read', id: path };
    if (path === '/api/v1/info') return send(log, SIZE.json, json({ apiVersion: 1, sending: true, product: 'App', serverVersion: '1.0.0' }), signal);
    if (path === '/api/v1/chats') return send(log, SIZE.chats, json({ chats: [album, ...groups].map((c) => ({ ...c })) }), signal);
    if (path === '/api/v1/settings' && method === 'GET') return send(log, SIZE.json, json({ values: {} }), signal);
    if (path === '/api/v1/chats/' + CHAT + '/messages') return send(log, SIZE.messages, json({ messages: messages.map((m) => ({ ...m })), hasMore: false, totalCount: PHOTOS }), signal);
    return send(log, SIZE.json, json({}), signal);
  };
  window.WebSocket = class {
    constructor() { setTimeout(() => this.onopen && this.onopen(), 0); }
    send(raw) {
      const frame = JSON.parse(raw);
      if (frame.type === 'auth') setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify({ type: 'hello', epoch: 'fixture', seq: 0, resumed: false }) }), 0);
    }
    close(code) { setTimeout(() => this.onclose && this.onclose({ code }), 0); }
  };

  // The part of the window an element can be seen in: the window, clipped by every scrolled view it sits in. A row
  // scrolled past its view's edge is still inside the window, under the header or the composer, and cannot be seen.
  const visibleArea = (el) => {
    const area = { top: 0, left: 0, bottom: innerHeight, right: innerWidth };
    for (let n = el.parentElement; n; n = n.parentElement) {
      if (!/(auto|scroll|overlay)/.test(getComputedStyle(n).overflowY)) continue;
      const r = n.getBoundingClientRect();
      area.top = Math.max(area.top, r.top);
      area.left = Math.max(area.left, r.left);
      area.bottom = Math.min(area.bottom, r.bottom);
      area.right = Math.min(area.right, r.right);
    }
    return area;
  };
  // What is on screen: a box of some size inside that area, in an element the page has not hidden.
  const shown = (el) => {
    if (!el || !el.isConnected) return false;
    const b = el.getBoundingClientRect();
    const v = visibleArea(el);
    if (b.width < 1 || b.height < 1 || b.bottom <= v.top || b.top >= v.bottom || b.right <= v.left || b.left >= v.right) return false;
    return getComputedStyle(el).visibility !== 'hidden';
  };
  // Within reach: within one height of that area above or below it, which the page may fetch ahead of a scroll.
  const inReach = (el) => {
    if (!el || !el.isConnected) return false;
    const b = el.getBoundingClientRect();
    const v = visibleArea(el);
    const h = Math.max(0, v.bottom - v.top);
    return h > 0 && b.width >= 1 && b.height >= 1 && b.bottom > v.top - h && b.top < v.bottom + h;
  };
  const times = { firstRow: null, ready: null, open: null, firstMessage: null, firstMedia: null };
  const drawnAt = new Map();
  let watching = true;
  const watch = () => {
    const now = at();
    if (times.firstRow == null && [...document.querySelectorAll('app-chat-list .chat-row')].some(shown)) times.firstRow = now;
    const pane = document.querySelector('app-conversation');
    if (pane && times.open != null) {
      if (times.firstMessage == null && [...pane.querySelectorAll('.bubble-row')].some(shown)) times.firstMessage = now;
      for (const el of pane.querySelectorAll('app-attachment')) {
        const id = el.attachment && el.attachment.id;
        const img = el.querySelector('img.attachment-image');
        if (id && !drawnAt.has(id) && img && img.complete && img.naturalWidth > 0) drawnAt.set(id, now);
        if (times.firstMedia == null && img && img.complete && img.naturalWidth > 0 && shown(img)) times.firstMedia = now;
      }
    }
    if (watching) requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);

  await customElements.whenDefined('app-root');
  const root = document.querySelector('app-root');
  await until(() => root.phase === 'onboarding' || root.phase === 'ready', 'the page to boot', 30000);
  if (root.phase !== 'onboarding') throw new Error('the load order fixture requires empty test storage');
  const started = at();
  await root.start('https://fixture.invalid', 'fixture-token');
  if (root.phase !== 'ready') throw new Error('the page did not sign in: ' + root.problem);
  times.ready = at();
  times.open = at();
  root.open(CHAT, { show: true });

  // Every picture on screen drawn, then a settle so anything the page would go on to ask for is asked for.
  const onScreenIds = () => [...document.querySelectorAll('app-conversation app-attachment')].filter(shown).map((el) => el.attachment.id);
  await until(() => times.firstMessage != null, 'the first message on screen', 60000);
  await until(() => { const ids = onScreenIds(); return ids.length > 0 && ids.every((id) => drawnAt.has(id)); }, 'every picture on screen to draw', 60000);
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

  // A fling up through the history (issue 425): a screen at a time, a screen every FLING.everyMs, the way a person's
  // touch moves the view, then a stop. What a person waits for is the pictures where they stopped; every fetch still
  // going for a row they flung past is spending the link on something they are not looking at.
  const FLING = { screens: 8, everyMs: 60 };
  const view = document.querySelector('app-conversation .messages');
  if (!view) throw new Error('no conversation view to fling');
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const touch = (type) => view.dispatchEvent(new Event(type, { bubbles: true }));
  // What was on screen when the conversation opened, and when the last of it drew, before the fling moves the view.
  const openSeen = onScreenIds();
  const openAllMedia = Math.max(...openSeen.map((id) => drawnAt.get(id)));
  const flungFrom = view.scrollTop;
  const flingStart = at();
  touch('touchstart');
  // Each step moves the view inside a frame, before the browser lays the page out and measures what it shows, as a
  // touch scroll moves it; a step from a timer could land between that measure and its report.
  for (let i = 0; i < FLING.screens; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, i ? FLING.everyMs : 0));
    await frame();
    touch('touchmove');
    view.scrollTop -= view.clientHeight;
  }
  touch('touchend');
  const flingStop = at();
  await frame();
  await frame();
  const stoppedOn = new Set(onScreenIds());
  const photoAsk = () => requests.filter((r) => r.kind === 'photo' && !r.part);
  const reachAtStop = new Set([...document.querySelectorAll('app-conversation app-attachment')].filter(inReach).map((el) => el.attachment.id));
  // Still going when the view stopped: for a row flung past that is now out of reach (stale), and for any row not on
  // screen, one within reach included (going).
  const going = photoAsk().filter((r) => r.asked >= flingStart && r.end == null && !stoppedOn.has(r.id));
  const stale = going.filter((r) => !reachAtStop.has(r.id));
  const passed = photoAsk().filter((r) => r.asked >= flingStart && r.asked <= flingStop && !stoppedOn.has(r.id));
  // A bound, not a failure: the pictures where the view stopped are measured even when they never all draw.
  let stopDrawn = true;
  try {
    await until(() => stoppedOn.size > 0 && [...stoppedOn].every((id) => drawnAt.has(id)), 'every picture where the fling stopped to draw', 60000);
  } catch {
    stopDrawn = false;
  }
  const stopTimes = [...stoppedOn].map((id) => (drawnAt.has(id) ? drawnAt.get(id) - flingStop : null));
  const fling = {
    ...FLING,
    moved: Math.round(flungFrom - view.scrollTop),
    stoppedOn: [...stoppedOn],
    firstMedia: stopTimes.some((t) => t != null) ? Math.min(...stopTimes.filter((t) => t != null)) : null,
    allMedia: stopDrawn ? Math.max(...stopTimes) : null,
    allDrawn: stopDrawn,
    passedAsked: passed.length,
    goingAtStop: going.length,
    staleAtStop: stale.length,
    staleAtStopIds: stale.map((r) => r.id),
  };
  watching = false;

  const photos = requests.filter((r) => r.kind === 'photo' && !r.part);
  // Off screen before on screen: a picture asked for while its own row was off screen and something on screen was
  // still waiting for its picture.
  const early = photos.filter((r) => !r.shown && r.screenWaiting);
  const avatars = requests.filter((r) => r.kind === 'avatar');
  const proof = {
    link: LINK,
    viewport: [innerWidth, innerHeight],
    startedAt: started,
    times: { ...times, allMedia: openAllMedia },
    sinceOpen: { firstMessage: times.firstMessage - times.open, firstMedia: times.firstMedia - times.open, allMedia: openAllMedia - times.open },
    onScreen: openSeen,
    photoRequests: photos.length,
    offscreenBeforeOnscreen: early.length,
    offscreenBeforeOnscreenIds: early.map((r) => r.id),
    offscreenBeforeOnscreenWhile: early.map((r) => ({ id: r.id, asked: r.asked, waitingOn: r.waitingOn })),
    firstAsked: photos.slice().sort((a, b) => a.asked - b.asked).slice(0, 8).map((r) => r.id),
    cancelled: photos.filter((r) => r.aborted != null).length,
    avatarRequests: avatars.length,
    avatarOffscreen: avatars.filter((r) => !r.shown).length,
    fling,
    reads: requests.filter((r) => r.kind === 'read').map((r) => ({ path: r.id, asked: r.asked, end: r.end })),
  };
  window.loadOrderProof = proof;
  say('order:ready ' + JSON.stringify(proof));
})().catch((error) => {
  window.loadOrderProof = { error: error.message };
  const text = 'order:fail ' + error.message;
  const mark = document.querySelector('[data-order-fixture]') || document.createElement('output');
  mark.setAttribute('aria-label', text);
  mark.textContent = text;
  document.body.append(mark);
});
