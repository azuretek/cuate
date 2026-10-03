// Injected only by native test builds. Real components and keepScroll remain unchanged.
(async () => {
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
  const marker = document.createElement('output');
  marker.setAttribute('aria-label', 'rotation-proof');
  Object.assign(marker.style, { position: 'fixed', top: '0', left: '0', zIndex: '9999' });
  document.body.append(marker);
  let frames = 0;
  let previousWidth = innerWidth;
  const sample = () => {
    observe();
    frames = previousWidth === innerWidth ? frames + 1 : 0;
    previousWidth = innerWidth;
    const current = rows().find(row => row.dataset.id === key);
    const relationships = [...scroller.querySelectorAll('.reply-link')];
    const chatDesign = document.documentElement.dataset.scheme === scheme && relationships.length === 25 && relationships.every(link => !link.textContent.includes('Synthetic rotation message'))
      && !scroller.querySelector('.reply-quote') && scroller.querySelector('.reaction');
    const ok = Boolean(chatDesign) && !blank && current && Math.abs(current.getBoundingClientRect().top - top() - offset) <= 2
      && field.value === 'Rotation draft with caret' && field.selectionStart === 9 && field.selectionEnd === 9
      && document.activeElement === field && frames >= 10;
    const label = (innerWidth > innerHeight ? 'landscape' : 'portrait') + ':' + (ok ? 'pass' : 'fail');
    if (marker.textContent !== label) { marker.textContent = label; marker.setAttribute('aria-label', label); }
    window.rotationProof = { ok: Boolean(ok), blank, width: innerWidth, height: innerHeight, key,
      delta: current ? current.getBoundingClientRect().top - top() - offset : null,
      draft: field.value, start: field.selectionStart, end: field.selectionEnd };
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
})().catch(error => {
  window.rotationProof = { ok: false, error: error.message };
  document.body.textContent = 'rotation fixture failed: ' + error.message;
});
