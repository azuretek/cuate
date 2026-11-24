// Injected only by native test builds, and run by the desktop smoke (issue 533, 2026-11-16). React offers exactly
// what a conversation can carry, and a reaction that arrives as text shows as a reaction. The real conversation is drawn
// in this shell's own web view for four synthetic conversations: SMS and RCS, which carry the six classic reactions, the
// message service with an engine that sends any emoji, and the message service with an engine that sends only the six.
// React is opened on a message in each, and what the composer's panel offers is measured. Then an SMS conversation is
// drawn with reactions that arrived as text in every cited phrasing, and each must be a reaction on the message it
// names, or a labelled line when it names nothing loaded, never a message bubble. Synthetic records only: no server,
// token or account.
//   reactions:pass <detail>   every panel offered what its conversation carries, and every reaction folded
//   reactions:fail <why>      it did not
(async () => {
  const L = '\u201c';
  const R = '\u201d';
  const until = async (test, what, ms = 20000) => {
    const deadline = performance.now() + ms;
    while (!test()) {
      if (performance.now() > deadline) throw new Error('timed out waiting for ' + what);
      await new Promise(requestAnimationFrame);
    }
  };
  const say = (text) => {
    const mark = document.querySelector('[data-reactions-fixture]') || document.createElement('output');
    mark.setAttribute('data-reactions-fixture', 'verdict');
    mark.setAttribute('aria-label', text);
    mark.textContent = text;
    Object.assign(mark.style, { position: 'fixed', bottom: '0', left: '0', zIndex: '9999', fontSize: '1px' });
    document.body.append(mark);
  };
  await customElements.whenDefined('app-conversation');
  await until(() => window.bridge && typeof window.bridge.call === 'function', 'the bridge');
  const { foldReactions } = await import(new URL('rules/platform.js', document.baseURI).href);
  const host = await window.bridge.call('app.info');
  const sam = '+15555550123';
  const at = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
  const message = (chatId, id, minutes, over) => ({ id, chatId, fromMe: false, sender: sam, senderName: 'Sam Example', text: '', sentAt: at(minutes), replyTo: null, read: null, attachments: [], link: null, payloads: 0, reactions: [], ...over });
  const chat = (id, service) => ({ id, name: 'Sam Example', isGroup: false, service, participants: [sam], members: [{ handle: sam, name: 'Sam Example', photo: null }], unread: 0, lastMessageAt: at(1), lastMessage: null });
  // The folded conversation fills the top half and each React case the bottom half, so the capture the native test keeps
  // shows both: the reactions folded, and the SMS panel offering the six, which is drawn last and left open.
  const draw = async (c, messages, engine, half) => {
    const conv = document.createElement('app-conversation');
    Object.assign(conv, { chat: c, host, messages, sending: true, phone: true, favourites: [], engine });
    Object.assign(conv.style, { position: 'fixed', left: '0', right: '0', top: half === 'top' ? '0' : '50%', bottom: half === 'top' ? '50%' : '0', zIndex: '9998', display: 'flex', flexDirection: 'column', background: 'var(--color-bg)' });
    document.body.append(conv);
    await until(() => conv.querySelectorAll('.bubble-row').length >= messages.length, 'the conversation ' + c.id);
    return conv;
  };
  const problems = [];
  const offered = {};

  // 1. What React offers, per conversation. SMS goes last, and its panel is left open for the capture.
  const CASES = [
    { id: 'fixture-rcs', service: 'RCS', engine: { kind: 'fixture', tapbackEmoji: 2 }, want: 'six' },
    { id: 'fixture-native', service: 'iMessage', engine: { kind: 'fixture', tapbackEmoji: 2 }, want: 'all' },
    { id: 'fixture-native-older', service: 'iMessage', engine: { kind: 'fixture', tapbackEmoji: 1 }, want: 'six' },
    { id: 'fixture-sms', service: 'SMS', engine: { kind: 'fixture', tapbackEmoji: 2 }, want: 'six' },
  ];
  const SIX = ['\u2764\ufe0f', '\u{1F44D}', '\u{1F44E}', '\u{1F602}', '\u203c\ufe0f', '\u2753'];
  for (const k of CASES) {
    const m = message(k.id, k.id + '-1', 5, { text: 'Synthetic words to react to.' });
    const conv = await draw(chat(k.id, k.service), [m], k.engine, 'bottom');
    await conv.openReact(m);
    await until(() => conv.querySelector('app-composer app-emoji-picker .emoji-cell'), 'the panel in ' + k.id);
    const panel = conv.querySelector('app-composer app-emoji-picker');
    const cells = [...panel.querySelectorAll('.emoji-cell')].map((c) => c.textContent);
    const search = Boolean(panel.querySelector('.emoji-search'));
    const tabs = panel.querySelectorAll('.emoji-tab').length;
    offered[k.id] = { cells: cells.length, search, tabs };
    if (k.want === 'six') {
      if (JSON.stringify(cells) !== JSON.stringify(SIX)) problems.push(k.id + ' offers ' + cells.length + ' reactions, not the six classic ones');
      if (search || tabs) problems.push(k.id + ' offers emoji search or categories it cannot send');
      if (!panel.querySelector('.reaction-choices')) problems.push(k.id + ' is not the short panel');
    } else {
      if (cells.length <= SIX.length || !search) problems.push(k.id + ' does not offer the full panel (' + cells.length + ' cells, search ' + search + ')');
    }
    if (k.id !== 'fixture-sms') conv.remove();
  }

  // 2. Reactions that arrived as text, in every cited phrasing, on an SMS conversation.
  const S = 'fixture-fold';
  const photo = { id: 'fixture-photo', name: 'photo.jpg', mime: 'image/jpeg', bytes: 10, missing: true };
  const raw = [
    message(S, 'f-1', 20, { fromMe: true, sender: null, senderName: null, text: 'Dinner at seven?' }),
    message(S, 'f-2', 19, { fromMe: true, sender: null, senderName: null, text: 'Bring the long folding table from the garage if you can' }),
    message(S, 'f-3', 18, { fromMe: true, sender: null, senderName: null, attachments: [photo] }),
    message(S, 'f-4', 17, { text: 'Liked ' + L + 'Dinner at seven?' + R }),
    message(S, 'f-5', 16, { text: 'Reacted \u{1F602} to "Bring the long folding table from the ga..."' }),
    message(S, 'f-6', 15, { text: 'Loved an image' }),
    message(S, 'f-7', 14, { sender: '+15555550124', senderName: 'Ana Example', text: 'Emphasized ' + L + 'Dinner at seven?' + R }),
    message(S, 'f-8', 13, { sender: '+15555550124', senderName: 'Ana Example', text: 'Removed an exclamation from ' + L + 'Dinner at seven?' + R }),
    message(S, 'f-9', 12, { text: 'Questioned ' + L + 'A message from long ago' + R }),
  ];
  const folded = foldReactions(raw, 'sms');
  const conv = await draw(chat(S, 'SMS'), folded, { kind: 'fixture', tapbackEmoji: 2 }, 'top');
  const chips = (id) => [...conv.querySelectorAll('.bubble-row[data-id="' + id + '"] .reaction')].map((r) => r.textContent.trim());
  const seen = { 'f-1': chips('f-1'), 'f-2': chips('f-2'), 'f-3': chips('f-3') };
  if (JSON.stringify(seen['f-1']) !== JSON.stringify(['\u{1F44D}'])) problems.push('the curly-quoted like is not a reaction on its message: ' + JSON.stringify(seen['f-1']) + ' (the removed emphasis must be gone)');
  if (JSON.stringify(seen['f-2']) !== JSON.stringify(['\u{1F602}'])) problems.push('the Android emoji reaction to a quote cut short is not on its message: ' + JSON.stringify(seen['f-2']));
  if (JSON.stringify(seen['f-3']) !== JSON.stringify(['\u2764\ufe0f'])) problems.push('the reaction to an image is not on the picture: ' + JSON.stringify(seen['f-3']));
  const line = conv.querySelector('.bubble-row[data-id="f-9"]');
  const lineWords = line ? line.textContent.trim() : null;
  if (!line || !line.classList.contains('event') || line.querySelector('.bubble')) problems.push('the reaction naming nothing loaded is not a quiet line');
  else if (lineWords !== 'Sam Example reacted \u2753 to ' + L + 'A message from long ago' + R) problems.push('the line reads ' + JSON.stringify(lineWords));
  const stray = [...conv.querySelectorAll('.bubble')].map((b) => b.textContent).filter((t) => /^(Liked|Loved|Emphasized|Questioned|Reacted|Removed) /.test(t.trim()));
  if (stray.length) problems.push('a reaction is drawn as a message: ' + JSON.stringify(stray));
  const rows = conv.querySelectorAll('.bubble-row').length;
  if (rows !== 4) problems.push(rows + ' rows drawn, not the three messages and the one line');
  const detail = 'sms=' + offered['fixture-sms'].cells + ' rcs=' + offered['fixture-rcs'].cells + ' native=' + offered['fixture-native'].cells + ' older=' + offered['fixture-native-older'].cells + ' chips=' + JSON.stringify(seen) + ' rows=' + rows;
  say(problems.length ? 'reactions:fail ' + problems.join('; ') : 'reactions:pass ' + detail);
  window.reactionChoicesProof = { ok: !problems.length, problems, offered, seen, line: lineWords, rows };
})().catch((error) => {
  const mark = document.createElement('output');
  mark.setAttribute('aria-label', 'reactions:fail ' + error.message);
  mark.textContent = mark.getAttribute('aria-label');
  document.body.append(mark);
  window.reactionChoicesProof = { ok: false, error: error.message };
});
