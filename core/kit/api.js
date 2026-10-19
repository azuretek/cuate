// The client's one way to reach the server: HTTP for reads and sends, one WebSocket for live events that resumes
// where it left off after a reconnect. fetch, WebSocket and timers are injected, so the same code runs in every
// shell and in the server's own tests.
export function createApiClient({ baseUrl, token, fetchImpl = globalThis.fetch, WebSocketImpl = globalThis.WebSocket, timers = globalThis, onEvent = () => {}, onState = () => {} }) {
  const base = String(baseUrl).trim().replace(/\/+$/, '');
  const auth = { authorization: 'Bearer ' + token };

  async function call(method, path, body, signal) {
    const headers = { ...auth };
    if (body !== undefined) headers['content-type'] = 'application/json';
    let res;
    try {
      res = await fetchImpl(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), ...(signal ? { signal } : {}) });
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
    async media(chatId, o = {}) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (o.signal?.aborted) abort(); else o.signal?.addEventListener('abort', abort, { once: true });
      const timer = timers.setTimeout(abort, 15000);
      try { return await call('GET', `/api/v1/chats/${encodeURIComponent(chatId)}/media` + query({ limit: o.limit, beforeCursor: o.beforeCursor, afterCursor: o.afterCursor }), undefined, controller.signal); }
      finally { timers.clearTimeout(timer); o.signal?.removeEventListener('abort', abort); }
    },
    chats: (o = {}) => call('GET', '/api/v1/chats' + query({ limit: o.limit })),
    // What changed since a cursor the server wrote (issue 441): new messages, edits, unsends, reactions and read receipts.
    changes: (o = {}) => call('GET', '/api/v1/changes' + query({ since: o.since, limit: o.limit, chats: o.chats })),
    messages: (chatId, o = {}) => call('GET', `/api/v1/chats/${encodeURIComponent(chatId)}/messages` + query({ limit: o.limit, before: o.before, beforeCursor: o.beforeCursor, afterCursor: o.afterCursor, includeTotal: o.includeTotal })),
    send: (chatId, { text, file, clientKey, replyTo }) => call('POST', `/api/v1/chats/${encodeURIComponent(chatId)}/messages`, { text, ...(file ? { file } : {}), clientKey, ...(replyTo ? { replyTo } : {}) }),
    // `text` is the message being reacted to, carried only so the server can compose the platform's own text
    // fallback where the conversation is not on the message service (issue 184); it is not sent otherwise.
    react: (chatId, messageId, { emoji, remove = false, text = '' }) => call('POST', `/api/v1/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/reactions`, { emoji, ...(remove ? { remove: true } : {}), ...(text ? { text } : {}) }),
    // The new words for one of our own messages (issue 391); the server answers the words it sent.
    edit: (chatId, messageId, text) => call('PUT', `/api/v1/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/text`, { text }),
    upload: ({ name, mime, data }) => call('POST', '/api/v1/attachments', { name, mime, data }),
    markRead: (chatId) => call('POST', `/api/v1/chats/${encodeURIComponent(chatId)}/read`),
    // A recording someone else sent was played here (issue 440): the server keeps it and tells every client.
    played: (id) => call('POST', '/api/v1/attachments/' + encodeURIComponent(id) + '/played'),
    // Conversations and groups are the message service's own (issue 326): one address starts or opens a direct chat, several start
    // a group conversation, and a group's name and people change through the Mac. Each answers the chat as it now is.
    createChat: ({ addresses, name, text }) => call('POST', '/api/v1/chats', { addresses, ...(name ? { name } : {}), ...(text ? { text } : {}) }),
    renameGroup: (chatId, name) => call('PUT', `/api/v1/chats/${encodeURIComponent(chatId)}/name`, { name }),
    addMember: (chatId, address) => call('POST', `/api/v1/chats/${encodeURIComponent(chatId)}/members`, { address }),
    removeMember: (chatId, address) => call('DELETE', `/api/v1/chats/${encodeURIComponent(chatId)}/members/${encodeURIComponent(address)}`),
    // Say we are (or are no longer) typing in a conversation. The server relays it to this account's other signed-in
    // devices; nothing is sent to anyone else and nothing is written to history (issue 230).
    typing: (chatId, typing) => call('POST', `/api/v1/chats/${encodeURIComponent(chatId)}/typing`, { typing }),
    // Push notifications with the app closed (issue 347): this phone's push token, platform and key, or stop.
    pushRegister: ({ token, platform, key }) => call('POST', '/api/v1/push', { token, platform, key }),
    pushUnregister: () => call('DELETE', '/api/v1/push'),
    settings: () => call('GET', '/api/v1/settings'),
    settingsWrite: (values) => call('PUT', '/api/v1/settings', { values }),
    // The emoji favourites the person has used, one list on the server so every device draws the same row, and a
    // change to it as one small operation (issue 494).
    favourites: () => call('GET', '/api/v1/emoji/favourites'),
    favouritesWrite: (change) => call('POST', '/api/v1/emoji/favourites', change),
    themeImport: ({ url, name }) => call('POST', '/api/v1/themes', name ? { url, name } : { url }),
    // One font file a held theme names, as bytes for the FontFace API.
    async themeFont(id) {
      const res = await fetchImpl(base + `/api/v1/themes/fonts/${encodeURIComponent(id)}`, { headers: auth });
      if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { status: res.status });
      return res.arrayBuffer();
    },
    async attachment(id, o = {}) {
      const res = await fetchImpl(base + `/api/v1/attachments/${encodeURIComponent(id)}` + query({ format: o.format, part: o.part }), { headers: auth, signal: o.signal });
      if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { status: res.status });
      return res.blob();
    },
    // A shared video link's media, resolved and cached by the server (issue 243), as bytes for the viewer. The client
    // reaches only us, never the site the link names.
    async linkMedia(url, o = {}) {
      const res = await fetchImpl(base + '/api/v1/links/media' + query({ url }), { headers: auth, signal: o.signal });
      if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { status: res.status });
      return res.blob();
    },
    connect,
    // Drops the event stream the way a lost connection does, so it reconnects and resumes where it left off. The
    // desktop smoke uses it to prove a reconnect never blanks a view (issue 142).
    reconnect() {
      if (ws && !closed) ws.close(4000);
    },
    close() {
      closed = true;
      if (timer) timers.clearTimeout(timer);
      if (ws) ws.close(1000);
    },
  };
}
