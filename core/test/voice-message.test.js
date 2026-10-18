// Issue 435: a voice message recorded in Messages is a Core Audio file (.caf), which no Chromium web view plays, so it
// was a file card that handed the file to another app, and on Android, Windows and Linux nothing played it at all. It is
// now a player in its message like any recording, and it asks for the server's MPEG-4 copy unless the web view says it
// plays the original for certain. Held here against the real components without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const defined = {};
// What the web view answers when asked whether it plays a type, set by each test.
let answers = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { defined[name] = cls; }, get() { return undefined; } };
globalThis.document = { createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement(tag) { return tag === 'audio' ? { canPlayType: (type) => answers[type] || '' } : { content: {} }; } };
URL.createObjectURL = () => 'blob:voice';
URL.revokeObjectURL = () => {};
globalThis.window = { bridge: { call: async () => null } };
await import('../app/components/app-attachment.js');
await import('../app/components/app-audio.js');
const AppAttachment = defined['app-attachment'];
const AppAudio = defined['app-audio'];

function words(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(words).join('');
  if (value?.strings) return value.strings.map((s, i) => s + words(value.values[i])).join('');
  return '';
}
let ids = 0;
const voice = (o) => ({ id: 'voi' + String(++ids).padStart(11, '0'), name: 'Audio Message.caf', mime: 'audio/x-caf', bytes: 20485, sticker: false, missing: false, ...o });

test('a voice message is drawn as a player in its message, never as a file card that leaves it (issue 435)', () => {
  for (const a of [voice(), voice({ mime: 'application/octet-stream' }), voice({ name: 'Audio Message.amr', mime: 'audio/amr' }), voice({ mime: 'audio/x-caf', voice: true })]) {
    const el = Object.create(AppAttachment.prototype);
    Object.assign(el, { attachment: a, client: { attachment: () => new Promise(() => {}) }, src: '', poster: '', failed: false, isConnected: true, linkUrl: '', mine: false });
    const drawn = words(el.render());
    assert.ok(drawn.includes('<app-audio') && !drawn.includes('attachment-file'), a.name + ' (' + a.mime + ') is a player in its message: ' + drawn.slice(0, 160));
  }
});

const settle = () => new Promise((r) => setTimeout(r, 0));
function player(a) {
  const el = Object.create(AppAudio.prototype);
  Object.assign(el, { mine: false, src: '', playing: false, position: 0, length: 0, heard: null, isConnected: true, attachment: a });
  el.wave = Array.from({ length: 28 }, () => 2);
  el.dispatchEvent = () => true;
  const asked = [];
  el.client = { attachment: async (id, options = {}) => { asked.push(options.format || null); return new Blob(['x'], { type: 'audio/mp4' }); } };
  return { el, asked };
}

test('the player asks for the server\'s MPEG-4 copy of a voice message unless the web view plays the original for certain (issue 435)', async () => {
  // Chromium (the desktop shells and Android) has no Core Audio demuxer and answers nothing.
  answers = {};
  let p = player(voice());
  await p.el.load();
  assert.deepEqual(p.asked, ['m4a'], 'a web view that cannot play a Core Audio file asks for the copy');
  // A web view that only might is not sure enough: a voice message that does not play is worse than a copy.
  answers = { 'audio/x-caf': 'maybe' };
  p = player(voice());
  await p.el.load();
  assert.deepEqual(p.asked, ['m4a']);
  // One that plays it for certain is handed the original.
  answers = { 'audio/x-caf': 'probably' };
  p = player(voice());
  await p.el.load();
  assert.deepEqual(p.asked, [null], 'a web view that plays it for certain gets the original');
  // An untyped one is known by its name, and an AMR recording asks the same way.
  answers = {};
  p = player(voice({ mime: 'application/octet-stream' }));
  await p.el.load();
  assert.deepEqual(p.asked, ['m4a']);
  p = player(voice({ name: 'memo.amr', mime: 'audio/amr' }));
  await p.el.load();
  assert.deepEqual(p.asked, ['m4a']);
  // Audio every web view plays is asked for as it is.
  p = player(voice({ name: 'memo.m4a', mime: 'audio/x-m4a' }));
  await p.el.load();
  assert.deepEqual(p.asked, [null], 'a recording the web view plays is never asked for as a copy');
  await settle();
});

