// The client's one way to reach the server: HTTP for reads and sends, one WebSocket for live events that resumes
// where it left off after a reconnect. fetch, WebSocket and timers are injected, so the same code runs in every
// shell and in the server's own tests.
export function createApiClient({ baseUrl, token, fetchImpl = globalThis.fetch, WebSocketImpl = globalThis.WebSocket, timers = globalThis, onEvent = () => {}, onState = () => {} }) {
  const base = String(baseUrl).trim().replace(/\/+$/, '');
  const auth = { authorization: 'Bearer ' + token };

  async function call(method, path, body) {
    const headers = { ...auth };
    if (body !== undefined) headers['content-type'] = 'application/json';
    let res;
    try {
      res = await fetchImpl(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (cause) {
      throw Object.assign(new Error('The server did not answer.'), { code: 'unreachable', cause });
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = (data && data.error) || {};
      throw Object.assign(new Error(err.message || 'HTTP ' + res.status), { status: res.status, code: err.code || 'http_' + res.status });
    }
    return data;
  }
  const query = (o) => {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null) s.set(k, String(v));
    const t = s.toString();
    return t ? '?' + t : '';
  };

  let ws = null;
  let closed = false;
  let retry = 0;
  let resume = null;
  let timer = null;

  function connect() {
    closed = false;
    onState(retry ? 'reconnecting' : 'connecting');
    const sock = new WebSocketImpl(base.replace(/^http/i, 'ws') + '/api/v1/events');
    ws = sock;
    sock.onopen = () => sock.send(JSON.stringify({ type: 'auth', token, resume }));
    sock.onmessage = (ev) => {
      let f;
      try { f = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch { return; }
      if (f.type === 'hello') {
        retry = 0;
        const hadResume = resume !== null;
        if (!f.resumed) resume = { epoch: f.epoch, seq: f.seq };
        onState('open');
        if (!f.resumed && (hadResume || f.seq > 0)) onEvent({ name: 'resync', data: {} });
      } else if (f.type === 'event') {
        if (resume) resume.seq = f.seq;
        onEvent({ name: f.name, data: f.data });
      }
    };
    sock.onerror = () => {};
    sock.onclose = (ev) => {
      if (ws === sock) ws = null;
      if (closed) { onState('closed'); return; }
      if (ev && ev.code === 4401) { onState('unauthorized'); return; }
      const delay = Math.min(30000, 500 * 2 ** retry);
      retry += 1;
      onState('reconnecting');
      timer = timers.setTimeout(connect, delay);
    };
  }

  return {
    info: () => call('GET', '/api/v1/info'),
    chats: (o = {}) => call('GET', '/api/v1/chats' + query({ limit: o.limit })),
    messages: (chatId, o = {}) => call('GET', `/api/v1/chats/${encodeURIComponent(chatId)}/messages` + query({ limit: o.limit, before: o.before })),
    send: (chatId, { text, file, clientKey, replyTo }) => call('POST', `/api/v1/chats/${encodeURIComponent(chatId)}/messages`, { text, ...(file ? { file } : {}), clientKey, ...(replyTo ? { replyTo } : {}) }),
    react: (chatId, messageId, { emoji, remove = false }) => call('POST', `/api/v1/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/reactions`, remove ? { emoji, remove: true } : { emoji }),
    upload: ({ name, mime, data }) => call('POST', '/api/v1/attachments', { name, mime, data }),
    markRead: (chatId) => call('POST', `/api/v1/chats/${encodeURIComponent(chatId)}/read`),
    settings: () => call('GET', '/api/v1/settings'),
    settingsWrite: (values) => call('PUT', '/api/v1/settings', { values }),
    themeImport: ({ url, name }) => call('POST', '/api/v1/themes', name ? { url, name } : { url }),
    async attachment(id, o = {}) {
      const res = await fetchImpl(base + `/api/v1/attachments/${encodeURIComponent(id)}` + query({ format: o.format }), { headers: auth });
      if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { status: res.status });
      return res.blob();
    },
    connect,
    close() {
      closed = true;
      if (timer) timers.clearTimeout(timer);
      if (ws) ws.close(1000);
    },
  };
}
