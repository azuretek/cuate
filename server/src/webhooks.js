// Outbound hooks. Every event the server publishes, the same ones a WebSocket client sees, can go to any number of
// configured endpoints. Each delivery is encrypted for its endpoint (a compact JWE, dir + A256GCM) and signed over a
// timestamp and the exact body, retried with a backoff until the endpoint accepts it or it is given up on, and an
// endpoint that keeps failing is switched off rather than retried forever. Delivery never sits on the server's path:
// queueing is synchronous, so an endpoint that is slow or down cannot stall the server.
import { createCipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { apiSpec } from './paths.js';

export const ALL_EVENTS = '*';
/** The event a test delivery carries. No publish ever sends it, so it reaches only the one hook a test names. */
export const TEST_EVENT = 'hook.test';
export const DEFAULT_EVENTS = ['message.new'];
/** Consecutive given-up deliveries after which an endpoint is switched off. */
export const DISABLE_AFTER_GIVEUPS = 20;
/** An endpoint that has delivered nothing for this long, while deliveries were attempted, is switched off. */
export const DISABLE_AFTER_MS = 24 * 60 * 60 * 1000;

const accepted = (status) => status >= 200 && status < 300;
// A refusal that resending the same body cannot change is not retried. 408 and 429 say "later", so they are.
const final = (status) => status >= 400 && status < 500 && status !== 408 && status !== 429;
const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** The event names an endpoint can ask for: every event the spec names. */
export const eventNames = () => Object.keys(apiSpec.events);

// A value of a declared type with placeholder content: every field present, optional ones too, so a receiver sees the
// whole shape. Nothing in it came from a message.
function placeholder(type, models) {
  const base = type.replace(/\?$/, '');
  if (base.endsWith('[]')) return [placeholder(base.slice(0, -2), models)];
  if (base === 'string') return 'placeholder';
  if (base === 'number') return 0;
  if (base === 'boolean') return false;
  if (base === 'object') return {};
  return Object.fromEntries(Object.entries(models[base]).map(([k, t]) => [k, placeholder(t, models)]));
}

/** Data shaped like an event's, as the spec declares it, with placeholder content. */
export function sampleData(name) {
  const model = apiSpec.events[name];
  if (!model) throw new Error(name + ' is not an event: ' + eventNames().join(', '));
  return placeholder(model, apiSpec.models);
}

/** A new endpoint secret or encryption key: 32 random bytes, base64url. */
export const newKeyMaterial = () => b64url(randomBytes(32));

/** A loopback URL is the only kind allowed in plain http, or with encryption off. */
export function isLoopback(url) {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '::1' || /^127\.\d+\.\d+\.\d+$/.test(host);
  } catch {
    return false;
  }
}

/**
 * The signature header: a timestamp and one v1 HMAC-SHA256 per live secret, each over "t.body". Signing the
 * timestamp lets a receiver refuse a replay; a v1 per secret lets it rotate at its own pace.
 */
export function sign(secrets, body, t) {
  return ['t=' + t, ...secrets.map((s) => 'v1=' + createHmac('sha256', s).update(t + '.' + body).digest('hex'))].join(',');
}

/** Encrypt a value as a compact JWE (alg dir, enc A256GCM), so any standard JOSE library decrypts it. */
export function encrypt({ kid, key }, value) {
  const header = b64url(JSON.stringify({ alg: 'dir', enc: 'A256GCM', kid }));
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'base64url'), iv);
  cipher.setAAD(Buffer.from(header, 'ascii'));
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [header, '', b64url(iv), b64url(ct), b64url(cipher.getAuthTag())].join('.');
}

/** An endpoint as config holds it, read into the shape delivery uses. */
function readEndpoint(e) {
  const events = Array.isArray(e.events) && e.events.length ? e.events.slice() : DEFAULT_EVENTS.slice();
  return {
    id: String(e.id),
    url: String(e.url),
    secrets: (e.secrets || []).map(String),
    key: e.keys && e.keys.length ? e.keys[0] : null,
    encrypt: e.encrypt !== false,
    events,
    all: events.includes(ALL_EVENTS),
    active: e.active !== false,
    giveUps: 0,
    lastDelivered: null,
    firstUndelivered: null,
    lastError: null,
  };
}

