// Sending, which is the dangerous half: off until switched on, rate limited, one send per client key, and an
// uncertain outcome is reported as uncertain and never retried.
export function createSender({ engine, store, config, log, now = Date.now }) {
  const recent = [];
  const inFlight = new Set();
  return async function send(chatId, text, clientKey) {
    const prev = store.getSend(clientKey);
    if (prev) return { http: 200, body: { status: prev.status, clientKey, messageId: prev.message_id ?? null, duplicate: true } };
    if (inFlight.has(clientKey)) return { http: 409, error: ['in_flight', 'That message is still being sent.'] };
    if (!config.sending.enabled) {
      log.emit('send.refused', { reason: 'sending_off', chat: chatId });
      return { http: 403, error: ['sending_off', 'Sending is switched off on the server.'] };
    }
    const t = now();
    while (recent.length && t - recent[0] > 60000) recent.shift();
    if (recent.length >= config.sending.perMinute) {
      log.emit('send.refused', { reason: 'rate_limited', chat: chatId });
      return { http: 429, error: ['rate_limited', 'Too many messages in the last minute.'] };
    }
    recent.push(t);
    inFlight.add(clientKey);
    try {
      store.putSend(clientKey, chatId, 'pending', null);
      const r = await engine.sendText(chatId, text);
      if (r.ok) {
        store.putSend(clientKey, chatId, 'sent', r.messageId);
        return { http: 201, body: { status: 'sent', clientKey, messageId: r.messageId ?? null } };
      }
      if (r.uncertain) {
        store.putSend(clientKey, chatId, 'uncertain', null);
        log.emit('send.uncertain', { chat: chatId, code: r.code });
        return { http: 202, body: { status: 'uncertain', clientKey, messageId: null } };
      }
      store.putSend(clientKey, chatId, 'failed', null);
      log.emit('send.failed', { chat: chatId, code: r.code, error: r.error || null });
      return { http: 502, error: ['send_failed', 'Messages did not send it.'] };
    } finally {
      inFlight.delete(clientKey);
    }
  };
}
