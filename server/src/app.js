// The HTTP and WebSocket API declared in core/spec/api.json. Loopback only; every route but health needs a token
// in the Authorization header whose scope covers it.
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { realpath, stat, mkdir, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { apiSpec, naming, serverVersion } from './paths.js';
import { createSender } from './send.js';

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

export async function startServer({ config, store, engine, log, dataDir, attachmentsRoot, host = '127.0.0.1', port = config.port, epoch = randomUUID(), platform = process.platform }) {
  const routes = compile(apiSpec.routes);
  const send = createSender({ engine, store, config, log });
  const previews = new Map();
  const events = [];
  const clients = new Set();
  let seq = 0;

  const publish = (name, data) => {
    seq += 1;
    const ev = { seq, name, data };
    events.push(ev);
    if (events.length > 1000) events.shift();
    const frame = JSON.stringify({ type: 'event', ...ev });
    for (const c of clients) if (c.authed && c.ws.readyState === 1) c.ws.send(frame);
  };
  engine.on((name, data) => {
    if (name === 'message.new') {
      const m = data.message;
      previews.set(m.chatId, { text: m.text, fromMe: m.fromMe, sentAt: m.sentAt, attachments: m.attachments.length });
    }
    publish(name, data);
  });
  engine.onState((s) => publish('server.state', { engine: s.ready ? 'ready' : 'down', sending: config.sending.enabled }));

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
  const allows = (principal, scope) => scope === 'any' || (apiSpec.scopes[principal.scope] || []).includes(scope);
  const intParam = (url, name, lo, hi, dflt) => {
    const v = url.searchParams.get(name);
    if (v === null) return dflt;
    if (!/^\d+$/.test(v)) throw badRequest('bad_' + name, name + ' must be a whole number');
    return Math.min(hi, Math.max(lo, Number(v)));
  };
  const chatIdOk = (id) => /^\d{1,12}$/.test(id);
  const preview = (m) => ({ text: m.text, fromMe: m.fromMe, sentAt: m.sentAt, attachments: m.attachments.length });

  const handlers = {
    async health({ res }) {
      json(res, 200, { ok: true });
    },
    async info({ res }) {
      json(res, 200, { product: naming.product, apiVersion: apiSpec.version, serverVersion, epoch, engine: engine.info(), sending: config.sending.enabled });
    },
    async chats({ res, url }) {
      const limit = intParam(url, 'limit', 1, 500, 200);
      const list = await engine.chats({ limit });
      const missing = list.slice(0, config.previews).filter((c) => !previews.has(c.id));
      await mapLimit(missing, 4, async (c) => {
        try {
          const { messages } = await engine.messages(c.id, { limit: 1 });
          if (messages.length) previews.set(c.id, preview(messages[messages.length - 1]));
        } catch {
          // The chat still lists, without a preview.
        }
      });
      json(res, 200, { chats: list.map((c) => ({ ...c, lastMessage: previews.get(c.id) || null })) });
    },
    async messages({ res, url, params }) {
      if (!chatIdOk(params.chatId)) throw badRequest('bad_chat', 'Unknown chat id.');
      const limit = intParam(url, 'limit', 1, 200, 50);
      const before = url.searchParams.get('before');
      if (before !== null && !Number.isFinite(Date.parse(before))) throw badRequest('bad_before', 'before must be an ISO 8601 time');
      json(res, 200, await engine.messages(params.chatId, { limit, before: before ? new Date(Date.parse(before)).toISOString() : null }));
    },
    async send({ req, res, params }) {
      if (!chatIdOk(params.chatId)) throw badRequest('bad_chat', 'Unknown chat id.');
      const body = await readJson(req, 65536);
      for (const k of Object.keys(body)) if (k !== 'text' && k !== 'clientKey') throw badRequest('bad_body', 'Unknown field ' + k + '.');
      const text = typeof body.text === 'string' ? body.text : '';
      const clientKey = typeof body.clientKey === 'string' ? body.clientKey : '';
      if (!text.trim() || text.length > 10000) throw badRequest('bad_text', 'text must be 1 to 10,000 characters');
      if (!/^[A-Za-z0-9_-]{8,100}$/.test(clientKey)) throw badRequest('bad_client_key', 'clientKey must be 8 to 100 letters, digits, dashes or underscores');
      const r = await send(params.chatId, text, clientKey);
      if (r.error) return fail(res, r.http, r.error[0], r.error[1], 'send');
      return json(res, r.http, r.body);
    },
    async attachment({ res, url, params }) {
      const id = params.attachmentId;
      if (!/^[A-Za-z0-9_-]{10,64}$/.test(id)) throw badRequest('bad_attachment', 'Unknown attachment id.');
      const rec = store.getAttachment(id);
      if (!rec) return fail(res, 404, 'attachment_unknown', 'The server does not know that attachment. Reload the conversation.');
      const root = await realpath(attachmentsRoot).catch(() => null);
      const expanded = rec.path.startsWith('~/') ? path.join(os.homedir(), rec.path.slice(2)) : rec.path;
      const real = await realpath(expanded).catch(() => null);
      if (!root || !real || !(real === root || real.startsWith(root + path.sep))) return fail(res, 404, 'attachment_missing', 'That attachment is not on the Mac.');
      let file = real;
      let mime = rec.mime;
      if (url.searchParams.get('format') === 'jpeg' && /heic|heif/i.test(rec.mime) && platform === 'darwin') {
        file = await toJpeg(real, id);
        mime = 'image/jpeg';
      }
      const st = await stat(file);
      res.writeHead(200, { 'content-type': mime, 'content-length': st.size, 'cache-control': 'private, max-age=86400', 'content-disposition': 'inline' });
      createReadStream(file).on('error', () => res.destroy()).pipe(res);
      return undefined;
    },
  };
  for (const r of routes) if (!handlers[r.id]) throw new Error('no handler for route ' + r.id);

  async function toJpeg(src, id) {
    const dir = path.join(dataDir, 'cache');
    await mkdir(dir, { recursive: true });
    const out = path.join(dir, id + '.jpg');
    try {
      await access(out);
      return out;
    } catch {
      // Not converted yet.
    }
    await new Promise((resolve, reject) => execFile('sips', ['-s', 'format', 'jpeg', src, '--out', out], { timeout: 30000 }, (err) => (err ? reject(err) : resolve())));
    return out;
  }

  async function handle(req, res) {
    const t0 = performance.now();
    const url = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'authorization, content-type, traceparent');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
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
      await handlers[route.id]({ req, res, url, params, principal });
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
    const c = { ws, authed: false, alive: true };
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
      const r = f.resume;
      const oldest = events.length ? events[0].seq : seq + 1;
      const resumed = Boolean(r && r.epoch === epoch && Number.isInteger(r.seq) && r.seq >= oldest - 1 && r.seq <= seq);
      ws.send(JSON.stringify({ type: 'hello', epoch, seq, apiVersion: apiSpec.version, resumed }));
      if (resumed) for (const ev of events) if (ev.seq > r.seq) ws.send(JSON.stringify({ type: 'event', ...ev }));
    });
    ws.on('close', () => { clearTimeout(timer); clients.delete(c); });
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

  return {
    port: addr.port,
    address: addr.address,
    epoch,
    publish,
    async close() {
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
