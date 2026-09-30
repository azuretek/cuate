// Phase 2d: outbound webhooks. One signed POST per live message, retried with a backoff until the endpoint accepts
// it or it is given up on. Delivery never sits on the server's path: an endpoint that is slow or down is retried off
// to the side, so a dead endpoint cannot stall the server.
import { createHmac, randomUUID } from 'node:crypto';

export const MESSAGE_EVENT = 'message.new';
const accepted = (status) => status >= 200 && status < 300;

/** The signature over the exact body, so a receiver can prove a delivery came from this server and was not changed. */
export function sign(secret, body) {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

export function createWebhooks({
  engine = null,
  endpoints = [],
  log = null,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  retryDelaysMs = [1000, 2000, 4000, 8000],
  timeoutMs = 10000,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const subs = endpoints.map((e) => ({
    id: String(e.id),
    url: String(e.url),
    secret: String(e.secret),
    events: Array.isArray(e.events) && e.events.length ? e.events.slice() : [MESSAGE_EVENT],
    active: e.active !== false,
  }));
  const stats = { queued: 0, delivered: 0, gaveUp: 0 };
  const inflight = new Set();
  let closed = false;

  function gaveUp(sub, payload, attempts, status, error) {
    stats.gaveUp += 1;
    if (log) log.emit('webhook.gaveup', { endpoint: sub.id, trigger: payload.event, attempts, status: status == null ? undefined : status, error: error == null ? undefined : error });
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
            headers: { 'content-type': 'application/json', 'x-webhook-event': payload.event, 'x-webhook-id': payload.id, 'x-webhook-signature': sign(sub.secret, body) },
            body,
            signal: ctl.signal,
          });
        } finally {
          clearTimeout(timer);
        }
        if (accepted(res.status)) {
          stats.delivered += 1;
          if (log) log.emit('webhook.delivered', { endpoint: sub.id, trigger: payload.event, attempts: attempt + 1, status: res.status });
          return;
        }
        if (last) return gaveUp(sub, payload, attempt + 1, res.status, null);
      } catch (e) {
        if (last) return gaveUp(sub, payload, attempt + 1, null, String(e.message || e));
      }
      await sleep(retryDelaysMs[attempt]);
    }
  }

  // Queueing is synchronous and never awaits the network, which is what keeps a live message off the server's path.
  function enqueue(name, data) {
    if (closed || name !== MESSAGE_EVENT) return;
    const payload = { id: randomUUID(), event: name, sentAt: new Date(now()).toISOString(), data };
    const body = JSON.stringify(payload);
    for (const sub of subs) {
      if (!sub.active || !sub.events.includes(name)) continue;
      stats.queued += 1;
      const p = post(sub, payload, body).catch(() => {});
      inflight.add(p);
      p.finally(() => inflight.delete(p));
    }
  }

  if (engine && typeof engine.on === 'function') engine.on((name, data) => enqueue(name, data));

  return {
    endpoints: subs,
    stats,
    enqueue,
    async drain() { while (inflight.size) await Promise.all([...inflight]); },
    close() { closed = true; },
  };
}
