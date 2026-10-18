// Injected only by native test builds (issue 447). A conversation whose messages carry bold, italic, underlined and
// struck-through stretches, several on one stretch, one around a link and one beside a text effect: the real conversation
// draws each, and the page reads back what the shell's own engine computed for each stretch, so the native test reads a
// verdict measured in its own web view. Synthetic records only: no server, token or account.
//   textfmt:pass <detail>   every stretch drew with its styles and the words read as sent
//   textfmt:fail <why>      it did not
(async () => {
  const until = async (test, what, ms = 20000) => {
    const deadline = performance.now() + ms;
    while (!test()) {
      if (performance.now() > deadline) throw new Error('timed out waiting for ' + what);
      await new Promise(requestAnimationFrame);
    }
  };
  const say = (text) => {
    const mark = document.querySelector('[data-textfmt-fixture]') || document.createElement('output');
    mark.setAttribute('data-textfmt-fixture', 'verdict');
    mark.setAttribute('aria-label', text);
    mark.textContent = text;
    Object.assign(mark.style, { position: 'fixed', bottom: '0', left: '0', zIndex: '9999', fontSize: '1px' });
    document.body.append(mark);
  };
  await customElements.whenDefined('app-conversation');
  await until(() => window.bridge && typeof window.bridge.call === 'function', 'the bridge');
  const host = await window.bridge.call('app.info');
  const sam = '+15555550123';
  const at = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
  const chat = { id: 'fixture-textfmt-chat', name: 'Sam Example', isGroup: false, service: 'iMessage', participants: [sam], members: [{ handle: sam, name: 'Sam Example', photo: null }], unread: 0, lastMessageAt: at(1), lastMessage: null };
  const message = (id, minutes, text, styles, over = {}) => ({ id, chatId: chat.id, fromMe: false, sender: sam, senderName: 'Sam Example', text, styles, sentAt: at(minutes), replyTo: null, read: null, attachments: [], link: null, payloads: 0, reactions: [], ...over });
  // Each case: a message, then the stretch to read back and the styles it must draw with.
  const CASES = [
    ['bold', 'Bring the big tent', [{ start: 10, length: 3, bold: true }], 'big', ['bold']],
    ['italic', 'That was so good', [{ start: 9, length: 2, italic: true }], 'so', ['italic']],
    ['underline', 'Meet at noon sharp', [{ start: 8, length: 4, underline: true }], 'noon', ['underline']],
    ['strike', 'Friday no Saturday', [{ start: 0, length: 6, strikethrough: true }], 'Friday', ['strikethrough']],
    ['stacked', 'All of them at once', [{ start: 0, length: 11, bold: true, italic: true, underline: true, strikethrough: true }], 'All of them', ['bold', 'italic', 'underline', 'strikethrough']],
    ['link', 'Read www.example.com first', [{ start: 0, length: 20, bold: true }], 'www.example.com', ['bold']],
    ['effect', 'Bloom and bold', [{ start: 0, length: 10, effect: 'bloom' }, { start: 10, length: 4, effect: 'bloom', bold: true }], 'bold', ['bold']],
  ];
  const messages = CASES.map(([name, text, styles], i) => message('fixture-' + name, 20 - i, text, styles, i % 2 ? { fromMe: true, sender: null, senderName: null } : {}));
  messages.push(message('fixture-plain', 2, 'Plain words, no style.', undefined));
  const conv = document.createElement('app-conversation');
  Object.assign(conv, { chat, host, messages, sending: true, phone: true });
  Object.assign(conv.style, { position: 'fixed', inset: '0', zIndex: '9998', display: 'flex', flexDirection: 'column', background: 'var(--color-bg)' });
  document.body.append(conv);
  await until(() => conv.querySelectorAll('.fmt').length >= CASES.length, 'the styled stretches');
  const problems = [];
  const seen = {};
  const plainWeight = Number(getComputedStyle(conv.querySelector('.bubble-row[data-id="fixture-plain"] .bubble')).fontWeight);
  for (const [name, text, , words, want] of CASES) {
    const row = conv.querySelector('.bubble-row[data-id="fixture-' + name + '"]');
    const bubble = row && row.querySelector('.bubble');
    if (!bubble) { problems.push(name + ' drew no bubble'); continue; }
    if (bubble.textContent !== text) problems.push(name + ' reads ' + JSON.stringify(bubble.textContent));
    // The innermost element holding exactly the stretch's words, and what the page computed for it.
    const holders = [...bubble.querySelectorAll('*')].filter((el) => el.textContent === words);
    const el = holders[holders.length - 1];
    if (!el) { problems.push(name + ' has no stretch reading ' + JSON.stringify(words)); continue; }
    const lines = new Set();
    // A link draws its own underline, which is the link's and not a format the sender laid, so it is not counted.
    for (let x = el; x && x !== bubble; x = x.parentElement) if (!x.matches('a.message-link')) for (const l of getComputedStyle(x).textDecorationLine.split(' ')) lines.add(l);
    const cs = getComputedStyle(el);
    const got = {
      bold: Number(cs.fontWeight) > plainWeight,
      italic: cs.fontStyle === 'italic',
      underline: lines.has('underline'),
      strikethrough: lines.has('line-through'),
    };
    seen[name] = Object.keys(got).filter((k) => got[k]).join('+') || 'none';
    for (const k of Object.keys(got)) if (got[k] !== want.includes(k)) problems.push(name + ' ' + (got[k] ? 'draws ' : 'misses ') + k);
    if (name === 'link' && !el.closest('a.message-link')) problems.push('the bold link is not a link');
    if (name === 'effect' && !el.closest('.text-effect[data-effect="bloom"]') && !el.querySelector('.text-effect[data-effect="bloom"]')) problems.push('the bold words lost their effect');
  }
  if (conv.querySelector('.bubble-row[data-id="fixture-plain"] .fmt')) problems.push('a plain message drew a style');
  const detail = Object.entries(seen).map(([k, v]) => k + '=' + v).join(' ');
  say(problems.length ? 'textfmt:fail ' + problems.join('; ') : 'textfmt:pass ' + detail);
  window.textFormatProof = { ok: !problems.length, problems, seen };
})().catch((error) => {
  const mark = document.createElement('output');
  mark.setAttribute('aria-label', 'textfmt:fail ' + error.message);
  mark.textContent = mark.getAttribute('aria-label');
  document.body.append(mark);
  window.textFormatProof = { ok: false, error: error.message };
});
