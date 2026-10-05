// Injected only by native test builds (issue 167). Settings on a phone: a page that fills the screen, with one tab per
// section and every setting the desktop offers reached from one, each drawn inside the screen's width, and the way back
// to the chats list drawn as the chats icon with its label (issue 168). Real components and the real shell, synthetic
// records only: no server, token or account.
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
  if (root.phase !== 'onboarding') throw new Error('settings fixture requires empty test storage');
  const { settingsTabs } = await import(new URL('rules/settings.js', document.baseURI).href);
  const scheme = window.fixtureScheme === 'dark' ? 'dark' : 'light';
  root.settings = { ...root.settings, 'appearance.skin': scheme };
  root.info = { product: (root.host && root.host.product) || 'App', serverVersion: '1.0.0', serverChannel: 'dev', apiVersion: 1, engine: { kind: 'fake', version: '1.0.0' } };
  root.chats = [];
  root.phase = 'ready';
  root.conn = 'open';
  await root.updateComplete;
  root.applyTheme();
  root.openSettings();
  const page = () => document.querySelector('app-settings');
  await until(() => page() && page().querySelector('.settings-tab'), 'the Settings page');
  await until(() => !document.querySelector('.sheet').getAnimations().some((a) => a.playState === 'running'), 'the page to arrive');
  // The sheet is a floating card over the conversation (issue 253), not a page that replaces the view: it spans the
  // phone's width, is anchored to the bottom edge, keeps its rounded top corners and its shadow, and its backdrop blurs
  // what is behind it. Its way back is the chats control.
  const sheetEl = document.querySelector('.sheet');
  const sheet = sheetEl.getBoundingClientRect();
  const scrim = getComputedStyle(document.querySelector('.sheet-scrim'));
  const width = innerWidth - parseFloat(scrim.paddingLeft) - parseFloat(scrim.paddingRight);
  if (Math.abs(sheet.width - width) > 1) throw new Error('Settings does not span the phone: ' + sheet.width + ' of ' + width);
  if (Math.abs(sheet.bottom - (innerHeight - parseFloat(scrim.paddingBottom))) > 1) throw new Error('Settings is not anchored to the bottom edge');
  if (!parseFloat(getComputedStyle(sheetEl).borderTopLeftRadius)) throw new Error('Settings keeps no rounded top corners, so it reads as a page rather than a card');
  if (!/blur/.test(scrim.backdropFilter || scrim.webkitBackdropFilter || '')) throw new Error('the backdrop does not blur the conversation behind the card');
  const narrow = page().querySelector('.sheet-back-narrow');
  const shown = (el) => Boolean(el) && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
  if (!shown(narrow) || shown(page().querySelector('.sheet-back-wide'))) throw new Error('the way back is not the chats control');
  const back = narrow.querySelector('.sheet-back-label').textContent.trim();
  const icon = narrow.querySelector('.icon').dataset.icon;
  if (back !== 'Back to chats' || icon !== 'messages-square') throw new Error('the way back reads ' + back + ' with ' + icon);
  // Every tab, and every setting it offers, inside the screen's width.
  const inside = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.left >= -0.5 && r.right <= innerWidth + 0.5; };
  const walked = [];
  for (const tab of settingsTabs()) {
    const button = page().querySelector('.settings-tab[data-tab="' + tab.id + '"]');
    if (!inside(button)) throw new Error('the ' + tab.id + ' tab is not on screen');
    button.click();
    await until(() => button.getAttribute('aria-selected') === 'true', 'the ' + tab.id + ' tab');
    await root.updateComplete;
    const panel = page().querySelector('.sheet-section:not([hidden])');
    if (!panel || panel.dataset.section !== tab.id) throw new Error('the ' + tab.id + ' tab shows ' + (panel && panel.dataset.section));
    const missing = tab.keys.filter((k) => !inside(panel.querySelector('[data-key="' + k + '"]')));
    if (missing.length) throw new Error('the phone cannot reach ' + missing.join(', '));
    walked.push(tab.id + ':' + tab.keys.length);
  }
  if (document.documentElement.scrollWidth > innerWidth) throw new Error('the page scrolls sideways');
  page().querySelector('.settings-tab[data-tab="appearance"]').click();
  await until(() => page().querySelector('.settings-tab[data-tab="appearance"]').getAttribute('aria-selected') === 'true', 'the Appearance tab');
  await until(() => [...page().querySelectorAll('.app-icon-choice img')].every((i) => i.complete && i.naturalWidth > 0), 'the app icon choices');
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  const marker = document.createElement('output');
  marker.setAttribute('aria-label', 'settings:pass');
  marker.textContent = 'settings:pass';
  Object.assign(marker.style, { position: 'fixed', bottom: '0', left: '0', zIndex: '9999', fontSize: '1px' });
  document.body.append(marker);
  window.settingsProof = { ok: document.documentElement.dataset.scheme === scheme, scheme, walked: walked.join('|'), back, icon };
})().catch((error) => {
  window.settingsProof = { ok: false, error: error.message };
  document.body.textContent = 'settings fixture failed: ' + error.message;
});
