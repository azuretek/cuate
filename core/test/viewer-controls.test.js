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
  }
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

// Issue 443: a video's element carries the item's poster while its clip loads, so the emulator's host renderer never
// sees an empty media surface. The player still decodes and plays the real clip, and its controls are unchanged.
test('a video carries its item poster while the clip loads', () => {
  assert.match(viewer, /<video class="viewer-image" src=\$\{this\.src\} poster=\$\{this\.poster \|\| nothing\}/, 'the video template draws the poster');
  assert.match(viewer, /this\.poster = item\.poster \|\| '';/, 'the viewer takes the poster from the item it shows');
});

// A video reaches the page only with its clip (issue 446): drawn before its clip, a video element is an empty player,
// and Android's web view builds that player's accessibility node as "Unable to play media." with none of its controls,
// then keeps it once the clip has loaded. Until the clip is here the viewer holds the video's place with a node that
// names it and is busy, and the video element is made with its clip already set.
test('a video is drawn only once its clip is here, and its place is held until then', () => {
  const host = (src) => {
    const items = [1, 2, 3].map((n) => ({ id: 'v' + n, attachmentId: 'v' + n, kind: 'video', name: 'clip-' + n + '.mp4', mime: 'video/mp4' }));
    return Object.assign(Object.create(components['app-image-viewer'].prototype), {
      items, index: 1, kind: 'video', alt: 'clip-2.mp4', src, view: { scale: 1, x: 0, y: 0 }, moving: false, motion: '', playing: false, motionFailed: false, pageError: '',
    });
  };
  const render = components['app-image-viewer'].prototype.render;
  const waiting = words(render.call(host('')));
  assert.doesNotMatch(waiting, /<video/, 'no video element is drawn before its clip');
  assert.match(waiting, /<div class="viewer-pending" role="img" aria-label=clip-2\.mp4 aria-busy="true">/, 'the video\'s place is held by a node that names it and is busy');
  assert.ok(waiting.includes('aria-label="Close"') && waiting.includes('viewer-prev') && waiting.includes('viewer-next'), 'the viewer\'s own controls are there meanwhile');
  const loaded = words(render.call(host('blob:clip')));
  assert.match(loaded, /<video class="viewer-image" src=blob:clip( poster=[^ ]*)? aria-label=clip-2\.mp4 controls /, 'the video element is made with its clip already set');
  assert.doesNotMatch(loaded, /viewer-pending/, 'and the held place is gone');
});

// Every run takes the real order (issue 446): the fixture holds the clip back while each phone's test reads the
// accessibility tree over the empty video, and lets it go only when the test says so, so a player whose controls never
// reach the tree fails every run rather than one in four. Every wait in those tests and the fixture is for a state.
test('each phone\'s video test reads the tree over the empty video before its clip, and waits only on states', () => {
  const read = (f) => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
  const naming = JSON.parse(read('core/spec/naming.json'));
  const fixture = read('core/test/video-controls-fixture.js');
  assert.match(fixture, /attachment: async \(\) => \{ await held; return clip; \}/, 'the fixture holds the clip back');
  assert.ok(fixture.indexOf("say('vc:empty '") < fixture.indexOf("'the test to let the clip go'") && fixture.indexOf("'the test to let the clip go'") < fixture.indexOf("'the clip to load'"), 'it reports the empty video, waits for the test, then loads the clip');
  const androidTest = read('android/app/src/androidTest/kotlin/' + naming.ids.android.replaceAll('.', '/') + '/VideoControlsTest.kt');
  const check = androidTest.slice(androidTest.indexOf('private fun check('));
  assert.ok(check.indexOf('awaitState(scenario, "vc:empty ")') < check.indexOf('awaitControls(OURS)') && check.indexOf('awaitControls(OURS)') < check.indexOf('window.videoControlsRelease()') && check.indexOf('window.videoControlsRelease()') < check.indexOf('awaitControls(PLAYER + OURS)'), 'Android connects the service and reads the tree over the empty video before it lets the clip go');
  const uiTest = read('ios/' + naming.product + 'UITests/VideoControlsTests.swift');
  assert.ok(uiTest.indexOf("'vc:empty'") < uiTest.indexOf('releaseClip(app, page)') && uiTest.includes('page.buttons["vc:release"]'), 'iOS reads the tree over the empty video, then presses the release control');
  for (const [name, source] of [['the fixture', fixture], ['the Android test', androidTest], ['the iOS test', uiTest]]) {
    assert.doesNotMatch(source, /Thread\.sleep|setTimeout|\bsleep\(|usleep/, name + ' waits on states, never a sleep');
  }
});

// The contacts tests wait on the reading they judge (issue 446): every window of the contacts app is read again and
// again, the whole tree at a time, until one names the person, and the reading the wait ends on is the one asserted. One
// look at a view that is still drawing, or a whole-name lookup against an editor whose name fields are separate, reads as
// not the person while the person is on screen. Google Contacts also draws its first-run notice in a window of its own,
// in front of the card, so the active root alone holds the notice and never the person behind it.
test('each phone\'s contacts test waits on the reading it judges, and says what it saw', () => {
  const read = (f) => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
  const naming = JSON.parse(read('core/spec/naming.json'));
  const androidTest = read('android/app/src/androidTest/kotlin/' + naming.ids.android.replaceAll('.', '/') + '/ContactEditorTest.kt');
  assert.match(androidTest, /node\.text\?\.toString\(\), node\.contentDescription\?\.toString\(\)/, 'Android reads every text and content description under one root');
  assert.match(androidTest, /for \(window in automation\.windows\) \{/, 'read from every window, not only the one in front');
  assert.match(androidTest, /while \(named\(\) == null\)/, 'and takes a new reading until one window names the person');
  assert.match(androidTest, /dismissFirstRunNotice\(\)/, "and closes the contacts app's own first-run notice rather than judging it");
  assert.match(androidTest, /assertEquals\("the contacts app names the person: \$shown", true, shown\.namesThePerson\)/, 'asserting on the reading its wait ended on');
  assert.match(androidTest, /the contacts app never showed the person; the last readings: \$readings/, 'and a wait that runs out says what it saw');
  assert.doesNotMatch(androidTest, /Thread\.sleep|SystemClock\.sleep/, 'Android waits on states, never a sleep');
  const uiTest = read('ios/' + naming.product + 'UITests/ContactEditorTests.swift');
  assert.match(uiTest, /let editor = app\.navigationBars\.buttons\["Edit"\]\.firstMatch/, 'iOS reads the card by the native control the tree carries');
  assert.match(uiTest, /while !\(editor\.exists && editor\.isHittable\) && Date\(\) < judged/, 'and waits on that state, bounded');
  assert.match(uiTest, /addingTimeInterval\(cardSeconds\)/, 'bounded, and it says what the last reading held');
  assert.match(uiTest, /the tree held/, 'and a failure says what the tree carried');
  assert.doesNotMatch(uiTest, /staticTexts\.matching\(named\)\.count/, 'never from two queries');
  assert.doesNotMatch(uiTest, /\bsleep\(/, 'iOS waits on states, never a sleep');
});
