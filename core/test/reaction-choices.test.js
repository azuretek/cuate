// Issue 533 (Abi, 2026-11-16): React offers exactly what the conversation can carry, decided once (reactionOffer in core)
// from the chat's service and the engine's advertised tapback.emoji version, and drawn by the one panel every surface
// opens: the message menu's React, reached by a right click, a long click or a long press. Where only the six classic
// reactions can go the panel draws just those, with no search, no categories and no recents; where any emoji can go it
// is the full panel. The same fixture proves it in each shell's own web view (core/test/reaction-choices-fixture.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const defined = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { defined[name] = cls; }, get() { return undefined; } };
globalThis.document = { createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
await import('../app/components/app-conversation.js');
const conversation = defined['app-conversation'].prototype;
const composer = defined['app-composer'].prototype;
const picker = defined['app-emoji-picker'].prototype;
const { reactionOffer } = await import('../app/rules/messages.js');

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const naming = JSON.parse(read('core/spec/naming.json'));
const SIX = ['\u2764\ufe0f', '\u{1F44D}', '\u{1F44E}', '\u{1F602}', '\u203c\ufe0f', '\u2753'];

function words(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(words).join('');
  if (value?.strings) return value.strings.map((s, i) => s + words(value.values[i])).join('');
  return '';
}

// The value a template binds to a property, found by the text just before it (" .name=").
function bound(value, name) {
  if (Array.isArray(value)) {
    for (const v of value) {
      const hit = bound(v, name);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }
  if (!value?.strings) return undefined;
  for (let i = 0; i < value.values.length; i += 1) {
    if (value.strings[i].endsWith(' .' + name + '=')) return value.values[i];
    const hit = bound(value.values[i], name);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

// The panel as the composer would draw it for a conversation, after React was pressed on a message in it.
function panelFor(chat, engine) {
  const host = { messages: [], chat, engine, sending: true, reactFor: 'FAKE-0001', replyingTo: null, editing: null, favourites: [], phone: false, uploadMaxBytes: 0 };
  const reactWith = bound(conversation.render.call({ ...host, pop: null, reacting: null, note: null, typing: null, shownEdits: new Set(), inkShown: new Set(), composerPlaceholder: () => '', windowControls: null, historyWindow: null, hasMore: false }), 'reactWith');
  const only = bound(composer.render.call({ emojiOpen: true, reactFor: 'FAKE-0001', reactWith, favourites: [], phone: false, disabled: false, editing: null, stageProblem: null, staged: null, placeholder: '' }), 'only');
  const panel = Object.assign(Object.create(picker), { only, favourites: [], dismiss: 'emoji', query: '', category: 'smileys', side: 'above', tones: {}, toneFor: null });
  return { reactWith, only, markup: words(panel.render()) };
}

const cells = (markup) => [...markup.matchAll(/class="emoji-cell[^"]*"[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);

test('an SMS or RCS conversation is offered exactly the six classic reactions, with nothing to search (issue 533)', () => {
  for (const service of ['SMS', 'RCS']) {
    const { only, markup } = panelFor({ id: '3', service }, { kind: 'imsg', tapbackEmoji: 2 });
    assert.deepEqual(only.map((r) => r.glyph), SIX, service + ': the composer hands the panel the six');
    assert.deepEqual(cells(markup), SIX, service + ': the panel draws the six and nothing else');
    assert.ok(markup.includes('reaction-choices') && markup.includes('aria-label="React"'), 'the short panel, named for what it does');
    assert.ok(!markup.includes('Search emoji') && !markup.includes('emoji-tab') && !markup.includes('Frequently used'), service + ': no search, categories or recents to pick something it would refuse');
    assert.match(markup, /aria-label="?Heart\b/, 'each reaction is named for a screen reader');
    assert.match(markup, /aria-label="?Question mark\b/);
  }
});

test('a conversation on the message service where the engine sends any emoji keeps the full panel (issue 533)', () => {
  const { reactWith, only, markup } = panelFor({ id: '1', service: 'iMessage' }, { kind: 'imsg', tapbackEmoji: 2 });
  assert.equal(reactWith, null, 'nothing restricts it');
  assert.equal(only, null);
  assert.ok(markup.includes('Search emoji') && markup.includes('emoji-tab'), 'search and categories');
  assert.ok(cells(markup).length > SIX.length, 'the whole grid');
});

test('the message service on an engine that sends only the six, and a group with a member off it, offer the six (issue 533)', () => {
  assert.deepEqual(cells(panelFor({ id: '1', service: 'iMessage' }, { kind: 'imsg', tapbackEmoji: 1 }).markup), SIX, 'an older engine');
  assert.deepEqual(cells(panelFor({ id: '1', service: 'iMessage' }, null).markup), SIX, 'an engine the app has not heard from');
  assert.deepEqual(cells(panelFor({ id: '2', service: 'iMessage', isGroup: true, participants: ['a', 'b'], members: [{ handle: 'a', service: 'SMS' }] }, { tapbackEmoji: 2 }).markup), SIX, 'the most limited member decides');
});

test('the composer opened for typing keeps the full panel on every conversation (issue 533)', () => {
  const only = bound(composer.render.call({ emojiOpen: true, reactFor: null, reactWith: reactionOffer({ service: 'SMS' }, null).choices, favourites: [], phone: false, disabled: false, editing: null, stageProblem: null, staged: null, placeholder: '' }), 'only');
  assert.equal(only, null, 'typing an emoji into a text is not a reaction, so nothing is restricted');
});

test('the menu and the long press reach the one panel, and the server holds the same rule (issue 533)', () => {
  const conv = read('core/app/components/app-conversation.js');
  assert.match(conv, /\.reactWith=\$\{this\.reactFor \? reactionOffer\(this\.chat, this\.engine\)\.choices : null\}/, 'the conversation asks the one rule');
  assert.match(read('core/app/components/app-root.js'), /\.engine=\$\{this\.info\?\.engine \|\| null\}/, 'with the engine the server reported');
  assert.match(read('server/src/send.js'), /reactionChoices\(\{ platform, tapbackEmoji: have \}\)/, 'the server decides by the same rule');
  assert.match(read('server/src/engine/index.js'), /tapbackEmoji: capabilityVersion\('tapback\.emoji'\)/, 'and tells the app the version it decides by');
});

test('the reaction choices fixture is the iOS, Android and desktop proof, Debug-only and kept by each leg (issue 533)', () => {
  const fixture = read('core/test/reaction-choices-fixture.js');
  for (const part of ["service: 'SMS'", "service: 'RCS'", 'tapbackEmoji: 2', 'tapbackEmoji: 1', 'reactions:pass', 'window.reactionChoicesProof = { ok: !problems.length', 'Reacted \\u{1F602} to', 'Loved an image', 'Removed an exclamation from']) assert.ok(fixture.includes(part), 'the fixture holds ' + part);
  const shell = read('ios/' + naming.product + '/ShellView.swift');
  assert.match(shell, /#if DEBUG[\s\S]*--reaction-choices-fixture[\s\S]*#endif/, 'a Debug seam on iOS');
  assert.match(read('ios/project.yml'), /CONFIGURATION.*Debug[\s\S]*core\/test\/reaction-choices-fixture\.js/, 'copied into test builds only');
  const iosTest = read('ios/' + naming.product + 'UITests/ReactionChoicesTests.swift');
  assert.ok(iosTest.includes('--reaction-choices-fixture') && iosTest.includes('hasPrefix("reactions:pass")'), 'the iOS UI test reads the verdict');
  const pkg = 'com/azuretek/' + naming.product.toLowerCase();
  const androidTest = read('android/app/src/androidTest/kotlin/' + pkg + '/ReactionChoicesTest.kt');
  assert.match(androidTest, /PageFixture\.run\(scenario, "reaction-choices-fixture\.js", "reactionChoicesProof"\)/, 'the Android test runs the shared fixture');
  assert.match(read('.github/workflows/android.yml'), /reaction-choices\.png/, 'and the leg keeps the capture');
  assert.match(read('desktop/scripts/smoke.mjs'), /key: 'reactionChoices'/, 'the desktop smoke checks it');
  assert.match(read('desktop/src/main.js'), /smokeStep\('reaction choices'\)[\s\S]*report\.reactionChoices = /, 'and runs the same fixture in the window');
  assert.doesNotMatch(read('core/app/main.js'), /reaction-choices-fixture/, 'the shipped page never loads it');
});
