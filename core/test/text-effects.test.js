import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Issue 433: a text effect plays over the stretch it was laid on, every length and duration a token, still under reduced
// motion, and the native proof is a Debug seam only.
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const naming = JSON.parse(read('core/spec/naming.json'));

test('each of the eight effects has its own animation, on the duration token, and none under reduced motion (issue 433)', () => {
  const css = read('core/app/styles/app.css');
  for (const effect of ['big', 'small', 'shake', 'nod', 'bloom']) {
    assert.match(css, new RegExp('\\.text-effect\\[data-effect="' + effect + '"\\] \\{ animation-name: text-' + effect + ';'), effect + ' plays its own animation');
    assert.match(css, new RegExp('@keyframes text-' + effect + ' \\{'), effect + ' has its keyframes');
  }
  for (const effect of ['ripple', 'jitter', 'explode']) {
    assert.match(css, new RegExp('\\.text-effect\\[data-effect="' + effect + '"\\] \\.fx-letter \\{ animation-name: text-' + effect + ';'), effect + ' moves each letter');
  }
  assert.match(css, /animation: var\(--motion-text-effect\) var\(--motion-ease\) both;/, 'the duration is the token');
  assert.ok(read('core/app/styles/tokens.css').includes('--motion-text-effect:'), 'which the page defines');
  // As specific as the rules that name each effect, and after them, so reduced motion wins over every one.
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.text-effect\[data-effect\], \.text-effect\[data-effect\] \.fx-letter \{ animation: none; \} \}/, 'reduced motion draws the words still');
  assert.ok(css.lastIndexOf('animation: none; } }') > css.lastIndexOf('animation-name: text-'), 'and it comes after every rule that names an effect');
});

test('the bubble draws its words through the styled pieces, so a link inside an effect still opens (issue 433)', () => {
  const conv = read('core/app/components/app-conversation.js');
  assert.match(conv, /const linkedText = \(text, open, styles = \[\]\) => styledParts\(text, styles\)/);
  assert.match(conv, /linkedText\(m\.text, \(e, href\) => this\.openLink\(e, href\), m\.styles\)/, 'the bubble hands the message\'s styles over');
});

test('the text effects proof is a Debug seam, copied into test builds only (issue 433)', () => {
  const shell = read('ios/' + naming.product + '/ShellView.swift');
  assert.match(shell, /#if DEBUG[\s\S]*--text-effects-fixture[\s\S]*#endif/, 'the fixture is a Debug seam');
  assert.match(read('ios/project.yml'), /CONFIGURATION.*Debug[\s\S]*core\/test\/text-effects-fixture\.js/, 'copied into test builds only');
  const uiTest = read('ios/' + naming.product + 'UITests/TextEffectsTests.swift');
  for (const part of ['--text-effects-fixture', 'hasPrefix("textfx:pass")', 'Plain words, no effect.']) assert.ok(uiTest.includes(part), 'the UI test reads the verdict: ' + part);
  assert.doesNotMatch(read('core/app/main.js'), /text-effects-fixture/);
});
