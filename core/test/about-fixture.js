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
  // The chosen icon (issue 246): About draws the choice in force, not one fixed drawing, so the fixture picks one
  // and the native legs hold the page to its picture.
  root.settings = { ...root.settings, 'appearance.skin': scheme, 'appearance.appIcon': 'rosa_dark' };
  root.info = { product: (root.host && root.host.product) || 'App', serverVersion: '1.0.0', serverChannel: 'dev', apiVersion: 1, engine: { kind: 'fake', version: '1.0.0' }, repository: 'https://example.invalid/owner/app' };
  root.chats = [];
  root.phase = 'ready';
  root.conn = 'open';
  await root.updateComplete;
  root.applyTheme();
  root.openSettings();
  await until(() => document.querySelector('app-settings [data-action=about]'), 'the About row in Settings');
  await until(() => !document.querySelector('.sheet').getAnimations().some((a) => a.playState === 'running'), 'the sheet to arrive');
  // The same slide as the desktop (Abi, 2026-10-13), in this platform's own web view: About rises from below while
  // Settings slides down out of the way, and the back press slides Settings straight back up as About goes down, never
  // changing width. A phone emulator draws a frame a second at times, so the motion is read off its own timeline
  // rather than sampled by frame: each running animation is held at its start and its middle, then let finish. Where
  // the system asks for reduced motion each is a straight cut by design, so only where each ends up is held.
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sheet = (view) => document.querySelector('.sheet[data-view=' + view + ']');
  const topOf = (view) => (sheet(view) ? Math.round(sheet(view).getBoundingClientRect().top) : null);
  const width = (view) => (sheet(view) ? Math.round(sheet(view).getBoundingClientRect().width) : null);
  const moving = () => document.getAnimations().filter((x) => x.playState === 'running' && x.effect && x.effect.target && x.effect.target.closest && x.effect.target.closest('.sheet-scrim'));
  const hold = (all, fraction) => { for (const x of all) { x.pause(); x.currentTime = Number(x.effect.getComputedTiming().duration) * fraction; } };
  const frame = () => new Promise(requestAnimationFrame);
  const settingsRest = topOf('settings');
  const settingsWidth = width('settings');
  const vh = window.innerHeight;
  document.querySelector('app-settings [data-action=about]').click();
  await root.updateComplete;
  await frame();
  let rising = moving();
  let aboutStart = null;
  let settingsMid = null;
  if (!reduced) {
    if (rising.length < 2) throw new Error('motion: opening About runs ' + rising.length + ' animations, not About rising and Settings going down');
    hold(rising, 0);
    aboutStart = topOf('about');
    hold(rising, 0.5);
    settingsMid = topOf('settings');
    for (const x of rising) x.finish();
  }
  await until(() => !moving().length, 'About to arrive');
  const aboutRest = topOf('about');
  const settingsDown = topOf('settings');
  if (!(settingsDown >= vh - 2)) throw new Error('motion: Settings waits at ' + settingsDown + ', not below the screen (' + vh + ')');
  if (width('settings') !== settingsWidth) throw new Error('motion: Settings changed width going down');
  if (!reduced) {
    if (!(aboutStart - aboutRest >= sheet('about').getBoundingClientRect().height / 2)) throw new Error('motion: About started at ' + aboutStart + ', not below its rest at ' + aboutRest);
    if (!(settingsMid > settingsRest + 20 && settingsMid < settingsDown - 20)) throw new Error('motion: Settings was at ' + settingsMid + ' halfway, not between ' + settingsRest + ' and ' + settingsDown);
  }
  document.querySelector('app-about .sheet-back').click();
  await root.updateComplete;
  await frame();
  const leaving = moving();
  if (!reduced) {
    if (leaving.length < 2) throw new Error('motion: back runs ' + leaving.length + ' animations, not About going down and Settings rising together');
    hold(leaving, 0.5);
    const halfway = topOf('settings');
    if (!(halfway < settingsDown - 20 && halfway > settingsRest + 20)) throw new Error('motion: Settings was at ' + halfway + ' halfway back, so it waited for About to leave');
    if (width('settings') !== settingsWidth) throw new Error('motion: Settings changed width coming back');
    for (const x of leaving) x.finish();
  }
  await until(() => !document.querySelector('app-about') && !moving().length, 'About to close');
  if (Math.abs(topOf('settings') - settingsRest) > 1 || width('settings') !== settingsWidth) throw new Error('motion: Settings came back to ' + topOf('settings') + ' at ' + width('settings') + ' wide, not ' + settingsRest + ' at ' + settingsWidth);
  const motionReport = (reduced ? 'cut' : 'slide') + ' settingsRest=' + settingsRest + ' settingsDown=' + settingsDown + ' aboutStart=' + aboutStart;
  // The About row is on every Settings page (issue 244), so no tab has to be picked first.
  document.querySelector('app-settings [data-action=about]').click();
  const about = () => document.querySelector('app-about');
  await until(() => about() && about().querySelector('.about-row'), 'the About sheet');
  // Issue 253: About is its OWN sheet, stacked ABOVE the Settings sheet, which steps aside underneath it: two cards
  // and two backdrops, the About one on top.
  const aboutSheet = document.querySelector('.sheet[data-view=about]');
  const settingsSheet = document.querySelector('.sheet[data-view=settings]');
  if (!aboutSheet || !settingsSheet || document.querySelectorAll('.sheet').length !== 2 || document.querySelectorAll('.sheet-scrim').length !== 2) throw new Error('About is not stacked as its own sheet above Settings');
  await until(() => !aboutSheet.getAnimations().some((a) => a.playState === 'running'), 'the About sheet to arrive');
  const icon = about().querySelector('.about-icon');
  await until(() => icon.complete && icon.naturalWidth > 0, 'the app icon to load');
  if (!(icon.getAttribute('src') || '').endsWith('assets/app-icons/rosa_dark.png')) throw new Error('About draws ' + icon.getAttribute('src') + ' rather than the chosen icon');
  const parts = [...about().querySelectorAll('.sheet-body > [data-section]')].map((s) => s.dataset.section).join('|');
  if (parts !== 'identity|updates|build') throw new Error('About draws ' + parts);
  const sheetTop = document.querySelector('.sheet[data-view=about]').getBoundingClientRect().top;
  about().querySelector('[data-action=check-updates]').click();
  const notice = () => (document.querySelector('.app-notice') || {}).textContent || '';
  await until(() => notice().includes('is available'), 'the update-available notice');
  await until(() => !document.querySelector('.app-notice').getAnimations().some((a) => a.playState === 'running'), 'the notice to arrive');
  // The notice floats above the sheet (issue 253): its dismiss control is the topmost thing at its own centre, so the
  // notice takes its own press first, and the sheet under it did not move when the notice appeared, so a floating notice
  // never pushes the page down. The card may overlap the sheet: it is above every surface.
  const dismiss = document.querySelector('.app-notice .close-button').getBoundingClientRect();
  const top = document.elementFromPoint(dismiss.left + dismiss.width / 2, dismiss.top + dismiss.height / 2);
  if (!top || !top.closest('.close-button')) throw new Error('the notice is covered by ' + (top ? top.className || top.tagName : 'nothing'));
  const moved = document.querySelector('.sheet[data-view=about]').getBoundingClientRect().top - sheetTop;
  if (Math.abs(moved) > 1) throw new Error('the notice pushed the sheet down by ' + moved);
  // The button has shown its answer and is idle again, so the capture shows its label.
  await until(() => !about().querySelector('[data-action=check-updates]').dataset.press, 'the button to settle', 5000);
  // About's button follows the notice (issue 192): it is now the step the notice offers, labelled as the notice's action.
  const button = about().querySelector('[data-action=check-updates]');
  const action = document.querySelector('.app-notice .app-notice-action');
  await until(() => button.dataset.command !== 'check', 'About\'s button to offer the update', 5000);
  // A shared action button draws every state's words up front in ONE box (issue 190), so its textContent holds them
  // all; the label it shows at rest is the idle one, and that is the step it offers.
  const shownLabel = (el) => { if (!el) return ''; const idle = el.querySelector('.action-label[data-when=idle]'); return ((idle ? idle.textContent : el.textContent) || '').trim(); };
  if (!action || shownLabel(action) !== shownLabel(button)) throw new Error('About offers ' + shownLabel(button) + ' but the notice offers ' + (action ? shownLabel(action) : 'nothing'));
  // The notice floats over the top of the card (issue 253), where the icon sits, so it is dismissed once its words are
  // read: the native legs capture the page with its icon, and the notice over the sheet is still driven and held by the
  // desktop smoke (06g/06h) and the app-notice tests.
  const noticeText = notice().trim();
  document.querySelector('.app-notice .close-button').click();
  await until(() => !document.querySelector('.app-notice'), 'the notice to close');
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  const marker = document.createElement('output');
  marker.setAttribute('aria-label', 'about:pass');
  marker.textContent = 'about:pass';
  Object.assign(marker.style, { position: 'fixed', bottom: '0', left: '0', zIndex: '9999', fontSize: '1px' });
  document.body.append(marker);
  // The build the shell reported (issue 192): the channel and the build number About draws, which a phone's test holds
  // to a value rather than Unknown.
  const value = (key) => ((about().querySelector('.about-row[data-key=' + key + '] .about-value-text') || {}).textContent || '').trim();
  const channel = value('channel');
  const build = value('build');
  const reported = document.createElement('output');
  reported.setAttribute('aria-label', 'about:build channel=' + channel + ' build=' + build);
  reported.textContent = reported.getAttribute('aria-label');
  Object.assign(reported.style, { position: 'fixed', bottom: '0', right: '0', zIndex: '9999', fontSize: '1px' });
  document.body.append(reported);
  const motionMark = document.createElement('output');
  motionMark.setAttribute('aria-label', 'about:motion ' + motionReport);
  motionMark.textContent = motionMark.getAttribute('aria-label');
  Object.assign(motionMark.style, { position: 'fixed', top: '0', left: '0', zIndex: '9999', fontSize: '1px' });
  document.body.append(motionMark);
  window.aboutProof = { motion: motionReport, ok: document.documentElement.dataset.scheme === scheme, scheme, parts, notice: noticeText, button: shownLabel(button), command: button.dataset.command, channel, build };
})().catch((error) => {
  window.aboutProof = { ok: false, error: error.message };
  document.body.textContent = 'about fixture failed: ' + error.message;
});
