// Issue 432: a recording in a conversation (a voice message, a memo, a song) was drawn as a file card, and a press
// took it out of the conversation into the media viewer's bare player, or into another app. Every recording a web view
// plays is now drawn in its own message as a player: play and pause, a waveform that fills as it plays and moves where
// it is pressed, how far in it is and how long it runs, and a mark on one someone else sent until it is played. A file
// the app cannot play is still a file card. Held here against the real components without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const defined = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { defined[name] = cls; }, get() { return undefined; } };
globalThis.document = { createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
let urls = 0;
URL.createObjectURL = () => 'blob:audio-' + ++urls;
URL.revokeObjectURL = () => {};
const stored = new Map();
const storage = [];
globalThis.window = { bridge: { call: async (command, args) => {
  storage.push([command, args]);
  if (command === 'storage.get') return stored.get(args.key) ?? null;
  if (command === 'storage.set') { stored.set(args.key, args.value); return true; }
  return null;
} } };
await import('../app/components/app-attachment.js');
const AppAttachment = defined['app-attachment'];

// The Lit template as the text it would draw, nested templates included, without a browser.
function words(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(words).join('');
  if (value?.strings) return value.strings.map((s, i) => s + words(value.values[i])).join('');
  return '';
}

let ids = 0;
const recording = (o) => ({ id: 'aud' + String(++ids).padStart(11, '0'), name: 'memo.m4a', mime: 'audio/x-m4a', bytes: 25879, sticker: false, missing: false, ...o });
const attachmentEl = (a) => {
  const el = Object.create(AppAttachment.prototype);
  Object.assign(el, { attachment: a, client: { attachment: () => new Promise(() => {}) }, src: '', poster: '', failed: false, isConnected: true, linkUrl: '', mine: false });
  return el;
};

test('a recording in a conversation is drawn as a player in its message, never as a file card that leaves it (issue 432)', () => {
  for (const a of [recording(), recording({ name: 'song.mp3', mime: 'audio/mpeg' }), recording({ name: 'memo.m4a', mime: 'application/octet-stream' }), recording({ name: 'take.wav', mime: 'audio/wav' })]) {
    const drawn = words(attachmentEl(a).render());
    assert.ok(drawn.includes('<app-audio'), a.name + ' (' + a.mime + ') is a player in its message: ' + drawn.slice(0, 160));
    assert.ok(!drawn.includes('attachment-file'), a.name + ' is not a file card');
  }
  // What is not a recording, or is one the app cannot hold, keeps its file card.
  for (const a of [recording({ name: 'booking.pdf', mime: 'application/pdf' }), recording({ name: 'huge.m4a', bytes: 200 * 1024 * 1024 })]) {
    const drawn = words(attachmentEl(a).render());
    assert.ok(drawn.includes('attachment-file') && !drawn.includes('<app-audio'), a.name + ' is a file card');
  }
});

test('a recording the web view cannot fetch or play falls back to a file card that opens it elsewhere (issue 432)', async () => {
  await import('../app/components/app-audio.js');
  const el = attachmentEl(recording());
  el.failed = true;
  const drawn = words(el.render());
  assert.ok(drawn.includes('class="attachment-file"') && drawn.includes('data-opens=app') && !drawn.includes('<app-audio'), 'a failed recording is a file card for another app: ' + drawn.slice(0, 200));
  const { el: player, events, pending } = audioEl();
  player.attachment = recording();
  player.load();
  pending[0].reject(Object.assign(new Error('HTTP 404'), { status: 404 }));
  await settle();
  assert.deepEqual(events.map((e) => e.type), ['audio-failed'], 'the player says it failed, and the attachment draws the card');
  assert.match(readFileSync(new URL('../app/components/app-attachment.js', import.meta.url), 'utf8'), /@audio-failed=\$\{\(\) => \{ this\.failed = true; \}\}/, 'the attachment answers a failure with its file card');
});

const settle = () => new Promise((r) => setTimeout(r, 0));
const audioEl = () => {
  const AppAudio = defined['app-audio'];
  const el = Object.create(AppAudio.prototype);
  Object.assign(el, { mine: false, src: '', playing: false, position: 0, length: 0, heard: null, isConnected: true });
  el.wave = Array.from({ length: 28 }, () => 2);
  const events = [];
  el.dispatchEvent = (e) => { events.push(e); return true; };
  const pending = [];
  el.client = { attachment: (id, options = {}) => new Promise((resolve, reject) => { pending.push({ id, options, resolve, reject }); }) };
  const player = { plays: 0, pauses: 0, currentTime: 0, duration: 7.4, play() { this.plays += 1; el.onPlay(); return Promise.resolve(); }, pause() { this.pauses += 1; el.onPause(); } };
  el.player = () => (el.src ? player : null);
  return { el, events, pending, player };
};

test('the player draws play, the waveform, how far in it is and how long it runs, and a mark until it is played (issue 432)', async () => {
  const { forgetPlayed } = await import('../app/components/app-audio.js');
  forgetPlayed();
  const { el } = audioEl();
  el.attachment = recording({ name: 'Audio Message.m4a' });
  el.length = 7.4;
  el.position = 3.2;
  el.heard = new Set();
  const drawn = words(el.render());
  assert.ok(drawn.includes('class="voice-play" aria-label=Play Audio Message.m4a') && drawn.includes('data-icon=play'), 'a play control named for the recording: ' + drawn.slice(0, 300));
  assert.equal((drawn.match(/class="voice-bar"/g) || []).length, 28, 'a waveform of bars');
  assert.ok(drawn.includes('role="slider"') && drawn.includes('aria-valuetext=0:03 of 0:07'), 'the waveform is a slider that says where it is');
  assert.ok(drawn.includes('<span class="voice-elapsed">0:03</span>') && drawn.includes('<span class="voice-length">0:07</span>'), 'how far in it is, and how long it runs');
  assert.equal((drawn.match(/data-done=true/g) || []).length, 12, 'the bars up to where it is are filled');
  assert.ok(drawn.includes('class="voice-unplayed"') && drawn.includes('data-unplayed=true'), 'one someone else sent is marked until it is played');
  el.mine = true;
  assert.ok(!words(el.render()).includes('voice-unplayed'), 'one we sent is never marked');
  el.mine = false;
  el.attachment = { ...el.attachment, played: true };
  assert.ok(!words(el.render()).includes('voice-unplayed'), 'one the Mac records as played is not marked');
});

test('pressing play plays it, pauses the one that was playing, and remembers on this device that it was played (issue 432)', async () => {
  const { forgetPlayed } = await import('../app/components/app-audio.js');
  const { PLAYED_KEY } = await import('../app/rules/audio.js');
  forgetPlayed();
  stored.clear();
  const first = audioEl();
  const second = audioEl();
  first.el.attachment = recording();
  second.el.attachment = recording();
  const playing = first.el.toggle();
  assert.equal(first.pending.length, 1, 'the file is fetched for the press');
  first.pending[0].resolve(new Blob(['m4a'], { type: 'audio/mp4' }));
  await playing;
  await settle();
  assert.equal(first.player.plays, 1, 'it plays');
  assert.equal(first.el.playing, true);
  assert.ok(words(first.el.render()).includes('data-icon=pause'), 'the control turns to pause');
  assert.deepEqual(JSON.parse(stored.get(PLAYED_KEY)), [first.el.attachment.id], 'it is remembered as played, in the shell storage');
  assert.ok(!words(first.el.render()).includes('voice-unplayed'), 'and is no longer marked');
  const next = second.el.toggle();
  second.pending[0].resolve(new Blob(['m4a'], { type: 'audio/mp4' }));
  await next;
  await settle();
  assert.equal(first.player.pauses, 1, 'starting another pauses the first');
  assert.equal(first.el.playing, false);
  assert.equal(second.el.playing, true);
  await second.el.toggle();
  assert.equal(second.player.pauses, 1, 'pressing it again pauses it');
  forgetPlayed();
  const { playedOnDevice } = await import('../app/components/app-audio.js');
  assert.ok((await playedOnDevice()).has(first.el.attachment.id), 'a new page reads what was played back from storage');
});

test('the waveform fills as it plays, moves to where it is pressed or keyed, and starts over at the end (issue 432)', async () => {
  await import('../app/components/app-audio.js');
  const { el, player, pending } = audioEl();
  el.attachment = recording();
  el.load();
  pending[0].resolve(new Blob(['m4a']));
  await settle();
  el.onLength({ target: { duration: 8 } });
  assert.equal(el.length, 8);
  el.onTime({ target: { currentTime: 2 } });
  assert.equal(el.position, 2);
  el.seekPress({ clientX: 150, currentTarget: { getBoundingClientRect: () => ({ left: 100, width: 200 }) } });
  assert.equal(player.currentTime, 2, 'a press a quarter of the way across moves a quarter of the way in');
  let prevented = false;
  el.seekKey({ key: 'ArrowRight', preventDefault: () => { prevented = true; } });
  assert.equal(player.currentTime, 7, 'an arrow steps five seconds');
  assert.ok(prevented, 'and the key is the slider\'s');
  el.seekKey({ key: 'End', preventDefault() {} });
  assert.equal(player.currentTime, 8);
  el.onEnded();
  assert.equal(player.currentTime, 0, 'at the end it is ready to play again from the start');
  assert.equal(el.position, 0);
});

test('the player rules: times, the waveform, seeking and what was played (issue 432)', async () => {
  const r = await import('../app/rules/audio.js');
  assert.deepEqual([r.clock(0), r.clock(7.9), r.clock(65), r.clock(3725), r.clock(NaN), r.clock(Infinity)], ['0:00', '0:07', '1:05', '1:02:05', '0:00', '0:00']);
  assert.deepEqual([r.progressOf(2, 8), r.progressOf(9, 8), r.progressOf(1, 0), r.progressOf(1, Infinity)], [0.25, 1, 0, 0]);
  const loud = new Float32Array(2800).map((_, i) => (i < 1400 ? 0.1 : 0.9) * (i % 2 ? 1 : -1));
  const wave = r.wavePeaks([loud], 28);
  assert.equal(wave.length, 28);
  assert.ok(wave.slice(0, 14).every((l) => l === 1) && wave.slice(14).every((l) => l === r.WAVE_LEVELS), 'quiet bars low, the loudest full height: ' + wave.join(','));
  assert.deepEqual(r.wavePeaks([], 4), r.flatWave(4), 'no samples draws the even waveform');
  assert.deepEqual(r.wavePeaks([new Float32Array(10)], 4), r.flatWave(4), 'silence draws the even waveform');
  assert.deepEqual([r.barsDone(0, 28), r.barsDone(0.5, 28), r.barsDone(1, 28)], [0, 14, 28]);
  assert.equal(r.seekAt(50, 0, 100, 10), 5);
  assert.equal(r.seekAt(500, 0, 100, 10), 10, 'past the end is the end');
  assert.equal(r.seekAt(50, 0, 100, 0), null, 'a length not known yet moves nowhere');
  assert.deepEqual([r.seekByKey('ArrowLeft', 3, 10), r.seekByKey('Home', 3, 10), r.seekByKey('a', 3, 10)], [0, 0, null]);
  const many = Array.from({ length: r.PLAYED_MAX + 5 }, (_, i) => 'a' + i);
  assert.equal(JSON.parse(r.encodePlayed(many)).length, r.PLAYED_MAX, 'what was played is bounded');
  assert.deepEqual(r.decodePlayed('not json'), []);
  assert.deepEqual(r.decodePlayed('[1, "x", ""]'), ['x']);
  assert.equal(r.isUnplayed({ id: 'x' }, { played: new Set(['x']) }), false);
  assert.equal(r.isUnplayed({ id: 'x' }, { played: new Set() }), true);
  assert.equal(r.isUnplayed({ id: 'x' }, { mine: true }), false);
});

test('the media viewer no longer plays audio: a recording plays in its message (issue 432)', () => {
  const viewer = readFileSync(new URL('../app/components/app-image-viewer.js', import.meta.url), 'utf8');
  assert.doesNotMatch(viewer, /viewer-audio|'audio'/, 'the viewer keeps no player of its own');
});

// The proof in each phone shell's own web view: a Debug-only fixture draws a synthetic recording in a conversation, and
// the native test presses play and reads that it plays, that its time moves and that it is marked played.
test('the audio fixture is a Debug seam the iOS and Android tests play (issue 432)', () => {
  const read = (f) => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
  const naming = JSON.parse(read('core/spec/naming.json'));
  assert.match(read('ios/' + naming.product + '/ShellView.swift'), /#if DEBUG[\s\S]*--audio-fixture[\s\S]*#endif/, 'the fixture is a Debug seam');
  assert.match(read('ios/project.yml'), /CONFIGURATION.*Debug[\s\S]*core\/test\/audio-fixture\.js[\s\S]*core\/test\/audio-fixture\.m4a/, 'copied into test builds only');
  const ui = read('ios/' + naming.product + 'UITests/AudioPlaybackTests.swift');
  for (const part of ['--audio-fixture', 'Play memo.m4a', 'au:playing']) assert.ok(ui.includes(part), 'the iOS test plays the recording: ' + part);
  const android = read('android/app/src/androidTest/kotlin/' + naming.ids.android.replace(/\./g, '/') + '/AudioPlaybackTest.kt');
  for (const part of ['audio-fixture.js', 'audio-fixture.m4a', 'au:playing']) assert.ok(android.includes(part), 'the Android test plays the recording: ' + part);
  assert.doesNotMatch(read('core/app/main.js'), /audio-fixture/);
  // Ready is what the player shows, not what its audio element knows: the element learns its duration a task before the
  // player draws it, and a report read between the two said 0:00 on the slower packaged desktop legs.
  assert.match(read('core/test/audio-fixture.js'), /drawnLength\(el\) !== '0:00'/, 'the fixture is ready only once every player shows its length');
});

// The desktop shells play it too: the smoke runs a proof in the shell's own Chromium on every desktop leg, pressing play
// with real mouse input and reading the same fixture's report.
test('the desktop smoke plays a recording in its message with real input (issue 432)', () => {
  const read = (f) => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
  assert.match(read('desktop/scripts/smoke.mjs'), /execFileSync\(proofElectron, \[path\.join\(root, 'desktop\/scripts\/prove-audio\.mjs'\)\]/, 'the smoke runs the audio proof');
  const proof = read('desktop/scripts/prove-audio.mjs');
  for (const part of ['core/test/audio-fixture.js', "sendInputEvent({ type: 'mouseDown'", "until('au:playing'", "until('au:paused'", 'requires the Chromium sandbox']) assert.ok(proof.includes(part), 'the proof presses play and reads it play: ' + part);
});
