// Injected only by native test builds (issue 442). A conversation that receives a message sent with each of Messages'
// bubble and screen effects: the real conversation, drawn in the shell's own web view, is handed synthetic messages one
// at a time as they would arrive, and the page samples what plays. A bubble effect must play on its bubble, a screen
// effect over the conversation, the line under each must name it with a Replay control, Invisible Ink must veil its
// words until pressed, and a message already in the history when the conversation is drawn must be named and never
// played. Synthetic records only: no server, token or account.
//   sendfx:pass <detail>   every effect played where it belongs and every line named it
//   sendfx:fail <why>      it did not
(async () => {
  const until = async (test, what, ms = 20000) => {
    const deadline = performance.now() + ms;
    while (!test()) {
      if (performance.now() > deadline) throw new Error('timed out waiting for ' + what);
      await new Promise(requestAnimationFrame);
    }
  };
  const frame = () => new Promise(requestAnimationFrame);
  const say = (text) => {
    const mark = document.querySelector('[data-sendfx-fixture]') || document.createElement('output');
    mark.setAttribute('data-sendfx-fixture', 'verdict');
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
  const chat = { id: 'fixture-sendfx-chat', name: 'Sam Example', isGroup: false, service: 'iMessage', participants: [sam], members: [{ handle: sam, name: 'Sam Example', photo: null }], unread: 0, lastMessageAt: at(1), lastMessage: null };
  const message = (id, minutes, text, sendEffect, over = {}) => ({ id, chatId: chat.id, fromMe: false, sender: sam, senderName: 'Sam Example', text, sentAt: at(minutes), replyTo: null, read: null, attachments: [], link: null, payloads: 0, reactions: [], ...(sendEffect ? { sendEffect } : {}), ...over });
  const BUBBLE = [['slam', 'Slam'], ['loud', 'Loud'], ['gentle', 'Gentle'], ['invisible-ink', 'Invisible Ink']];
  const SCREEN = [['echo', 'Echo'], ['spotlight', 'Spotlight'], ['balloons', 'Balloons'], ['confetti', 'Confetti'], ['love', 'Love'], ['lasers', 'Lasers'], ['fireworks', 'Fireworks'], ['celebration', 'Celebration'], ['shooting-star', 'Shooting Star']];
  let list = [message('fixture-plain', 60, 'Plain words, no effect.'), message('fixture-history', 59, 'Sent with confetti a while ago', 'confetti')];
  const conv = document.createElement('app-conversation');
  Object.assign(conv, { chat, host, messages: list, sending: true, phone: true });
  Object.assign(conv.style, { position: 'fixed', inset: '0', zIndex: '9998', display: 'flex', flexDirection: 'column', background: 'var(--color-bg)' });
  document.body.append(conv);
  const row = (id) => conv.querySelector('.messages .bubble-row[data-id="' + id + '"]');
  await until(() => row('fixture-history'), 'the conversation');
  await frame();
  await frame();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const running = (els, id) => els.flatMap((el) => el.getAnimations()).filter((a) => a.playState === 'running' && a.id === id).length;
  const problems = [];
  const seen = {};
  const layer = conv.querySelector('.screen-effect');
  if (!layer) throw new Error('no layer over the conversation for a screen effect');
  // A message in the history when the conversation is drawn is a place, not news: named, and never played.
  if (layer.querySelector('.fx-piece')) problems.push('a message in the history played as the conversation was drawn');
  const lineOf = (id) => (row(id)?.querySelector('.send-effect-line .send-effect-name')?.textContent || '').trim();
  if (lineOf('fixture-history') !== 'Sent with Confetti') problems.push('the history line reads ' + JSON.stringify(lineOf('fixture-history')));
  if (row('fixture-plain').querySelector('.send-effect-line')) problems.push('a plain message is named as sent with an effect');
  const arrive = async (m) => {
    list = [...list, m];
    conv.messages = list;
    await conv.updateComplete;
    await frame();
  };
  let minute = 50;
  for (const [effect, name] of BUBBLE) {
    minute -= 1;
    const id = 'fixture-' + effect;
    await arrive(message(id, minute, 'Words sent with ' + name, effect, minute % 2 ? { fromMe: true, sender: null, senderName: null } : {}));
    const r = row(id);
    const bubble = r && r.querySelector('.bubble');
    if (!bubble) { problems.push(effect + ' drew no bubble'); continue; }
    const moving = running([bubble], 'send-' + effect);
    seen[effect] = { moving };
    if (effect !== 'invisible-ink' && !reduced && !moving) problems.push(effect + ' did not play on its bubble');
    if (lineOf(id) !== 'Sent with ' + name) problems.push(effect + ' line reads ' + JSON.stringify(lineOf(id)));
    if (!r.querySelector('.send-effect-replay')) problems.push(effect + ' offers no Replay');
    if (layer.querySelector('.fx-piece')) problems.push(effect + ' played over the conversation, not on its bubble');
  }
  // Invisible Ink keeps its words veiled until the bubble is pressed.
  const ink = row('fixture-invisible-ink')?.querySelector('.bubble');
  const words = ink && ink.querySelector('.ink-words');
  if (!ink || ink.dataset.ink !== 'veiled' || !words) problems.push('Invisible Ink is not veiled');
  else {
    const veil = getComputedStyle(words).filter;
    if (!veil || veil === 'none') problems.push('Invisible Ink shows its words openly');
    ink.click();
    await conv.updateComplete;
    await frame();
    const shown = getComputedStyle(ink.querySelector('.ink-words')).filter;
    seen['invisible-ink'].veil = veil;
    seen['invisible-ink'].pressed = ink.dataset.ink;
    if (ink.dataset.ink !== 'shown' || (shown && shown !== 'none')) problems.push('pressing Invisible Ink did not show its words');
    if (ink.textContent.trim() !== 'Words sent with Invisible Ink') problems.push('Invisible Ink reads ' + JSON.stringify(ink.textContent.trim()));
  }
  for (const [effect, name] of SCREEN) {
    minute -= 1;
    const id = 'fixture-' + effect;
    const text = 'Words sent with ' + name;
    await arrive(message(id, minute, text, effect));
    if (!reduced) await until(() => layer.dataset.effect === effect && running([...layer.querySelectorAll('.fx-piece')], 'send-' + effect) > 0, effect + ' over the conversation', 5000).catch(() => {});
    const pieces = [...layer.querySelectorAll('.fx-piece')];
    const moving = running(pieces, 'send-' + effect);
    seen[effect] = { pieces: pieces.length, moving };
    if (!reduced && (layer.dataset.effect !== effect || !moving)) problems.push(effect + ' did not play over the conversation');
    if (effect === 'echo' && !reduced && !pieces.every((p) => p.textContent === text)) problems.push('echo does not repeat the words');
    if (effect === 'spotlight' && !reduced && !layer.querySelector('.fx-spot')) problems.push('spotlight lights nothing');
    if (lineOf(id) !== 'Sent with ' + name) problems.push(effect + ' line reads ' + JSON.stringify(lineOf(id)));
    if (running([row(id).querySelector('.bubble')], 'send-' + effect)) problems.push(effect + ' played on its bubble');
  }
  // Replay plays it again, on a press of the line's own control.
  const replay = row('fixture-history').querySelector('.send-effect-replay');
  if (!replay) problems.push('the history message offers no Replay');
  else if (!reduced) {
    replay.click();
    await until(() => layer.dataset.effect === 'confetti' && running([...layer.querySelectorAll('.fx-piece')], 'send-confetti') > 0, 'the replay', 5000).catch(() => problems.push('Replay did not play the effect again'));
    seen.replay = running([...layer.querySelectorAll('.fx-piece')], 'send-confetti');
  }
  // Once it has played the layer is empty again, and takes no press while it plays.
  if (getComputedStyle(layer).pointerEvents !== 'none') problems.push('the layer over the conversation takes presses');
  await until(() => !layer.querySelector('.fx-piece'), 'the effect to end', 15000).catch(() => problems.push('the screen effect never ended'));
  const detail = Object.entries(seen).map(([k, v]) => k + '=' + (typeof v === 'object' ? Object.values(v).join('/') : v)).join(' ');
  say(problems.length ? 'sendfx:fail ' + problems.join('; ') : 'sendfx:pass ' + (reduced ? 'reduced ' : '') + detail);
  window.sendEffectsProof = { ok: !problems.length, problems, seen, reduced };
})().catch((error) => {
  const mark = document.createElement('output');
  mark.setAttribute('aria-label', 'sendfx:fail ' + error.message);
  mark.textContent = mark.getAttribute('aria-label');
  document.body.append(mark);
  window.sendEffectsProof = { ok: false, error: error.message };
});
