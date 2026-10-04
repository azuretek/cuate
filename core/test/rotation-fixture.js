// Injected only by native test builds. Real components and keepScroll remain unchanged.
(async () => {
  // The verdict's fills. The native tests read them back from a capture, so they are fixed here rather than themed.
  const PASS = '#1b7f3b';
  const FAIL = '#b3261e';
  // A sample that has not settled yet is neither: the marker must never claim fail while the page is merely still
  // reflowing after a turn, so an unsettled sample draws this and reads '<orientation>:settling' (issue 201).
  const SETTLING = '#5a5a5a';
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
  // What the place keeper saw (issue 211): each scroll it was handed and each size the view took, with its anchor and
  // scrollTop, so a run that loses its place says which step moved it. The wrapper only watches: record still runs.
  const keep = conversation.keep;
  const steps = [];
  const anchorText = (a) => (!a ? 'none' : a.end ? 'end' : a.key != null ? String(a.key).replace('rotation-', 'm') + '@' + Math.round(a.offset) : 'top' + Math.round(a.top));
  let lastStep = '';
  const step = (kind) => {
    const text = kind + ' ' + anchorText(keep && keep.anchor) + ' st' + Math.round(scroller.scrollTop) + ' ' + scroller.clientWidth + 'x' + scroller.clientHeight + ':' + scroller.scrollHeight;
    if (text.slice(text.indexOf(' ')) === lastStep.slice(lastStep.indexOf(' '))) return;
    lastStep = text;
    steps.push(Math.round(performance.now()) + ' ' + text);
    if (steps.length > 14) steps.shift();
  };
  if (keep && typeof keep.record === 'function') {
    const record = keep.record.bind(keep);
    keep.record = () => { record(); step('scroll'); };
  }
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
    position: 'fixed', top: 'var(--inset-top, env(safe-area-inset-top, 0px))', left: 'var(--inset-left, env(safe-area-inset-left, 0px))', zIndex: '9999',
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
  // A compact, machine-readable copy of the last sample, drawn as its own accessible element so a native dump names
  // the failing checks, the sample the verdict last failed on and the frame counter (issue 201). It is one pixel and
  // paints nothing, so it never shows in a capture or moves another surface.
  const diagnosis = document.createElement('output');
  diagnosis.setAttribute('aria-label', 'rotation-diagnosis');
  Object.assign(diagnosis.style, {
    position: 'fixed', top: '0px', left: '0px', width: '1px', height: '1px', overflow: 'hidden',
    font: '1px/1px sans-serif', color: 'transparent', background: 'transparent', zIndex: '9998', pointerEvents: 'none',
  });
  document.body.append(diagnosis);
  const sample = () => {
    observe();
    frames = previousWidth === innerWidth ? frames + 1 : 0;
    previousWidth = innerWidth;
    step('frame');
    const current = rows().find(row => row.dataset.id === key);
    // A thread is drawn from the stored pointer alone (issue 208): the fixture's 25 replies each mark the message
    // they answer with one quiet count line, and nothing is drawn between two messages.
    const summaries = [...scroller.querySelectorAll('.thread-replies')];
    const chatDesign = document.documentElement.dataset.scheme === scheme && summaries.length === 25
      && summaries.every(s => (s.querySelector('.thread-count')?.textContent || '').trim() === '1 Reply' && !s.textContent.includes('Synthetic rotation message') && !/Reply to/.test(s.textContent))
      && scroller.querySelectorAll('.bubble-row.thread-reply').length === 25 && !scroller.querySelector('.thread-line') && !scroller.querySelector('.thread-ghost')
      && !scroller.querySelector('.reply-quote') && scroller.querySelector('.reaction');
    const checks = {
      design: Boolean(chatDesign), present: !blank,
      anchored: Boolean(current) && Math.abs(current.getBoundingClientRect().top - top() - offset) <= 2,
      draft: field.value === 'Rotation draft with caret', caret: field.selectionStart === 9 && field.selectionEnd === 9,
      focused: document.activeElement === field,
    };
    const failing = Object.keys(checks).filter(name => !checks[name]);
    // The settling gate is a state of its own, never a failure: a sample still counting the frames after a turn reports
    // 'settling', and only a settled sample can report pass or fail (issue 201).
    const settled = frames >= 10;
    const state = settled ? (failing.length ? 'fail' : 'pass') : 'settling';
    const ok = state === 'pass';
    seq += 1;
    if (state === 'fail') lastFail = seq;
    const label = (innerWidth > innerHeight ? 'landscape' : 'portrait') + ':' + state;
    if (marker.textContent !== label) {
      marker.textContent = label;
      marker.setAttribute('aria-label', label);
      marker.style.background = state === 'pass' ? PASS : state === 'fail' ? FAIL : SETTLING;
      history.push({ at: Math.round(performance.now()), label, failing: settled ? failing : [] });
      if (history.length > 40) history.shift();
    }
    const box = marker.getBoundingClientRect();
    diagnosis.textContent = 'rotation-diagnosis ' + JSON.stringify({ label, state, seq, lastFail, failing, frames, settled, blank,
      width: innerWidth, height: innerHeight, delta: current ? current.getBoundingClientRect().top - top() - offset : null,
      history: history.slice(-8), steps });
    window.rotationProof = { ok, blank, width: innerWidth, height: innerHeight, key,
      delta: current ? current.getBoundingClientRect().top - top() - offset : null,
      draft: field.value, start: field.selectionStart, end: field.selectionEnd,
      label, seq, lastFail, failing, settled, frames, history,
      marker: { left: box.left, top: box.top, width: box.width, height: box.height } };
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
})().catch(error => {
  window.rotationProof = { ok: false, error: error.message };
  document.body.textContent = 'rotation fixture failed: ' + error.message;
});