export function createWebhooks({
  endpoints = [],
  log = null,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  retryDelaysMs = [1000, 2000, 4000, 8000],
  timeoutMs = 10000,
  disableAfterGiveUps = DISABLE_AFTER_GIVEUPS,
  disableAfterMs = DISABLE_AFTER_MS,
  onDisable = null,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  let subs = endpoints.map(readEndpoint);
  const stats = { queued: 0, delivered: 0, gaveUp: 0, disabled: 0 };
  const inflight = new Set();
  let closed = false;

  function disable(sub, reason) {
    if (!sub.active) return;
    sub.active = false;
    stats.disabled += 1;
    if (log) log.emit('webhook.disabled', { endpoint: sub.id, reason, give_ups: sub.giveUps, error: sub.lastError == null ? undefined : sub.lastError });
    if (onDisable) {
      try { onDisable(sub.id, { reason, at: new Date(now()).toISOString(), lastError: sub.lastError }); } catch { /* the endpoint is off in memory either way */ }
    }
  }

  function gaveUp(sub, payload, attempts, status, error) {
    stats.gaveUp += 1;
    sub.giveUps += 1;
    sub.lastError = status != null ? 'status ' + status : error;
    if (log) log.emit('webhook.gaveup', { endpoint: sub.id, trigger: payload.event, attempts, status: status == null ? undefined : status, error: error == null ? undefined : error });
    if (sub.giveUps >= disableAfterGiveUps) disable(sub, 'give_ups');
    else if (sub.firstUndelivered !== null && now() - sub.firstUndelivered >= disableAfterMs) disable(sub, 'no_delivery');
    return { ok: false, attempts, status, error };
  }

  function delivered(sub, payload, attempts, status) {
    stats.delivered += 1;
    sub.giveUps = 0;
    sub.lastDelivered = now();
    sub.firstUndelivered = null;
    if (log) log.emit('webhook.delivered', { endpoint: sub.id, trigger: payload.event, attempts, status });
    return { ok: true, attempts, status, error: null };
  }

  async function post(sub, payload, body) {
    for (let attempt = 0; ; attempt += 1) {
      const last = attempt >= retryDelaysMs.length;
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), timeoutMs);
        if (timer.unref) timer.unref();
        let res;
        try {
          res = await fetchImpl(sub.url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-webhook-event': payload.event, 'x-webhook-id': payload.id, 'x-webhook-signature': sign(sub.secrets, body, Math.floor(now() / 1000)) },
            body,
            signal: ctl.signal,
          });
        } finally {
          clearTimeout(timer);
        }
        if (accepted(res.status)) return delivered(sub, payload, attempt + 1, res.status);
        if (last || final(res.status)) return gaveUp(sub, payload, attempt + 1, res.status, null);
      } catch (e) {
        if (last) return gaveUp(sub, payload, attempt + 1, null, String(e.message || e));
      }
      await sleep(retryDelaysMs[attempt]);
    }
  }

  // The event name and id stay in the clear so a receiver can route and de-duplicate before decrypting; the data,
  // which is where every private thing lives, is inside the JWE.
  function bodyFor(sub, head, data) {
    return JSON.stringify(sub.encrypt ? { ...head, jwe: encrypt(sub.key, data) } : { ...head, data });
  }

  // One delivery to one endpoint, tracked so drain waits for it; the promise resolves to how it ended.
  function send(sub, head, data) {
    stats.queued += 1;
    if (sub.firstUndelivered === null) sub.firstUndelivered = now();
    const p = post(sub, head, bodyFor(sub, head, data));
    const tracked = p.catch(() => {});
    inflight.add(tracked);
    tracked.finally(() => inflight.delete(tracked));
    return p;
  }

  // Queueing is synchronous and never awaits the network, which is what keeps a live event off the server's path.
  function enqueue(name, data) {
    if (closed || name === TEST_EVENT) return;
    const head = { id: randomUUID(), event: name, sentAt: new Date(now()).toISOString() };
    for (const sub of subs) {
      if (!sub.active || !(sub.all || sub.events.includes(name))) continue;
      send(sub, head, data).catch(() => {});
    }
  }

  /**
   * One test delivery to one endpoint, through the same signing, encryption, retries and log events as a live one.
   * It carries TEST_EVENT and no message content; with a shape, its data is that event's, with placeholder content,
   * and the shape is named in the clear beside the event. Resolves to { ok, attempts, status, error }.
   */
  function test(id, { shape = null } = {}) {
    const sub = subs.find((s) => s.id === id);
    if (!sub) return Promise.reject(new Error('no hook ' + id));
    if (!sub.active) return Promise.reject(new Error('hook ' + id + ' is switched off'));
    const data = shape ? sampleData(shape) : { hook: id, test: true };
    const head = { id: randomUUID(), event: TEST_EVENT, ...(shape ? { shape } : {}), sentAt: new Date(now()).toISOString() };
    return send(sub, head, data);
  }

  return {
    get endpoints() { return subs; },
    stats,
    enqueue,
    test,
    /** Take a new endpoint list, as on a reload. An endpoint kept by id, and still on, keeps its failure count. */
    setEndpoints(list) {
      const before = new Map(subs.map((s) => [s.id, s]));
      subs = list.map((e) => {
        const next = readEndpoint(e);
        const prev = before.get(next.id);
        if (prev && prev.active && next.active) Object.assign(next, { giveUps: prev.giveUps, lastDelivered: prev.lastDelivered, firstUndelivered: prev.firstUndelivered, lastError: prev.lastError });
        return next;
      });
    },
    async drain() { while (inflight.size) await Promise.all([...inflight]); },
    close() { closed = true; },
  };
}
