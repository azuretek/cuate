// Injected only by native test builds (issue 414). A notice pressed before its message reached the server: the real
// page signs in to a stand-in server held in this script, raises a real message notice through the shell's bridge for
// a message the server does not have yet, and the native test presses that notice from the home screen. The message
// reaches the server and the live stream a moment after the press, and the proof is that the conversation the press
// opened brings that message into view. Synthetic records only: no server, token or account.
(async () => {
  const CHAT = 'fixture-late';
  const LATE = 'm-late';
  // How long after the press the message lands: well past the first page, well inside the page's wait.
  const LATE_BY_MS = 2500;
  const until = async (check, what, ms) => {
    const deadline = performance.now() + ms;
    while (!check()) {
      if (performance.now() > deadline) throw new Error('timed out waiting for ' + what);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  const mark = document.createElement('output');
  Object.assign(mark.style, { position: 'fixed', bottom: '0', left: '0', zIndex: '9999', fontSize: '1px' });
  const say = (text) => { mark.setAttribute('aria-label', text); mark.textContent = text; };
  document.body.append(mark);
  say('late-notice:starting');

  const message = (id, second, text) => ({ id, chatId: CHAT, text, sender: '+15555550142', fromMe: false, attachments: [], sentAt: '2026-01-01T00:00:' + String(second).padStart(2, '0') + '.000Z', historyCursor: 'cursor-' + id });
  const stored = [message('m-1', 1, 'Earlier fixture one'), message('m-2', 2, 'Earlier fixture two')];
  const lateMessage = message(LATE, 9, 'Late fixture message');
  const chat = { id: CHAT, name: 'Fixture Late', isGroup: false, service: 'iMessage', participants: ['+15555550142'], unread: 0, lastMessageAt: stored[1].sentAt, lastMessage: { text: stored[1].text } };
  const pages = [];
  let socket = null;
  let seq = 0;

  // The stand-in server: the API's own shapes, from this script's memory.
  window.fetch = async (url, { method = 'GET' } = {}) => {
    const path = new URL(url).pathname;
    const answer = (body) => ({ ok: true, status: 200, json: async () => body });
    if (path === '/api/v1/info') return answer({ apiVersion: 1, sending: true });
    if (path === '/api/v1/chats') return answer({ chats: [{ ...chat }] });
    if (path === '/api/v1/settings' && method === 'GET') return answer({ values: {} });
    if (path === '/api/v1/chats/' + CHAT + '/messages') {
      pages.push({ at: performance.now(), ids: stored.map((m) => m.id) });
      return answer({ messages: stored.map((m) => ({ ...m })), hasMore: false, totalCount: stored.length });
    }
    if (path === '/api/v1/chats/' + CHAT + '/read') return answer({ chatId: CHAT, unread: 0 });
    return answer({});
  };
  window.WebSocket = class {
    constructor() {
      socket = this;
      setTimeout(() => this.onopen && this.onopen(), 0);
    }
    send(raw) {
      const frame = JSON.parse(raw);
      if (frame.type === 'auth') setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify({ type: 'hello', epoch: 'fixture', seq: 0, resumed: false }) }), 0);
    }
    close(code) { if (socket === this) socket = null; setTimeout(() => this.onclose && this.onclose({ code }), 0); }
  };
  const live = (name, data) => socket && socket.onmessage && socket.onmessage({ data: JSON.stringify({ type: 'event', seq: (seq += 1), name, data }) });

  await customElements.whenDefined('app-root');
  const root = document.querySelector('app-root');
  await until(() => root.phase === 'onboarding' || root.phase === 'ready', 'the page to boot', 30000);
  await root.start('https://fixture.invalid', 'fixture-token');
  // The sign-in asks for notifications; the native test answers the system's question.
  await until(() => root.notifyPermission === 'granted', 'notifications to be allowed', 60000);

  // The notice for a message the server does not have yet, raised the way the page raises every message notice.
  const posted = await window.bridge.call('notify', { title: chat.name, body: lateMessage.text, chatId: CHAT, messageId: LATE });
  if (posted !== true) throw new Error('the shell refused the notice');
  say('late-notice:posted');

  // The press opens the conversation, which asks the server for its newest messages; the message is not among them.
  await until(() => root.openChatId === CHAT && pages.length > 0, 'the press to open the conversation', 90000);
  const pressedAt = performance.now();
  const firstPage = pages[0].ids;
  await new Promise((resolve) => setTimeout(resolve, LATE_BY_MS));
  stored.push(lateMessage);
  live('message.new', { message: { ...lateMessage } });
  const arrivedAt = performance.now();
  say('late-notice:arrived');

  const conv = () => root.querySelector('app-conversation');
  const revealed = () => conv()?.revealedId === LATE && conv()?.querySelector('.bubble-row.revealed');
  await until(revealed, 'the late message to be brought into view', 20000);
  const revealedAt = performance.now();
  const ok = !firstPage.includes(LATE) && revealedAt >= arrivedAt;
  window.lateNoticeProof = { ok, firstPage, lateByMs: Math.round(arrivedAt - pressedAt), revealedAfterArrivalMs: Math.round(revealedAt - arrivedAt) };
  say(ok ? 'late-notice:pass' : 'late-notice:fail ' + JSON.stringify(window.lateNoticeProof));
})().catch((error) => {
  window.lateNoticeProof = { ok: false, error: error.message };
  const text = 'late-notice:fail ' + error.message;
  const mark = document.querySelector('output[aria-label^="late-notice:"]');
  if (mark) { mark.setAttribute('aria-label', text); mark.textContent = text; }
});
