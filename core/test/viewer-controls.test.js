// The media viewer's controls (issue 325): every press reaches its control, the picture sits in the middle, and the
// controls are one designed family on the shared tokens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const viewer = readFileSync(new URL('../app/components/app-image-viewer.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/styles/app.css', import.meta.url), 'utf8');
const rule = (sel) => { const m = css.match(new RegExp('(^|\\n)' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([^}]*)\\}')); return m ? m[2] : ''; };

test('a press on any viewer control is the control\'s, never captured by the stage for a pan', () => {
  assert.match(viewer, /e\.target\.closest\('button, video, \.viewer-bar'\)\) return;/, 'every button, the bar and a video are left out of the pan');
  const down = viewer.slice(viewer.indexOf('onDown = (e) => {'), viewer.indexOf('onMove = (e) => {'));
  assert.ok(down.indexOf("closest('button, video, .viewer-bar')") < down.indexOf('setPointerCapture'), 'and that is decided before the stage takes the pointer');
});

test('the picture sits in the middle of the stage', () => {
  assert.match(viewer, /anchor: 'center' \}/);
});

test('the controls are one family: the close control\'s height, one frosted pill, one bar centred at the foot', () => {
  assert.match(css, /\.viewer \{ --viewer-control: var\(--size-close-lg\);/, 'the close control sets the height');
  assert.match(rule('.viewer-nav, .viewer-control'), /height: var\(--viewer-control\)/);
  assert.match(rule('.viewer > .close-button, .viewer-nav, .viewer-bar'), /background: var\(--viewer-glass\)/, 'one surface for every control');
  assert.match(rule('.viewer-bar'), /left: 50%; translate: -50% 0;/, 'the bar is centred');
  assert.match(viewer, /<div class="viewer-bar" role="toolbar" aria-label="Media controls">\$\{play\}\$\{count\}/, 'the play control and the position live in the bar');
  assert.match(viewer, /class="viewer-control viewer-play"[^>]*>.*<span class="viewer-play-label">Live<\/span>/, 'the play control is labelled');
  assert.match(rule('.viewer-play'), /background: var\(--color-accent\)/, 'and drawn in the accent so it is not missed');
  for (const sel of ['.viewer-nav, .viewer-control', '.viewer-bar', '.viewer-play', '.viewer-count, .viewer-zoom']) {
    assert.doesNotMatch(rule(sel), /\d+px(?!\))/, sel + ' takes its sizes from tokens');
  }
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.viewer > \.close-button, \.viewer-nav, \.viewer-bar \{ animation: none; \}/);
});

// A Live Photo's motion is started by the viewer, and a motion that cannot play says so (issue 386). The real viewer's
// own play path runs here over a stand-in motion element: on iPhone WebKit refused the motion's autoplay, which left the
// empty box a video element draws before it has a frame.
const components = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { components[name] = cls; }, get() { return undefined; } };
globalThis.document = { createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
await import('../app/components/app-image-viewer.js');

// The Lit template as the text it would draw, nested templates included, without a browser.
function words(value) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(words).join('');
  if (value?.strings) return value.strings.map((s, i) => s + words(value.values[i])).join('');
  return '';
}

// A viewer on one Live Photo, its still drawn at 300 by 400, and a motion element whose play() answers as told.
function livePhoto(play) {
  const props = new Map();
  const video = { isConnected: true, plays: 0, style: { setProperty: (k, v) => props.set(k, v) }, play() { this.plays += 1; return play(this); } };
  const still = { offsetWidth: 300, offsetHeight: 400 };
  const items = [{ id: 'att-l', attachmentId: 'att-l', kind: 'image', name: 'IMG_0001.HEIC', mime: 'image/png', live: true }];
  const host = Object.assign(Object.create(components['app-image-viewer'].prototype), {
    items, index: 0, kind: 'image', alt: 'IMG_0001.HEIC', src: 'blob:still', view: { scale: 1, x: 0, y: 0 }, moving: false,
    motion: '', playing: false, motionFailed: false, urls: new Map(), isConnected: true,
    client: { attachment: async (id, o) => { assert.equal(o.part, 'live'); return new Blob(['motion'], { type: 'video/mp4' }); } },
    querySelector: (sel) => (sel === 'video.viewer-motion' ? (host.playing ? video : null) : sel === '.viewer-image' ? (host.playing ? video : still) : null),
  });
  Object.defineProperty(host, 'updateComplete', { value: Promise.resolve(true) });
  return { host, video, props };
}

