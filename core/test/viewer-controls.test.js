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
  assert.match(viewer, /<div class="viewer-bar" role="toolbar" aria-label="Media controls">(\$\{inBar \? prev : nothing\})?\$\{play\}\$\{count\}/, 'the play control and the position live in the bar');
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

// A video is drawn before its clip arrives (issue 446). An empty video offers no player controls, and they are drawn
// with the first frame of the video's own source, which rebuilds the video's accessibility node: on Android's web view
// a video that reached the tree empty otherwise stayed "Unable to play media." with none of its controls.
function videoViewer() {
  const items = [1, 2].map((n) => ({ id: 'v' + n, attachmentId: 'v' + n, kind: 'video', name: 'clip-' + n + '.mp4', mime: 'video/mp4' }));
  const host = Object.assign(Object.create(components['app-image-viewer'].prototype), {
    items, index: 0, kind: 'video', alt: 'clip-1.mp4', src: '', view: { scale: 1, x: 0, y: 0 }, moving: false,
    motion: '', playing: false, motionFailed: false, urls: new Map(), isConnected: true, loads: 0,
  });
  host.onLoad = async () => { host.loads += 1; };
  const drawn = () => words(components['app-image-viewer'].prototype.render.call(host)).match(/<video class="viewer-image"[^>]*>/)[0];
  const loaded = (src) => host.videoLoaded({ target: { getAttribute: (name) => (name === 'src' ? src : null) } });
  return { host, drawn, loaded };
}

