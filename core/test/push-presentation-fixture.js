// Debug-only host presentation probe with synthetic content and no server or account.
(async () => {
  const mark = document.createElement('output');
  mark.textContent = 'push-presentation:starting';
  document.body.append(mark);
  await window.bridge.call('notify.permission', { request: true });
  await window.bridge.call('notify', { title: 'Synthetic sender', body: 'Synthetic foreground notice', chatId: 'synthetic-chat', messageId: 'synthetic-message' });
  mark.textContent = 'push-presentation:posted';
})();
