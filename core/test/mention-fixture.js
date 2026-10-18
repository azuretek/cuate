// Injected only by native test builds (issue 453). A group whose messages carry mentions: of a member Contacts knows, of
// someone it does not, inside bold words, over a text effect, inside a link and two side by side. The real conversation
// draws each, and the page reads back what the shell's own engine computed, the name each mention is titled with and the
// name it gives a screen reader, so the native test reads a verdict measured in its own web view. Synthetic records
// only: no server, token or account.
//   mention:pass <detail>   every mention drew set apart, named its person, and the words read as sent
//   mention:fail <why>      it did not
(async () => {
  const until = async (test, what, ms = 20000) => {
    const deadline = performance.now() + ms;
    while (!test()) {
      if (performance.now() > deadline) throw new Error('timed out waiting for ' + what);
      await new Promise(requestAnimationFrame);
    }
  };
  const say = (text) => {
    const mark = document.querySelector('[data-mention-fixture]') || document.createElement('output');
    mark.setAttribute('data-mention-fixture', 'verdict');
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
  const chat = { id: 'fixture-mention-chat', name: 'Weekend plans', isGroup: true, service: 'iMessage', participants: [sam, riley, jordan], members: [{ handle: sam, name: 'Sam Example', photo: null }, { handle: jordan, name: 'Jordan Example', photo: null }], unread: 0, lastMessageAt: at(1), lastMessage: null };
  const message = (id, minutes, text, styles, over = {}) => ({ id, chatId: chat.id, fromMe: false, sender: jordan, senderName: 'Jordan Example', text, styles, sentAt: at(minutes), replyTo: null, read: null, attachments: [], link: null, payloads: 0, reactions: [], ...over });
  // Each case: a message, then each mention's words, the name it must be titled with and whether it must draw bold too.
  const CASES = [
    ['known', 'Sam are you coming?', [{ start: 0, length: 3, mention: '+1 (555) 555-0123' }], [['Sam', 'Sam Example']]],
    ['unknown', 'Riley bring chairs', [{ start: 0, length: 5, mention: riley }], [['Riley', riley]]],
    ['bold', 'Thanks Sam a lot', [{ start: 7, length: 3, mention: sam, bold: true }], [['Sam', 'Sam Example']]],
    ['pair', 'SamRiley', [{ start: 0, length: 3, mention: sam }, { start: 3, length: 5, mention: riley }], [['Sam', 'Sam Example'], ['Riley', riley]]],
    ['effect', 'Sam look at this', [{ start: 0, length: 3, mention: sam, effect: 'bloom' }], [['Sam', 'Sam Example']], '.text-effect'],
    ['link', 'See www.example.com/Riley', [{ start: 20, length: 5, mention: riley }], [['Riley', riley]], 'link'],
  ];
  const expected = CASES.reduce((n, c) => n + c[3].length, 0);
  const messages = CASES.map(([name, text, styles], i) => message('fixture-' + name, 20 - i, text, styles, i === 2 ? { fromMe: true, sender: null, senderName: null } : {}));
  messages.push(message('fixture-plain', 2, 'Plain words, no mention.', undefined));
  const conv = document.createElement('app-conversation');
  Object.assign(conv, { chat, host, messages, sending: true, phone: true });
  Object.assign(conv.style, { position: 'fixed', inset: '0', zIndex: '9998', display: 'flex', flexDirection: 'column', background: 'var(--color-bg)' });
  document.body.append(conv);
  await until(() => conv.querySelectorAll('.mention').length >= expected, 'the mentions');
  const problems = [];
  const seen = {};
  const plainWeight = Number(getComputedStyle(conv.querySelector('.bubble-row[data-id="fixture-plain"] .bubble')).fontWeight);
  for (const [name, text, , mentions, inside] of CASES) {
    const row = conv.querySelector('.bubble-row[data-id="fixture-' + name + '"]');
    const bubble = row && row.querySelector('.bubble');
    if (!bubble) { problems.push(name + ' drew no bubble'); continue; }
    if (bubble.textContent !== text) problems.push(name + ' reads ' + JSON.stringify(bubble.textContent));
    const drawn = [...bubble.querySelectorAll('.mention')];
    if (drawn.length !== mentions.length) problems.push(name + ' drew ' + drawn.length + ' mentions');
    mentions.forEach(([words, title], i) => {
      const el = drawn[i];
      if (!el) return;
      if (el.textContent !== words) problems.push(name + ' mention reads ' + JSON.stringify(el.textContent));
      if (el.getAttribute('title') !== title) problems.push(name + ' mention is titled ' + JSON.stringify(el.getAttribute('title')));
      // A screen reader reads the words and the person they stand for.
      if (el.getAttribute('role') !== 'img' || el.getAttribute('aria-label') !== words + ', mention of ' + title) problems.push(name + ' mention reads aloud as ' + JSON.stringify(el.getAttribute('aria-label')));
      if (inside === 'link' && !el.closest('a.message-link')) problems.push(name + ' mention is not inside its link');
      if (inside && inside !== 'link' && !el.querySelector(inside)) problems.push(name + ' mention does not hold ' + inside);
      if (!(Number(getComputedStyle(el).fontWeight) > plainWeight)) problems.push(name + ' mention is not set apart');
    });
    seen[name] = drawn.map((el) => el.getAttribute('title')).join('|');
  }
  if (conv.querySelector('.bubble-row[data-id="fixture-plain"] .mention')) problems.push('a plain message drew a mention');
  const detail = Object.entries(seen).map(([k, v]) => k + '=' + v).join(' ');
  say(problems.length ? 'mention:fail ' + problems.join('; ') : 'mention:pass ' + detail);
  window.mentionProof = { ok: !problems.length, problems, seen };
})().catch((error) => {
  const mark = document.createElement('output');
  mark.setAttribute('aria-label', 'mention:fail ' + error.message);
  mark.textContent = mark.getAttribute('aria-label');
  document.body.append(mark);
  window.mentionProof = { ok: false, error: error.message };
});
