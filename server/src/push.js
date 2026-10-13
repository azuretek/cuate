// Push notifications with the app closed (issue 347, docs/push.md). A phone registers its push token and a key it made;
// the server registers the token with the relay, which answers a ticket bound to it. For each new message the server
// seals the notification with that phone's key (AES-256-GCM) and hands the relay only the token, the ticket and the
// sealed bytes, so neither the relay nor Firebase, Apple or Google can read who wrote or what they said.
import { createCipheriv, randomBytes } from 'node:crypto';
import { naming } from './paths.js';

/** Our relay, which every release build uses unless the server's config names another (docs/push.md). Its Firebase
 * project is named for the product, so the address is built from naming.json rather than spelled here. */
export const PUSH_RELAY = 'https://us-central1-' + naming.slug + '-push.cloudfunctions.net/relay';
export const PLATFORMS = ['ios', 'android'];
/** The longest message text a notification carries; the phone shows the rest when the conversation opens. */
export const BODY_MAX = 600;
const TIMEOUT_MS = 10000;
const KEY = /^[A-Za-z0-9_-]{43}$/;
const TOKEN = /^[\w:.-]{1,4096}$/;

/** A phone's registration, checked before the relay is asked. */
export function readRegistration(body) {
  const b = body && typeof body === 'object' ? body : {};
  for (const k of Object.keys(b)) if (!['token', 'platform', 'key'].includes(k)) return { error: 'Unknown field ' + k + '.' };
  if (typeof b.token !== 'string' || !TOKEN.test(b.token)) return { error: 'token must be the push token the phone got.' };
  if (!PLATFORMS.includes(b.platform)) return { error: 'platform must be one of ' + PLATFORMS.join(', ') + '.' };
  if (typeof b.key !== 'string' || !KEY.test(b.key) || Buffer.from(b.key, 'base64url').length !== 32) return { error: 'key must be 32 random bytes, base64url.' };
  return { token: b.token, platform: b.platform, key: b.key };
}

/** What a notification says: the sender, the text (or what was sent), and where a tap goes. Nothing else. */
export function notice(m) {
  const files = (m.attachments || []).length;
  const text = String(m.text || '').trim();
  const body = text ? (text.length > BODY_MAX ? text.slice(0, BODY_MAX - 1) + '\u2026' : text) : files ? (files === 1 ? 'Sent an attachment' : 'Sent ' + files + ' attachments') : 'New message';
  return { v: 1, chatId: String(m.chatId), messageId: String(m.id), title: m.senderName || m.sender || 'New message', body };
}

/** The sealed form the phone opens with its key: base64url of a 12-byte nonce, the ciphertext, then the 16-byte tag. */
export function seal(key, payload) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', Buffer.from(key, 'base64url'), iv);
  const out = Buffer.concat([c.update(JSON.stringify(payload), 'utf8'), c.final()]);
  return Buffer.concat([iv, out, c.getAuthTag()]).toString('base64url');
}

// Which messages earn a notification: someone else's, a real message rather than a membership or name change.
const notifies = (m) => m && !m.fromMe && !m.event;

export function createPush({ store, config, log, fetchImpl = globalThis.fetch, isConnected = () => false, settings = () => ({}) }) {
  const relay = () => (config.push && config.push.relay) || null;
  async function call(route, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetchImpl(relay() + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
      let data = null;
      try { data = await res.json(); } catch { data = null; }
      return { status: res.status, data };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    get enabled() { return Boolean(relay()); },

    // Registers a phone for the signed-in device it belongs to. The relay checks the token with Firebase first, so a
    // token that reaches no phone is refused here rather than stored.
    async register(tokenId, reg) {
      if (!relay()) return { status: 503, code: 'push_off' };
      let out;
      try { out = await call('/register', { token: reg.token, platform: reg.platform }); }
      catch (e) { log.emit('push.failed', { route: 'register', error: String(e && e.message || e).slice(0, 200) }); return { status: 502, code: 'relay_unreachable' }; }
      if (out.status === 410) return { status: 400, code: 'token_gone' };
      if (out.status !== 200 || !out.data || typeof out.data.ticket !== 'string') {
        log.emit('push.failed', { route: 'register', status: out.status });
        return { status: 502, code: 'relay_refused' };
      }
      store.putPushDevice({ tokenId, platform: reg.platform, pushToken: reg.token, ticket: out.data.ticket, sealKey: reg.key });
      log.emit('push.registered', { platform: reg.platform });
      return { status: 200 };
    },

    unregister(tokenId) {
      return store.deletePushDevice(tokenId);
    },

    // Every phone not already showing the app gets the notification. A phone the relay reports gone is forgotten.
    async notify(m, badge = null) {
      if (!relay() || !notifies(m)) return 0;
      if (settings()['notifications.newMessage'] === false) return 0;
      const payload = notice(m);
      let sent = 0;
      for (const d of store.listPushDevices()) {
        if (isConnected(d.tokenId)) continue;
        const body = { token: d.pushToken, ticket: d.ticket, sealed: seal(d.sealKey, payload) };
        if (Number.isInteger(badge)) body.badge = badge;
        try {
          const out = await call('/send', body);
          if (out.status === 200) { sent += 1; log.emit('push.sent', { platform: d.platform }); }
          else if (out.status === 410) { store.deletePushDevice(d.tokenId); log.emit('push.gone', { platform: d.platform }); }
          else log.emit('push.failed', { route: 'send', status: out.status });
        } catch (e) {
          log.emit('push.failed', { route: 'send', error: String(e && e.message || e).slice(0, 200) });
        }
      }
      return sent;
    },
  };
}
