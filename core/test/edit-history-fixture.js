// Injected only by native test builds (issue 437). An edited message whose earlier versions the server sent: the real
// conversation draws Edited under it as a control, and pressing it shows those versions above the message, oldest first,
// and reads Hide edits; pressing that folds them away; a live edit that grows the history adds the words it replaced;
// and an edited message with no history keeps the plain mark. The page presses the real control and reports what it
// saw, so the native test reads a verdict measured in the shell's own web view. Synthetic records only.
//   edits:pass <detail>   every step drew as Messages does
//   edits:fail <why>      it did not
(async () => {
  const frame = () => new Promise(requestAnimationFrame);
  const until = async (test, what, ms = 20000) => {
    const deadline = performance.now() + ms;
    while (!test()) {
      if (performance.now() > deadline) throw new Error('timed out waiting for ' + what);
      await frame();
    }
  };
  // Past the press behaviour's coalescing window, so a second press is its own.
  const settle = (ms = 600) => new Promise((resolve) => setTimeout(resolve, ms));
  const say = (text) => {
    const mark = document.querySelector('[data-edits-fixture]') || document.createElement('output');
    mark.setAttribute('data-edits-fixture', 'verdict');
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
  const chat = { id: 'fixture-edits-chat', name: 'Sam Example', isGroup: false, service: 'iMessage', participants: [sam], members: [{ handle: sam, name: 'Sam Example', photo: null }], unread: 0, lastMessageAt: at(1), lastMessage: null };
  const message = (id, minutes, text, over = {}) => ({ id, chatId: chat.id, fromMe: false, sender: sam, senderName: 'Sam Example', text, sentAt: at(minutes), replyTo: null, read: null, attachments: [], link: null, payloads: 0, reactions: [], ...over });
  const FIRST = 'Running a little late';
  const SECOND = 'Running about ten minutes late';
  const NOW = 'Running twenty minutes late, sorry';
  const LATER = 'Running half an hour late, sorry';
  const messages = [
    message('fixture-edited', 10, NOW, { edited: true, edits: [{ text: SECOND, at: at(9) }, { text: FIRST, at: at(10) }] }),
    message('fixture-bare', 5, 'Edited with nothing kept', { edited: true }),
    message('fixture-plain', 2, 'Plain words, never edited.'),
  ];
  const conv = document.createElement('app-conversation');
  Object.assign(conv, { chat, host, messages, sending: true, phone: true });
  Object.assign(conv.style, { position: 'fixed', inset: '0', zIndex: '9998', display: 'flex', flexDirection: 'column', background: 'var(--color-bg)' });
  document.body.append(conv);
  const row = () => conv.querySelector('.bubble-row[data-id="fixture-edited"]');
  const toggle = () => row() && row().querySelector('button.edited-toggle');
  const versions = () => [...row().querySelectorAll('.edit-version')].map((el) => el.textContent);
  await until(() => toggle(), 'the Edited control');
  const problems = [];
  const seen = {};
  seen.folded = { label: toggle().textContent, expanded: toggle().getAttribute('aria-expanded'), versions: versions().length };
  if (seen.folded.label !== 'Edited' || seen.folded.expanded !== 'false' || seen.folded.versions) problems.push('folded: ' + JSON.stringify(seen.folded));
  toggle().click();
  await until(() => versions().length === 2, 'the earlier versions');
  const current = row().querySelector('.bubble:not(.edit-version)');
  const shownEls = [...row().querySelectorAll('.edit-version')];
  const above = shownEls.every((el) => el.getBoundingClientRect().bottom <= current.getBoundingClientRect().top + 1);
  const quieter = shownEls.every((el) => getComputedStyle(el).color !== getComputedStyle(current).color);
  seen.shown = { label: toggle().textContent, expanded: toggle().getAttribute('aria-expanded'), versions: versions(), above, quieter };
  if (seen.shown.label !== 'Hide edits' || seen.shown.expanded !== 'true') problems.push('shown control: ' + seen.shown.label + '/' + seen.shown.expanded);
  if (JSON.stringify(versions()) !== JSON.stringify([FIRST, SECOND])) problems.push('versions not oldest first: ' + JSON.stringify(versions()));
  if (!above) problems.push('the versions are not above the message');
  if (!quieter) problems.push('the versions are drawn like the message');
  // A live edit: the message now says LATER, and the words it replaced join the history.
  conv.messages = conv.messages.map((m) => (m.id === 'fixture-edited' ? { ...m, text: LATER, edits: [...m.edits, { text: NOW, at: at(1) }] } : m));
  await until(() => versions().length === 3, 'the live edit');
  seen.live = versions();
  if (JSON.stringify(seen.live) !== JSON.stringify([FIRST, SECOND, NOW]) || !row().textContent.includes(LATER)) problems.push('live: ' + JSON.stringify(seen.live));
  await settle();
  toggle().click();
  await until(() => versions().length === 0, 'the versions to fold');
  seen.hidden = { label: toggle().textContent, expanded: toggle().getAttribute('aria-expanded') };
  if (seen.hidden.label !== 'Edited' || seen.hidden.expanded !== 'false') problems.push('hidden: ' + JSON.stringify(seen.hidden));
  const bare = conv.querySelector('.bubble-row[data-id="fixture-bare"]');
  seen.bare = { mark: Boolean(bare.querySelector('div.edited-mark')), control: Boolean(bare.querySelector('button.edited-toggle')) };
  if (!seen.bare.mark || seen.bare.control) problems.push('a message with no history: ' + JSON.stringify(seen.bare));
  if (conv.querySelector('.bubble-row[data-id="fixture-plain"] .edited-mark')) problems.push('a message never edited is marked');
  const detail = 'versions=' + seen.shown.versions.length + ' live=' + seen.live.length + ' above=' + above + ' quieter=' + quieter;
  say(problems.length ? 'edits:fail ' + problems.join('; ') : 'edits:pass ' + detail);
  window.editHistoryProof = { ok: !problems.length, problems, seen };
})().catch((error) => {
  const mark = document.createElement('output');
  mark.setAttribute('aria-label', 'edits:fail ' + error.message);
  mark.textContent = mark.getAttribute('aria-label');
  document.body.append(mark);
  window.editHistoryProof = { ok: false, error: error.message };
});
