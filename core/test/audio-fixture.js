// Injected only by native test builds (issue 432). Two recordings in a conversation, drawn as the conversation
// draws them, in the shell's own web view: one someone else sent, not played yet, and one we sent. Real components in
// the real shell, synthetic audio only: a four second tone (core/test/audio-fixture.m4a) the shell serves from its test
// build, or, where the shell cannot serve a test file (Android keeps fixtures in the test package), as base64 the test
// hands over first in window.fixtureAudioBase64. No server, token or account.
//
// The verdict is the native test's: it presses play through the accessibility tree, as a person would, and reads what
// the page reports on one marker, kept current:
//   au:boot              the script is running
//   au:ready <json>      every player is drawn and shows how long it runs
//   au:playing <json>    the first is playing, and its time and its elapsed clock have moved
//   au:paused <json>     the first was played and is paused part way in
//   au:fail <why>        the scene could not be set
(async () => {
  const marker = document.createElement('output');
  marker.dataset.audioFixture = 'true';
  Object.assign(marker.style, { position: 'fixed', top: '0', left: '0', zIndex: '9999', fontSize: '1px', pointerEvents: 'none' });
  const say = (text) => { marker.setAttribute('aria-label', text); marker.textContent = text; window.audioFixtureState = text; };
  say('au:boot');
  document.body.append(marker);
  await customElements.whenDefined('app-root');
  const root = document.querySelector('app-root');
  const until = async (test, what, ms = 20000) => {
    const deadline = performance.now() + ms;
    while (!test()) {
      if (performance.now() > deadline) throw new Error('timed out waiting for ' + what);
      await new Promise(requestAnimationFrame);
    }
  };
  await until(() => root.phase !== 'boot', 'the app to boot');
  if (root.phase !== 'onboarding') throw new Error('the audio fixture requires empty test storage');
  const scheme = window.fixtureScheme === 'dark' ? 'dark' : 'light';
  root.settings = { ...root.settings, 'appearance.skin': scheme };
  root.info = { product: (root.host && root.host.product) || 'App', serverVersion: '1.0.0', serverChannel: 'dev', apiVersion: 1, engine: { kind: 'fake', version: '1.0.0' } };
  root.chats = [];
  root.phase = 'ready';
  root.conn = 'open';
  await root.updateComplete;
  root.applyTheme();

  let bytes;
  if (typeof window.fixtureAudioBase64 === 'string' && window.fixtureAudioBase64) {
    bytes = Uint8Array.from(atob(window.fixtureAudioBase64), (c) => c.charCodeAt(0));
  } else {
    const r = await fetch(new URL('/audio-fixture.m4a', document.baseURI));
    if (!r.ok) throw new Error('the recording answered ' + r.status);
    bytes = new Uint8Array(await r.arrayBuffer());
  }
  // Typed as the server types an MPEG-4 recording.
  const clip = new Blob([bytes], { type: 'audio/mp4' });
  const client = { attachment: async () => clip };

  await customElements.whenDefined('app-attachment');
  const stage = document.createElement('div');
  stage.className = 'messages';
  Object.assign(stage.style, { position: 'fixed', top: '20%', left: '0', right: '0', zIndex: '9998', display: 'flex', flexDirection: 'column', gap: '24px', padding: '16px', background: 'var(--color-bg)' });
  const players = [
    { id: 'audtheirs0001', name: 'memo.m4a', mine: false },
    { id: 'audmine000001', name: 'reply.m4a', mine: true },
  ].map((p) => {
    const row = document.createElement('div');
    row.className = 'bubble-row ' + (p.mine ? 'mine' : 'theirs');
    const body = document.createElement('div');
    body.className = 'bubble-body';
    const el = document.createElement('app-attachment');
    el.client = client;
    el.mine = p.mine;
    el.attachment = { id: p.id, name: p.name, mime: 'audio/x-m4a', bytes: bytes.length, sticker: false, missing: false };
    body.append(el);
    row.append(body);
    stage.append(row);
    return el;
  });
  document.body.append(stage);
  const audio = (el) => el.querySelector('audio');
  // Ready once every player SHOWS how long it runs, not only once its audio element knows: the element learns its
  // duration a task before the player hears of it, and a report read in between showed 0:00 on a slower runner.
  const drawnLength = (el) => el.querySelector('.voice-length')?.textContent || '0:00';
  await until(() => players.every((el) => audio(el) && Number.isFinite(audio(el).duration) && audio(el).duration > 0 && drawnLength(el) !== '0:00'), 'every recording to show how long it runs', 30000);

  const report = () => players.map((el) => {
    const a = audio(el);
    const note = el.querySelector('.voice-note');
    const b = note.getBoundingClientRect();
    const levels = new Set([...el.querySelectorAll('.voice-bar')].map((bar) => bar.dataset.level));
    // Whether the waveform keeps to its own room: its last bar inside it, and it clear of the time beside it.
    const wave = el.querySelector('.voice-wave').getBoundingClientRect();
    const time = el.querySelector('.voice-time').getBoundingClientRect();
    const bars = [...el.querySelectorAll('.voice-bar')].map((bar) => bar.getBoundingClientRect());
    const clear = bars.every((r) => r.right <= wave.right + 0.5) && wave.right <= time.left + 0.5;
    return {
      label: el.querySelector('.voice-play').getAttribute('aria-label'),
      playing: note.dataset.playing === 'true',
      unplayed: note.dataset.unplayed === 'true',
      elapsed: el.querySelector('.voice-elapsed').textContent,
      length: el.querySelector('.voice-length').textContent,
      filled: el.querySelectorAll('.voice-bar[data-done="true"]').length,
      levels: levels.size,
      clear,
      currentTime: Math.round(a.currentTime * 100) / 100,
      duration: Math.round(a.duration * 100) / 100,
      paused: a.paused,
      box: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)],
    };
  });
  let played = false;
  const publish = () => {
    const now = report();
    const first = now[0];
    if (first.playing && first.currentTime >= 1 && first.elapsed !== '0:00') played = true;
    const state = first.playing && played ? 'playing' : played && first.paused && first.currentTime > 0 ? 'paused' : 'ready';
    say('au:' + state + ' ' + JSON.stringify({ viewport: [innerWidth, innerHeight], players: now }));
  };
  publish();
  setInterval(publish, 200);
})().catch((error) => {
  const text = 'au:fail fixture ' + error.message;
  const marker = document.querySelector('[data-audio-fixture]') || document.createElement('output');
  marker.setAttribute('aria-label', text);
  marker.textContent = text;
  window.audioFixtureState = text;
  document.body.append(marker);
});
