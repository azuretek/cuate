// Pure: the push relay's rules (issue 347). The relay is a function in our Firebase project that holds the only
// credential able to send through Firebase Cloud Messaging, so no server and no build ever carries it. A server hands it
// a notification it has already encrypted for one phone, and the relay passes it on without being able to read it.
//
// The relay accepts a send only for a phone that registered through it: registering checks the phone's push token with
// Firebase and answers a ticket, a signature over that token made with a secret only the relay holds. A send carries the
// token and its ticket, so a caller can reach only the phones it registered, never an arbitrary one.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const TICKET_VERSION = 'v1';
// Firebase registration tokens are a few hundred characters; anything far longer is not one.
export const TOKEN_MAX = 4096;
// The encrypted notification, base64url. Firebase allows 4096 bytes of data per message, so this leaves room for the
// envelope around it.
export const SEALED_MAX = 3000;
const B64URL = /^[A-Za-z0-9_-]+$/;

const sign = (secret, token) => createHmac('sha256', secret).update(TICKET_VERSION + ':' + token).digest('base64url');

export function ticketFor(secret, token) {
  if (!secret) throw new Error('the relay has no ticket secret');
  return TICKET_VERSION + '.' + sign(secret, token);
}

export function ticketValid(secret, token, ticket) {
  if (!secret || typeof ticket !== 'string' || typeof token !== 'string') return false;
  const [version, mac] = ticket.split('.');
  if (version !== TICKET_VERSION || !mac || !B64URL.test(mac)) return false;
  const want = Buffer.from(sign(secret, token));
  const got = Buffer.from(mac);
  return want.length === got.length && timingSafeEqual(want, got);
}

const tokenOk = (t) => typeof t === 'string' && t.length > 0 && t.length <= TOKEN_MAX && /^[\w:.-]+$/.test(t);

// A registration names one push token and the platform it came from.
export function readRegister(body) {
  const b = body && typeof body === 'object' ? body : {};
  if (!tokenOk(b.token)) return { error: 'token' };
  if (b.platform !== 'ios' && b.platform !== 'android') return { error: 'platform' };
  return { token: b.token, platform: b.platform };
}

// A send names the token, its ticket and the sealed notification, and nothing the relay could read.
export function readSend(body) {
  const b = body && typeof body === 'object' ? body : {};
  if (!tokenOk(b.token)) return { error: 'token' };
  if (typeof b.ticket !== 'string' || b.ticket.length > 128) return { error: 'ticket' };
  if (typeof b.sealed !== 'string' || !b.sealed.length || b.sealed.length > SEALED_MAX || !B64URL.test(b.sealed)) return { error: 'sealed' };
  const badge = b.badge === undefined ? null : Number(b.badge);
  if (badge !== null && !(Number.isInteger(badge) && badge >= 0 && badge <= 99999)) return { error: 'badge' };
  return { token: b.token, ticket: b.ticket, sealed: b.sealed, badge };
}

// The message Firebase delivers. The phone opens the sealed payload itself: on the iPhone a notification service
// extension replaces the placeholder alert before it is shown, which needs mutable-content; on Android the app's
// messaging service draws the notification from the data. The placeholder is all anyone sees if the phone cannot open it.
export function fcmMessage({ token, sealed, badge }) {
  const aps = { 'mutable-content': 1, alert: { title: 'New message' }, sound: 'default' };
  if (badge !== null && badge !== undefined) aps.badge = badge;
  return {
    token,
    data: { v: '1', sealed },
    apns: { headers: { 'apns-priority': '10', 'apns-push-type': 'alert' }, payload: { aps } },
    android: { priority: 'high' },
  };
}

// A fixed window per key: at most limit calls each windowMs. It lives in the function's memory, so it bounds each
// running copy; the function's instance cap bounds how many copies there are.
export function rateLimiter({ limit, windowMs, now = () => Date.now(), maxKeys = 50000 }) {
  const seen = new Map();
  return (key) => {
    const t = now();
    const cur = seen.get(key);
    if (!cur || t - cur.start >= windowMs) {
      if (seen.size >= maxKeys) seen.clear();
      seen.set(key, { start: t, count: 1 });
      return true;
    }
    cur.count += 1;
    return cur.count <= limit;
  };
}

// Firebase's answer for a token that no longer reaches a phone. The relay reports it so the server can forget it.
export const GONE_CODES = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token']);