test('the copy rule: which recordings need the server\'s copy, by type, then by name (issue 435)', async () => {
  const { copyFormat } = await import('../app/rules/audio.js');
  const none = () => '';
  assert.equal(copyFormat(voice(), none), 'm4a');
  assert.equal(copyFormat(voice({ mime: 'audio/x-caf' }), (t) => (t === 'audio/x-caf' ? 'probably' : '')), null);
  assert.equal(copyFormat(voice({ mime: 'audio/amr' }), none), 'm4a');
  assert.equal(copyFormat(voice({ mime: 'audio/3gpp', name: 'memo.3gp' }), none), 'm4a');
  assert.equal(copyFormat(voice({ mime: 'audio/mpeg', name: 'song.mp3' }), none), null);
  assert.equal(copyFormat(voice({ mime: 'application/octet-stream', name: 'Audio Message.caf' }), none), 'm4a');
  assert.equal(copyFormat(voice({ mime: 'application/octet-stream', name: 'take.wav' }), none), null);
  assert.equal(copyFormat(voice(), undefined), 'm4a', 'a page that cannot ask asks for the copy');
});

test('the client hands the format to the attachment route (issue 435)', () => {
  const api = readFileSync(new URL('../kit/api.js', import.meta.url), 'utf8');
  assert.match(api, /query\(\{ format: o\.format, part: o\.part \}\)/, 'the format reaches the route');
});

// The proof in each shell's own web view plays a voice message too: the fixture draws one beside the recordings, typed
// as Messages types it, and reports which copy it asked for and what the web view said it plays.
test('the audio fixture plays a synthetic Opus voice message in every shell (issue 435)', () => {
  const read = (f) => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
  const fixture = read('core/test/audio-fixture.js');
  for (const part of ['Audio Message.caf', 'audio/x-caf', 'voice-fixture.caf', 'voice-fixture.m4a', 'canPlayType', 'au:voice']) assert.ok(fixture.includes(part), 'the fixture draws a voice message: ' + part);
  const caf = readFileSync(new URL('./voice-fixture.caf', import.meta.url));
  assert.equal(caf.subarray(0, 4).toString(), 'caff', 'the voice fixture is a Core Audio file');
  assert.ok(caf.includes(Buffer.from('opus')), 'with Opus inside, as current iPhones record');
  const copy = readFileSync(new URL('./voice-fixture.m4a', import.meta.url));
  assert.equal(copy.subarray(4, 12).toString(), 'ftypM4A ', 'and its copy is MPEG-4 audio, as the server makes it');
  assert.match(read('ios/project.yml'), /core\/test\/voice-fixture\.caf[\s\S]*core\/test\/voice-fixture\.m4a/, 'the iOS test build carries both');
  const naming = JSON.parse(read('core/spec/naming.json'));
  const ui = read('ios/' + naming.product + 'UITests/AudioPlaybackTests.swift');
  for (const part of ['Play Audio Message.caf', 'au:voice']) assert.ok(ui.includes(part), 'the iOS test plays the voice message: ' + part);
  const android = read('android/app/src/androidTest/kotlin/' + naming.ids.android.replace(/\./g, '/') + '/AudioPlaybackTest.kt');
  for (const part of ['voice-fixture.caf', 'voice-fixture.m4a', 'Play Audio Message.caf', 'au:voice']) assert.ok(android.includes(part), 'the Android test plays the voice message: ' + part);
  const proof = read('desktop/scripts/prove-audio.mjs');
  for (const part of ["'Play Audio Message.caf'", "until('au:voice'"]) assert.ok(proof.includes(part), 'the desktop proof plays the voice message: ' + part);
});
