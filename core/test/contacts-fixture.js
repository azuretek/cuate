// Injected only by native test builds (issue 393). Edit contact on a phone: the real conversation header, given this
// shell's own app.info, draws the Edit contact control on a one-to-one chat, and its press hands the address to the
// real bridge, which opens the system's own contact card. The test seeds the synthetic person first (+15555550123,
// "Fixture Person"), and the native test then holds the system editor to being on screen with that person in it.
// Synthetic records only: no server, token or account.
(async () => {
  const until = async (test, what, ms = 15000) => {
    const deadline = performance.now() + ms;
    while (!test()) {
      if (performance.now() > deadline) throw new Error('timed out waiting for ' + what);
      await new Promise(requestAnimationFrame);
    }
  };
  await customElements.whenDefined('app-conversation');
  await until(() => window.bridge && typeof window.bridge.call === 'function', 'the bridge');
  const host = await window.bridge.call('app.info');
  const handle = '+15555550123';
  const chat = { id: 'fixture-contact', name: 'Fixture Person', isGroup: false, service: 'iMessage', participants: [handle], members: [{ handle, name: 'Fixture Person', photo: null }], unread: 0, lastMessageAt: null, lastMessage: null };
  const conv = document.createElement('app-conversation');
  conv.chat = chat;
  conv.host = host;
  Object.assign(conv.style, { position: 'fixed', inset: '0', zIndex: '9998', background: 'var(--color-surface, #fff)' });
  document.body.append(conv);
  await until(() => conv.querySelector('.conv-head'), 'the conversation header');
  const control = conv.querySelector('.conv-head .conv-edit-contact');
  const drawn = Boolean(control) && host.contactsEditor === true;
  // The press itself, through the kit's press behaviour, which calls editContact; the answer is read from the same
  // call the handler makes, so the proof is the bridge's own word on whether the editor opened.
  let answer = null;
  if (control) {
    const pressed = new Promise((resolve) => {
      const original = conv.editContact.bind(conv);
      conv.editContact = () => { const p = original(); p.then(resolve, () => resolve(false)); return p; };
    });
    control.click();
    answer = await pressed;
  }
  const mark = document.createElement('output');
  mark.setAttribute('aria-label', 'contacts:answer ' + String(answer) + ' drawn=' + String(drawn));
  mark.textContent = mark.getAttribute('aria-label');
  Object.assign(mark.style, { position: 'fixed', bottom: '0', left: '0', zIndex: '9999', fontSize: '1px' });
  document.body.append(mark);
  window.contactsProof = { ok: drawn && answer === true, drawn, answer, editor: host.contactsEditor === true };
})().catch((error) => {
  window.contactsProof = { ok: false, error: error.message };
  document.body.textContent = 'contacts fixture failed: ' + error.message;
});
