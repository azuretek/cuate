// History scrolls both ways with nothing to wait for (issue 535). Injected only by native test builds and by
// the packaged desktop history proof. It walks a long conversation the way a reader scrolls it, half a screen at a time,
// up past several evicted pages and back down to the newest message, and every page the page asks for lands only once
// the reader has moved another screen (two more steps), which is a slow link measured in the reader's own movement
// rather than in time. At every step it asserts, from what the page itself reports:
//   - the messages about to come into view were already loaded before the step that shows them (a loaded-ahead fact
//     read from the rows the page drew, never a timer), so no blank space is ever scrolled onto;
//   - each page was asked for while the reader was still about a page from that edge (the reach the page reported when
//     it asked: no fewer loaded messages ahead than its own lead less the screen the last step could cover);
//   - the message at the top of the screen does not move by a pixel when a page lands above or below it;
//   - one page at most is on its way in each direction, every ask starts at the window's own edge, no page brings a
//     message the window already holds, and the window never holds more than three pages.
// Coming back down, the newer pages evicted on the way up are asked for again the same way, and the walk ends on the
// newest message with nothing newer left to load.
// Then the path that showed the old-engine banner (issue 537): at the newest message one message arrives and is laid in,
// the reader scrolls up two steps, a second arrives and is counted past the window, and the reader scrolls down to the
// newest: both are shown and no banner is. Here the pages land as the server answers them, since a message that arrives
// while the reader is a screen from the newest cannot have been asked for a page ahead.
//
// globalThis.historyWalk({ root, chatId, upTo, arrive }) runs the walk on a signed-in page and resolves its report, or
// throws with what it measured. arrive(k, text) makes a message with those words arrive in the conversation by the live
// stream, as the k-th of the last part. The desktop proof calls it against the real server (it sets globalThis.historyWalkHosted
// first); everywhere else this script signs the real page in to a stand-in server held here, with a thousand synthetic
// messages, runs the walk and reports on a marker and on window.historyScrollProof:
//   scroll:pass <json>   every step held
//   scroll:fail <why>    one did not
(() => {
  const STEP = 0.5;
  // A page asked for on one step lands only after the two steps that follow it: one more screen of reading.
  const HOLD_STEPS = 3;
  const PAGE = 50;
  const CAP = PAGE * 3;
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  // After a frame has been painted: a task queued from a frame callback runs once that frame's rendering, its resize
  // handling included, is done, so what it reads is what the reader was shown. Ordered by frames, never by a clock.
  const painted = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
  const until = async (check, what, ms = 20000) => {
    const deadline = performance.now() + ms;
    while (!check()) {
      if (performance.now() > deadline) throw new Error('timed out waiting for ' + what);
      await frame();
    }
  };
  const number = (id) => Number(String(id || '').split('-').at(-1));

  globalThis.historyWalk = async function historyWalk({ root, chatId, upTo, arrive }) {
    const pane = () => root.querySelector('app-conversation');
    const settle = async () => { await root.updateComplete; if (pane()) await pane().updateComplete; await frame(); await frame(); };
    await root.open(chatId, { show: true });
    await settle();
    await until(() => pane() && pane().querySelector('.messages > .bubble-row'), 'the conversation drawn');
    const scroller = () => pane().querySelector('.messages');
    const rows = () => [...scroller().querySelectorAll(':scope > .bubble-row')];
    const client = root.client;
    const ask = client.messages.bind(client);
    const load = root.loadHistory.bind(root);
    const held = [];
    const asks = [];
    const steps = [];
    const landings = [];
    const inFlight = { older: 0, newer: 0 };
    let current = null;
    let walking = true;
    // Whether a page waits for the reader to move on (the walk) or lands as the server answers it (the live part).
    let holding = true;
    const landing = new Set();
    // The loaded messages the reader had ahead each way before the last step moved them, so an ask can be held to the
    // first step on which the reader came within the page's lead.
    const reachOf = () => { const r = pane().historyReach(scroller()); return { older: r.rowsAbove, newer: r.rowsBelow }; };
    let lastReach = reachOf();
    const fail = (what, detail) => { throw new Error(what + ' ' + JSON.stringify(detail)); };
    // Each page the conversation asks for: what the page reported when it asked, held until the reader has moved a
    // screen further. A page from the device's store needs no read, so it lands at once, which is never a wait.
    root.loadHistory = (direction, detail) => {
      const record = { direction };
      current = record;
      record.done = load(direction, detail);
      landing.add(record.done);
      record.done.finally(() => landing.delete(record.done));
      current = null;
      return record.done;
    };
    client.messages = async (id, options = {}) => {
      const direction = options.beforeCursor ? 'older' : options.afterCursor ? 'newer' : null;
      const record = current;
      if (!direction || !walking || !record) return ask(id, options);
      const reported = pane().lastAsk || {};
      // A page is asked from the message nearest the window's edge that has a history cursor: the edge itself, unless the
      // window ends on messages that came by the live stream with none (issue 537).
      const edge = (direction === 'older' ? root.messages : [...root.messages].reverse()).find((m) => m.historyCursor);
      inFlight[direction] += 1;
      const entry = {
        direction, step: steps.length, ahead: reported.direction === direction ? reported.ahead : null, lead: reported.lead, before: lastReach[direction],
        visible: pane().reach?.visibleRows, atEdge: edge?.historyCursor === (options.beforeCursor || options.afterCursor), inFlight: inFlight[direction],
      };
      asks.push(entry);
      record.entry = entry;
      try {
        const page = await ask(id, options);
        entry.answered = true;
        if (holding) await new Promise((resolve) => held.push({ due: entry.step + HOLD_STEPS, resolve, record }));
        // A message the window holds with no cursor is brought again with its cursor, which is no duplicate.
        const kept = new Set(root.messages.filter((m) => m.historyCursor).map((m) => m.id));
        entry.duplicates = page.messages.filter((m) => kept.has(m.id)).length;
        entry.landed = steps.length;
        return page;
      } finally {
        inFlight[direction] -= 1;
      }
    };
    // Where a row sits once the page has settled it, read on painted frames: the keep's place agrees with what is drawn
    // (the item it holds sits where it says), on two frames running. A picture that grows as it loads is put back by the
    // keep, but read before its resize is handled the row is caught mid-correction. Bounded, and read from the page.
    const offsetOf = (id) => { const row = rows().find((r) => r.dataset.id === id); return row ? row.getBoundingClientRect().top - scroller().getBoundingClientRect().top : null; };
    const kept = () => { const a = pane().keep.anchor || {}; if (a.key == null) return true; const at = offsetOf(a.key); return at !== null && Math.abs(at - a.offset) < 1; };
    const settledOffset = async (id) => {
      const deadline = performance.now() + 20000;
      await painted();
      let last = offsetOf(id);
      for (;;) {
        if (performance.now() > deadline) throw new Error('timed out waiting for the page to settle around ' + id);
        await painted();
        const now = offsetOf(id);
        if (now !== null && last !== null && Math.abs(now - last) < 0.5 && kept()) return now;
        last = now;
      }
    };
    // The row at the top of the screen and where it sits, so a page landing can be seen not to move it.
    const topRow = () => {
      const view = scroller().getBoundingClientRect();
      const row = rows().find((r) => r.getBoundingClientRect().bottom > view.top + 1);
      return row ? { id: row.dataset.id, offset: row.getBoundingClientRect().top - view.top } : null;
    };
    const release = async () => {
      const due = held.filter((h) => h.due <= steps.length);
      for (const h of due) {
        held.splice(held.indexOf(h), 1);
        const before = topRow();
        before.offset = await settledOffset(before.id);
        h.resolve();
        await h.record.done;
        await settle();
        if (!rows().some((r) => r.dataset.id === before.id)) fail('the message on screen left the window when a page landed', { before, entry: h.record.entry });
        const drift = (await settledOffset(before.id)) - before.offset;
        landings.push({ direction: h.record.direction, step: steps.length, drift: Math.round(drift * 10) / 10 });
        if (Math.abs(drift) > 1) fail('the message on screen moved when a page landed', { before, after: topRow(), drift, entry: h.record.entry, steps: steps.slice(-6), });
      }
    };
    const check = () => {
      if (root.messages.length > CAP) fail('the window held more than three pages', { rows: root.messages.length });
      if (rows().length > CAP) fail('more than three pages of rows were drawn', { rows: rows().length });
      for (const a of asks) {
        if (a.inFlight > 1) fail('two pages were on their way in one direction', a);
        if (!a.atEdge) fail('a page was asked for from somewhere other than the window edge', a);
        if (a.duplicates) fail('a page brought messages the window already held', a);
        if (a.ahead === null || a.ahead < Math.min(a.lead, a.before) - a.visible) fail('a page was asked for too late, with the reader near the edge', a);
      }
    };
    // Half a screen in the direction of travel. Before it moves, the messages it will bring into view must already be
    // drawn: the loaded rows reach at least that far past the edge of the screen, whenever there is more history that way.
    const step = async (sign) => {
      // Every page asked for has had its answer from the server before the reader moves on, so how far the reader moves
      // before a page lands is counted in steps alone, never in how fast a link or a runner is.
      await until(() => asks.every((a) => a.answered), 'the server to answer the pages asked for');
      if (!holding && landing.size) { await Promise.all([...landing]); await settle(); }
      const el = scroller();
      const view = el.getBoundingClientRect();
      const distance = Math.round(el.clientHeight * STEP);
      const drawn = rows();
      const state = root.historyWindow || {};
      const more = sign < 0 ? state.hasOlder : state.hasNewer;
      const cover = sign < 0 ? view.top - drawn[0].getBoundingClientRect().top : drawn.at(-1).getBoundingClientRect().bottom - view.bottom;
      const reach = pane().historyReach(el);
      const record = { dir: sign < 0 ? 'up' : 'down', top: number(topRow()?.id), first: number(root.messages[0]?.id), last: number(root.messages.at(-1)?.id), ahead: sign < 0 ? reach.rowsAbove : reach.rowsBelow, cover: Math.round(cover), distance, rows: root.messages.length };
      if (more && cover < distance) fail('the messages about to come into view were not loaded before they were needed', { ...record, held: held.length, asks: asks.slice(-3) });
      lastReach = reachOf();
      const place = { ...pane().keep.anchor };
      const from = el.scrollTop;
      pane().keep.onInput();
      el.scrollTop = from + sign * distance;
      await settle();
      record.moved = Math.round(el.scrollTop - from);
      // The page took the reader's scroll as their new place: nothing put the view back to the place it had before the
      // page heard the scroll (a picture growing as it loads used to, a frame ahead of the scroll event).
      const now = pane().keep.anchor || {};
      if (more && now.key === place.key && Math.abs((now.offset ?? 0) - (place.offset ?? 0)) < 1) fail('the reader\'s scroll was undone', { ...record, place, asks: asks.slice(-2) });
      steps.push(record);
      await release();
      check();
      return record;
    };

    // The live part (issue 537), from the newest message.
    const banner = () => /Update the message engine/.test(root.problem || '');
    const heard = (text) => new Promise((resolve) => {
      if (!root.arrivals) root.arrivals = new Set();
      const watch = (m) => { if (m.text === text) { root.arrivals.delete(watch); resolve(m); } };
      root.arrivals.add(watch);
    });
    const come = async (k) => {
      const text = 'Live message ' + k + ' synthetic';
      const message = heard(text);
      await arrive(k, text);
      return message;
    };
    const windowState = () => ({ first: root.messages[0]?.id, last: root.messages.at(-1)?.id, rows: root.messages.length, afterCount: root.historyWindow?.afterCount || 0, hasNewer: Boolean(root.historyWindow?.hasNewer), problem: root.problem || '' });
    async function liveArrivals() {
      walking = true;
      holding = false;
      const first = await come(1);
      await settle();
      await until(() => rows().some((r) => r.dataset.id === first.id), 'the first live message drawn');
      if (root.messages.at(-1)?.id !== first.id || root.historyWindow?.afterCount) fail('the first live message was not laid in as the newest', windowState());
      const up = [await step(-1), await step(-1)];
      const second = await come(2);
      await settle();
      const counted = windowState();
      if (!counted.hasNewer || counted.afterCount < 1 || root.messages.some((m) => m.id === second.id)) fail('the second live message was not counted past the window', counted);
      let still = 0;
      const down = [];
      while (root.historyWindow?.hasNewer || rows().at(-1).getBoundingClientRect().bottom > scroller().getBoundingClientRect().bottom + 1) {
        if (down.length > 40) fail('the walk down never reached the newest live message', windowState());
        const r = await step(1);
        down.push(r);
        if (banner()) fail('the old-engine banner showed on the way down', windowState());
        still = r.moved === 0 ? still + 1 : 0;
        if (still > 3) fail('the view stopped short of the newest live message', { r, ...windowState() });
      }
      if (landing.size) { await Promise.all([...landing]); await settle(); }
      walking = false;
      const shown = rows().map((r) => r.dataset.id);
      const report = { first: first.id, second: second.id, cursors: [Boolean(first.historyCursor), Boolean(second.historyCursor)], counted: counted.afterCount, up: up.length, down: down.length, last: shown.at(-1), bothShown: shown.includes(first.id) && shown.includes(second.id), banner: banner() };
      if (!report.bothShown || report.last !== second.id || root.historyWindow?.hasNewer) fail('the live messages were not both shown at the newest', { ...report, ...windowState() });
      if (report.banner) fail('the old-engine banner showed', { ...report, ...windowState() });
      return report;
    }

    try {
      const newest = number(root.messages.at(-1)?.id);
      while (number(topRow()?.id) > upTo) {
        if (steps.length > 2000) fail('the walk up never reached its turn', { top: topRow() });
        await step(-1);
      }
      const turn = { top: number(topRow()?.id), first: number(root.messages[0]?.id), last: number(root.messages.at(-1)?.id), afterCount: root.historyWindow?.afterCount || 0 };
      const evicted = asks.filter((a) => a.direction === 'older').length - 2;
      if (turn.afterCount <= 0 || evicted < 4) fail('the walk up did not go past several evicted pages', { turn, evicted });
      let still = 0;
      while (root.historyWindow?.hasNewer || rows().at(-1).getBoundingClientRect().bottom > scroller().getBoundingClientRect().bottom + 1) {
        if (steps.length > 4000) fail('the walk down never reached the newest message', { last: root.messages.at(-1)?.id });
        const r = await step(1);
        still = r.moved === 0 ? still + 1 : 0;
        if (still > 3) fail('the view stopped short of the newest message', { r, hasNewer: root.historyWindow?.hasNewer });
      }
      walking = false;
      for (const h of held.splice(0)) h.resolve();
      const end = { last: number(root.messages.at(-1)?.id), shown: number(rows().at(-1)?.dataset.id), hasNewer: Boolean(root.historyWindow?.hasNewer), afterCount: root.historyWindow?.afterCount || 0 };
      if (end.last !== newest || end.shown !== newest || end.hasNewer || end.afterCount) fail('the walk down did not end on the newest message', end);
      const older = asks.filter((a) => a.direction === 'older');
      const newer = asks.filter((a) => a.direction === 'newer');
      if (newer.length < 4) fail('the evicted newer pages were not loaded again on the way down', { newer: newer.length });
      const live = arrive ? await liveArrivals() : null;
      return {
        ok: true, steps: steps.length, turn, end, evicted, older: older.length, newer: newer.length, live,
        minAhead: Math.min(...asks.map((a) => a.ahead)), lead: asks[0]?.lead, minCover: Math.min(...steps.filter((s) => s.cover >= 0).map((s) => s.cover)),
        maxDrift: Math.max(0, ...landings.map((l) => Math.abs(l.drift))), landings: landings.length, maxRows: Math.max(...steps.map((s) => s.rows)),
        asks: asks.map((a) => a.direction[0] + a.step + ':' + a.ahead + '/' + a.lead + '>' + a.landed),
      };
    } finally {
      walking = false;
      for (const h of held.splice(0)) h.resolve();
      client.messages = ask;
      delete root.loadHistory;
    }
  };

  if (globalThis.historyWalkHosted) return;

  // A phone's shell: the real page signed in to a stand-in server held here.
  const mark = document.createElement('output');
  mark.dataset.scrollFixture = 'true';
  Object.assign(mark.style, { position: 'fixed', bottom: '0', left: '0', zIndex: '9999', fontSize: '1px' });
  const say = (text) => { mark.setAttribute('aria-label', text); mark.textContent = text; document.body.append(mark); };
  (async () => {
    say('scroll:boot');
    await customElements.whenDefined('app-root');
    const root = document.querySelector('app-root');
    await until(() => root.phase === 'onboarding' || root.phase === 'ready', 'the page to boot', 30000);
    if (root.phase !== 'onboarding') throw new Error('the history scroll fixture requires empty test storage');
    await new Promise((resolve) => {
      const q = indexedDB.deleteDatabase('message-store');
      q.onsuccess = q.onerror = q.onblocked = () => resolve();
    });
    const CHAT = 'fixture-history';
    const TOTAL = 1000;
    const sam = '+15555550142';
    const words = 'synthetic history words for a message that runs on long enough to wrap onto a second or a third line';
    const at = (n) => new Date(Date.UTC(2026, 0, 1, 9, 0, 0) + n * 60000).toISOString();
    const history = Array.from({ length: TOTAL }, (_, i) => {
      const n = i + 1;
      return { id: 'fixture-' + n, chatId: CHAT, fromMe: n % 3 === 0, sender: n % 3 === 0 ? null : sam, senderName: n % 3 === 0 ? null : 'Sam Example', text: 'Message ' + n + ' ' + words.slice(0, 10 + (n * 37) % 90), sentAt: at(n), replyTo: null, read: null, attachments: [], link: null, payloads: 0, reactions: [], historyCursor: (1000000 + n) + ':' + n };
    });
    const chat = { id: CHAT, name: 'Sam Example', isGroup: false, service: 'iMessage', participants: [sam], members: [{ handle: sam, name: 'Sam Example', photo: null }], unread: 0, lastMessageAt: history.at(-1).sentAt, lastMessage: { text: history.at(-1).text } };
    const route = (url, method) => {
      const u = new URL(url);
      const p = u.pathname;
      const q = u.searchParams;
      if (p === '/api/v1/info') return { apiVersion: 1, sending: true, serverVersion: '1.0.0', engine: { kind: 'fake', version: '1.0.0' } };
      if (p === '/api/v1/chats' && method === 'GET') return { chats: [{ ...chat }] };
      if (p === '/api/v1/settings' && method === 'GET') return { values: {} };
      if (p === '/api/v1/changes') return { cursor: 'v1.' + TOTAL, reset: !q.get('since'), more: false, messages: [], reactions: [], unsent: [], reads: [] };
      if (p === '/api/v1/chats/' + CHAT + '/messages' && method === 'GET') {
        const limit = Number(q.get('limit')) || PAGE;
        const before = q.get('beforeCursor');
        const after = q.get('afterCursor');
        const index = (cursor) => history.findIndex((m) => m.historyCursor === cursor);
        let from;
        let to;
        if (after) { from = index(after) + 1; to = Math.min(history.length, from + limit); } else { to = before ? index(before) : history.length; from = Math.max(0, to - limit); }
        const hasMore = after ? to < history.length : from > 0;
        return { messages: history.slice(from, to).map((m) => ({ ...m })), hasMore, ...(q.get('includeTotal') ? { totalCount: history.length } : {}) };
      }
      if (/\/read$/.test(p)) return { chatId: CHAT, unread: 0 };
      return {};
    };
    window.fetch = async (url, init = {}) => {
      const body = route(url, init.method || 'GET');
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)), blob: async () => new Blob([JSON.stringify(body)]) };
    };
    const sockets = [];
    let seq = 0;
    window.WebSocket = class {
      constructor() { sockets.push(this); setTimeout(() => this.onopen && this.onopen(), 0); }
      send(raw) {
        const f = JSON.parse(raw);
        if (f.type === 'auth') setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify({ type: 'hello', epoch: 'fixture', seq: 0, resumed: false }) }), 0);
      }
      close(code) { sockets.splice(sockets.indexOf(this), 1); setTimeout(() => this.onclose && this.onclose({ code }), 0); }
    };
    await root.start('https://fixture.invalid', 'fixture-token');
    if (root.phase !== 'ready') throw new Error('the page did not sign in: ' + root.problem);
    say('scroll:walking');
    // A message arrives as the live stream carries it from imsg, with no history cursor (issue 537); the server's own pages
    // give it one.
    const arrive = async (k, text) => {
      const n = TOTAL + k;
      const m = { ...history.at(-1), id: 'fixture-' + n, fromMe: false, sender: sam, senderName: 'Sam Example', text, sentAt: at(n), historyCursor: (1000000 + n) + ':' + n };
      history.push(m);
      const { historyCursor, ...streamed } = m;
      void historyCursor;
      const frame = JSON.stringify({ type: 'event', seq: ++seq, name: 'message.new', data: { message: streamed } });
      for (const s of sockets) if (s.onmessage) s.onmessage({ data: frame });
    };
    const report = await globalThis.historyWalk({ root, chatId: CHAT, upTo: 400, arrive });
    window.historyScrollProof = report;
    say('scroll:pass ' + JSON.stringify(report));
  })().catch((error) => {
    window.historyScrollProof = { ok: false, error: error.message };
    say('scroll:fail ' + error.message);
  });
})();
