// Injected only by native test builds (issue 433). A conversation whose messages carry each of Messages' text effects:
// the real conversation, given synthetic messages whose styles name a stretch and its effect, draws each stretch with
// its effect playing. The page samples the stretches while they play and reports what it saw, so the native test reads
// a verdict measured in the shell's own web view. Synthetic records only: no server, token or account.
//   textfx:pass <detail>   every effect drew over its own stretch, played, and settled back to the words as sent
//   textfx:fail <why>      it did not
(async () => {
  const until = async (test, what, ms = 20000) => {
    const deadline = performance.now() + ms;
    while (!test()) {
      if (performance.now() > deadline) throw new Error('timed out waiting for ' + what);
      await new Promise(requestAnimationFrame);
    }
  };
  const say = (text) => {
    const mark = document.querySelector('[data-textfx-fixture]') || document.createElement('output');
    mark.setAttribute('data-textfx-fixture', 'verdict');
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
  const chat = { id: 'fixture-textfx-chat', name: 'Sam Example', isGroup: false, service: 'iMessage', participants: [sam], members: [{ handle: sam, name: 'Sam Example', photo: null }], unread: 0, lastMessageAt: at(1), lastMessage: null };
  const message = (id, minutes, text, styles, over = {}) => ({ id, chatId: chat.id, fromMe: false, sender: sam, senderName: 'Sam Example', text, styles, sentAt: at(minutes), replyTo: null, read: null, attachments: [], link: null, payloads: 0, reactions: [], ...over });
  const CASES = [
    ['big', 'Big news today', 0, 8],
    ['small', 'a small thing', 2, 5],
    ['shake', 'Shake it off', 0, 5],
    ['nod', 'Yes yes yes', 0, 11],
    ['bloom', 'Happy birthday!', 6, 9],
    ['ripple', 'Ripple across', 0, 6],
    ['jitter', 'So nervous', 3, 7],
    ['explode', 'Boom goes it', 0, 4],
  ];
  const messages = CASES.map(([effect, text, start, length], i) => message('fixture-' + effect, 20 - i, text, [{ start, length, effect }], i % 2 ? { fromMe: true, sender: null, senderName: null } : {}));
  messages.push(message('fixture-plain', 2, 'Plain words, no effect.', undefined));
  const conv = document.createElement('app-conversation');
  Object.assign(conv, { chat, host, messages, sending: true, phone: true });
  Object.assign(conv.style, { position: 'fixed', inset: '0', zIndex: '9998', display: 'flex', flexDirection: 'column', background: 'var(--color-bg)' });
  document.body.append(conv);
  await until(() => conv.querySelectorAll('.text-effect').length >= CASES.length, 'the effects');
  const problems = [];
  const seen = {};
  for (const [effect, text, start, length] of CASES) {
    const row = conv.querySelector('.bubble-row[data-id="fixture-' + effect + '"]');
    const el = row && row.querySelector('.text-effect[data-effect="' + effect + '"]');
    if (!el) { problems.push(effect + ' drew no stretch'); continue; }
    if (el.textContent !== text.slice(start, start + length)) problems.push(effect + ' covers ' + JSON.stringify(el.textContent));
    const bubble = row.querySelector('.bubble');
    if (bubble.textContent !== text) problems.push(effect + ' bubble reads ' + JSON.stringify(bubble.textContent));
    const moving = [el, ...el.querySelectorAll('.fx-letter')].flatMap((x) => x.getAnimations()).filter((a) => a.playState === 'running').length;
    seen[effect] = { moving, letters: el.querySelectorAll('.fx-letter').length, grew: 1 };
    if (!moving && !matchMedia('(prefers-reduced-motion: reduce)').matches) problems.push(effect + ' is not playing');
  }
  // The big stretch is sampled while it plays: it must grow past its settled size and settle back.
  const big = conv.querySelector('.text-effect[data-effect="big"]');
  const settledWidth = big.offsetWidth;
  let widest = 0;
  const sampleUntil = performance.now() + 2500;
  while (performance.now() < sampleUntil) {
    widest = Math.max(widest, big.getBoundingClientRect().width);
    await new Promise(requestAnimationFrame);
  }
  seen.big.grew = Math.round((widest / settledWidth) * 100) / 100;
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches && seen.big.grew < 1.3) problems.push('big grew only ' + seen.big.grew + 'x');
  const still = [...conv.querySelectorAll('.text-effect, .fx-letter')].flatMap((x) => x.getAnimations()).filter((a) => a.playState === 'running').length;
  if (still) problems.push(still + ' animations still running after they should have settled');
  if (conv.querySelector('.bubble-row[data-id="fixture-plain"] .text-effect')) problems.push('a plain message drew an effect');
  for (const e of ['ripple', 'jitter', 'explode']) if (!seen[e] || seen[e].letters < 2) problems.push(e + ' does not move its letters one by one');
  const detail = Object.entries(seen).map(([k, v]) => k + '=' + v.moving + (v.letters ? '/' + v.letters + 'l' : '') + (k === 'big' ? '/' + v.grew + 'x' : '')).join(' ');
  say(problems.length ? 'textfx:fail ' + problems.join('; ') : 'textfx:pass ' + detail);
  window.textEffectsProof = { ok: !problems.length, problems, seen };
})().catch((error) => {
  const mark = document.createElement('output');
  mark.setAttribute('aria-label', 'textfx:fail ' + error.message);
  mark.textContent = mark.getAttribute('aria-label');
  document.body.append(mark);
  window.textEffectsProof = { ok: false, error: error.message };
});
