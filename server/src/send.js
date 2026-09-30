// Sending, which is the dangerous half: off until switched on, rate limited, one send per client key, and an
// uncertain outcome is reported as uncertain and never retried. A send carries text, a file, or a file with a
// caption; the file is an attachment id the server already holds, resolved to its path only here.
export function createSender({ engine, store, config, log, now = Date.now }) {
  const recent = [];
  const inFlight = new Set();
  return async function send(chatId, { text = '', file = '' } = {}, clientKey) {
    const prev = store.getSend(clientKey);
    if (prev) return { http: 200, body: { status: prev.status, clientKey, messageId: prev.message_id ?? null, duplicate: true } };
    if (inFlight.has(clientKey)) return { http: 409, error: ['in_flight', 'That message is still being sent.'] };
    if (!String(text).trim() && !file) return { http: 400, error: ['bad_text', 'Send text, a file, or a file with a caption'] };
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
    // Resolved before the window is charged, so a request naming a file we do not hold costs no rate budget.
    let path = null;
    if (file) {
      const rec = store.getAttachment(file);
      if (!rec) {
        log.emit('send.refused', { reason: 'unknown_attachment', chat: chatId });
        return { http: 404, error: ['attachment_unknown', 'The server does not hold that file.'] };
      }
      path = rec.path;
    }
    recent.push(t);
    inFlight.add(clientKey);
    try {
      store.putSend(clientKey, chatId, 'pending', null);
      const r = path ? await engine.sendFile(chatId, path, text) : await engine.sendText(chatId, text);
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
