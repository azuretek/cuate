// The relay's HTTP handling, with Firebase passed in so the tests drive it with a fake (issue 347). Two routes:
// POST /register checks a push token with Firebase and answers its ticket; POST /send passes a sealed notification on.
// Neither ever sees what a notification says.
import { readRegister, readSend, ticketFor, ticketValid, fcmMessage, rateLimiter, GONE_CODES } from './rules.js';

export const LIMITS = { registerPerMinute: 10, sendPerMinute: 30 };

export function createHandler({ send, secret, now, log = () => {} }) {
  const registers = rateLimiter({ limit: LIMITS.registerPerMinute, windowMs: 60000, now });
  const sends = rateLimiter({ limit: LIMITS.sendPerMinute, windowMs: 60000, now });
  return async function handle({ method, path, ip, body }) {
    if (method !== 'POST') return { status: 405, body: { error: 'method' } };
    if (path === '/register') {
      if (!registers(ip || 'unknown')) return { status: 429, body: { error: 'rate' } };
      const r = readRegister(body);
      if (r.error) return { status: 400, body: { error: r.error } };
      // A dry run asks Firebase whether the token reaches a phone without sending anything to it.
      try { await send({ token: r.token, data: { v: '1', probe: '1' } }, true); }
      catch (e) { return GONE_CODES.has(e && e.code) ? { status: 410, body: { error: 'gone' } } : { status: 502, body: { error: 'upstream' } }; }
      log('register', { platform: r.platform });
      return { status: 200, body: { ticket: ticketFor(secret, r.token) } };
    }
    if (path === '/send') {
      const s = readSend(body);
      if (s.error) return { status: 400, body: { error: s.error } };
      if (!ticketValid(secret, s.token, s.ticket)) return { status: 403, body: { error: 'ticket' } };
      if (!sends(s.ticket)) return { status: 429, body: { error: 'rate' } };
      try { await send(fcmMessage(s), false); }
      catch (e) { return GONE_CODES.has(e && e.code) ? { status: 410, body: { error: 'gone' } } : { status: 502, body: { error: 'upstream' } }; }
      log('send', {});
      return { status: 200, body: { ok: true } };
    }
    return { status: 404, body: { error: 'route' } };
  };
}
