// Injected only by native test builds (issue 417). A conversation whose background a participant set: the real
// conversation, given a synthetic group whose chat carries its background and a history holding the change, draws the
// backdrop behind the messages and the change as a line naming who made it. The page reports what it drew, and where a
// stretch of bare backdrop is, so the native test can read the colour the screen actually shows there. Synthetic
// records only: no server, token or account, and the picture is a solid colour drawn here.
//   background:pass <detail>   the backdrop drew behind the messages, out of the timeline, and the line reads right
//   background:fail <why>      it did not
//   where:backdrop x y w h     a point of bare backdrop in the page's coordinates, and the page's size
(async () => {
  const COLOUR = [230, 30, 160];
  const LINE = 'Sam Example changed the background';
  const until = async (test, what, ms = 20000) => {
    const deadline = performance.now() + ms;
    while (!test()) {
      if (performance.now() > deadline) throw new Error('timed out waiting for ' + what);
      await new Promise(requestAnimationFrame);
    }
  };
  const say = (label, text) => {
    const mark = document.querySelector('[data-background-fixture="' + label + '"]') || document.createElement('output');
    mark.setAttribute('data-background-fixture', label);
    mark.setAttribute('aria-label', text);
    mark.textContent = text;
    Object.assign(mark.style, { position: 'fixed', bottom: '0', left: label === 'where' ? '50%' : '0', zIndex: '9999', fontSize: '1px' });
    document.body.append(mark);
  };
  await customElements.whenDefined('app-conversation');
  await until(() => window.bridge && typeof window.bridge.call === 'function', 'the bridge');
  const host = await window.bridge.call('app.info');
  const canvas = document.createElement('canvas');
  canvas.width = 360;
  canvas.height = 640;
  const g = canvas.getContext('2d');
  g.fillStyle = 'rgb(' + COLOUR.join(',') + ')';
  g.fillRect(0, 0, canvas.width, canvas.height);
  const picture = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  let fetched = 0;
  const client = { attachment: async (id) => { if (id !== 'fixture-background') throw new Error('no such attachment'); fetched += 1; return picture; } };
  const sam = '+15555550123';
  const at = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
  const background = { id: 'fixture-background', name: 'Background', mime: 'image/*', bytes: picture.size, sticker: false, missing: false };
  const chat = { id: 'fixture-background-chat', name: 'Fixture Group', isGroup: true, service: 'iMessage', participants: [sam, 'fixture@example.com'], members: [{ handle: sam, name: 'Sam Example', photo: null }], unread: 0, lastMessageAt: at(1), lastMessage: null, background };
  const message = (id, minutes, over) => ({ id, chatId: chat.id, fromMe: false, sender: sam, senderName: 'Sam Example', text: '', sentAt: at(minutes), replyTo: null, read: null, attachments: [], link: null, payloads: 0, reactions: [], ...over });
  const messages = [
    message('fixture-1', 6, { text: 'Synthetic words before the change.' }),
    message('fixture-bg', 4, { event: { kind: 'background', action: 'set' } }),
    message('fixture-2', 2, { fromMe: true, sender: null, senderName: null, text: 'Synthetic words after it.' }),
  ];
  const conv = document.createElement('app-conversation');
  Object.assign(conv, { chat, host, client, messages, sending: true, phone: true });
  Object.assign(conv.style, { position: 'fixed', inset: '0', zIndex: '9998', display: 'flex', flexDirection: 'column', background: 'var(--color-bg)' });
  document.body.append(conv);
  await until(() => conv.querySelector('.conv-body'), 'the conversation');
  await until(() => { const img = conv.querySelector('app-backdrop img'); return img && img.complete && img.naturalWidth > 0; }, 'the backdrop picture');
  await new Promise(requestAnimationFrame);
  const body = conv.querySelector('.conv-body');
  const list = conv.querySelector('.messages');
  const img = conv.querySelector('app-backdrop img');
  const rows = [...list.querySelectorAll('.bubble-row')];
  const eventRow = list.querySelector('.bubble-row.event[data-id="fixture-bg"]');
  const line = eventRow ? eventRow.textContent.trim() : null;
  const problems = [];
  if (!body.hasAttribute('data-backdrop')) problems.push('the conversation is not marked as having a backdrop');
  if (list.contains(img)) problems.push('the backdrop is in the timeline');
  if ([...list.querySelectorAll('img')].some((i) => i.src === img.src)) problems.push('the backdrop is drawn as a picture in the timeline');
  if (line !== LINE) problems.push('the line reads ' + JSON.stringify(line));
  if (rows.length !== 3) problems.push(rows.length + ' rows drawn, not 3');
  if (rows.some((r) => !r.classList.contains('event') && !r.textContent.trim())) problems.push('an empty notice is drawn');
  const words = eventRow && eventRow.querySelector('.conv-event > span');
  const behind = words ? getComputedStyle(words).backgroundColor : '';
  if (!behind || behind === 'transparent' || /rgba\(0, 0, 0, 0\)/.test(behind)) problems.push('the line has nothing behind its words over the backdrop');
  const b = body.getBoundingClientRect();
  const p = img.getBoundingClientRect();
  if (p.width < b.width - 1 || p.height < b.height - 1) problems.push('the backdrop does not fill the conversation');
  // A point of bare backdrop: in the larger gap the messages leave, above the first or below the last, where only the
  // list itself is.
  const first = rows[0].getBoundingClientRect();
  const last = rows[rows.length - 1].getBoundingClientRect();
  const above = first.top - b.top;
  const below = b.bottom - last.bottom;
  const x = Math.round(b.left + b.width / 2);
  const y = Math.round(above >= below ? b.top + above / 2 : last.bottom + below / 2);
  const there = document.elementFromPoint(x, y);
  if (!(there === list || (there && there.classList.contains('history-space')))) problems.push('the point chosen is covered by ' + (there ? there.className || there.tagName : 'nothing'));
  if (Math.max(above, below) < 24) problems.push('no bare backdrop beside the messages');
  say('where', 'where:backdrop ' + x + ' ' + y + ' ' + window.innerWidth + ' ' + window.innerHeight);
  const detail = 'line="' + line + '" rows=' + rows.length + ' fetched=' + fetched + ' picture=' + img.naturalWidth + 'x' + img.naturalHeight + ' colour=' + COLOUR.join(',') + ' behind-line=' + behind;
  say('verdict', problems.length ? 'background:fail ' + problems.join('; ') : 'background:pass ' + detail);
  window.backgroundProof = { ok: !problems.length, problems, line, rows: rows.length };
})().catch((error) => {
  const mark = document.createElement('output');
  mark.setAttribute('aria-label', 'background:fail ' + error.message);
  mark.textContent = mark.getAttribute('aria-label');
  document.body.append(mark);
  window.backgroundProof = { ok: false, error: error.message };
});
