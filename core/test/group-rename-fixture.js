// Injected only by native test builds (issue 439). A group someone renamed: the real conversation, given a synthetic
// group whose history holds the group being named, its name being removed, and a rename made from this app, draws each
// as a quiet centred line naming who did it, and the real chat list draws the group under its new name with the same
// words as its preview. The page reports what it drew, so the native test reads a verdict measured in the shell's own
// web view. Synthetic records only: no server, token or account.
//   rename:pass <detail>   every rename drew as its line, nothing drew as an empty message, and the list agrees
//   rename:fail <why>      it did not
(async () => {
  const q = (name) => '\u201c' + name + '\u201d';
  const LINES = {
    'fixture-named': 'Sam Example named the conversation ' + q('Weekend plans'),
    'fixture-removed': 'Sam Example removed the name from the conversation',
    'fixture-mine': 'You named the conversation ' + q('Lake trip'),
  };
  const until = async (test, what, ms = 20000) => {
    const deadline = performance.now() + ms;
    while (!test()) {
      if (performance.now() > deadline) throw new Error('timed out waiting for ' + what);
      await new Promise(requestAnimationFrame);
    }
  };
  const say = (text) => {
    const mark = document.querySelector('[data-rename-fixture]') || document.createElement('output');
    mark.setAttribute('data-rename-fixture', 'verdict');
    mark.setAttribute('aria-label', text);
    mark.textContent = text;
    Object.assign(mark.style, { position: 'fixed', bottom: '0', left: '0', zIndex: '9999', fontSize: '1px' });
    document.body.append(mark);
  };
  await customElements.whenDefined('app-conversation');
  await customElements.whenDefined('app-chat-list');
  await until(() => window.bridge && typeof window.bridge.call === 'function', 'the bridge');
  const host = await window.bridge.call('app.info');
  const sam = '+15555550123';
  const at = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
  const message = (id, minutes, over) => ({ id, chatId: 'fixture-rename-chat', fromMe: false, sender: sam, senderName: 'Sam Example', text: '', sentAt: at(minutes), replyTo: null, read: null, attachments: [], link: null, payloads: 0, reactions: [], ...over });
  const me = { fromMe: true, sender: null, senderName: null };
  const messages = [
    message('fixture-1', 10, { text: 'Synthetic words before the name.' }),
    message('fixture-named', 8, { event: { kind: 'rename', name: 'Weekend plans' } }),
    message('fixture-2', 6, { ...me, text: 'Synthetic words after it.' }),
    message('fixture-removed', 4, { event: { kind: 'rename', name: '' } }),
    message('fixture-mine', 2, { ...me, event: { kind: 'rename', name: 'Lake trip' } }),
  ];
  const last = messages[messages.length - 1];
  const chat = {
    id: 'fixture-rename-chat', name: 'Lake trip', isGroup: true, service: 'iMessage', participants: [sam, 'fixture@example.com'],
    members: [{ handle: sam, name: 'Sam Example', photo: null }, { handle: 'fixture@example.com', name: 'fixture@example.com', photo: null }],
    unread: 0, lastMessageAt: last.sentAt,
    lastMessage: { text: '', fromMe: true, sentAt: last.sentAt, attachments: 0, link: null, payloads: 0, event: { kind: 'rename', name: 'Lake trip' }, senderName: null },
  };
  const list = document.createElement('app-chat-list');
  Object.assign(list, { chats: [chat] });
  Object.assign(list.style, { position: 'fixed', top: '0', left: '0', right: '0', height: '30%', zIndex: '9998', display: 'block', overflow: 'auto', background: 'var(--color-bg)' });
  const conv = document.createElement('app-conversation');
  Object.assign(conv, { chat, host, messages, sending: true, phone: true });
  Object.assign(conv.style, { position: 'fixed', top: '30%', left: '0', right: '0', bottom: '0', zIndex: '9998', display: 'flex', flexDirection: 'column', background: 'var(--color-bg)' });
  document.body.append(list, conv);
  await until(() => conv.querySelectorAll('.bubble-row').length >= messages.length, 'the conversation');
  await until(() => list.querySelector('.chat-row .chat-preview'), 'the chat list');
  const problems = [];
  const seen = {};
  for (const [id, want] of Object.entries(LINES)) {
    const row = conv.querySelector('.bubble-row[data-id="' + id + '"]');
    const words = row ? row.textContent.trim() : null;
    seen[id] = words;
    if (!row || !row.classList.contains('event')) problems.push(id + ' is not a line in the conversation');
    else if (words !== want) problems.push(id + ' reads ' + JSON.stringify(words));
    else if (row.querySelector('.bubble')) problems.push(id + ' is drawn as a bubble');
  }
  const rows = [...conv.querySelectorAll('.bubble-row')];
  if (rows.length !== messages.length) problems.push(rows.length + ' rows drawn, not ' + messages.length);
  if (rows.some((r) => !r.classList.contains('event') && !r.textContent.trim())) problems.push('an empty message is drawn');
  const title = (list.querySelector('.chat-row .chat-name') || {}).textContent;
  const preview = (list.querySelector('.chat-row .chat-preview') || {}).textContent;
  if (title !== 'Lake trip') problems.push('the list titles the group ' + JSON.stringify(title));
  if (preview !== LINES['fixture-mine']) problems.push('the list preview reads ' + JSON.stringify(preview));
  const head = (conv.querySelector('.conv-head .chat-name') || {}).textContent;
  if (head !== 'Lake trip') problems.push('the header titles the group ' + JSON.stringify(head));
  const detail = 'lines=' + Object.keys(LINES).length + ' rows=' + rows.length + ' title="' + title + '" preview="' + preview + '"';
  say(problems.length ? 'rename:fail ' + problems.join('; ') : 'rename:pass ' + detail);
  window.groupRenameProof = { ok: !problems.length, problems, seen, title, preview, rows: rows.length };
})().catch((error) => {
  const mark = document.createElement('output');
  mark.setAttribute('aria-label', 'rename:fail ' + error.message);
  mark.textContent = mark.getAttribute('aria-label');
  document.body.append(mark);
  window.groupRenameProof = { ok: false, error: error.message };
});
