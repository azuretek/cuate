import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SEND_STYLES, SEND_EFFECTS, BUBBLE_EFFECTS, SCREEN_EFFECTS, sendEffectOf, sendEffectLine, sendEffectKind, effectPieces } from '../app/rules/send-effects.js';
import { messageSummary } from '../app/rules/payload.js';

// Issue 442: a bubble effect plays on the bubble, a screen effect over the conversation, when the message arrives in the
// conversation on screen; a quiet line under the message names it with a Replay control; under reduced motion nothing
// plays and the line still names it. Every colour, length and duration is a token, and the native proof is a Debug seam.
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const naming = JSON.parse(read('core/spec/naming.json'));

test('each of the thirteen effects is named, and is a bubble effect or a screen effect (issue 442)', () => {
  assert.deepEqual(BUBBLE_EFFECTS, ['slam', 'loud', 'gentle', 'invisible-ink']);
  assert.deepEqual(SCREEN_EFFECTS, ['echo', 'spotlight', 'balloons', 'confetti', 'love', 'lasers', 'fireworks', 'celebration', 'shooting-star']);
  assert.equal(Object.keys(SEND_EFFECTS).length, 13);
  for (const key of BUBBLE_EFFECTS) assert.equal(sendEffectKind(key), 'bubble', key);
  for (const key of SCREEN_EFFECTS) assert.equal(sendEffectKind(key), 'screen', key);
  assert.equal(sendEffectLine('confetti'), 'Sent with Confetti');
  assert.equal(sendEffectLine('invisible-ink'), 'Sent with Invisible Ink');
  assert.equal(sendEffectLine('shooting-star'), 'Sent with Shooting Star');
  assert.equal(sendEffectLine('slam'), 'Sent with Slam');
  assert.equal(sendEffectLine('nonsense'), '');
  assert.equal(sendEffectKind('nonsense'), null);
  assert.equal(sendEffectOf('com.apple.MobileSMS.expressivesend.impact'), 'slam');
  assert.equal(sendEffectOf('com.apple.messages.effect.CKSparklesEffect'), 'celebration');
  assert.equal(sendEffectOf('com.apple.messages.effect.CKHappyBirthdayEffect'), 'balloons');
  assert.equal(sendEffectOf('something.else'), null);
  assert.equal(sendEffectOf(null), null);
  assert.equal(new Set(Object.values(SEND_STYLES)).size, 13, 'one identifier per effect');
  assert.equal(messageSummary({ text: 'Synthetic hidden', sendEffect: 'invisible-ink', attachments: [] }), 'Sent with Invisible Ink', 'ink never shows its words in a summary');
  assert.equal(messageSummary({ text: 'Synthetic words', sendEffect: 'slam', attachments: [] }), 'Synthetic words');
});

test('a screen effect\'s pieces are laid out the same way every time, inside the conversation (issue 442)', () => {
  for (const effect of SCREEN_EFFECTS) {
    const a = effectPieces(effect);
    assert.deepEqual(a, effectPieces(effect), effect + ' is drawn the same way each time it plays');
    assert.ok(a.length >= 1, effect + ' has pieces');
    for (const p of a) {
      for (const k of ['x', 'y', 'delay']) assert.ok(p[k] >= 0 && p[k] <= 1, effect + ' ' + k + ' ' + p[k] + ' is a fraction of the conversation');
      assert.ok(Number.isInteger(p.tone) && p.tone >= 1 && p.tone <= 5, effect + ' takes its colour from one of the five chart tokens');
    }
  }
  assert.ok(effectPieces('confetti').length >= 30, 'confetti falls as many pieces');
  assert.equal(effectPieces('spotlight').length, 1, 'a spotlight is one light');
});

