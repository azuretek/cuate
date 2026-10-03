// Injected only by native test builds. Real components and keepScroll remain unchanged.
(async () => {
  // The verdict's fills. The native tests read them back from a capture, so they are fixed here rather than themed.
  const PASS = '#1b7f3b';
  const FAIL = '#b3261e';
  await customElements.whenDefined('app-root');
  const root = document.querySelector('app-root');
  // Wait for credential-free onboarding before replacing its synthetic record.
  const deadline = performance.now() + 10000;
  while (root.phase === 'boot' && performance.now() < deadline) await new Promise(requestAnimationFrame);
  if (root.phase !== 'onboarding') throw new Error('rotation fixture requires empty test storage');
  const chat = { id: 'rotation', title: 'Rotation fixture', participants: ['fixture@example.invalid'], service: 'iMessage' };
  root.chats = [chat];
  root.openChatId = chat.id;
  root.messages = Array.from({ length: 100 }, (_, i) => ({
    id: 'rotation-' + i, chatId: chat.id, text: 'Synthetic rotation message ' + i + ' with enough words to wrap when the phone turns.',
    sentAt: '2026-01-01T12:00:00.000Z', fromMe: i % 2 === 0, sender: 'Fixture', attachments: [], reactions: i % 3 === 0 ? [{ type: 'love', sender: 'Fixture', fromMe: false }] : [], replyTo: i % 4 === 1 ? 'rotation-' + (i - 1) : null,
  }));
  const scheme = window.fixtureScheme === 'dark' ? 'dark' : 'light';
  root.settings = { ...root.settings, 'appearance.skin': scheme };
  root.phase = 'ready';
  root.conn = 'open';
  root.sending = true;
  root.listOpen = false;
  await root.updateComplete;
  root.applyTheme();
  const conversation = root.querySelector('app-conversation');
  await conversation.updateComplete;
  const composer = conversation.querySelector('app-composer');
  await composer.updateComplete;
  const field = composer.querySelector('textarea');
  field.value = 'Rotation draft with caret';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.focus();
  field.setSelectionRange(9, 9);
  const scroller = conversation.querySelector('.messages');
  if (scroller.scrollHeight <= scroller.clientHeight || !field) throw new Error('fixture must populate a scrollable conversation');
  scroller.scrollTop = scroller.scrollHeight / 2;
  scroller.dispatchEvent(new Event('scroll'));
  await new Promise(requestAnimationFrame);
  const rows = () => [...scroller.querySelectorAll('.bubble-row')];
  const top = () => scroller.getBoundingClientRect().top;
  const anchor = rows().find(row => row.getBoundingClientRect().bottom > top());
  const key = anchor.dataset.id;
  const offset = anchor.getBoundingClientRect().top - top();
  let blank = false;
  const observe = () => { if (!rows().length || !scroller.isConnected || document.querySelector('app-onboarding')) blank = true; };
  new MutationObserver(records => {
    observe();
    if (records.some(record => [...record.removedNodes].some(node => node === scroller || node === conversation || node.contains?.(scroller)))) blank = true;
  }).observe(document.body, { childList: true, subtree: true });
  // The verdict is drawn inside the safe area, so no system bar draws over it, and on a fill of its own state, so a
  // capture shows which verdict it caught whatever the scheme and the native test can read it from the pixels.
  const marker = document.createElement('output');
  marker.setAttribute('aria-label', 'rotation-proof');
  Object.assign(marker.style, {
    position: 'fixed', top: 'env(safe-area-inset-top, 0px)', left: 'env(safe-area-inset-left, 0px)', zIndex: '9999',
    padding: '4px 8px', font: '12px/16px sans-serif', color: '#ffffff', background: FAIL,
  });
  document.body.append(marker);
  // Every sample is numbered and the last failing one remembered, so a test can prove the verdict held for the whole
  // of a capture rather than at the one instant it asked; each change of verdict is kept with the checks that failed.
  let seq = 0;
  let lastFail = 0;
  const history = [];
  let frames = 0;
  let previousWidth = innerWidth;
  const sample = () => {
    observe();
    frames = previousWidth === innerWidth ? frames + 1 : 0;
    previousWidth = innerWidth;
    const current = rows().find(row => row.dataset.id === key);
    const relationships = [...scroller.querySelectorAll('.reply-mark')];
    const chatDesign = document.documentElement.dataset.scheme === scheme && relationships.length === 25 && relationships.every(link => !link.textContent.includes('Synthetic rotation message') && !/Reply to/.test(link.textContent))
      && !scroller.querySelector('.reply-quote') && scroller.querySelector('.reaction');
    const checks = {
      design: Boolean(chatDesign), present: !blank,
      anchored: Boolean(current) && Math.abs(current.getBoundingClientRect().top - top() - offset) <= 2,
      draft: field.value === 'Rotation draft with caret', caret: field.selectionStart === 9 && field.selectionEnd === 9,
      focused: document.activeElement === field, settled: frames >= 10,
    };
    const failing = Object.keys(checks).filter(name => !checks[name]);
    const ok = failing.length === 0;
    seq += 1;
    if (!ok) lastFail = seq;
    const label = (innerWidth > innerHeight ? 'landscape' : 'portrait') + ':' + (ok ? 'pass' : 'fail');
    if (marker.textContent !== label) {
      marker.textContent = label;
      marker.setAttribute('aria-label', label);
      marker.style.background = ok ? PASS : FAIL;
      history.push({ at: Math.round(performance.now()), label, failing });
      if (history.length > 40) history.shift();
    }
    const box = marker.getBoundingClientRect();
    window.rotationProof = { ok, blank, width: innerWidth, height: innerHeight, key,
      delta: current ? current.getBoundingClientRect().top - top() - offset : null,
      draft: field.value, start: field.selectionStart, end: field.selectionEnd,
      label: marker.textContent, seq, lastFail, failing, history,
      marker: { left: box.left, top: box.top, width: box.width, height: box.height } };
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
})().catch(error => {
  window.rotationProof = { ok: false, error: error.message };
  document.body.textContent = 'rotation fixture failed: ' + error.message;
});