test('a video offers the player\'s controls only once it has a frame of its own clip', async () => {
  const { host, drawn, loaded } = videoViewer();
  assert.match(drawn(), /\?controls=false/, 'an empty video offers no controls');
  host.src = 'blob:clip-1';
  assert.match(drawn(), /\?controls=false/, 'nor does one whose clip has not given a frame yet');
  await loaded('blob:clip-1');
  assert.match(drawn(), /\?controls=true/, 'the first frame brings the controls');
  assert.equal(host.loads, 1, 'and the picture is fitted as before');
  assert.match(drawn(), /autoplay muted playsinline @loadeddata=/, 'the clip still starts muted on its own');
  host.src = 'blob:clip-2';
  assert.match(drawn(), /\?controls=false/, 'another clip is empty again until its own first frame');
  await loaded('blob:clip-1');
  assert.match(drawn(), /\?controls=false/, 'a late frame of the clip before does not count for this one');
  await loaded('blob:clip-2');
  assert.match(drawn(), /\?controls=true/);
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


// A video's own player controls and the viewer's controls are proven clear of each other in each phone shell's own web
// view (issue 416): the fixture opens the real viewer on a synthetic clip, and a native test on each phone finds every
// player control and every one of ours in the accessibility tree and asserts each is hittable and none overlaps another.
test('each phone proves a video\'s player controls and the viewer\'s own are all clear, on synthetic clips', () => {
  const read = (f) => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
  const naming = JSON.parse(read('core/spec/naming.json'));
  const shell = read('ios/' + naming.product + '/ShellView.swift');
  assert.match(shell, /#if DEBUG[\s\S]*--video-controls-fixture[\s\S]*#endif/, 'the video controls fixture is a Debug seam');
  const copies = read('ios/project.yml');
  for (const file of ['video-controls-fixture.js', 'video-controls-portrait.mp4', 'video-controls-landscape.mp4']) {
    assert.match(copies, new RegExp('CONFIGURATION.*Debug[\\s\\S]*core/test/' + file.replace('.', '\\.')), file + ' is copied into test builds only');
  }
  const uiTest = read('ios/' + naming.product + 'UITests/VideoControlsTests.swift');
  const androidTest = read('android/app/src/androidTest/kotlin/' + naming.ids.android.replaceAll('.', '/') + '/VideoControlsTest.kt');
  for (const [name, source] of [['the iOS UI test', uiTest], ['the Android instrumented test', androidTest]]) {
    for (const part of ['portrait', 'landscape', 'play or pause', 'scrubber', 'mute', 'full screen', 'close', 'next', 'bar', 'overlaps']) assert.ok(source.includes(part), name + ' checks ' + part);
    // The clip is held until the test has read the tree with the empty video in it (issue 446), and no wait is a sleep.
    for (const part of ['vc:holding', 'vc:release']) assert.ok(source.includes(part), name + ' takes the held order: ' + part);
    assert.doesNotMatch(source, /Thread\.sleep|\bsleep\(|usleep/, name + ' waits for states, never a clock');
  }
  const fixture = read('core/test/video-controls-fixture.js');
  assert.match(fixture, /attachment: async \(\) => \{ await released; return clip; \}/, 'the fixture holds the clip until it is released');
  assert.ok(uiTest.includes('isHittable') && uiTest.includes('.keepAlways'), 'the iOS test asserts each control is hittable and keeps its screenshot');
  assert.ok(androidTest.includes('elementFromPoint') && androidTest.includes('additionalTestOutputDir'), 'the Android test presses each control\'s middle through the page\'s hit test and keeps its screenshot');
  // The player offers mute only for a clip with sound, so each synthetic clip carries a (silent) sound track.
  for (const shape of ['portrait', 'landscape']) {
    const clip = readFileSync(new URL('./video-controls-' + shape + '.mp4', import.meta.url));
    assert.ok(clip.includes(Buffer.from('mp4a')) && clip.includes(Buffer.from('avc1')), 'the ' + shape + ' clip has a picture and a sound track');
  }
  assert.doesNotMatch(read('core/app/main.js'), /video-controls-fixture/);
});

// A video is laid out in the room the viewer's controls leave (issue 416): its step controls join the bar, and the
// stage keeps a band clear above it for the close control and one below it for the bar, so the player's own controls,
// drawn inside the video's box, never sit under ours. A picture keeps its step controls either side.
test('a video is laid out clear of every viewer control, and its step controls join the bar', () => {
  const host = (kind) => {
    const items = [1, 2, 3].map((n) => ({ id: 'v' + n, attachmentId: 'v' + n, kind, name: 'clip-' + n, mime: kind === 'video' ? 'video/mp4' : 'image/png' }));
    return Object.assign(Object.create(components['app-image-viewer'].prototype), {
      items, index: 1, kind, alt: 'clip-2', src: 'blob:clip', view: { scale: 1, x: 0, y: 0 }, moving: false, motion: '', playing: false, motionFailed: false, pageError: '',
    });
  };
  const drawn = words(components['app-image-viewer'].prototype.render.call(host('video')));
  const bar = drawn.slice(drawn.indexOf('<div class="viewer-bar"'));
  assert.ok(bar.includes('viewer-prev') && bar.includes('viewer-next'), 'a video\'s step controls are in the bar');
  assert.ok(bar.indexOf('viewer-prev') < bar.indexOf('viewer-count') && bar.indexOf('viewer-count') < bar.indexOf('viewer-next'), 'previous leads the bar and next ends it');
  assert.doesNotMatch(drawn, /class="viewer-nav/, 'nothing of ours floats over the sides of a video');
  const picture = words(components['app-image-viewer'].prototype.render.call(host('image')));
  assert.match(picture, /class="viewer-nav viewer-prev"/, 'a picture keeps its step controls either side');
  assert.doesNotMatch(picture.slice(picture.indexOf('<div class="viewer-bar"')), /viewer-prev/);
  const video = rule('.sheet-scrim.viewer[data-kind="video"]');
  assert.match(video, /padding-top: calc\(var\(--viewer-close-top\) \+ var\(--viewer-control\) \+ var\(--space-2\)\);/, 'the band above clears the close control');
  assert.match(video, /padding-bottom: calc\(var\(--viewer-bar-bottom\) \+ var\(--viewer-bar-h\) \+ var\(--space-2\)\);/, 'the band below clears the bar');
  assert.match(rule('.viewer > .close-button'), /top: var\(--viewer-close-top\);/, 'the close control sits where the band measures it');
  assert.match(rule('.viewer-bar'), /bottom: var\(--viewer-bar-bottom\);/, 'the bar sits where the band measures it');
  assert.match(rule('.viewer-bar'), /min-height: var\(--viewer-bar-h\);/, 'and is the height the band leaves it');
});
