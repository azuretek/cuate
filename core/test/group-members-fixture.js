// Injected only by native test builds (issue 456). A group whose people changed: Sam added someone Contacts does not know,
// removed someone it does, someone left, and you added a person from here. The real conversation draws each change, and
// the page reads back what the shell's own engine drew, so the native test reads a verdict measured in its own web view.
// Synthetic records only: no server, token or account.
//   members:pass <detail>   every change drew as a quiet centred line naming who did it and whom, and none as a message
//   members:fail <why>      it did not
(async () => {
  const until = async (test, what, ms = 20000) => {
    const deadline = performance.now() + ms;
    while (!test()) {
      if (performance.now() > deadline) throw new Error('timed out waiting for ' + what);
      await new Promise(requestAnimationFrame);
    }
  };
  const say = (text) => {
    const mark = document.querySelector('[data-members-fixture]') || document.createElement('output');
    mark.setAttribute('data-members-fixture', 'verdict');
    mark.setAttribute('aria-label', text);
    mark.textContent = text;
    Object.assign(mark.style, { position: 'fixed', bottom: '0', left: '0', zIndex: '9999', fontSize: '1px' });
    document.body.append(mark);
  };
  await customElements.whenDefined('app-conversation');
  await until(() => window.bridge && typeof window.bridge.call === 'function', 'the bridge');
  const host = await window.bridge.call('app.info');
  const sam = '+15555550123';
  const riley = 'riley@example.com';
  const jordan = 'jordan@example.com';
  const at = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
  const chat = { id: 'fixture-members-chat', name: 'Weekend plans', isGroup: true, service: 'iMessage', participants: [sam, jordan], members: [{ handle: sam, name: 'Sam Example', photo: null }, { handle: jordan, name: 'Jordan Example', photo: null }], unread: 0, lastMessageAt: at(1), lastMessage: null };
  const message = (id, minutes, over) => ({ id, chatId: chat.id, fromMe: false, sender: sam, senderName: 'Sam Example', text: '', sentAt: at(minutes), replyTo: null, read: null, attachments: [], link: null, payloads: 0, reactions: [], ...over });
  const person = (handle, name) => ({ handle, name });
  // Each case: the message, then the line it must draw.
  const CASES = [
    [message('fixture-before', 12, { text: 'Synthetic words before the changes.' }), null],
    [message('fixture-add', 10, { event: { kind: 'member', action: 'add', person: person(riley, null) } }), 'Sam Example added riley@example.com to the conversation'],
    [message('fixture-remove', 8, { event: { kind: 'member', action: 'remove', person: person(jordan, 'Jordan Example') } }), 'Sam Example removed Jordan Example from the conversation'],
    [message('fixture-leave', 6, { sender: riley, senderName: null, event: { kind: 'member', action: 'leave' } }), 'riley@example.com left the conversation'],
    [message('fixture-mine', 4, { fromMe: true, sender: null, senderName: null, event: { kind: 'member', action: 'add', person: person(jordan, 'Jordan Example') } }), 'You added Jordan Example to the conversation'],
    [message('fixture-after', 2, { fromMe: true, sender: null, senderName: null, text: 'Synthetic words after them.' }), null],
  ];
  const conv = document.createElement('app-conversation');
  Object.assign(conv, { chat, host, messages: CASES.map((c) => c[0]), sending: true, phone: true });
  Object.assign(conv.style, { position: 'fixed', inset: '0', zIndex: '9998', display: 'flex', flexDirection: 'column', background: 'var(--color-bg)' });
  document.body.append(conv);
  await until(() => conv.querySelectorAll('.messages .bubble-row').length >= CASES.length, 'the conversation');
  await new Promise(requestAnimationFrame);
  const problems = [];
  const seen = [];
  const list = conv.querySelector('.messages');
  const rows = [...list.querySelectorAll('.bubble-row')];
  if (rows.length !== CASES.length) problems.push(rows.length + ' rows drawn, not ' + CASES.length);
  if (rows.some((r) => !r.classList.contains('event') && !r.textContent.trim())) problems.push('an empty message is drawn');
  const middle = list.getBoundingClientRect().left + list.getBoundingClientRect().width / 2;
  for (const [m, want] of CASES) {
    if (!want) continue;
    const row = list.querySelector('.bubble-row[data-id="' + m.id + '"]');
    if (!row) { problems.push(m.id + ' drew nothing'); continue; }
    const line = row.textContent.trim();
    if (!row.classList.contains('event')) problems.push(m.id + ' is not an event line');
    if (row.querySelector('.bubble')) problems.push(m.id + ' drew a bubble');
    if (line !== want) problems.push(m.id + ' reads ' + JSON.stringify(line));
    const words = row.querySelector('.conv-event');
    const box = words ? words.getBoundingClientRect() : null;
    if (!box || Math.abs(box.left + box.width / 2 - middle) > 2) problems.push(m.id + ' is not centred');
    seen.push(m.id.replace('fixture-', '') + '="' + line + '"');
  }
  say(problems.length ? 'members:fail ' + problems.join('; ') : 'members:pass rows=' + rows.length + ' ' + seen.join(' '));
  window.membersProof = { ok: !problems.length, problems, seen };
})().catch((error) => {
  const mark = document.createElement('output');
  mark.setAttribute('aria-label', 'members:fail ' + error.message);
  mark.textContent = mark.getAttribute('aria-label');
  document.body.append(mark);
  window.membersProof = { ok: false, error: error.message };
});
