// Issue 440: a voice message played on one device still read as not played on every other. A recording someone else
// sent, played here, is told to the server, which keeps it and tells every client; a client told it was played elsewhere
// takes its mark off at once, and the mark the server sends with the recording (played) is honoured. Held here against
// the real components without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const defined = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { defined[name] = cls; }, get() { return undefined; } };
globalThis.document = { createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
URL.createObjectURL = () => 'blob:voice';
URL.revokeObjectURL = () => {};
globalThis.window = { bridge: { call: async () => null } };
const { forgetPlayed, notePlayed } = await import('../app/components/app-audio.js');
const AppAudio = defined['app-audio'];

function words(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(words).join('');
  if (value?.strings) return value.strings.map((s, i) => s + words(value.values[i])).join('');
  return '';
}
const settle = () => new Promise((r) => setTimeout(r, 0));
let ids = 0;
function player({ mine = false, ...o } = {}) {
  const el = Object.create(AppAudio.prototype);
  Object.assign(el, { mine, src: '', playing: false, position: 0, length: 0, heard: null, isConnected: true });
  el.attachment = { id: 'vpl' + String(++ids).padStart(11, '0'), name: 'Audio Message.caf', mime: 'audio/x-caf', bytes: 20485, sticker: false, missing: false, voice: true, played: false, ...o };
  el.wave = Array.from({ length: 28 }, () => 2);
  el.dispatchEvent = () => true;
  const told = [];
  el.client = { attachment: async () => new Blob(['x'], { type: 'audio/mp4' }), played: async (id) => { told.push(id); return { attachmentId: id, played: true }; } };
  const audio = { currentTime: 0, duration: 3, play() { el.onPlay(); return Promise.resolve(); }, pause() { el.onPause(); } };
  el.player = () => (el.src ? audio : null);
  return { el, told };
}

test('a recording someone else sent, played here, is told to the server; ours never is (issue 440)', async () => {
  forgetPlayed();
  const theirs = player();
  await theirs.el.toggle();
  await settle();
  assert.deepEqual(theirs.told, [theirs.el.attachment.id], 'the server is told it was played');
  await theirs.el.toggle();
  await theirs.el.toggle();
  await settle();
  assert.equal(theirs.told.length, 1, 'once, however many times it is played');
  const ours = player({ mine: true });
  await ours.el.toggle();
  await settle();
  assert.deepEqual(ours.told, [], 'what we sent is never marked');
  const already = player({ played: true });
  await already.el.toggle();
  await settle();
  assert.deepEqual(already.told, [], 'one already played everywhere is not told again');
  // A server that cannot be told leaves it played on this device.
  const offline = player();
  offline.el.client.played = async () => { throw new Error('offline'); };
  await offline.el.toggle();
  await settle();
  assert.ok(!words(offline.el.render()).includes('voice-unplayed'));
});

test('a recording played on another device loses its mark here at once, and the server\'s played mark is honoured (issue 440)', async () => {
  forgetPlayed();
  const { el } = player();
  el.heard = new Set();
  el.connectedCallback = AppAudio.prototype.connectedCallback;
  assert.ok(words(el.render()).includes('voice-unplayed'), 'marked until played');
  let updates = 0;
  el.requestUpdate = () => { updates += 1; };
  AppAudio.prototype.watchPlayed.call(el);
  await notePlayed(el.attachment.id);
  assert.ok(updates > 0, 'the player draws again');
  assert.ok(!words(el.render()).includes('voice-unplayed'), 'played elsewhere, it is played here');
  const marked = player({ played: true });
  marked.el.heard = new Set();
  assert.ok(!words(marked.el.render()).includes('voice-unplayed'), 'the mark the server sends is honoured');
});

test('the page tells every player when the server says a recording was played elsewhere (issue 440)', () => {
  const root = readFileSync(new URL('../app/components/app-root.js', import.meta.url), 'utf8');
  assert.match(root, /name === 'attachment\.played'[\s\S]{0,300}notePlayed\(/, 'app-root answers attachment.played');
  const api = readFileSync(new URL('../kit/api.js', import.meta.url), 'utf8');
  assert.match(api, /played: \(id\) => call\('POST', '\/api\/v1\/attachments\/' \+ encodeURIComponent\(id\) \+ '\/played'\)/, 'the client tells the server');
});
