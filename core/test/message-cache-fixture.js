// Injected only by native test builds and the desktop proof (issue 441). It measures what opening the app costs over a
// slow link, with the device's message store and without it: the bytes the server sends and the time from sign-in to
// the first message drawn in the conversation opened, on a cold open (an empty store) and on a warm open (a relaunch
// over the store the cold open left). The real page signs in to a stand-in server held in this script, which answers
// the API's own shapes over an emulated slow link (a round trip and a bandwidth every response shares), and counts
// every byte it answers. Synthetic records and pictures only: no server, token or account.
//
//   window.fixtureCacheMode  'on' (the store as shipped) or 'off' (a web view with no IndexedDB, which is the page as it
//                            was before the store)
//   window.fixtureCacheRun   'cold' (the store is emptied first) or 'warm' (the store is what the last run left)
//
// It says where it is on a marker the native test reads, and in window.messageCacheState:
//   cache:result <json>      the measurement
//   cache:fail <why>         the fixture could not take it
(async () => {
  const MODE = window.fixtureCacheMode === 'off' ? 'off' : 'on';
  const RUN = window.fixtureCacheRun === 'warm' ? 'warm' : 'cold';
  // The emulated link: a slow mobile connection, as browsers' own throttling presets name it.
  const RTT_MS = 400;
  const BYTES_PER_SECOND = 50 * 1024;
  const CHAT_COUNT = 24;
  const HISTORY = 120;
  const SERVER = 'https://fixture.invalid';
  const mark = document.createElement('output');
  Object.assign(mark.style, { position: 'fixed', bottom: '0', left: '0', zIndex: '9999', fontSize: '1px' });
  const say = (text) => { window.messageCacheState = text; mark.setAttribute('aria-label', text); mark.textContent = text; };
  document.body.append(mark);
  say('cache:starting');
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const until = async (check, what, ms) => {
    const deadline = performance.now() + ms;
    while (!check()) {
      if (performance.now() > deadline) throw new Error('timed out waiting for ' + what);
      await frame();
    }
  };
  try {
    await customElements.whenDefined('app-root');
    const root = document.querySelector('app-root');
    await until(() => root.phase !== 'boot', 'the app to boot', 30000);
    if (root.phase !== 'onboarding') throw new Error('the message cache fixture requires empty test storage');

    if (MODE === 'off') Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true });
    else if (RUN === 'cold') {
      await new Promise((resolve) => {
        const q = indexedDB.deleteDatabase('message-store');
        q.onsuccess = q.onerror = q.onblocked = () => resolve();
      });
    }

    // The synthetic pictures: noise a JPEG cannot shrink to nothing, at a phone photo's shape, made before the clock
    // starts so drawing them is never measured.
    let seed = 441;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const picture = async (hue) => {
      const canvas = document.createElement('canvas');
      canvas.width = 300;
      canvas.height = 400;
      const g = canvas.getContext('2d');
      g.fillStyle = 'hsl(' + hue + ', 60%, 50%)';
      g.fillRect(0, 0, 300, 400);
      for (let i = 0; i < 1400; i += 1) {
        g.fillStyle = 'hsla(' + Math.floor(rand() * 360) + ', 70%, ' + Math.floor(rand() * 100) + '%, 0.7)';
        g.fillRect(rand() * 300, rand() * 400, 4 + rand() * 18, 4 + rand() * 18);
      }
      return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    };
    const pictures = [];
    for (let i = 0; i < 8; i += 1) pictures.push(await picture(i * 45));

    // The server's history. A warm run's server has moved on since the cold run: one message edited and one new.
    const at = (n) => new Date(Date.UTC(2026, 0, 1, 9, 0, 0) + n * 60000).toISOString();
    const words = 'synthetic fixture words for a message that is long enough to look like a real one in a conversation';
    const message = (chatId, n) => {
      const pictureAt = chatId === 'c1' && n > HISTORY - 50 && n % 6 === 0 ? (n / 6) % pictures.length : -1;
      return {
        id: chatId + '-m' + n, chatId, fromMe: n % 3 === 0, sender: n % 3 === 0 ? null : '+15555550' + String(100 + (n % 7)), senderName: null,
        text: 'Fixture ' + n + ' ' + words.slice(0, 20 + (n * 7) % 80), sentAt: at(n), replyTo: null, read: null, readAt: null,
        attachments: pictureAt >= 0 ? [{ id: 'att' + n, name: 'fixture-' + n + '.jpg', mime: 'image/jpeg', bytes: pictures[pictureAt].size, sticker: false, missing: false }] : [],
        link: null, payloads: 0, reactions: [], historyCursor: (1000 + n) + ':' + n,
      };
    };
    const history = new Map();
    for (let c = 1; c <= CHAT_COUNT; c += 1) {
      const id = 'c' + c;
      const count = id === 'c1' ? HISTORY : 30;
      history.set(id, Array.from({ length: count }, (_, i) => message(id, i + 1)));
    }
    const c1 = history.get('c1');
    const edited = { ...c1[HISTORY - 3], text: 'Fixture edited while the app was closed', edited: true };
    const arrived = message('c1', HISTORY + 1);
    if (RUN === 'warm') { c1[HISTORY - 3] = edited; c1.push(arrived); }
    const pictureFor = (id) => pictures[(Number(String(id).replace('att', '')) / 6) % pictures.length];
    const chats = [...history.entries()].map(([id, list], i) => ({
      id, name: 'Fixture ' + id, isGroup: false, service: 'iMessage', participants: ['+15555550' + String(200 + i)], unread: 0,
      lastMessageAt: list.at(-1).sentAt, lastMessage: { text: list.at(-1).text },
    }));
    const COLD_HEAD = 'v1.' + HISTORY;
    const WARM_HEAD = 'v1.' + (HISTORY + 1);
    const changesAfter = (since) => {
      if (!since) return { cursor: RUN === 'warm' ? WARM_HEAD : COLD_HEAD, reset: true, more: false, messages: [], reactions: [], unsent: [], reads: [] };
      if (RUN === 'warm' && since === COLD_HEAD) return { cursor: WARM_HEAD, more: false, messages: [edited, arrived], reactions: [], unsent: [], reads: [] };
      if (since === COLD_HEAD || since === WARM_HEAD) return { cursor: since, more: false, messages: [], reactions: [], unsent: [], reads: [] };
      return { cursor: RUN === 'warm' ? WARM_HEAD : COLD_HEAD, reset: true, more: false, messages: [], reactions: [], unsent: [], reads: [] };
    };

    // The stand-in server over the emulated link: a round trip, then the body through a link every response shares.
    const asked = [];
    let bytes = 0;
    let pending = 0;
    let lastActivity = performance.now();
    let linkFreeAt = 0;
    const encoder = new TextEncoder();
    // A request the page gives up on (a tile scrolled away, a row reused) is cut off as a real one is: what it had not
    // yet received is never sent, and it is counted as dropped rather than as bytes.
    let dropped = 0;
    const abortable = (signal) => () => {
      if (!signal || !signal.aborted) return;
      dropped += 1;
      throw new DOMException('The request was dropped.', 'AbortError');
    };
    const respond = async (path, body, signal) => {
      const size = body instanceof Blob ? body.size : encoder.encode(JSON.stringify(body)).length;
      const check = abortable(signal);
      await sleep(RTT_MS);
      check();
      const start = Math.max(performance.now(), linkFreeAt);
      linkFreeAt = start + (size / BYTES_PER_SECOND) * 1000;
      await sleep(linkFreeAt - performance.now());
      check();
      bytes += size;
      asked.push({ path, bytes: size });
      return {
        ok: true, status: 200,
        json: async () => (body instanceof Blob ? null : JSON.parse(JSON.stringify(body))),
        blob: async () => (body instanceof Blob ? body : new Blob([JSON.stringify(body)])),
        arrayBuffer: async () => (body instanceof Blob ? body.arrayBuffer() : encoder.encode(JSON.stringify(body)).buffer),
      };
    };
    const route = (url, method) => {
      const u = new URL(url);
      const p = u.pathname;
      const q = u.searchParams;
      if (p === '/api/v1/info') return { apiVersion: 1, sending: true, serverVersion: '1.0.0', engine: { kind: 'fake', version: '1.0.0' } };
      if (p === '/api/v1/chats' && method === 'GET') return { chats: chats.map((c) => ({ ...c })) };
      if (p === '/api/v1/settings' && method === 'GET') return { values: {} };
      if (p === '/api/v1/changes') return changesAfter(q.get('since'));
      const page = /^\/api\/v1\/chats\/([^/]+)\/messages$/.exec(p);
      if (page && method === 'GET') {
        const list = history.get(decodeURIComponent(page[1])) || [];
        const limit = Number(q.get('limit')) || 50;
        const before = q.get('beforeCursor');
        const end = before ? list.findIndex((m) => m.historyCursor === before) : list.length;
        const from = Math.max(0, end - limit);
        return { messages: list.slice(from, end), hasMore: from > 0, ...(q.get('includeTotal') ? { totalCount: list.length } : {}) };
      }
      const file = /^\/api\/v1\/attachments\/([^/]+)$/.exec(p);
      if (file) return pictureFor(decodeURIComponent(file[1]));
      if (/\/read$/.test(p)) return { chatId: p.split('/')[4], unread: 0 };
      return {};
    };
    window.fetch = async (url, init = {}) => {
      const method = init.method || 'GET';
      pending += 1;
      lastActivity = performance.now();
      try {
        const u = new URL(url);
        return await respond(method + ' ' + u.pathname + u.search, route(url, method), init.signal);
      } finally {
        pending -= 1;
        lastActivity = performance.now();
      }
    };
    window.WebSocket = class {
      constructor() { setTimeout(() => this.onopen && this.onopen(), 0); }
      send(raw) {
        const f = JSON.parse(raw);
        if (f.type === 'auth') setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify({ type: 'hello', epoch: 'fixture', seq: 0, resumed: false }) }), 0);
      }
      close(code) { setTimeout(() => this.onclose && this.onclose({ code }), 0); }
    };

    // The clock starts at sign-in, the moment a launch with a token held begins, and the conversation is opened the
    // moment the list is drawn, as a person pressing it would.
    say('cache:measuring');
    const t0 = performance.now();
    const started = root.start(SERVER, 'fixture-token');
    await until(() => root.phase === 'ready' && root.chats.length, 'the conversation list', 60000);
    const listMs = performance.now() - t0;
    const opened = root.open('c1', { show: true });
    const visible = (el) => { const b = el.getBoundingClientRect(); return b.height > 0 && b.bottom > 0 && b.top < innerHeight; };
    const rows = () => [...document.querySelectorAll('app-conversation .bubble-row[data-id]')];
    await until(() => rows().some(visible), 'the first message', 60000);
    const firstVisibleMs = performance.now() - t0;
    const newest = (RUN === 'warm' ? arrived : c1.at(-1)).id;
    await until(() => rows().some((el) => el.dataset.id === newest && visible(el)), 'the newest message', 60000);
    const newestVisibleMs = performance.now() - t0;
    await started;
    await opened;
    // Settled: nothing asked of the server for two seconds, bounded.
    await until(() => pending === 0 && performance.now() - lastActivity > 2000, 'the page to settle', 60000);
    await root.cache?.flush();
    const shownEdit = (root.messages.find((m) => m.id === edited.id) || {}).text === edited.text;
    say('cache:result ' + JSON.stringify({
      mode: MODE, run: RUN, store: Boolean(root.cache), link: { rttMs: RTT_MS, bytesPerSecond: BYTES_PER_SECOND },
      bytes, requests: asked.length, listMs: Math.round(listMs), firstVisibleMs: Math.round(firstVisibleMs), newestVisibleMs: Math.round(newestVisibleMs),
      pageReads: asked.filter((a) => /\/messages/.test(a.path)).length, pictureReads: asked.filter((a) => /\/attachments\//.test(a.path)).length,
      changesReads: asked.filter((a) => /\/changes/.test(a.path)).length, dropped, shownEdit: RUN === 'warm' ? shownEdit : null,
      asked: asked.map((a) => a.path.replace(/\?.*$/, '') + ' ' + a.bytes),
    }));
  } catch (e) {
    say('cache:fail ' + (e && e.message ? e.message : String(e)));
  }
})();
