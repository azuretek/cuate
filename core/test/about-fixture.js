// Injected only by native test builds (issue 171). The About page on a phone: Settings opens, its last row opens the
// About page, Check for updates reads the release feed through the real shell's bridge (updates.releases, issue 192),
// and its answer arrives as the app notice. The test build's shell serves a synthetic feed naming a newer build, so the
// page shows the update-available state: the notice and About's button both offer the step this platform installs by.
// Real components and the real bridge, synthetic records only: no server, token or account.
(async () => {
  await customElements.whenDefined('app-root');
  const root = document.querySelector('app-root');
  const until = async (test, what, ms = 10000) => {
    const deadline = performance.now() + ms;
    while (!test()) {
      if (performance.now() > deadline) throw new Error('timed out waiting for ' + what);
      await new Promise(requestAnimationFrame);
    }
  };
  await until(() => root.phase !== 'boot', 'the app to boot');
  if (root.phase !== 'onboarding') throw new Error('about fixture requires empty test storage');
  const scheme = window.fixtureScheme === 'dark' ? 'dark' : 'light';
  root.settings = { ...root.settings, 'appearance.skin': scheme };
  root.info = { product: (root.host && root.host.product) || 'App', serverVersion: '1.0.0', serverChannel: 'dev', apiVersion: 1, engine: { kind: 'fake', version: '1.0.0' }, repository: 'https://example.invalid/owner/app' };
  root.chats = [];
  root.phase = 'ready';
  root.conn = 'open';
  await root.updateComplete;
  root.applyTheme();
  root.openSettings();
  await until(() => document.querySelector('app-settings [data-action=about]'), 'the About row in Settings');
  await until(() => !document.querySelector('.sheet').getAnimations().some((a) => a.playState === 'running'), 'the sheet to arrive');
  document.querySelector('app-settings [data-action=about]').click();
  const about = () => document.querySelector('app-about');
  await until(() => about() && about().querySelector('.about-row') && !document.querySelector('app-settings'), 'the About page');
  await until(() => !about().getAnimations().some((a) => a.playState === 'running'), 'the page push to finish');
  const icon = about().querySelector('.about-icon');
  await until(() => icon.complete && icon.naturalWidth > 0, 'the app icon to load');
  const parts = [...about().querySelectorAll('.sheet-body > [data-section]')].map((s) => s.dataset.section).join('|');
  if (parts !== 'identity|updates|build') throw new Error('About draws ' + parts);
  about().querySelector('[data-action=check-updates]').click();
  const notice = () => (document.querySelector('.app-notice') || {}).textContent || '';
  await until(() => notice().includes('is available'), 'the update-available notice');
  await until(() => !document.querySelector('.app-notice').getAnimations().some((a) => a.playState === 'running'), 'the notice to arrive');
  // The notice is seen: its dismiss control (the one part of the stack that takes a press) is the topmost thing at its
  // own centre, so no sheet covers it; and the sheet starts below the notice's band, so the card covers no sheet.
  const card = document.querySelector('.app-notice').getBoundingClientRect();
  const dismiss = document.querySelector('.app-notice .app-notice-dismiss').getBoundingClientRect();
  const top = document.elementFromPoint(dismiss.left + dismiss.width / 2, dismiss.top + dismiss.height / 2);
  if (!top || !top.closest('.app-notice-dismiss')) throw new Error('the notice is covered by ' + (top ? top.className || top.tagName : 'nothing'));
  if (document.querySelector('.sheet').getBoundingClientRect().top < card.bottom) throw new Error('the notice covers the sheet');
  // The button has shown its answer and is idle again, so the capture shows its label.
  await until(() => !about().querySelector('[data-action=check-updates]').dataset.press, 'the button to settle', 5000);
  // About's button follows the notice (issue 192): it is now the step the notice offers, labelled as the notice's action.
  const button = about().querySelector('[data-action=check-updates]');
  const action = document.querySelector('.app-notice .app-notice-action');
  await until(() => button.dataset.command !== 'check', 'About\'s button to offer the update', 5000);
  if (!action || action.textContent.trim() !== button.textContent.trim()) throw new Error('About offers ' + button.textContent.trim() + ' but the notice offers ' + (action ? action.textContent.trim() : 'nothing'));
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  const marker = document.createElement('output');
  marker.setAttribute('aria-label', 'about:pass');
  marker.textContent = 'about:pass';
  Object.assign(marker.style, { position: 'fixed', bottom: '0', left: '0', zIndex: '9999', fontSize: '1px' });
  document.body.append(marker);
  window.aboutProof = { ok: document.documentElement.dataset.scheme === scheme, scheme, parts, notice: notice().trim(), button: button.textContent.trim(), command: button.dataset.command };
})().catch((error) => {
  window.aboutProof = { ok: false, error: error.message };
  document.body.textContent = 'about fixture failed: ' + error.message;
});
