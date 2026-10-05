// The HTTP and WebSocket API declared in core/spec/api.json. Loopback only; every route but health needs a token
// in the Authorization header whose scope covers it. The routes themselves live one per module in ./routes, mounted
// here by the id they declare in the spec.
import http from 'node:http';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { apiSpec, naming, serverVersion, serverChannel, serverBuild, serverCommit, serverBuiltAt } from './paths.js';
import { createSender } from './send.js';
import { platformOf } from '../../core/app/rules/platform.js';
import { createAttachments } from './attachments.js';
import { createUploads } from './uploads.js';
import { createThemeFonts } from './theme-fonts.js';
import { createLinkMedia } from './link-media.js';
import { createSearch } from './search.js';
import { createSettings } from './settings.js';
import { loadRoutes } from './routes/index.js';
import { allows as scopeAllows } from './scopes.js';
import { createExporter } from './export.js';
import { createWebhooks } from './webhooks.js';
import { createTyping } from './typing.js';
import { configPath, loadConfig, saveConfig } from './config.js';

const TOKEN_PARAMS = ['token', 'access_token', 'auth'];
const badRequest = (code, message, status = 400) => Object.assign(new Error(message), { status, code });
const compile = (routes) => routes.map((r) => {
  const keys = [];
  const re = new RegExp('^' + r.path.replace(/:([A-Za-z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  return { ...r, re, keys };
});

async function mapLimit(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

function readJson(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { reject(badRequest('too_large', 'The request body is too large.', 413)); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
        resolve(v);
      } catch {
        reject(badRequest('bad_json', 'The body must be a JSON object.'));
      }
    });
    req.on('error', reject);
  });
}

export async function startServer({ config, store, engine, log, dataDir, attachmentsRoot, host = '127.0.0.1', port = config.port, epoch = randomUUID(), platform = process.platform, mac = null, restarts = null, diagnostics = null, webhookOptions = {}, themeFetch = globalThis.fetch, linkFetch = globalThis.fetch, updateOutcome = () => null, updatePending = () => false }) {
  const routes = compile(apiSpec.routes);
  const previews = new Map();
  const paging = apiSpec.paging;
  const LIST_TTL_MS = 5 * 60 * 1000;
  const events = [];
  const clients = new Set();
  let seq = 0;
  // An endpoint that keeps failing is switched off in the config file too, with why, so doctor and hooks list show
  // it and a restart does not switch it back on.
  const disableHook = (id, { reason, at, lastError }) => {
    for (const e of (config.webhooks && config.webhooks.endpoints) || []) if (e.id === id) Object.assign(e, { active: false, disabledAt: at, disabledReason: reason, lastError });
    if (!dataDir || !existsSync(configPath(dataDir))) return;
    const saved = loadConfig(dataDir);
    const e = saved.webhooks.endpoints.find((x) => x.id === id);
    if (!e) return;
    Object.assign(e, { active: false, disabledAt: at, disabledReason: reason, lastError });
    saveConfig(dataDir, saved);
  };
  // The hooks hear exactly what a WebSocket client hears, from this one publish, so there is no second list of
  // events to drift from the first.
  const hookLog = log.child('webhook');
  const webhooks = createWebhooks({ endpoints: (config.webhooks && config.webhooks.endpoints) || [], log: hookLog, onDisable: disableHook, ...webhookOptions });

  // except is a token id whose own sockets are left out of this frame, which is how a device's typing reaches the
  // account's OTHER signed-in devices and never bounces back to the device that sent it (issue 230). The hook log
  // still hears every event a socket hears.
  const publish = (name, data, except = null) => {
    seq += 1;
    const ev = { seq, name, data };
    events.push(ev);
    if (events.length > 1000) events.shift();
    const frame = JSON.stringify({ type: 'event', ...ev });
    for (const c of clients) if (c.authed && c.ws.readyState === 1 && (!except || c.id !== except)) c.ws.send(frame);
    webhooks.enqueue(name, data);
  };
  const typing = createTyping({ publish });
  engine.on((name, data) => {
    if (name === 'message.new') noteMessage(data.message);
    // The engine only reports inbound typing when the switch is on and a bridge is already running; with it off this
    // never fires, so no contact indicator is invented (issue 230).
    if (name === 'typing.incoming') { if (config.typing && config.typing.incoming) typing.incoming(data); return; }
    publish(name, data);
  });
  engine.onState((s) => {
    publish('server.state', { engine: s.ready ? 'ready' : 'down', sending: config.sending.enabled });
    if (s.ready) warm();
  });

  const json = (res, status, body) => {
    const s = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(s), 'cache-control': 'no-store' });
    res.end(s);
  };
  const fail = (res, status, code, message, route = 'none', err = null) => {
    if (status >= 500) log.emit('http.error', { route, status, code, error: err ? String(err.message || err) : null });
    json(res, status, { error: { code, message } });
  };
  const bearer = (h) => {
    const m = /^Bearer\s+(\S+)$/i.exec(String(h || ''));
    return m ? m[1] : null;
  };
  const allows = (principal, scope) => scopeAllows(apiSpec, principal, scope);
  const intParam = (url, name, lo, hi, dflt) => {
    const v = url.searchParams.get(name);
    if (v === null) return dflt;
    if (!/^\d+$/.test(v)) throw badRequest('bad_' + name, name + ' must be a whole number');
    return Math.min(hi, Math.max(lo, Number(v)));
  };
  const chatIdOk = (id) => /^\d{1,12}$/.test(id);
  const preview = (m) => ({ text: m.text, fromMe: m.fromMe, sentAt: m.sentAt, attachments: m.attachments.length, link: m.link || null, payloads: m.payloads || 0 });
  // The chat list is held in memory: a live message moves its chat to the top, a message in a chat the list does not
  // hold reads it again, and a list older than LIST_TTL_MS is served while a fresh one is read behind it.
  let held = null;
  let listing = null;
  const readChats = (limit) => {
    if (!listing) {
      listing = engine.chats({ limit })
        .then((chats) => { held = { chats, limit, at: Date.now() }; })
        .finally(() => { listing = null; });
    }
    return listing;
  };
  const chatList = async (limit) => {
    while (!held || held.limit < limit) await readChats(Math.max(limit, held ? held.limit : 0));
    if (Date.now() - held.at > LIST_TTL_MS) readChats(held.limit).catch(() => {});
    return held.chats.slice(0, limit);
  };
  const noteMessage = (m) => {
    const id = String(m.chatId);
    const current = previews.get(id);
    if (!current || !(current.sentAt > m.sentAt)) previews.set(id, preview(m));
    if (!held) return;
    const at = held.chats.findIndex((c) => String(c.id) === id);
    if (at < 0) {
      readChats(held.limit).catch(() => {});
      return;
    }
    const chat = held.chats[at];
    if (chat.lastMessageAt && chat.lastMessageAt > m.sentAt) return;
    held.chats.splice(at, 1);
    held.chats.unshift({ ...chat, lastMessageAt: m.sentAt });
  };
  // A conversation read on one device clears here too: the held list drops its count and every client is told,
  // so the number a client shows is the server's, never its own idea.
  const markRead = (chatId) => {
    const id = String(chatId);
    if (held) {
      const at = held.chats.findIndex((c) => String(c.id) === id);
      if (at >= 0) held.chats[at] = { ...held.chats[at], unread: 0 };
    }
    publish('chat.read', { chatId: id, unread: 0 });
  };
  // One history read per chat at a time. A live message that lands during the read is newer, so it is kept.
  const loading = new Map();
  const loadPreview = (id) => {
    const key = String(id);
    if (previews.has(key)) return Promise.resolve();
    if (!loading.has(key)) {
      const read = engine.messages(id, { limit: 1 })
        .then(({ messages }) => {
          if (messages.length && !previews.has(key)) previews.set(key, preview(messages[messages.length - 1]));
        })
        .catch(() => { /* the chat still lists, without a preview */ })
        .finally(() => loading.delete(key));
      loading.set(key, read);
    }
    return loading.get(key);
  };
  // The list and its previews are read before the first client asks, and again whenever the engine comes back.
  const warm = async () => {
    try {
      const list = await chatList(paging.chats.default);
      await mapLimit(list.slice(0, config.previews), 4, (c) => loadPreview(c.id));
    } catch {
      // The first chat list reads them instead.
    }
  };

  // The conversation's own platform, read from the service the engine reports for its chat (issue 184); the sender
  // chooses the form each platform carries from it. The held chat list answers (and is read if it is not held yet); a
  // chat it does not know reads as unknown, and the sender refuses in place rather than guess.
  const platformOfChat = async (chatId) => {
    let chat = null;
    try {
      chat = (await chatList(paging.chats.default)).find((c) => String(c.id) === String(chatId)) || null;
    } catch {
      // The list could not be read, so the platform is unknown and the sender refuses rather than guess.
    }
    return platformOf(chat);
  };
  const send = createSender({ engine, store, config, log, platformOfChat });

  const exporter = createExporter({ engine, dataDir, log: log.child('export') });
  const ctx = {
    json, fail, badRequest, readJson, engine, store, config, naming, apiSpec, serverVersion, serverChannel, serverBuild, serverCommit, serverBuiltAt, epoch, platform, diagnostics,
    send, react: send.react, paging, typing, mapLimit, intParam, chatIdOk, preview, chatList, loadPreview, previews, markRead, publish, warm,
    attachments: createAttachments({ attachmentsRoot, dataDir, platform }),
    uploads: createUploads({ dataDir, store, limits: apiSpec.uploads }),
    search: createSearch({ engine, paging }),
    settings: createSettings({ store }),
    exporter,
    webhooks,
    mac,
    restarts,
    // How a theme URL is fetched; injected so a test can stand in for the network.
    themeFetch,
    // A theme's fonts, fetched at import and served to the clients (issue 132).
    themeFonts: dataDir ? createThemeFonts({ dataDir, fetchImpl: themeFetch }) : null,
    // A shared video link's media, resolved and cached on the server so a client never reaches the third party
    // (issue 243). The fetch is injected, so a test stands in for the site.
    linkMedia: createLinkMedia({ dataDir, fetchImpl: linkFetch }),
    // The installed server's last update outcome, which info reports so a client that reconnects after a rollback
    // still hears about it. Null for a checkout.
    updateOutcome,
  };
  const handlers = await loadRoutes(apiSpec.routes);
  for (const r of apiSpec.routes) if (!handlers.has(r.id)) throw new Error('no handler for route ' + r.id);

  // A tool call runs through the route it names rather than a second copy of the handler, so the spec, the scope
  // check and the response are the server's own. The request and the response are captured instead of put on a
  // socket, which is what lets the MCP endpoint carry a tool call straight into an existing route.
  const fakeReq = (body) => {
    const listeners = { data: [], end: [] };
    const chunks = body === null || body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
    const req = { on(ev, fn) { (listeners[ev] || (listeners[ev] = [])).push(fn); return req; }, destroy() {} };
    queueMicrotask(() => {
      for (const fn of listeners.data) fn(Buffer.concat(chunks));
      for (const fn of listeners.end) fn();
    });
    return req;
  };
  const captureRes = () => ({
    statusCode: 200, headersSent: false, headers: {}, body: null,
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    writeHead(status, headers) { this.statusCode = status; this.headersSent = true; for (const [k, v] of Object.entries(headers || {})) this.headers[String(k).toLowerCase()] = v; },
    write() { return true; },
    end(chunk) { if (chunk !== undefined) this.body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)); },
    destroy() {},
    on() { return this; },
  });
  const dispatch = async (id, { params = {}, query = {}, body = null, principal = null } = {}) => {
    if (updatePending() && !['health', 'chats'].includes(id)) throw Object.assign(new Error('The server is validating an update.'), { status: 503, code: 'updating' });
    const spec = apiSpec.routes.find((r) => r.id === id);
    if (!spec) throw Object.assign(new Error('No such route.'), { status: 404, code: 'not_found' });
    if (!allows(principal, spec.scope)) throw Object.assign(new Error('This token cannot do that.'), { status: 403, code: 'forbidden' });
    const path = spec.path.replace(/:([A-Za-z]+)/g, (_, key) => {
      if (params[key] === undefined) throw Object.assign(new Error(key + ' is required'), { status: 400, code: 'bad_' + key });
      return encodeURIComponent(params[key]);
    });
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) search.set(k, String(v));
    const url = new URL(path + (search.toString() ? '?' + search.toString() : ''), 'http://127.0.0.1');
    const res = captureRes();
    try {
      await handlers.get(id)({ ...ctx, req: fakeReq(body), res, url, params, principal });
    } catch (e) {
      if (!e.status) throw e;
      res.statusCode = e.status;
      res.body = Buffer.from(JSON.stringify({ error: { code: e.code, message: e.message } }));
    }
    const text = res.body ? res.body.toString('utf8') : '';
    let parsed;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: res.statusCode, body: parsed, binary: String(res.headers['content-type'] || '').startsWith('image/') };
  };
  ctx.dispatch = dispatch;

  async function handle(req, res) {
    const t0 = performance.now();
    const url = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'authorization, content-type, traceparent');
    res.setHeader('access-control-allow-methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('access-control-max-age', '600');
    if (req.method === 'OPTIONS') {
      res.setHeader('access-control-allow-private-network', 'true');
      res.writeHead(204);
      res.end();
      return;
    }
    let route = null;
    const params = {};
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(url.pathname);
      if (m) {
        route = r;
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        break;
      }
    }
    if (!route) return fail(res, 404, 'not_found', 'No such route.');
    // During probation only the health probes run. No send, settings change, upload or export can be accepted
    // and then erased by a rollback. Read the durable gate on each request, before any asynchronous work.
    if (updatePending() && !['health', 'chats'].includes(route.id)) return fail(res, 503, 'updating', 'The server is validating an update.');
    if (TOKEN_PARAMS.some((k) => url.searchParams.has(k))) {
      log.emit('auth.refused', { route: route.id, reason: 'token_in_url' });
      return fail(res, 400, 'token_in_url', 'Send the token in the Authorization header, never in the URL.');
    }
    let principal = null;
    if (route.scope !== 'none') {
      const tok = bearer(req.headers.authorization);
      principal = tok ? store.findToken(tok) : null;
      if (!principal) {
        log.emit('auth.refused', { route: route.id, reason: tok ? 'unknown_token' : 'no_token' });
        return fail(res, 401, 'unauthorized', 'A valid token is required.');
      }
      if (!allows(principal, route.scope)) {
        log.emit('auth.refused', { route: route.id, reason: 'scope' });
        return fail(res, 403, 'forbidden', 'This token cannot do that.');
      }
    }
    try {
      await handlers.get(route.id)({ ...ctx, req, res, url, params, principal });
    } catch (e) {
      if (res.headersSent) { res.destroy(); return undefined; }
      if (e.status) return fail(res, e.status, e.code, e.message, route.id);
      if (e.code === -32002 || e.code === 'engine_down' || e.code === 'engine_exit') return fail(res, 503, 'engine_unavailable', 'The server cannot read Messages right now. Run doctor on the Mac.', route.id, e);
      if (e.code === 'timeout') return fail(res, 504, 'engine_timeout', 'Messages took too long to answer.', route.id, e);
      if (typeof e.code === 'number') return fail(res, 502, 'engine_error', 'Messages could not answer that.', route.id, e);
      return fail(res, 500, 'internal', 'Something went wrong on the server.', route.id, e);
    }
    log.emit('http.request', { route: route.id, status: res.statusCode, ms: Math.round(performance.now() - t0) });
    return undefined;
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      try { fail(res, 500, 'internal', 'Something went wrong on the server.', 'none', e); } catch { res.destroy(); }
    });
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 65536 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== apiSpec.websocket.path) { socket.destroy(); return; }
    if (TOKEN_PARAMS.some((k) => url.searchParams.has(k))) {
      log.emit('ws.refused', { reason: 'token_in_url' });
      socket.end('HTTP/1.1 400 Bad Request\r\nconnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => onSocket(ws));
  });

  function onSocket(ws) {
    const c = { ws, authed: false, alive: true, id: null };
    clients.add(c);
    const timer = setTimeout(() => {
      if (!c.authed) {
        log.emit('ws.refused', { reason: 'auth_timeout' });
        ws.close(4401, 'unauthorized');
      }
    }, 5000);
    ws.on('pong', () => { c.alive = true; });
    ws.on('message', (buf) => {
      if (c.authed) return;
      let f = null;
      try { f = JSON.parse(String(buf)); } catch { /* refused below */ }
      const p = f && f.type === 'auth' ? store.findToken(f.token) : null;
      clearTimeout(timer);
      if (!p || !allows(p, apiSpec.websocket.scope)) {
        log.emit('ws.refused', { reason: p ? 'scope' : 'unknown_token' });
        ws.close(4401, 'unauthorized');
        return;
      }
      c.authed = true;
      c.id = p.id;
      const r = f.resume;
      const oldest = events.length ? events[0].seq : seq + 1;
      const resumed = Boolean(r && r.epoch === epoch && Number.isInteger(r.seq) && r.seq >= oldest - 1 && r.seq <= seq);
      ws.send(JSON.stringify({ type: 'hello', epoch, seq, apiVersion: apiSpec.version, resumed }));
      if (resumed) for (const ev of events) if (ev.seq > r.seq) ws.send(JSON.stringify({ type: 'event', ...ev }));
    });
    ws.on('close', () => {
      clearTimeout(timer);
      clients.delete(c);
      // The last socket of a device that was typing ends its typing for every conversation, so a dropped connection
      // never leaves an indicator up (issue 230).
      if (c.id && ![...clients].some((x) => x.id === c.id)) typing.stopFrom(c.id);
    });
    ws.on('error', (e) => log.emit('ws.error', { error: e.message }));
  }

  const beat = setInterval(() => {
    for (const c of clients) {
      if (!c.alive) { c.ws.terminate(); continue; }
      c.alive = false;
      try { c.ws.ping(); } catch { /* closed */ }
    }
  }, 25000);
  beat.unref();

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.off('error', reject); resolve(); });
  });
  const addr = server.address();
  log.emit('server.ready', { port: addr.port, host: addr.address });
  const warmed = engine.info().ready ? warm() : Promise.resolve();

  return {
    port: addr.port,
    warmed,
    address: addr.address,
    epoch,
    publish,
    webhooks,
    /**
     * The updater's gate before a switch: hold() stops new sends and exports, busy() says what is still running, and
     * release() lets them through again when the switch does not happen.
     */
    quiesce: {
      hold() { send.hold(); exporter.hold(); },
      release() { send.release(); exporter.release(); },
      busy: () => ({ sends: send.inFlight(), exporting: exporter.running() }),
    },
    /** Read the hook endpoints again from a new config, as the run command does on SIGHUP. */
    reloadHooks(next) {
      config.webhooks = next.webhooks;
      webhooks.setEndpoints(next.webhooks.endpoints);
      hookLog.emit('webhook.reloaded', { endpoints: next.webhooks.endpoints.length, active: next.webhooks.endpoints.filter((e) => e.active !== false).length });
    },
    async close() {
      webhooks.close();
      typing.stopAll();
      clearInterval(beat);
      for (const c of clients) {
        try { c.ws.close(1012, 'restarting'); } catch { /* gone */ }
        setTimeout(() => c.ws.terminate(), 1000).unref();
      }
      wss.close();
      const closed = new Promise((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      await closed;
    },
  };
}