test('every effect plays on the motion tokens through the kit, and reduced motion keeps the line and plays nothing (issue 442)', () => {
  const tokens = JSON.parse(read('core/spec/tokens.json'));
  for (const t of ['send-bubble', 'send-gentle', 'send-screen']) assert.match(tokens.motion[t] || '', /^\d+ms$/, t + ' is a duration token');
  for (const t of ['ink-blur', 'balloon', 'confetti', 'spotlight-reach']) assert.ok(tokens.size[t], t + ' is a size token');
  const css = read('core/app/styles/app.css');
  assert.match(css, /\.send-effect-line \{/, 'the line under the message is drawn');
  assert.match(css, /\.screen-effect \{ position: absolute; inset: 0;[^}]*pointer-events: none;/, 'a screen effect plays over the conversation and takes no press');
  assert.match(css, /\.bubble\[data-ink="veiled"\] \.ink-words \{[^}]*filter: blur\(var\(--size-ink-blur\)\)/, 'Invisible Ink veils the words');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.screen-effect \{ display: none; \} \.send-effect-replay \{ display: none; \} \.bubble\[data-ink\] \.ink-veil \{ animation: none; \} \}/, 'reduced motion plays nothing and offers nothing to replay');
  for (const tone of [1, 2, 3, 4, 5]) assert.ok(css.includes('.fx-piece[data-tone="' + tone + '"] { --fx-colour: var(--color-chart-' + tone + '); }'), 'tone ' + tone + ' is a chart colour');
  const fx = read('core/app/components/send-effects.js');
  assert.match(fx, /import \{ play, reducedMotion, cssVar \} from '\.\.\/\.\.\/kit\/motion\.js';/, 'the effects play through the kit');
  assert.ok(!/\.animate\(/.test(fx), 'never on their own');
  for (const d of ["duration: 'send-bubble'", "duration: 'send-gentle'", "duration: 'send-screen'"]) assert.ok(fx.includes(d), 'on the token: ' + d);
  assert.match(fx, /if \(reducedMotion\(\)\) return null;/, 'nothing is drawn over the conversation under reduced motion');
});

test('the conversation plays an effect when its message arrives, names it under the message, and replays it on a press (issue 442)', () => {
  const conv = read('core/app/components/app-conversation.js');
  assert.match(conv, /import \{ playBubbleEffect, playScreenEffect \} from '\.\/send-effects\.js';/);
  assert.match(conv, /const fresh = newArrivals\(/, 'only a message that arrives plays, never a first draw or a page of older history');
  assert.match(conv, /if \(m && m\.sendEffect\) this\.playEffect\(m\);/, 'an arriving message with an effect plays it');
  assert.match(conv, /<div class="send-effect-line"><span class="send-effect-name">\$\{sendEffectLine\(m\.sendEffect\)\}<\/span>/, 'the line names the effect');
  assert.match(conv, /class="send-effect-replay" aria-label=\$\{'Replay ' \+ sendEffectName\(m\.sendEffect\)\} @click=\$\{press\(\(\) => this\.playEffect\(m\)\)\}>Replay<\/button>/, 'Replay goes through the kit press');
  assert.match(conv, /data-ink=\$\{ink \? \(this\.inkShown\.has\(m\.id\) \? 'shown' : 'veiled'\) : nothing\}/, 'Invisible Ink is veiled until it is pressed');
  assert.match(conv, /<div class="screen-effect" aria-hidden="true"><\/div>/, 'one layer over the conversation for a screen effect');
});

test('the send effects proof is a Debug seam, copied into test builds only, and the desktop smoke plays them (issue 442)', () => {
  const shell = read('ios/' + naming.product + '/ShellView.swift');
  assert.match(shell, /#if DEBUG[\s\S]*--send-effects-fixture[\s\S]*#endif/, 'the fixture is a Debug seam');
  assert.match(read('ios/project.yml'), /CONFIGURATION.*Debug[\s\S]*core\/test\/send-effects-fixture\.js/, 'copied into test builds only');
  const uiTest = read('ios/' + naming.product + 'UITests/SendEffectsTests.swift');
  for (const part of ['--send-effects-fixture', 'hasPrefix("sendfx:pass")', 'Sent with Confetti']) assert.ok(uiTest.includes(part), 'the UI test reads the verdict: ' + part);
  assert.doesNotMatch(read('core/app/main.js'), /send-effects-fixture/);
  assert.match(read('desktop/scripts/smoke.mjs'), /key: 'sendEffects'/, 'the desktop smoke requires its check');
  assert.match(read('desktop/src/main.js'), /await smokeStep\('send effects'\);[\s\S]*report\.sendEffects = /, 'and the smoke runs it');
});

test('the same fixture is the Android proof, run by the instrumented tests and kept by the leg (issue 442)', () => {
  const pkg = 'com/azuretek/' + naming.product.toLowerCase();
  const uiTest = read('android/app/src/androidTest/kotlin/' + pkg + '/SendEffectsTest.kt');
  assert.match(uiTest, /PageFixture\.run\(scenario, "send-effects-fixture\.js", "sendEffectsProof"(?:, \d+)?\)/, 'the Android test runs the shared fixture');
  assert.match(uiTest, /proof\.optBoolean\("ok"\)/, 'and fails on its verdict');
  assert.ok(read('android/app/src/androidTest/kotlin/' + pkg + '/PageFixture.kt').includes('object PageFixture'), 'through the shared page fixture seam');
  assert.match(read('.github/workflows/android.yml'), /send-effects\.png/, 'the leg requires the capture');
  assert.doesNotMatch(read('android/app/src/main/kotlin/' + pkg + '/MainActivity.kt'), /send-effects-fixture|sendEffectsProof/);
});
