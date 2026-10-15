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
  // The same slide as the desktop (Abi, 2026-10-13), and what a phone can hold without depending on its frame rate.
  // This is the same page every shell draws, and the desktop smoke measures the whole slide in a real browser on all
  // three desktop platforms (settingsSlidesDown, aboutBackDesktop). Here each phone is held to: the spec's own motion
  // tokens, applied; the arrival keyframes on the incoming sheet and a transition that carries the sheet underneath;
  // About's own rise, read from its timeline (a style flush creates it, it is paused in the same task, and it is read
  // at its start and its end); Settings leaving its rest and ending below the screen at an unchanged width; and the
  // back press putting Settings back exactly where it was. A CI simulator drew one frame a second, so nothing here is
  // sampled by frame. Where the system asks for reduced motion each sheet is a straight cut by design, and only where
  // each ends up is held.
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rootStyle = getComputedStyle(document.documentElement);
  const tokenOf = (name) => rootStyle.getPropertyValue("--motion-" + name).trim();
  const sheet = (view) => document.querySelector(".sheet[data-view=" + view + "]");
  const topOf = (view) => (sheet(view) ? Math.round(sheet(view).getBoundingClientRect().top) : null);
  const width = (view) => (sheet(view) ? Math.round(sheet(view).getBoundingClientRect().width) : null);
  // Every animation moving a sheet, by the sheet it moves: the arrival keyframes, or the transition carrying the sheet
  // underneath. A scrim's own fade moves no sheet, and a briefly highlighted control is not a sheet's motion.
  // A finished animation that fills forwards stays in getAnimations(), so only one still running counts as motion.
  const movingOf = (view) => document.getAnimations().filter((x) => x.playState !== "finished" && x.effect && x.effect.target && x.effect.target.closest && x.effect.target.closest(".sheet[data-view=" + view + "]") && x.effect.getComputedTiming && Number(x.effect.getComputedTiming().duration) >= 200);
  const describe = (list) => (list || []).map((x) => (x.effect.target.className || x.effect.target.tagName) + ":" + Math.round(Number(x.effect.getComputedTiming().duration)) + "ms:" + x.playState).join(", ");
  const hold = (all, fraction) => { for (const x of all) { x.pause(); x.currentTime = Number(x.effect.getComputedTiming().duration) * fraction; } };
  const settle = (view) => { for (const x of movingOf(view)) x.finish(); };
  const motions = { about: [], settings: [] };
  const settingsRest = topOf("settings");
  const settingsWidth = width("settings");
  const vh = window.innerHeight;
  // The motion the spec names, applied on this platform: the arrival keyframes and the durations both sheets slide on.
  const arrival = document.querySelector(".sheet[data-arrive=up]");
  const wiring = {
    inToken: tokenOf("sheet-in"),
    outToken: tokenOf("sheet-out"),
    // size/motion are the spec's own, held to it by the generated tokens (core/test/tokens.test.js).
    specIn: '500ms',
    specOut: '400ms',
    arrival: arrival ? getComputedStyle(arrival).animationName : null,
  };
  if (!(wiring.inToken === wiring.specIn && wiring.outToken === wiring.specOut)) throw new Error("motion: the sheet tokens are " + wiring.inToken + " and " + wiring.outToken + ", not the spec's " + wiring.specIn + " and " + wiring.specOut);
  if (!reduced && wiring.arrival !== "sheet-up-in") throw new Error("motion: an arriving sheet runs " + wiring.arrival + ", not the arrival keyframes");
  document.querySelector("app-settings [data-action=about]").click();
  await root.updateComplete;
  let aboutStart = null;
  if (!reduced) {
    const rise = movingOf("about");
    motions.about = rise;
    if (!rise.length) throw new Error("motion: opening About moves no About sheet");
    hold(rise, 0);
    aboutStart = topOf("about");
  }
  // The sheet underneath is carried by a transition in this same web view: its computed transition names the property
  // that moves it, which is what the desktop smoke then measures frame by frame.
  const under = sheet("settings") ? getComputedStyle(sheet("settings")).transitionProperty : "";
  if (!reduced && !/translate|transform/.test(under)) throw new Error("motion: the sheet underneath is carried by " + (under || "nothing"));
  settle("about");
  settle("settings");
  await until(() => !movingOf("about").length && !movingOf("settings").length, "About to arrive");
  const aboutRest = topOf("about");
  const settingsDown = topOf("settings");
  if (!(settingsDown >= vh - 2)) throw new Error("motion: Settings waits at " + settingsDown + ", not below the screen (" + vh + ")");
  if (!(settingsDown > settingsRest)) throw new Error("motion: Settings never moved, resting at " + settingsRest + " and ending at " + settingsDown);
  if (width("settings") !== settingsWidth) throw new Error("motion: Settings changed width going down");
  if (!reduced && !(aboutStart - aboutRest >= sheet("about").getBoundingClientRect().height / 2)) throw new Error("motion: About started at " + aboutStart + ", not below its rest at " + aboutRest);
  document.querySelector("app-about .sheet-back").click();
  await root.updateComplete;
  settle("about");
  settle("settings");
  await until(() => !document.querySelector("app-about") && !movingOf("about").length && !movingOf("settings").length, "About to close");
  if (Math.abs(topOf("settings") - settingsRest) > 1 || width("settings") !== settingsWidth) throw new Error("motion: Settings came back to " + topOf("settings") + " at " + width("settings") + " wide, not " + settingsRest + " at " + settingsWidth);
  const motionReport = (reduced ? 'cut' : 'slide') + ' about=[' + describe(motions.about) + '] under=' + under + ' in=' + wiring.inToken + ' arrival=' + wiring.arrival + ' settingsRest=' + settingsRest + ' settingsDown=' + settingsDown + ' aboutStart=' + aboutStart;
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