test('the viewer starts the motion itself, in the still\'s box with the still as its poster', async () => {
  const { host, video, props } = livePhoto(async () => {});
  await host.playMotion();
  assert.equal(video.plays, 1, 'play() is called on the motion once it is drawn, rather than trusting autoplay');
  assert.ok(host.playing && !host.motionFailed, 'the motion is playing');
  assert.deepEqual([props.get('--motion-w'), props.get('--motion-h')], ['300', '400'], 'the motion takes the still\'s box, so the stage keeps its size');
  const drawn = words(components['app-image-viewer'].prototype.render.call(host));
  assert.match(drawn, /<video class="viewer-image viewer-motion" src=blob:[^ ]+ poster=blob:still /, 'the still is the motion\'s poster while it loads');
  assert.doesNotMatch(drawn, /viewer-motion[^>]* autoplay/, 'the motion is started by play(), not left to autoplay');
  assert.match(css, /\.viewer video\.viewer-motion \{ width: calc\(var\(--motion-w\) \* 1px\); height: calc\(var\(--motion-h\) \* 1px\); \}/, 'the box is the still\'s');
});

test('a motion whose play is refused puts the still back and says the motion could not be loaded', async () => {
  const { host, video } = livePhoto(() => Promise.reject(Object.assign(new Error('The request is not allowed by the user agent'), { name: 'NotAllowedError' })));
  await host.playMotion();
  assert.equal(video.plays, 1);
  assert.ok(!host.playing && host.motionFailed, 'a refused play is the failure state, not a motion left waiting');
  const drawn = words(components['app-image-viewer'].prototype.render.call(host));
  assert.ok(drawn.includes('<img class="viewer-image" src=blob:still') && !drawn.includes('<video'), 'the still is drawn, never an empty motion box');
  assert.match(drawn, /class="viewer-control viewer-play" aria-label=The motion could not be loaded title=The motion could not be loaded aria-pressed=false \?disabled=true/, 'the control says the motion could not be loaded');
  assert.match(viewer, /@error=\$\{\(e\) => this\.motionRefused\(e\.target, list\[at\]\)\}/, 'a motion file that will not load is the same failure');
});

test('a play the viewer ended itself is not a failure', async () => {
  const { host } = livePhoto((v) => { v.isConnected = false; host.playing = false; return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
  await host.playMotion();
  assert.ok(!host.playing && !host.motionFailed, 'the control pressed again, another item or the viewer closing leaves the motion offered');
});

test('the iOS shell lets media play without a gesture, as the Android shell does', () => {
  const read = (f) => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
  const naming = JSON.parse(read('core/spec/naming.json'));
  const shell = read('ios/' + naming.product + '/ShellView.swift');
  assert.match(shell, /configuration\.mediaTypesRequiringUserActionForPlayback = \[\]/);
  assert.match(read('android/app/src/main/kotlin/' + naming.ids.android.replaceAll('.', '/') + '/MainActivity.kt'), /mediaPlaybackRequiresUserGesture = false/);
  assert.match(shell, /#if DEBUG[\s\S]*--live-photo-fixture[\s\S]*#endif/, 'the Live Photo fixture is a Debug seam');
  assert.match(read('ios/project.yml'), /CONFIGURATION.*Debug[\s\S]*core\/test\/live-photo-fixture\.js[\s\S]*core\/test\/live-photo-fixture\.mp4/, 'copied into test builds only');
  const uiTest = read('ios/' + naming.product + 'UITests/LivePhotoTests.swift');
  for (const part of ['--live-photo-fixture', '"Play the Live Photo"', 'control.tap()', 'hasPrefix("live:pass")']) assert.ok(uiTest.includes(part), 'the UI test presses LIVE and reads the verdict: ' + part);
  assert.doesNotMatch(read('core/app/main.js'), /live-photo-fixture/);
});


test('a closed viewer never installs or starts a late Live Photo motion', async () => {
  const { host, video } = livePhoto(async () => {});
  host.isConnected = false;
  await host.playMotion();
  assert.equal(video.plays, 0);
  assert.equal(host.urls.size, 0);
  assert.equal(host.playing, false);
});
